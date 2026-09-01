"""Event bus, audit trail and distributed tracing.

One table backs all three. That is a deliberate choice: a separate audit store
that can disagree with the runtime log is worse than one store with a
``category`` discriminator and an index per access pattern. The mandate's nine
forensic questions ("what happened / who did it / why / what did it cost / who
approved it") are each answerable by one indexed query against this table —
see ``Telemetry.explain_trace``.

Writes are buffered and flushed in batches. Per-event commits were the single
largest source of write-lock contention in early benchmarking: at 1000 tasks
each emitting ~8 events, unbuffered writing spent more time in SQLite than in
the runtime. Buffering is safe here because events are observations, not state —
losing the last few on a hard crash costs forensics, not correctness.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable

from af.clock import Clock, SystemClock
from af.ids import new_id
from af.store.sqlite_store import SqliteStore, dumps

__all__ = ["Event", "Telemetry", "EventType"]


class EventType:
    """Stable event type strings. Constants rather than an Enum so that adding
    a type never requires a migration or breaks a stored row."""

    # lifecycle
    CONTRACT_CREATED = "contract.created"
    CONTRACT_VALIDATED = "contract.validated"
    CONTRACT_TESTED = "contract.tested"
    CONTRACT_APPROVED = "contract.approved"
    CONTRACT_REJECTED = "contract.rejected"
    CONTRACT_STATE_CHANGED = "contract.state_changed"
    INSTANCE_SPAWNED = "instance.spawned"
    INSTANCE_RETIRED = "instance.retired"
    INSTANCE_PAUSED = "instance.paused"
    # work
    TASK_SUBMITTED = "task.submitted"
    TASK_READY = "task.ready"
    TASK_CLAIMED = "task.claimed"
    TASK_STARTED = "task.started"
    TASK_COMPLETED = "task.completed"
    TASK_FAILED = "task.failed"
    TASK_RETRIED = "task.retried"
    TASK_TIMEOUT = "task.timeout"
    TASK_CANCELLED = "task.cancelled"
    TASK_DEAD_LETTERED = "task.dead_lettered"
    TASK_LEASE_EXPIRED = "task.lease_expired"
    TASK_DEPS_SATISFIED = "task.deps_satisfied"
    # governance (category=audit)
    PERMISSION_DENIED = "permission.denied"
    ISOLATION_VIOLATION = "isolation.violation"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_GRANTED = "approval.granted"
    APPROVAL_DENIED = "approval.denied"
    APPROVAL_EXPIRED = "approval.expired"
    TOKEN_ISSUED = "token.issued"
    TOKEN_CONSUMED = "token.consumed"
    TOKEN_REJECTED = "token.rejected"
    TOOL_CALLED = "tool.called"
    TOOL_BLOCKED = "tool.blocked"
    BUDGET_EXCEEDED = "budget.exceeded"
    SPAWN_BLOCKED = "spawn.blocked"
    # quality
    QUALITY_EVALUATED = "quality.evaluated"
    QUALITY_REWORK = "quality.rework"
    QUALITY_ESCALATED = "quality.escalated"
    CAPA_OPENED = "capa.opened"
    CAPA_CLOSED = "capa.closed"
    # model / memory
    MODEL_CALLED = "model.called"
    MODEL_ROUTED = "model.routed"
    MEMORY_WRITTEN = "memory.written"
    MEMORY_READ = "memory.read"

#: Types recorded as audit rather than runtime. Audit events are what a
#: regulator or an incident review reads, so they get their own index and are
#: exempt from the runtime retention sweep.
AUDIT_TYPES = frozenset({
    EventType.CONTRACT_APPROVED, EventType.CONTRACT_REJECTED,
    EventType.PERMISSION_DENIED, EventType.ISOLATION_VIOLATION,
    EventType.APPROVAL_REQUESTED, EventType.APPROVAL_GRANTED,
    EventType.APPROVAL_DENIED, EventType.APPROVAL_EXPIRED,
    EventType.TOKEN_ISSUED, EventType.TOKEN_CONSUMED, EventType.TOKEN_REJECTED,
    EventType.TOOL_BLOCKED, EventType.BUDGET_EXCEEDED, EventType.SPAWN_BLOCKED,
    EventType.CAPA_OPENED, EventType.CAPA_CLOSED,
})


@dataclass(slots=True)
class Event:
    type: str
    trace_id: str | None = None
    span_id: str | None = None
    parent_span: str | None = None
    task_id: str | None = None
    agent_id: str | None = None
    project_id: str | None = None
    workflow_id: str | None = None
    status: str | None = None
    duration_ms: float | None = None
    cost_micros: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    model: str | None = None
    provider: str | None = None
    tool: str | None = None
    error_code: str | None = None
    actor: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    ts: float = 0.0
    id: str = ""

    @property
    def category(self) -> str:
        return "audit" if self.type in AUDIT_TYPES else "runtime"


_COLUMNS = (
    "id", "ts", "type", "category", "trace_id", "span_id", "parent_span",
    "task_id", "agent_id", "project_id", "workflow_id", "status", "duration_ms",
    "cost_micros", "tokens_in", "tokens_out", "model", "provider", "tool",
    "error_code", "actor", "payload",
)
_INSERT = (
    f"INSERT INTO events ({', '.join(_COLUMNS)}) "
    f"VALUES ({', '.join('?' * len(_COLUMNS))})"
)


class Telemetry:
    """Buffered event writer plus the forensic query surface."""

    def __init__(
        self,
        store: SqliteStore,
        clock: Clock | None = None,
        *,
        buffer_size: int = 256,
        subscribers: list[Callable[[Event], None]] | None = None,
    ) -> None:
        self.store = store
        self.clock = clock or SystemClock()
        self.buffer_size = buffer_size
        self._buf: list[tuple] = []
        self._lock = threading.Lock()
        # In-process fan-out. The real system would publish to a broker here;
        # the subscriber list is the seam where that adapter plugs in.
        self._subscribers = subscribers or []

    def subscribe(self, fn: Callable[[Event], None]) -> None:
        self._subscribers.append(fn)

    def emit(self, event: Event) -> Event:
        event.id = event.id or new_id("evt")
        event.ts = event.ts or self.clock.now()
        row = (
            event.id, event.ts, event.type, event.category, event.trace_id,
            event.span_id, event.parent_span, event.task_id, event.agent_id,
            event.project_id, event.workflow_id, event.status, event.duration_ms,
            event.cost_micros, event.tokens_in, event.tokens_out, event.model,
            event.provider, event.tool, event.error_code, event.actor,
            dumps(event.payload),
        )
        flush_now: list[tuple] | None = None
        with self._lock:
            self._buf.append(row)
            # Audit events bypass buffering: if the process dies, the record of
            # who approved what must already be durable.
            if len(self._buf) >= self.buffer_size or event.category == "audit":
                flush_now, self._buf = self._buf, []
        if flush_now:
            self._write(flush_now)
        for fn in self._subscribers:
            try:
                fn(event)
            except Exception:
                # A broken subscriber must never fail the emitting operation.
                pass
        return event

    def _write(self, rows: list[tuple]) -> None:
        with self.store.write() as c:
            c.executemany(_INSERT, rows)

    def flush(self) -> int:
        with self._lock:
            rows, self._buf = self._buf, []
        if rows:
            self._write(rows)
        return len(rows)

    # -- forensic queries ------------------------------------------------
    def trace(self, trace_id: str) -> list[dict[str, Any]]:
        self.flush()
        return [dict(r) for r in self.store.all(
            "SELECT * FROM events WHERE trace_id = ? ORDER BY ts, id", (trace_id,))]

    def task_events(self, task_id: str) -> list[dict[str, Any]]:
        self.flush()
        return [dict(r) for r in self.store.all(
            "SELECT * FROM events WHERE task_id = ? ORDER BY ts, id", (task_id,))]

    def audit_trail(self, project_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        self.flush()
        if project_id:
            sql = ("SELECT * FROM events WHERE category = 'audit' AND project_id = ? "
                   "ORDER BY ts DESC LIMIT ?")
            params: tuple = (project_id, limit)
        else:
            sql = "SELECT * FROM events WHERE category = 'audit' ORDER BY ts DESC LIMIT ?"
            params = (limit,)
        return [dict(r) for r in self.store.all(sql, params)]

    def explain_trace(self, trace_id: str) -> dict[str, Any]:
        """Answer the mandate's forensic questions for one trace in one call.

        This exists as a named method rather than a documented query because a
        capability that requires knowing the schema is a capability most people
        will not have during an incident.
        """
        rows = self.trace(trace_id)
        if not rows:
            return {"trace_id": trace_id, "found": False}
        tools = [r for r in rows if r["tool"]]
        approvals = [r for r in rows if r["type"].startswith("approval.")]
        failures = [r for r in rows if r["error_code"]]
        return {
            "trace_id": trace_id,
            "found": True,
            "what_happened": [r["type"] for r in rows],
            "agents_involved": sorted({r["agent_id"] for r in rows if r["agent_id"]}),
            "projects": sorted({r["project_id"] for r in rows if r["project_id"]}),
            "tools_called": [{"tool": r["tool"], "status": r["status"], "agent": r["agent_id"]}
                             for r in tools],
            "approvals": [{"type": r["type"], "actor": r["actor"], "ts": r["ts"]}
                          for r in approvals],
            "failures": [{"type": r["type"], "error": r["error_code"], "agent": r["agent_id"]}
                         for r in failures],
            "total_cost_micros": sum(r["cost_micros"] or 0 for r in rows),
            "total_tokens": sum((r["tokens_in"] or 0) + (r["tokens_out"] or 0) for r in rows),
            "span_count": len(rows),
            "started_at": rows[0]["ts"],
            "ended_at": rows[-1]["ts"],
            "duration_ms": (rows[-1]["ts"] - rows[0]["ts"]) * 1000.0,
        }
