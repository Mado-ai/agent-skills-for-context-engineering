"""Structured delegation: work packets, authority narrowing, DAG dependencies,
and recursion limits.

Replaces free-form agent-to-agent messages with a record whose fields the
runtime enforces. A natural-language instruction carries no enforceable
constraints; a packet carries budget, tools, deadline, depth and spawn
allowance as data the receiving model cannot alter.

Use when:
    - One agent assigns work to another.
    - Sub-agents can spawn further sub-agents.
    - Tasks have dependencies, or parallel results must be joined.
    - An agent system has produced runaway recursion or surprising cost.

Standard library only. The dependency graph is in-memory here; the invariants
are what transfer.

Typical usage::

    graph = TaskGraph()
    root = WorkPacket(project_id="p1", objective="research topic",
                      budget_micros=1_000, spawn_budget=4)
    graph.submit(root)
    child = root.child(objective="search sources")   # authority can only narrow
    graph.submit(child, depends_on=())
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Iterable

__all__ = [
    "TaskStatus", "Priority", "WorkPacket", "SpawnPolicy", "SpawnLimitExceeded",
    "check_spawn", "TaskGraph",
]


class SpawnLimitExceeded(Exception):
    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


class TaskStatus(str, Enum):
    BLOCKED = "BLOCKED"      # waiting on dependencies
    READY = "READY"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Priority(int, Enum):
    """Lower sorts first, like UNIX nice. This lets a claim index be walked in
    ascending order and stopped at LIMIT without a sort."""

    CRITICAL = 0
    HIGH = 25
    NORMAL = 100
    LOW = 200
    BACKGROUND = 500


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


@dataclass
class WorkPacket:
    """A unit of delegated work.

    Every field exists because something downstream enforces it. Fields nothing
    reads are decoration and should be removed.
    """

    id: str = field(default_factory=lambda: _uid("tsk"))
    trace_id: str = field(default_factory=lambda: _uid("trc"))
    root_id: str = ""
    parent_task_id: str | None = None
    project_id: str = ""

    sender_agent_id: str | None = None
    #: A KIND of agent, not a specific instance. Naming an instance couples the
    #: sender to fleet state and prevents elastic scaling.
    receiver_template_id: str | None = None

    objective: str = ""
    inputs: dict[str, Any] = field(default_factory=dict)
    #: References into shared storage, not inlined content: keeps packets small
    #: and lets the receiver apply its own context policy.
    context_refs: tuple[str, ...] = ()
    required_output_schema: dict[str, Any] = field(default_factory=dict)

    allowed_tools: tuple[str, ...] = ()
    budget_micros: int = 100_000
    token_budget: int = 100_000
    deadline_at: float | None = None
    priority: int = int(Priority.NORMAL)

    # Recursion controls travel WITH the work, so they hold across process and
    # worker boundaries.
    depth: int = 0
    spawn_budget: int = 8
    max_attempts: int = 3
    idempotency_key: str | None = None

    def __post_init__(self) -> None:
        if not self.root_id:
            self.root_id = self.id

    def child(self, **overrides: Any) -> "WorkPacket":
        """Derive a sub-packet whose authority is never wider than this one's.

        The clamp runs AFTER overrides are applied. Clamping first lets a caller
        widen authority by passing a larger value afterwards, and the resulting
        code still reads as correct.
        """
        child = WorkPacket(
            trace_id=self.trace_id,          # one trace for the whole tree
            root_id=self.root_id,
            parent_task_id=self.id,
            project_id=self.project_id,
            sender_agent_id=self.receiver_template_id,
            depth=self.depth + 1,
            priority=self.priority,
            budget_micros=self.budget_micros,
            token_budget=self.token_budget,
            spawn_budget=max(0, self.spawn_budget - 1),
            deadline_at=self.deadline_at,
            max_attempts=self.max_attempts,
            allowed_tools=self.allowed_tools)

        for key, value in overrides.items():
            setattr(child, key, value)

        # --- enforcement, not validation: correct the caller rather than trust it
        child.budget_micros = min(child.budget_micros, self.budget_micros)
        child.token_budget = min(child.token_budget, self.token_budget)
        child.spawn_budget = min(child.spawn_budget, max(0, self.spawn_budget - 1))
        child.depth = self.depth + 1
        child.trace_id = self.trace_id
        child.root_id = self.root_id
        child.parent_task_id = self.id
        if self.deadline_at is not None:
            child.deadline_at = (self.deadline_at if child.deadline_at is None
                                 else min(child.deadline_at, self.deadline_at))
        # A child may only use tools the parent itself was allowed to use.
        if self.allowed_tools:
            child.allowed_tools = tuple(t for t in child.allowed_tools
                                        if t in self.allowed_tools)
        return child


@dataclass(frozen=True)
class SpawnPolicy:
    max_spawn_depth: int = 3
    max_children_per_task: int = 8
    #: The backstop. Depth and width limits that look individually reasonable
    #: multiply into numbers nobody intended.
    max_total_spawns: int = 200


def check_spawn(*, depth: int, siblings: int, tree_size: int,
                policy: SpawnPolicy) -> None:
    """Three independent limits, all checked BEFORE the child is created."""
    if depth > policy.max_spawn_depth:
        raise SpawnLimitExceeded(
            "depth", f"spawn depth {depth} exceeds limit {policy.max_spawn_depth}")
    if siblings >= policy.max_children_per_task:
        raise SpawnLimitExceeded(
            "fan_out",
            f"task already has {siblings} children (limit {policy.max_children_per_task})")
    if tree_size >= policy.max_total_spawns:
        raise SpawnLimitExceeded(
            "tree_size",
            f"task tree already has {tree_size} tasks (limit {policy.max_total_spawns})")


class TaskGraph:
    """Dependency tracking with fan-out, fan-in, and an explicit failure path."""

    def __init__(self, policy: SpawnPolicy | None = None) -> None:
        self.policy = policy or SpawnPolicy()
        self.tasks: dict[str, WorkPacket] = {}
        self.status: dict[str, TaskStatus] = {}
        self.pending_deps: dict[str, int] = {}
        self.dependents: dict[str, list[str]] = {}
        self.reasons: dict[str, str] = {}
        self._idempotency: dict[tuple[str, str], str] = {}

    def submit(self, packet: WorkPacket, depends_on: Iterable[str] = ()) -> str:
        # Idempotency: a duplicate submission returns the existing task rather
        # than creating a second one. In a database this is a unique constraint,
        # so concurrent duplicates collide there instead of racing.
        if packet.idempotency_key:
            key = (packet.project_id, packet.idempotency_key)
            if key in self._idempotency:
                return self._idempotency[key]
            self._idempotency[key] = packet.id

        depends_on = [d for d in depends_on
                      if self.status.get(d) is not TaskStatus.COMPLETED]
        self.tasks[packet.id] = packet
        self.pending_deps[packet.id] = len(depends_on)
        self.status[packet.id] = (TaskStatus.BLOCKED if depends_on else TaskStatus.READY)
        for dependency in depends_on:
            self.dependents.setdefault(dependency, []).append(packet.id)
        return packet.id

    def spawn_child(self, parent: WorkPacket, **overrides: Any) -> WorkPacket:
        """Create and submit a child under the full recursion controls."""
        siblings = sum(1 for t in self.tasks.values() if t.parent_task_id == parent.id)
        tree_size = sum(1 for t in self.tasks.values() if t.root_id == parent.root_id)
        check_spawn(depth=parent.depth + 1, siblings=siblings, tree_size=tree_size,
                    policy=self.policy)
        if parent.spawn_budget <= 0:
            raise SpawnLimitExceeded("spawn_budget",
                                     "this packet's spawn budget is exhausted")
        child = parent.child(**overrides)
        self.submit(child)
        return child

    def complete(self, task_id: str) -> list[str]:
        """Mark done and release dependents that have no remaining blockers."""
        self.status[task_id] = TaskStatus.COMPLETED
        released = []
        for dependent in self.dependents.get(task_id, []):
            # Decrement and promote together: a task must never be observable
            # at pending_deps == 0 while still BLOCKED.
            self.pending_deps[dependent] -= 1
            if (self.pending_deps[dependent] <= 0
                    and self.status[dependent] is TaskStatus.BLOCKED):
                self.status[dependent] = TaskStatus.READY
                released.append(dependent)
        return released

    def fail(self, task_id: str, reason: str = "failed") -> list[str]:
        """Terminal failure, WITH an explicit path for waiters.

        Without this, a fan-in join blocks forever on a dead branch — which
        presents as a mysterious stall rather than as a failure.
        """
        self.status[task_id] = TaskStatus.FAILED
        self.reasons[task_id] = reason
        cancelled = []
        queue = list(self.dependents.get(task_id, []))
        while queue:
            waiter = queue.pop()
            if self.status.get(waiter) in (TaskStatus.BLOCKED, TaskStatus.READY):
                self.status[waiter] = TaskStatus.CANCELLED
                self.reasons[waiter] = "dependency_failed"
                cancelled.append(waiter)
                queue.extend(self.dependents.get(waiter, []))
        return cancelled

    def ready(self) -> list[WorkPacket]:
        """Runnable tasks, highest priority first."""
        runnable = [self.tasks[i] for i, s in self.status.items()
                    if s is TaskStatus.READY]
        return sorted(runnable, key=lambda p: (p.priority, p.id))

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for status in self.status.values():
            out[status.value] = out.get(status.value, 0) + 1
        return out


# --------------------------------------------------------------------------
if __name__ == "__main__":
    print("1. Delegation can only narrow authority")
    parent = WorkPacket(project_id="p1", objective="research",
                        budget_micros=1_000, token_budget=5_000,
                        spawn_budget=3, allowed_tools=("search", "fetch"))
    child = parent.child(objective="try to widen", budget_micros=10**9,
                         token_budget=10**9, spawn_budget=99,
                         allowed_tools=("search", "shell", "sql"))
    print(f"   budget  {parent.budget_micros} -> {child.budget_micros}")
    print(f"   spawn   {parent.spawn_budget} -> {child.spawn_budget}")
    print(f"   tools   {parent.allowed_tools} -> {child.allowed_tools}")
    print(f"   trace preserved: {child.trace_id == parent.trace_id}\n")

    print("2. Fan-out then fan-in")
    graph = TaskGraph()
    graph.submit(parent)
    branches = [graph.spawn_child(parent, objective=f"branch {i}") for i in range(3)]
    join = parent.child(objective="synthesise", priority=int(Priority.HIGH))
    graph.submit(join, depends_on=[b.id for b in branches])
    print(f"   join starts: {graph.status[join.id].value} "
          f"(pending {graph.pending_deps[join.id]})")
    for branch in branches[:-1]:
        graph.complete(branch.id)
    print(f"   after 2 of 3: {graph.status[join.id].value}")
    graph.complete(branches[-1].id)
    print(f"   after 3 of 3: {graph.status[join.id].value}\n")

    print("3. A dead branch cancels its waiters instead of stalling")
    g2 = TaskGraph()
    dep = WorkPacket(project_id="p1", objective="fragile")
    waiter = WorkPacket(project_id="p1", objective="waits on fragile")
    g2.submit(dep)
    g2.submit(waiter, depends_on=[dep.id])
    cancelled = g2.fail(dep.id, "unrecoverable")
    print(f"   cancelled waiters: {len(cancelled)} "
          f"reason={g2.reasons[waiter.id]}\n")

    print("4. Three independent recursion limits")
    policy = SpawnPolicy(max_spawn_depth=3, max_children_per_task=8,
                         max_total_spawns=200)
    for label, kwargs in (
            ("depth", dict(depth=9, siblings=0, tree_size=0)),
            ("fan_out", dict(depth=1, siblings=8, tree_size=0)),
            ("tree_size", dict(depth=1, siblings=0, tree_size=200))):
        try:
            check_spawn(policy=policy, **kwargs)
            print(f"   *** FAILURE: {label} not enforced")
        except SpawnLimitExceeded as exc:
            print(f"   {exc.reason}: {exc}")
    print(f"\n   depth 3 x fan-out 50 would be {50 ** 3:,} tasks "
          f"— why the tree cap is the backstop\n")

    print("5. Idempotent submission")
    g3 = TaskGraph()
    a = g3.submit(WorkPacket(project_id="p1", objective="once", idempotency_key="K"))
    b = g3.submit(WorkPacket(project_id="p1", objective="again", idempotency_key="K"))
    print(f"   same id returned: {a == b}   tasks stored: {len(g3.tasks)}")
