"""Composition root.

One place where every component is constructed and wired, so that dependency
direction is visible in a single file rather than inferred across a dozen
imports. Nothing below this module constructs its own collaborators — they are
all injected, which is what makes the whole stack testable with a ManualClock
and a mock provider.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from af.budget.governor import BudgetGovernor
from af.clock import Clock, SystemClock
from af.factory import AgentFactory
from af.governance.approvals import ApprovalEngine
from af.governance.permissions import PermissionEngine, Principal
from af.memory.layers import MemoryStore
from af.quality.capa import CapaEngine
from af.quality.gates import QualityEngine
from af.registry import AgentRegistry
from af.router.model_router import ModelRouter
from af.router.providers import MockProvider
from af.runtime import AgentBehaviour, AgentRuntime
from af.scheduler.queue import TaskQueue
from af.store.batch import WriteBatcher
from af.store.sqlite_store import SqliteStore
from af.telemetry.events import Telemetry
from af.tools.builtin import register_builtin_tools
from af.tools.gateway import ToolGateway, ToolRegistry

__all__ = ["AgentFactorySystem", "build_system"]


@dataclass
class AgentFactorySystem:
    store: SqliteStore
    clock: Clock
    telemetry: Telemetry
    permissions: PermissionEngine
    registry: AgentRegistry
    tools: ToolRegistry
    approvals: ApprovalEngine
    budget: BudgetGovernor
    gateway: ToolGateway
    memory: MemoryStore
    router: ModelRouter
    quality: QualityEngine
    capa: CapaEngine
    queue: TaskQueue
    factory: AgentFactory
    runtime: AgentRuntime
    batcher: WriteBatcher

    def owner(self, owner_id: str = "owner") -> Principal:
        return Principal.owner(owner_id)

    def flush(self) -> dict[str, int]:
        """Force every write-behind buffer to disk.

        Must be called before reading batched tables (reviews, ledger, tool
        calls) or the reader sees stale data. Every reporting surface in this
        class calls it; callers doing ad-hoc SQL against those tables must too.
        """
        return {"events": self.telemetry.flush(), "rows": self.batcher.flush()}

    def maintenance_tick(self) -> dict[str, int]:
        """One pass of every background sweep.

        Grouped into a single call because these must all run for the system to
        be self-healing, and it is easy to deploy a scheduler that forgets one.
        In production each of these would be its own periodic job; here they are
        explicit and individually testable.
        """
        self.flush()
        return {
            "leases_reaped": self.queue.reap_expired_leases(),
            "deadlines_enforced": self.queue.enforce_deadlines(),
            "approvals_expired": self.approvals.expire_stale(),
            "memory_swept": self.memory.sweep_expired(),
            "instances_retired": self.factory.retire_idle_instances(),
        }

    def control_center(self, project_id: str | None = None) -> dict[str, Any]:
        """Backend for the future operational dashboard.

        Every panel the mandate lists is served from here. Deliberately a plain
        dict from indexed queries rather than a UI: the mandate is explicit that
        runtime architecture comes before cosmetics.
        """
        self.flush()
        queue_stats = self.queue.stats(project_id)
        overview = self.registry.workforce_overview(project_id)
        return {
            "workforce": overview,
            "queues": queue_stats.to_dict(),
            "quality": self._quality_summary(project_id),
            "approvals_pending": len(self.approvals.pending(project_id)),
            "capa_open": len(self.capa.open_records(project_id)),
            "memory": self.memory.stats(project_id),
            "cost": self.budget.project_spend(project_id) if project_id else {},
            "top_spenders": self.budget.top_spenders(project_id, limit=5),
            "models": self.router.fleet(),
            "tools": [t.to_dict() for t in self.tools.list(project_id=project_id)],
            "failures": self._failure_summary(project_id),
        }

    def _quality_summary(self, project_id: str | None) -> dict[str, Any]:
        where, params = ("WHERE project_id = ?", (project_id,)) if project_id else ("", ())
        rows = self.store.all(
            f"SELECT verdict, count(*) AS n, AVG(score) AS avg_score "
            f"FROM quality_reviews {where} GROUP BY verdict", params)
        return {r["verdict"]: {"count": r["n"], "avg_score": round(r["avg_score"] or 0, 4)}
                for r in rows}

    def _failure_summary(self, project_id: str | None) -> dict[str, Any]:
        where, params = ("AND project_id = ?", (project_id,)) if project_id else ("", ())
        by_code = {r["error_code"]: r["n"] for r in self.store.all(
            f"SELECT error_code, count(*) AS n FROM events "
            f"WHERE error_code IS NOT NULL {where} GROUP BY error_code "
            f"ORDER BY n DESC LIMIT 10", params)}
        dlq = self.store.scalar(
            f"SELECT count(*) FROM tasks WHERE status = 'DEAD_LETTER' "
            f"{'AND project_id = ?' if project_id else ''}", params) or 0
        return {"by_error_code": by_code, "dead_letter_tasks": dlq}


def build_system(path: str = ":memory:", *, clock: Clock | None = None,
                 behaviour: AgentBehaviour | None = None,
                 providers: list | None = None,
                 max_queue_depth: int = 100_000,
                 event_buffer: int = 256,
                 batch_rows: int = 64) -> AgentFactorySystem:
    clock = clock or SystemClock()
    store = SqliteStore(path)
    telemetry = Telemetry(store, clock, buffer_size=event_buffer)
    batcher = WriteBatcher(store, max_batch=batch_rows)
    permissions = PermissionEngine(telemetry)
    registry = AgentRegistry(store)
    tools = register_builtin_tools(ToolRegistry(), store=store)
    approvals = ApprovalEngine(store, telemetry, permissions, clock)
    budget = BudgetGovernor(store, telemetry, clock, batcher=batcher)
    gateway = ToolGateway(store, tools, telemetry, permissions, approvals, budget,
                          clock, batcher=batcher)
    memory = MemoryStore(store, telemetry, permissions, clock)

    router = ModelRouter(telemetry, clock)
    for provider in (providers or [MockProvider("mockprov"), MockProvider("altprov")]):
        router.register(provider)

    quality = QualityEngine(store, telemetry, clock, batcher=batcher)
    capa = CapaEngine(store, telemetry, permissions, clock)
    queue = TaskQueue(store, telemetry, clock, max_queue_depth=max_queue_depth)
    factory = AgentFactory(store, registry, telemetry, permissions, clock,
                           tool_ids=tools.ids())
    runtime = AgentRuntime(store, registry, factory, queue, telemetry, permissions,
                           gateway, memory, router, quality, budget, clock,
                           behaviour=behaviour)
    return AgentFactorySystem(
        store=store, clock=clock, telemetry=telemetry, permissions=permissions,
        registry=registry, tools=tools, approvals=approvals, budget=budget,
        gateway=gateway, memory=memory, router=router, quality=quality, capa=capa,
        queue=queue, factory=factory, runtime=runtime, batcher=batcher)
