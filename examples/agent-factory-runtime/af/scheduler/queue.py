"""Durable work queue with leased claims, DAG dependencies and dead-lettering.

Why leases rather than "mark it running and hope": a worker that crashes mid-task
leaves the row RUNNING forever, and the task is silently lost. A lease has an
expiry, so a crashed worker's work becomes claimable again automatically. That
single decision is what makes the system tolerant of worker loss without any
crash-detection machinery.

Delivery is **at-least-once**. Exactly-once is not available across a database
and an external side effect, so instead of pretending otherwise the design makes
duplicates safe: submission is idempotent on ``idempotency_key``, and the tool
gateway's execution tokens are single-use, so a duplicated high-risk action is
rejected at the point where it would matter.

The claim is a single atomic UPDATE ... WHERE id IN (SELECT ...) RETURNING.
Doing it as SELECT-then-UPDATE would let two workers read the same row before
either wrote — the classic thundering-herd double-delivery. One statement inside
one IMMEDIATE transaction makes that race unrepresentable.
"""

from __future__ import annotations

import random
import sqlite3
from dataclasses import dataclass
from typing import Any, Sequence

from af.clock import Clock, SystemClock
from af.errors import DuplicateWork, QueueFull
from af.ids import new_id
from af.store.sqlite_store import SqliteStore, dumps, loads
from af.telemetry.events import Event, EventType, Telemetry
from af.workpacket import Priority, TaskStatus, WorkPacket

__all__ = ["TaskQueue", "ClaimedTask", "QueueStats"]


@dataclass(slots=True)
class ClaimedTask:
    id: str
    packet: WorkPacket
    attempts: int
    lease_expires_at: float
    status: str
    enqueued_at: float
    started_at: float

    @property
    def queue_ms(self) -> float:
        """Time between becoming runnable and being picked up. The number that
        tells you whether to add workers."""
        return max(0.0, (self.started_at - self.enqueued_at) * 1000.0)


@dataclass(slots=True)
class QueueStats:
    ready: int = 0
    blocked: int = 0
    running: int = 0
    review: int = 0
    completed: int = 0
    failed: int = 0
    dead_letter: int = 0
    cancelled: int = 0
    waiting_approval: int = 0
    rework: int = 0
    oldest_ready_age_s: float = 0.0

    @property
    def depth(self) -> int:
        """Backlog that still needs a worker."""
        return self.ready + self.blocked + self.rework

    def to_dict(self) -> dict[str, Any]:
        d = {f: getattr(self, f) for f in self.__slots__}
        d["depth"] = self.depth
        return d


class TaskQueue:
    def __init__(
        self,
        store: SqliteStore,
        telemetry: Telemetry,
        clock: Clock | None = None,
        *,
        max_queue_depth: int = 100_000,
    ) -> None:
        self.store = store
        self.telemetry = telemetry
        self.clock = clock or SystemClock()
        #: Backpressure ceiling. Beyond this, submission is refused rather than
        #: silently accepted into a queue nothing will drain — an unbounded
        #: queue converts an overload into an outage plus a storage bill.
        self.max_queue_depth = max_queue_depth

    # -- submission ---------------------------------------------------------
    def submit(
        self,
        packet: WorkPacket,
        *,
        depends_on: Sequence[str] = (),
        check_backpressure: bool = True,
    ) -> str:
        """Enqueue a packet. Returns the task id.

        If ``depends_on`` is non-empty the task starts BLOCKED and becomes READY
        only when every dependency completes (fan-in).
        """
        now = self.clock.now()
        if check_backpressure:
            depth = self.store.scalar(
                "SELECT count(*) FROM tasks WHERE status IN ('READY','BLOCKED','REWORK')") or 0
            if depth >= self.max_queue_depth:
                self.telemetry.emit(Event(
                    type=EventType.TASK_FAILED, trace_id=packet.trace_id,
                    task_id=packet.id, project_id=packet.project_id,
                    status="rejected", error_code="queue_full",
                    payload={"depth": depth, "capacity": self.max_queue_depth}))
                raise QueueFull(
                    f"queue depth {depth} is at capacity {self.max_queue_depth}; "
                    f"submission rejected so the backlog cannot grow without bound",
                    depth=depth, capacity=self.max_queue_depth)
        # Resolve dependencies that are already finished, so a task whose deps
        # completed before submission does not start life BLOCKED forever.
        pending = 0
        if depends_on:
            placeholders = ",".join("?" * len(depends_on))
            done = {r[0] for r in self.store.all(
                f"SELECT id FROM tasks WHERE id IN ({placeholders}) AND status = 'COMPLETED'",
                tuple(depends_on))}
            pending = len([d for d in depends_on if d not in done])
        status = TaskStatus.BLOCKED.value if pending else TaskStatus.READY.value

        try:
            with self.store.write() as c:
                c.execute(
                    """
                    INSERT INTO tasks (
                        id, trace_id, root_id, parent_id, project_id, workflow_id,
                        sender_agent_id, receiver_instance_id, receiver_template_id,
                        objective, packet, status, priority, depth, attempts,
                        max_attempts, pending_deps, available_at, deadline_at,
                        idempotency_key, created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)
                    """,
                    (packet.id, packet.trace_id, packet.root_id, packet.parent_task_id,
                     packet.project_id, packet.workflow_id, packet.sender_agent_id,
                     packet.receiver_instance_id, packet.receiver_template_id,
                     packet.objective, dumps(packet.to_dict()), status, packet.priority,
                     packet.depth, packet.max_attempts, pending, now, packet.deadline_at,
                     packet.idempotency_key, now),
                )
                if depends_on:
                    c.executemany(
                        "INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)",
                        [(packet.id, d) for d in depends_on])
        except sqlite3.IntegrityError as exc:
            # Idempotency collision: someone already submitted this exact unit of
            # work. Return the winner rather than creating a duplicate.
            if packet.idempotency_key:
                existing = self.store.one(
                    "SELECT id FROM tasks WHERE project_id = ? AND idempotency_key = ?",
                    (packet.project_id, packet.idempotency_key))
                if existing:
                    return existing[0]
            raise DuplicateWork(f"task submission conflict: {exc}", task_id=packet.id) from exc

        self.telemetry.emit(Event(
            type=EventType.TASK_SUBMITTED, trace_id=packet.trace_id, task_id=packet.id,
            project_id=packet.project_id, agent_id=packet.sender_agent_id,
            workflow_id=packet.workflow_id, status=status,
            payload={"objective": packet.objective[:200], "depth": packet.depth,
                     "pending_deps": pending, "priority": packet.priority}))
        return packet.id

    def submit_many(self, packets: Sequence[WorkPacket]) -> list[str]:
        """Bulk insert for fan-out. One transaction for N packets rather than N
        transactions — the difference is roughly an order of magnitude at scale,
        because the write lock is taken once."""
        now = self.clock.now()
        rows = [
            (p.id, p.trace_id, p.root_id, p.parent_task_id, p.project_id, p.workflow_id,
             p.sender_agent_id, p.receiver_instance_id, p.receiver_template_id,
             p.objective, dumps(p.to_dict()), TaskStatus.READY.value, p.priority,
             p.depth, p.max_attempts, 0, now, p.deadline_at, p.idempotency_key, now)
            for p in packets
        ]
        with self.store.write() as c:
            c.executemany(
                """
                INSERT INTO tasks (
                    id, trace_id, root_id, parent_id, project_id, workflow_id,
                    sender_agent_id, receiver_instance_id, receiver_template_id,
                    objective, packet, status, priority, depth, attempts,
                    max_attempts, pending_deps, available_at, deadline_at,
                    idempotency_key, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)
                """, rows)
        for p in packets:
            self.telemetry.emit(Event(
                type=EventType.TASK_SUBMITTED, trace_id=p.trace_id, task_id=p.id,
                project_id=p.project_id, agent_id=p.sender_agent_id, status="READY",
                payload={"objective": p.objective[:120], "depth": p.depth, "bulk": True}))
        return [p.id for p in packets]

    # -- claiming -------------------------------------------------------------
    def claim(self, worker_id: str, *, limit: int = 1, lease_seconds: float = 60.0,
              project_id: str | None = None) -> list[ClaimedTask]:
        """Atomically lease up to ``limit`` runnable tasks."""
        now = self.clock.now()
        expires = now + lease_seconds
        # Optional project filter lets a worker pool be dedicated to a tenant,
        # which is how a noisy project is stopped from starving the others.
        project_clause = "AND project_id = ?" if project_id else ""
        params: list[Any] = [worker_id, expires, now]
        select_params: list[Any] = [now]
        if project_id:
            select_params.append(project_id)
        select_params.append(limit)

        sql = f"""
            UPDATE tasks
               SET status = 'RUNNING',
                   lease_owner = ?,
                   lease_expires_at = ?,
                   attempts = attempts + 1,
                   started_at = COALESCE(started_at, ?)
             WHERE id IN (
                    SELECT id FROM tasks
                     WHERE status = 'READY'
                       AND available_at <= ?
                       {project_clause}
                     ORDER BY priority, available_at, id
                     LIMIT ?
             )
            RETURNING id, packet, attempts, lease_expires_at, status, created_at,
                      started_at, priority
        """
        with self.store.write() as c:
            rows = c.execute(sql, params + select_params).fetchall()

        # RETURNING yields rows in the order the UPDATE touched them, which is
        # storage order, NOT the subquery's ORDER BY. The subquery still selects
        # the correct highest-priority set (that is the part that matters for
        # fairness across claims), but within a batch the rows come back
        # unsorted, so a worker handed a batch would dispatch a BACKGROUND task
        # before a CRITICAL one. Re-sort here rather than in the SQL, since the
        # batch is at most `limit` rows and this costs nothing.
        rows = sorted(rows, key=lambda r: (r["priority"], r["id"]))

        claimed = []
        for r in rows:
            packet = WorkPacket.from_dict(loads(r["packet"]))
            claimed.append(ClaimedTask(
                id=r["id"], packet=packet, attempts=r["attempts"],
                lease_expires_at=r["lease_expires_at"], status=r["status"],
                enqueued_at=r["created_at"], started_at=r["started_at"] or now))
            self.telemetry.emit(Event(
                type=EventType.TASK_CLAIMED, trace_id=packet.trace_id, task_id=r["id"],
                project_id=packet.project_id, actor=worker_id, status="RUNNING",
                payload={"attempt": r["attempts"], "worker": worker_id}))
        return claimed

    def extend_lease(self, task_id: str, worker_id: str, seconds: float = 60.0) -> bool:
        """Heartbeat for long-running work. Guarded on ``lease_owner`` so a
        worker that already lost its lease cannot silently reclaim it."""
        n = self.store.execute(
            "UPDATE tasks SET lease_expires_at = ? "
            "WHERE id = ? AND lease_owner = ? AND status = 'RUNNING'",
            (self.clock.now() + seconds, task_id, worker_id))
        return n > 0

    # -- completion -----------------------------------------------------------
    def complete(self, task_id: str, result: dict[str, Any], worker_id: str | None = None) -> bool:
        """Mark done and release any dependents (fan-in)."""
        now = self.clock.now()
        guard = "AND lease_owner = ?" if worker_id else ""
        params = [dumps(result), now, task_id]
        if worker_id:
            params.append(worker_id)
        with self.store.write() as c:
            cur = c.execute(
                f"UPDATE tasks SET status = 'COMPLETED', result = ?, finished_at = ?, "
                f"lease_owner = NULL, lease_expires_at = NULL "
                f"WHERE id = ? AND status IN ('RUNNING','REVIEW','REWORK') {guard}",
                params)
            if cur.rowcount == 0:
                return False
            released = self._release_dependents(c, task_id, now)
            row = c.execute(
                "SELECT trace_id, project_id, created_at, started_at FROM tasks WHERE id = ?",
                (task_id,)).fetchone()

        self.telemetry.emit(Event(
            type=EventType.TASK_COMPLETED, trace_id=row["trace_id"], task_id=task_id,
            project_id=row["project_id"], status="COMPLETED",
            duration_ms=((now - (row["started_at"] or now)) * 1000.0),
            payload={"released_dependents": released,
                     "queue_ms": ((row["started_at"] or now) - row["created_at"]) * 1000.0}))
        return True

    def _release_dependents(self, c: sqlite3.Connection, task_id: str, now: float) -> int:
        """Decrement dependents' counters; promote any that hit zero.

        The decrement and the promotion happen in the same statement pair inside
        the caller's transaction, so a task can never be observed at
        pending_deps=0 while still BLOCKED.
        """
        c.execute(
            """
            UPDATE tasks SET pending_deps = MAX(0, pending_deps - 1)
             WHERE id IN (SELECT task_id FROM task_deps WHERE depends_on = ?)
               AND status = 'BLOCKED'
            """, (task_id,))
        cur = c.execute(
            """
            UPDATE tasks SET status = 'READY', available_at = ?
             WHERE status = 'BLOCKED' AND pending_deps <= 0
               AND id IN (SELECT task_id FROM task_deps WHERE depends_on = ?)
            RETURNING id
            """, (now, task_id))
        return len(cur.fetchall())

    def fail(self, task_id: str, error: dict[str, Any], *, retryable: bool = True,
             worker_id: str | None = None, backoff_seconds: float | None = None,
             jitter: float = 0.2) -> str:
        """Retry with backoff, or terminate.

        Jitter is applied here rather than in the retry policy so that a
        thousand tasks failing on the same downstream outage do not all retry in
        the same instant — the retry storm the mandate asks us to defend against.
        """
        now = self.clock.now()
        row = self.store.one(
            "SELECT attempts, max_attempts, trace_id, project_id, packet FROM tasks WHERE id = ?",
            (task_id,))
        if row is None:
            return "missing"
        packet = WorkPacket.from_dict(loads(row["packet"]))
        exhausted = row["attempts"] >= row["max_attempts"]

        if not retryable:
            new_status, reason = TaskStatus.DEAD_LETTER.value, "non_retryable"
        elif exhausted:
            new_status, reason = TaskStatus.DEAD_LETTER.value, "attempts_exhausted"
        else:
            new_status, reason = TaskStatus.READY.value, "retry"

        delay = 0.0
        if new_status == TaskStatus.READY.value:
            base = backoff_seconds if backoff_seconds is not None else 1.0
            delay = base * (1.0 + random.uniform(-jitter, jitter))

        guard = "AND lease_owner = ?" if worker_id else ""
        params: list[Any] = [new_status, dumps(error), now + delay,
                             None if new_status == TaskStatus.READY.value else reason,
                             None if new_status == TaskStatus.READY.value else now, task_id]
        if worker_id:
            params.append(worker_id)
        self.store.execute(
            f"UPDATE tasks SET status = ?, error = ?, available_at = ?, dlq_reason = ?, "
            f"finished_at = ?, lease_owner = NULL, lease_expires_at = NULL "
            f"WHERE id = ? {guard}", params)

        self.telemetry.emit(Event(
            type=(EventType.TASK_RETRIED if new_status == TaskStatus.READY.value
                  else EventType.TASK_DEAD_LETTERED),
            trace_id=row["trace_id"], task_id=task_id, project_id=row["project_id"],
            status=new_status, error_code=str(error.get("code", "unknown")),
            payload={"attempt": row["attempts"], "max_attempts": row["max_attempts"],
                     "reason": reason, "retry_in_s": round(delay, 3),
                     "error": str(error.get("message", ""))[:300]}))
        # A dead-lettered child must not leave its parent waiting forever.
        if new_status == TaskStatus.DEAD_LETTER.value:
            self._fail_dependents(task_id, packet.trace_id)
        return new_status

    def _fail_dependents(self, task_id: str, trace_id: str) -> int:
        """Propagate terminal failure to anything that was waiting on it.

        Without this a fan-in join blocks forever on a dead branch, which
        presents as a mysterious stall rather than as a failure.
        """
        with self.store.write() as c:
            cur = c.execute(
                """
                UPDATE tasks SET status = 'CANCELLED', dlq_reason = 'dependency_failed',
                                 finished_at = ?
                 WHERE status = 'BLOCKED'
                   AND id IN (SELECT task_id FROM task_deps WHERE depends_on = ?)
                RETURNING id
                """, (self.clock.now(), task_id))
            ids = [r[0] for r in cur.fetchall()]
        for tid in ids:
            self.telemetry.emit(Event(
                type=EventType.TASK_CANCELLED, trace_id=trace_id, task_id=tid,
                status="CANCELLED", payload={"reason": "dependency_failed",
                                             "failed_dependency": task_id}))
        return len(ids)

    def set_status(self, task_id: str, status: TaskStatus, **fields: Any) -> bool:
        sets = ["status = ?"]
        params: list[Any] = [status.value]
        for k, v in fields.items():
            sets.append(f"{k} = ?")
            params.append(dumps(v) if isinstance(v, (dict, list)) else v)
        params.append(task_id)
        return self.store.execute(
            f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", params) > 0

    def requeue_for_rework(self, task_id: str, *, delay: float = 0.0) -> bool:
        """Send a quality-failed task back for another attempt.

        ``max_attempts`` is raised alongside, because a rework cycle is a
        deliberate second attempt requested by the quality engine, not a
        symptom of flakiness — spending a retry budget on it would let a
        rework silently consume the allowance meant for transient failures.
        """
        now = self.clock.now()
        return self.store.execute(
            "UPDATE tasks SET status = 'READY', available_at = ?, "
            "max_attempts = max_attempts + 1, lease_owner = NULL, lease_expires_at = NULL "
            "WHERE id = ? AND status IN ('REVIEW','REWORK','RUNNING')",
            (now + delay, task_id)) > 0

    def cancel_tree(self, root_id: str, reason: str = "cancelled") -> int:
        """Cancel a whole task tree. Used by deadline enforcement and by an
        owner stopping a runaway workflow."""
        now = self.clock.now()
        with self.store.write() as c:
            cur = c.execute(
                """
                UPDATE tasks SET status = 'CANCELLED', dlq_reason = ?, finished_at = ?,
                                 lease_owner = NULL, lease_expires_at = NULL
                 WHERE root_id = ? AND status IN
                       ('BLOCKED','READY','RUNNING','REVIEW','REWORK','WAITING_APPROVAL')
                RETURNING id
                """, (reason, now, root_id))
            ids = [r[0] for r in cur.fetchall()]
        for tid in ids:
            self.telemetry.emit(Event(type=EventType.TASK_CANCELLED, task_id=tid,
                                      status="CANCELLED", payload={"reason": reason}))
        return len(ids)

    # -- recovery ---------------------------------------------------------------
    def reap_expired_leases(self, limit: int = 500) -> int:
        """Return work abandoned by dead workers to the queue.

        This is the whole crash-recovery story. No heartbeat registry, no
        failure detector: if a worker stops renewing, its lease lapses and the
        task is picked up by someone else.
        """
        now = self.clock.now()
        with self.store.write() as c:
            rows = c.execute(
                """
                SELECT id, trace_id, project_id, lease_owner, attempts, max_attempts
                  FROM tasks
                 WHERE status = 'RUNNING' AND lease_expires_at IS NOT NULL
                   AND lease_expires_at < ?
                 LIMIT ?
                """, (now, limit)).fetchall()
            if not rows:
                return 0
            ids = [r["id"] for r in rows]
            marks = ",".join("?" * len(ids))
            # A task whose attempts are already spent goes straight to the DLQ:
            # re-queueing it would only fail again, and a task that repeatedly
            # kills its worker is exactly what a DLQ is for (poison message).
            c.execute(
                f"UPDATE tasks SET status = CASE WHEN attempts >= max_attempts "
                f"                          THEN 'DEAD_LETTER' ELSE 'READY' END, "
                f"                 dlq_reason = CASE WHEN attempts >= max_attempts "
                f"                          THEN 'lease_expired_exhausted' ELSE NULL END, "
                f"                 available_at = ?, lease_owner = NULL, lease_expires_at = NULL "
                f"WHERE id IN ({marks})", [now] + ids)
        for r in rows:
            self.telemetry.emit(Event(
                type=EventType.TASK_LEASE_EXPIRED, trace_id=r["trace_id"], task_id=r["id"],
                project_id=r["project_id"], status="requeued",
                payload={"dead_worker": r["lease_owner"], "attempts": r["attempts"]}))
        return len(rows)

    def enforce_deadlines(self, limit: int = 500) -> int:
        """Cancel work that missed its deadline. Prevents zombie tasks holding
        concurrency slots against a result nobody is waiting for any more."""
        now = self.clock.now()
        with self.store.write() as c:
            cur = c.execute(
                """
                UPDATE tasks SET status = 'CANCELLED', dlq_reason = 'deadline_exceeded',
                                 finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
                 WHERE deadline_at IS NOT NULL AND deadline_at < ?
                   AND status IN ('BLOCKED','READY','RUNNING','REWORK','WAITING_APPROVAL')
                RETURNING id, trace_id
                """, (now, now))
            rows = cur.fetchall()
        for r in rows:
            self.telemetry.emit(Event(type=EventType.TASK_TIMEOUT, task_id=r["id"],
                                      trace_id=r["trace_id"], status="CANCELLED",
                                      payload={"reason": "deadline_exceeded"}))
        return len(rows)

    # -- introspection ------------------------------------------------------------
    def get(self, task_id: str) -> dict[str, Any] | None:
        row = self.store.one("SELECT * FROM tasks WHERE id = ?", (task_id,))
        return dict(row) if row else None

    def children(self, task_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.store.all(
            "SELECT * FROM tasks WHERE parent_id = ? ORDER BY id", (task_id,))]

    def stats(self, project_id: str | None = None) -> QueueStats:
        where, params = ("WHERE project_id = ?", (project_id,)) if project_id else ("", ())
        rows = self.store.all(
            f"SELECT status, count(*) AS n FROM tasks {where} GROUP BY status", params)
        s = QueueStats()
        mapping = {
            "READY": "ready", "BLOCKED": "blocked", "RUNNING": "running",
            "REVIEW": "review", "COMPLETED": "completed", "FAILED": "failed",
            "DEAD_LETTER": "dead_letter", "CANCELLED": "cancelled",
            "WAITING_APPROVAL": "waiting_approval", "REWORK": "rework",
        }
        for r in rows:
            attr = mapping.get(r["status"])
            if attr:
                setattr(s, attr, r["n"])
        oldest = self.store.scalar(
            f"SELECT MIN(created_at) FROM tasks WHERE status = 'READY'"
            + (" AND project_id = ?" if project_id else ""), params)
        if oldest:
            s.oldest_ready_age_s = max(0.0, self.clock.now() - oldest)
        return s
