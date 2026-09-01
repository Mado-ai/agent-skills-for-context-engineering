"""The WorkPacket — the only sanctioned way for one agent to give another work.

Agents do not converse. They exchange packets. Every field below exists because
something downstream enforces it: ``allowed_tools`` narrows the gateway,
``budget`` is debited before execution, ``required_output_schema`` is what the
schema gate validates against, ``depth``/``spawn_budget`` are what stop runaway
recursion.

Free-form agent chat was rejected for this role deliberately (ADR-0003): an
unstructured message carries no enforceable constraints, so every governance
check would have to be re-derived from natural language by the receiving model —
which is to say, not enforced at all.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

from af.ids import new_id, new_trace_id

__all__ = ["TaskStatus", "Priority", "WorkPacket", "TERMINAL_STATUSES", "ACTIVE_STATUSES"]


class TaskStatus(str, Enum):
    BLOCKED = "BLOCKED"          # waiting on dependencies
    READY = "READY"              # claimable
    RUNNING = "RUNNING"          # leased by a worker
    REVIEW = "REVIEW"            # executed, awaiting quality verdict
    REWORK = "REWORK"            # failed quality, queued for another attempt
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"            # retries exhausted
    CANCELLED = "CANCELLED"
    DEAD_LETTER = "DEAD_LETTER"  # unprocessable; needs human eyes
    WAITING_APPROVAL = "WAITING_APPROVAL"


TERMINAL_STATUSES = frozenset({
    TaskStatus.COMPLETED, TaskStatus.FAILED,
    TaskStatus.CANCELLED, TaskStatus.DEAD_LETTER,
})
ACTIVE_STATUSES = frozenset({
    TaskStatus.BLOCKED, TaskStatus.READY, TaskStatus.RUNNING,
    TaskStatus.REVIEW, TaskStatus.REWORK, TaskStatus.WAITING_APPROVAL,
})


class Priority(int, Enum):
    """Lower sorts first — the same convention as UNIX nice, and the reason the
    claim index can walk ascending and stop at LIMIT."""

    CRITICAL = 0
    HIGH = 25
    NORMAL = 100
    LOW = 200
    BACKGROUND = 500


@dataclass(slots=True)
class WorkPacket:
    """A unit of delegated work. Immutable in spirit: a rework produces a new
    packet with an incremented attempt rather than mutating the original, so
    the audit trail keeps both."""

    id: str = field(default_factory=lambda: new_id("tsk"))
    trace_id: str = field(default_factory=new_trace_id)
    root_id: str = ""                       # root of this task tree; defaults to id
    parent_task_id: str | None = None
    project_id: str = ""
    workflow_id: str | None = None

    sender_agent_id: str | None = None
    #: Target either a specific live instance or a template (the factory then
    #: picks or spawns an instance). Template targeting is what makes elastic
    #: scaling possible — the sender does not need to know who exists.
    receiver_instance_id: str | None = None
    receiver_template_id: str | None = None

    objective: str = ""
    inputs: dict[str, Any] = field(default_factory=dict)
    #: References into memory rather than inlined content. Passing a reference
    #: keeps the packet small and lets the receiver apply its own context policy
    #: when deciding how much to actually load.
    context_refs: tuple[str, ...] = ()
    allowed_tools: tuple[str, ...] = ()
    required_output_schema: dict[str, Any] = field(default_factory=dict)
    constraints: dict[str, Any] = field(default_factory=dict)

    # governance envelope
    budget_micros: int = 100_000
    token_budget: int = 100_000
    deadline_at: float | None = None
    priority: int = int(Priority.NORMAL)
    quality_policy: dict[str, Any] = field(default_factory=dict)
    escalation_policy: dict[str, Any] = field(default_factory=dict)

    # recursion controls — carried in the packet so limits travel with the work
    depth: int = 0
    spawn_budget: int = 8                   # children this packet may create
    max_attempts: int = 3
    idempotency_key: str | None = None

    def __post_init__(self) -> None:
        if not self.root_id:
            self.root_id = self.id

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkPacket":
        d = dict(data)
        for t in ("context_refs", "allowed_tools"):
            if d.get(t) is not None:
                d[t] = tuple(d[t])
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in d.items() if k in known})

    def child(self, **overrides: Any) -> "WorkPacket":
        """Derive a sub-packet.

        The child inherits the trace and root (so the whole tree is one trace),
        sits one level deeper, and — critically — cannot be given a larger
        budget or spawn allowance than the parent holds. Delegation may only
        narrow authority, never widen it.
        """
        child = WorkPacket(
            trace_id=self.trace_id,
            root_id=self.root_id,
            parent_task_id=self.id,
            project_id=self.project_id,
            workflow_id=self.workflow_id,
            sender_agent_id=self.receiver_instance_id,
            depth=self.depth + 1,
            priority=self.priority,
            budget_micros=self.budget_micros,
            token_budget=self.token_budget,
            spawn_budget=max(0, self.spawn_budget - 1),
            deadline_at=self.deadline_at,
            max_attempts=self.max_attempts,
        )
        for key, value in overrides.items():
            setattr(child, key, value)
        # Clamp after applying overrides so a caller cannot widen by passing a
        # larger value. This is enforcement, not validation: it corrects rather
        # than trusting the caller to have asked for something legal.
        child.budget_micros = min(child.budget_micros, self.budget_micros)
        child.token_budget = min(child.token_budget, self.token_budget)
        child.spawn_budget = min(child.spawn_budget, max(0, self.spawn_budget - 1))
        child.depth = self.depth + 1
        child.trace_id = self.trace_id
        child.root_id = self.root_id
        child.parent_task_id = self.id
        # A child may only use tools the parent was itself allowed to use.
        if self.allowed_tools:
            child.allowed_tools = tuple(t for t in child.allowed_tools if t in self.allowed_tools)
        return child
