"""Event recording, audit separation, and forensic trace reconstruction for
agent systems.

An agent system is observable when someone holding one trace identifier can
answer nine questions without knowing the schema: what happened, which agent,
why, which information, what cost, which tool, who approved, what failed, who
corrected it. `explain_trace` answers all nine in one call.

Use when:
    - Multiple agents collaborate on one request.
    - An agent run produced a wrong or expensive result and the cause is unclear.
    - Actions must be auditable for compliance or review.

Standard library only. Uses SQLite so the indexes and retention behaviour are
real rather than illustrative.

Typical usage::

    tel = Telemetry(":memory:")
    tel.emit(Event(type=EventType.TASK_SUBMITTED, trace_id=t, task_id=k))
    report = tel.explain_trace(t)
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

__all__ = ["Event", "EventType", "Telemetry", "AUDIT_TYPES", "percentiles"]


class EventType:
    """Stable strings rather than an Enum: adding a type must never require a
    migration or invalidate a stored row."""

    # lifecycle
    CONTRACT_APPROVED = "contract.approved"
    INSTANCE_SPAWNED = "instance.spawned"
    INSTANCE_RETIRED = "instance.retired"
    # work
    TASK_SUBMITTED = "task.submitted"
    TASK_CLAIMED = "task.claimed"
    TASK_STARTED = "task.started"
    TASK_COMPLETED = "task.completed"
    TASK_FAILED = "task.failed"
    TASK_RETRIED = "task.retried"
    TASK_DEAD_LETTERED = "task.dead_lettered"
    # governance (audit)
    PERMISSION_DENIED = "permission.denied"
    ISOLATION_VIOLATION = "isolation.violation"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_GRANTED = "approval.granted"
    TOKEN_CONSUMED = "token.consumed"
    TOKEN_REJECTED = "token.rejected"
    TOOL_BLOCKED = "tool.blocked"
    BUDGET_EXCEEDED = "budget.exceeded"
    SPAWN_BLOCKED = "spawn.blocked"
    CAPA_OPENED = "capa.opened"
    CAPA_CLOSED = "capa.closed"
    # resources
    TOOL_CALLED = "tool.called"
    MODEL_ROUTED = "model.routed"
    MODEL_CALLED = "model.called"
    MEMORY_READ = "memory.read"
    MEMORY_WRITTEN = "memory.written"
    # quality
    QUALITY_EVALUATED = "quality.evaluated"
    QUALITY_ESCALATED = "quality.escalated"


#: Recorded as audit rather than runtime. These are what a regulator or an
#: incident review reads, so they get their own index, are never sampled, and
#: are exempt from the runtime retention sweep.
AUDIT_TYPES = frozenset({
    EventType.CONTRACT_APPROVED, EventType.PERMISSION_DENIED,
    EventType.ISOLATION_VIOLATION, EventType.APPROVAL_REQUESTED,
    EventType.APPROVAL_GRANTED, EventType.TOKEN_CONSUMED,
    EventType.TOKEN_REJECTED, EventType.TOOL_BLOCKED,
    EventType.BUDGET_EXCEEDED, EventType.SPAWN_BLOCKED,
    EventType.CAPA_OPENED, EventType.CAPA_CLOSED,
})


@dataclass
class Event:
    type: str
    trace_id: str | None = None
    span_id: str | None = None
    parent_span: str | None = None
    task_id: str | None = None
    agent_id: str | None = None
    project_id: str | None = None
    status: str | None = None
    duration_ms: float | None = None
    cost_micros: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    model: str | None = None
    provider: str | None = None
    tool: str | None = None
    error_code: str | None = None
    #: WHO acted. Without a distinct actor field an approval event records only
    #: that an approval happened — never who gave it, which is usually the first
    #: question asked.
    actor: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    ts: float = 0.0
    id: str = ""

    @property
    def category(self) -> str:
        return "audit" if self.type in AUDIT_TYPES else "runtime"


_COLUMNS = ("id", "ts", "type", "category", "trace_id", "span_id", "parent_span",
            "task_id", "agent_id", "project_id", "status", "duration_ms",
            "cost_micros", "tokens_in", "tokens_out", "model", "provider", "tool",
            "error_code", "actor", "payload")
_INSERT = (f"INSERT INTO events ({', '.join(_COLUMNS)}) "
           f"VALUES ({', '.join('?' * len(_COLUMNS))})")


class Telemetry:
    """Buffered event writer plus the forensic query surface."""

    def __init__(self, path: str = ":memory:", *, buffer_size: int = 128,
                 now: Callable[[], float] = time.time) -> None:
        self.conn = sqlite3.connect(path, isolation_level=None,
                                    check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, ts REAL NOT NULL, type TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'runtime',
                trace_id TEXT, span_id TEXT, parent_span TEXT, task_id TEXT,
                agent_id TEXT, project_id TEXT, status TEXT, duration_ms REAL,
                cost_micros INTEGER, tokens_in INTEGER, tokens_out INTEGER,
                model TEXT, provider TEXT, tool TEXT, error_code TEXT,
                actor TEXT, payload TEXT NOT NULL DEFAULT '{}')
        """)
        # One index per access pattern. The audit index is PARTIAL, so an audit
        # query never scans runtime volume.
        for statement in (
            "CREATE INDEX IF NOT EXISTS idx_events_trace ON events (trace_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_events_task ON events (task_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_events_type ON events (type, ts)",
            "CREATE INDEX IF NOT EXISTS idx_events_audit ON events (ts) WHERE category = 'audit'",
        ):
            self.conn.execute(statement)
        self.now = now
        self.buffer_size = buffer_size
        self._buf: list[tuple] = []
        self._lock = threading.Lock()
        self._seq = 0

    def emit(self, event: Event) -> Event:
        """Buffer runtime events; flush audit events immediately.

        Buffering is safe for observations — losing the last few on a hard crash
        costs forensics, not correctness. It is NOT safe for audit: a record of
        who approved or was denied something must survive precisely the crash
        worth investigating.
        """
        self._seq += 1
        event.id = event.id or f"evt_{self._seq:09d}"
        event.ts = event.ts or self.now()
        row = (event.id, event.ts, event.type, event.category, event.trace_id,
               event.span_id, event.parent_span, event.task_id, event.agent_id,
               event.project_id, event.status, event.duration_ms, event.cost_micros,
               event.tokens_in, event.tokens_out, event.model, event.provider,
               event.tool, event.error_code, event.actor,
               json.dumps(event.payload, default=str))
        pending: list[tuple] | None = None
        with self._lock:
            self._buf.append(row)
            if len(self._buf) >= self.buffer_size or event.category == "audit":
                pending, self._buf = self._buf, []
        if pending:
            self.conn.executemany(_INSERT, pending)
        return event

    def flush(self) -> int:
        with self._lock:
            rows, self._buf = self._buf, []
        if rows:
            self.conn.executemany(_INSERT, rows)
        return len(rows)

    # -- forensic surface ---------------------------------------------------
    def trace(self, trace_id: str) -> list[dict[str, Any]]:
        self.flush()
        return [dict(r) for r in self.conn.execute(
            "SELECT * FROM events WHERE trace_id = ? ORDER BY ts, id", (trace_id,))]

    def task_events(self, task_id: str) -> list[dict[str, Any]]:
        self.flush()
        return [dict(r) for r in self.conn.execute(
            "SELECT * FROM events WHERE task_id = ? ORDER BY ts, id", (task_id,))]

    def audit_trail(self, limit: int = 100) -> list[dict[str, Any]]:
        self.flush()
        return [dict(r) for r in self.conn.execute(
            "SELECT * FROM events WHERE category = 'audit' ORDER BY ts DESC LIMIT ?",
            (limit,))]

    def explain_trace(self, trace_id: str) -> dict[str, Any]:
        """Answer the nine forensic questions in one call.

        A named method rather than a documented query, because a capability
        requiring schema knowledge is one most people will not have during an
        incident — which is exactly when it is needed.
        """
        rows = self.trace(trace_id)
        if not rows:
            return {"trace_id": trace_id, "found": False}
        return {
            "trace_id": trace_id,
            "found": True,
            # 1. what happened
            "what_happened": [r["type"] for r in rows],
            # 2. which agent
            "agents_involved": sorted({r["agent_id"] for r in rows if r["agent_id"]}),
            # 4. which information
            "memory_reads": sum(1 for r in rows if r["type"] == EventType.MEMORY_READ),
            # 5. what it cost
            "total_cost_micros": sum(r["cost_micros"] or 0 for r in rows),
            "total_tokens": sum((r["tokens_in"] or 0) + (r["tokens_out"] or 0)
                                for r in rows),
            # 6. which tool
            "tools_called": [{"tool": r["tool"], "status": r["status"],
                              "agent": r["agent_id"]} for r in rows if r["tool"]],
            # 7. who approved
            "approvals": [{"type": r["type"], "actor": r["actor"], "ts": r["ts"]}
                          for r in rows if r["type"].startswith("approval.")],
            # 8. what failed
            "failures": [{"type": r["type"], "error": r["error_code"],
                          "agent": r["agent_id"]} for r in rows if r["error_code"]],
            # 9. who corrected it
            "corrections": [{"type": r["type"], "actor": r["actor"]} for r in rows
                            if r["type"].startswith("capa.")],
            "span_count": len(rows),
            "duration_ms": (rows[-1]["ts"] - rows[0]["ts"]) * 1000.0,
        }

    # -- volume ----------------------------------------------------------------
    def volume(self) -> dict[str, Any]:
        self.flush()
        by_category = {r["category"]: r["n"] for r in self.conn.execute(
            "SELECT category, count(*) AS n FROM events GROUP BY category")}
        tasks = self.conn.execute(
            "SELECT count(DISTINCT task_id) FROM events WHERE task_id IS NOT NULL"
        ).fetchone()[0] or 1
        total = sum(by_category.values())
        return {"by_category": by_category, "total": total,
                "distinct_tasks": tasks,
                "events_per_task": round(total / tasks, 2)}

    def sweep_runtime(self, older_than_seconds: float) -> int:
        """Retention, differentiated by category.

        Runtime events age out in weeks; audit events are retained far longer
        and are NEVER swept here. In production this is a partition drop rather
        than a DELETE.
        """
        cutoff = self.now() - older_than_seconds
        cursor = self.conn.execute(
            "DELETE FROM events WHERE category = 'runtime' AND ts < ?", (cutoff,))
        return cursor.rowcount


def percentiles(values: list[float]) -> dict[str, float]:
    """Nearest-rank, NOT interpolated.

    With small samples an interpolating percentile reports values that were
    never observed, which is misleading in exactly the low-traffic case where
    each observation matters most.
    """
    if not values:
        return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    ordered = sorted(values)

    def at(q: float) -> float:
        idx = min(len(ordered) - 1, max(0, int(round(q * len(ordered))) - 1))
        return round(ordered[idx], 3)

    return {"p50": at(0.50), "p95": at(0.95), "p99": at(0.99),
            "max": round(ordered[-1], 3)}


# --------------------------------------------------------------------------
if __name__ == "__main__":
    clock = {"t": 1_700_000_000.0}
    tel = Telemetry(now=lambda: clock["t"])
    trace = "trc_demo"

    def step(event: Event) -> None:
        clock["t"] += 0.05
        tel.emit(event)

    step(Event(type=EventType.TASK_SUBMITTED, trace_id=trace, task_id="tsk_1",
               project_id="acme", agent_id="chief"))
    step(Event(type=EventType.TASK_CLAIMED, trace_id=trace, task_id="tsk_1",
               agent_id="agi_7"))
    step(Event(type=EventType.MEMORY_READ, trace_id=trace, task_id="tsk_1",
               agent_id="agi_7", payload={"hits": 3, "min_trust": "verified"}))
    step(Event(type=EventType.MODEL_CALLED, trace_id=trace, task_id="tsk_1",
               agent_id="agi_7", model="std-1", provider="prov-a",
               tokens_in=1200, tokens_out=340, cost_micros=180))
    # The event most often emitted WITHOUT a trace_id — and therefore invisible
    # in the trace despite being audited. Pass it explicitly.
    step(Event(type=EventType.TOOL_CALLED, trace_id=trace, task_id="tsk_1",
               agent_id="agi_7", tool="kb.search", status="ok", cost_micros=5))
    step(Event(type=EventType.APPROVAL_GRANTED, trace_id=trace, task_id="tsk_1",
               project_id="acme", actor="owner", agent_id="agi_7"))
    step(Event(type=EventType.TOOL_CALLED, trace_id=trace, task_id="tsk_1",
               agent_id="agi_7", tool="email.send", status="ok", cost_micros=100))
    step(Event(type=EventType.QUALITY_EVALUATED, trace_id=trace, task_id="tsk_1",
               status="PASS", payload={"score": 0.94}))
    step(Event(type=EventType.TASK_COMPLETED, trace_id=trace, task_id="tsk_1",
               agent_id="agi_7", status="COMPLETED", duration_ms=412.0))

    print("The nine forensic questions, from one trace id\n" + "-" * 52)
    report = tel.explain_trace(trace)
    print(f"1. what happened     {' -> '.join(report['what_happened'][:5])} ...")
    print(f"2. which agent       {report['agents_involved']}")
    print(f"3. why               (payloads carry the reason per event)")
    print(f"4. which information {report['memory_reads']} memory read(s)")
    print(f"5. what it cost      {report['total_cost_micros']} micros, "
          f"{report['total_tokens']} tokens")
    print(f"6. which tool        {[t['tool'] for t in report['tools_called']]}")
    print(f"7. who approved      {[a['actor'] for a in report['approvals']]}")
    print(f"8. what failed       {report['failures'] or 'nothing'}")
    print(f"9. who corrected it  {report['corrections'] or 'no corrections needed'}")
    print(f"\n   spans={report['span_count']}  "
          f"duration={report['duration_ms']:.0f}ms")

    print("\nA denied action is audited and flushed immediately")
    tel.emit(Event(type=EventType.PERMISSION_DENIED, trace_id=trace,
                   agent_id="agi_7", actor="agi_7", error_code="permission_denied",
                   payload={"capability": "agent.activate"}))
    print(f"   audit rows without any explicit flush: {len(tel.audit_trail())}")

    print(f"\nVolume: {tel.volume()}")
    clock["t"] += 90 * 86400
    print(f"Retention sweep (runtime only): removed {tel.sweep_runtime(30 * 86400)}")
    print(f"   audit rows retained: {len(tel.audit_trail())}")

    print(f"\nLatency percentiles (nearest-rank): "
          f"{percentiles([12.0, 18.0, 25.0, 31.0, 240.0])}")
