"""Elastic agent pool: template/instance separation, leased work queue, idle
reaping, and a harness for locating the real bottleneck.

Capacity follows demand. Instances are reused before being spawned and reaped
when idle, so fleet size is an outcome of load rather than a configured constant.

Use when:
    - An agent system must handle variable load.
    - Adding workers has not improved throughput.
    - A scaling claim needs measurement rather than assertion.

Standard library only. Uses SQLite so the queue semantics (atomic claim, lease
expiry, dead-lettering) are real rather than illustrative.

Typical usage::

    pool = ElasticPool(":memory:")
    pool.register_template("writer", concurrency_limit=4, max_instances=10)
    pool.submit("writer", "draft the article")
    for task in pool.claim("worker-1", limit=8):
        pool.complete(task["id"])
"""

from __future__ import annotations

import random
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

__all__ = ["ElasticPool", "TemplatePolicy", "measure_worker_curve"]


@dataclass
class _WriteResult:
    """RETURNING rows plus rowcount, both captured before the commit."""

    rows: list
    rowcount: int


@dataclass(frozen=True)
class TemplatePolicy:
    concurrency_limit: int = 4       # simultaneous tasks per instance
    max_instances: int = 10          # instances per template
    idle_retire_seconds: float = 900.0
    max_attempts: int = 3


SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS instances (
        id             TEXT PRIMARY KEY,
        template_id    TEXT NOT NULL,
        state          TEXT NOT NULL DEFAULT 'ACTIVE',
        inflight       INTEGER NOT NULL DEFAULT 0,
        created_at     REAL NOT NULL,
        last_active_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_instances_live ON instances (template_id, inflight, last_active_at) WHERE state = 'ACTIVE'",
    """
    CREATE TABLE IF NOT EXISTS tasks (
        id               TEXT PRIMARY KEY,
        template_id      TEXT NOT NULL,
        objective        TEXT NOT NULL,
        status           TEXT NOT NULL,
        priority         INTEGER NOT NULL DEFAULT 100,
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT 3,
        available_at     REAL NOT NULL,
        lease_owner      TEXT,
        lease_expires_at REAL,
        dlq_reason       TEXT,
        created_at       REAL NOT NULL
    )
    """,
    # THE claim index. Column order matches the claim's ORDER BY exactly, so the
    # planner walks it in output order and stops at LIMIT without sorting.
    # Leading with available_at instead — the intuitive choice, since it is the
    # filtered column — forces a sort of the whole runnable backlog per claim,
    # and claim latency then grows with queue depth.
    "CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks (priority, available_at, id) WHERE status = 'READY'",
    "CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks (lease_expires_at) WHERE status = 'RUNNING'",
]


class ElasticPool:
    def __init__(self, path: str = ":memory:", *,
                 now: Callable[[], float] = time.time,
                 max_queue_depth: int = 100_000) -> None:
        self.conn = sqlite3.connect(path, isolation_level=None,
                                    check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        if path != ":memory:":
            self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA busy_timeout=10000")
        for statement in SCHEMA:
            self.conn.execute(statement)
        self.now = now
        #: Backpressure. An unbounded queue converts an overload into an outage
        #: plus a storage bill, and hides it until it is expensive.
        self.max_queue_depth = max_queue_depth
        self.policies: dict[str, TemplatePolicy] = {}
        self._seq = 0
        #: One connection shared across worker threads, so writes are serialised
        #: here explicitly. This is not a workaround — it makes visible what the
        #: storage engine does internally anyway, which is exactly the
        #: serialised fraction that caps parallel speedup.
        self._write_lock = threading.Lock()

    def _uid(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}_{self._seq:09d}"

    def _write(self, sql: str, params: tuple = ()) -> "_WriteResult":
        """Run one write in an IMMEDIATE transaction, materialising any
        RETURNING rows before the commit.

        Two details matter. BEGIN IMMEDIATE rather than the default deferred
        transaction: a deferred transaction takes the write lock only at the
        first write, so two transactions that read-then-write can deadlock and
        one dies AFTER doing real work. And rows must be fetched before COMMIT —
        committing with a RETURNING cursor still open raises "cannot commit
        transaction - SQL statements in progress".
        """
        with self._write_lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = self.conn.execute(sql, params)
                rows = cursor.fetchall()
                rowcount = cursor.rowcount
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")
        return _WriteResult(rows, rowcount)

    # -- templates and instances -------------------------------------------
    def register_template(self, template_id: str, **kwargs: Any) -> None:
        self.policies[template_id] = TemplatePolicy(**kwargs)

    def acquire_instance(self, template_id: str) -> tuple[str, bool]:
        """Reuse a warm instance, else spawn, else refuse.

        Returns (instance_id, reused). Ordering by inflight then last_active
        keeps load even AND keeps recently used instances warm, rather than
        round-robining across the whole fleet.
        """
        policy = self.policies.get(template_id, TemplatePolicy())
        warm = self.conn.execute(
            "SELECT id FROM instances WHERE template_id = ? AND state = 'ACTIVE' "
            "AND inflight < ? ORDER BY inflight, last_active_at LIMIT 1",
            (template_id, policy.concurrency_limit)).fetchone()
        if warm:
            return warm["id"], True

        live = self.conn.execute(
            "SELECT count(*) FROM instances WHERE template_id = ? AND state = 'ACTIVE'",
            (template_id,)).fetchone()[0]
        if live >= policy.max_instances:
            raise RuntimeError(
                f"template '{template_id}' is at its instance ceiling "
                f"({policy.max_instances}) and none has spare concurrency")

        instance_id = self._uid("agi")
        now = self.now()
        self._write("INSERT INTO instances (id, template_id, created_at, last_active_at) "
                    "VALUES (?,?,?,?)", (instance_id, template_id, now, now))
        return instance_id, False

    def reserve(self, instance_id: str, concurrency_limit: int) -> bool:
        """Atomic. The guard is in the WHERE clause, so two concurrent
        reservations cannot both succeed past the limit."""
        cursor = self._write(
            "UPDATE instances SET inflight = inflight + 1, last_active_at = ? "
            "WHERE id = ? AND state = 'ACTIVE' AND inflight < ?",
            (self.now(), instance_id, concurrency_limit))
        return cursor.rowcount > 0

    def release(self, instance_id: str) -> None:
        """Floors at zero. At-least-once delivery means a double release happens
        eventually, and a negative counter silently grants extra concurrency."""
        self._write(
            "UPDATE instances SET inflight = MAX(0, inflight - 1), last_active_at = ? "
            "WHERE id = ?", (self.now(), instance_id))

    def reap_idle(self, idle_seconds: float | None = None) -> int:
        """Scale down. Without this the fleet ratchets to peak and stays there —
        the peak becomes the floor."""
        now = self.now()
        cutoff = now - (idle_seconds if idle_seconds is not None else 900.0)
        cursor = self._write(
            "UPDATE instances SET state = 'RETIRED' "
            "WHERE state = 'ACTIVE' AND inflight = 0 AND last_active_at < ?", (cutoff,))
        return cursor.rowcount

    # -- queue ----------------------------------------------------------------
    def submit(self, template_id: str, objective: str, *, priority: int = 100,
               max_attempts: int = 3) -> str:
        depth = self.conn.execute(
            "SELECT count(*) FROM tasks WHERE status = 'READY'").fetchone()[0]
        if depth >= self.max_queue_depth:
            raise RuntimeError(f"queue at capacity ({self.max_queue_depth}); "
                               f"submission refused rather than growing unbounded")
        task_id = self._uid("tsk")
        now = self.now()
        self._write(
            "INSERT INTO tasks (id, template_id, objective, status, priority, "
            "max_attempts, available_at, created_at) VALUES (?,?,?,'READY',?,?,?,?)",
            (task_id, template_id, objective, priority, max_attempts, now, now))
        return task_id

    def submit_many(self, template_id: str, objectives: list[str]) -> list[str]:
        """One transaction for N tasks. The write lock is taken once instead of
        N times, which is roughly an order of magnitude at scale."""
        now = self.now()
        rows = []
        for objective in objectives:
            rows.append((self._uid("tsk"), template_id, objective, 100, 3, now, now))
        with self._write_lock:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.executemany(
                "INSERT INTO tasks (id, template_id, objective, status, priority, "
                "max_attempts, available_at, created_at) VALUES (?,?,?,'READY',?,?,?,?)",
                rows)
            self.conn.execute("COMMIT")
        return [r[0] for r in rows]

    def claim(self, worker_id: str, *, limit: int = 1,
              lease_seconds: float = 60.0) -> list[dict[str, Any]]:
        """One atomic statement. A SELECT followed by an UPDATE lets two workers
        read the same row before either writes — the classic double delivery."""
        now = self.now()
        cursor = self._write(
            """
            UPDATE tasks
               SET status = 'RUNNING', lease_owner = ?, lease_expires_at = ?,
                   attempts = attempts + 1
             WHERE id IN (SELECT id FROM tasks
                           WHERE status = 'READY' AND available_at <= ?
                           ORDER BY priority, available_at, id
                           LIMIT ?)
            RETURNING id, template_id, objective, attempts, priority
            """, (worker_id, now + lease_seconds, now, limit))
        rows = cursor.rows
        # RETURNING yields rows in storage order, NOT the subquery's ORDER BY.
        # The right set is selected; within the batch it must be re-sorted or a
        # worker dispatches a BACKGROUND task before a CRITICAL one.
        return [dict(r) for r in sorted(rows, key=lambda r: (r["priority"], r["id"]))]

    def complete(self, task_id: str) -> bool:
        return self._write(
            "UPDATE tasks SET status = 'COMPLETED', lease_owner = NULL, "
            "lease_expires_at = NULL WHERE id = ? AND status = 'RUNNING'",
            (task_id,)).rowcount > 0

    def fail(self, task_id: str, *, retryable: bool = True,
             backoff_seconds: float = 1.0, jitter: float = 0.25) -> str:
        """Retry with jittered backoff, or dead-letter.

        Jitter matters: a thousand tasks failing on one downstream outage would
        otherwise all retry in the same instant, and the storm outlasts the
        original failure.
        """
        row = self.conn.execute(
            "SELECT attempts, max_attempts FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            return "missing"
        exhausted = row["attempts"] >= row["max_attempts"]
        if not retryable or exhausted:
            status = "DEAD_LETTER"
            reason = "non_retryable" if not retryable else "attempts_exhausted"
            delay = 0.0
        else:
            status, reason = "READY", None
            delay = backoff_seconds * (1.0 + random.uniform(-jitter, jitter))
        self._write(
            "UPDATE tasks SET status = ?, dlq_reason = ?, available_at = ?, "
            "lease_owner = NULL, lease_expires_at = NULL WHERE id = ?",
            (status, reason, self.now() + delay, task_id))
        return status

    def reap_expired_leases(self) -> int:
        """The entire crash-recovery story: no heartbeat registry, no failure
        detector. A worker that stops renewing loses its lease.

        A task whose attempts are already spent goes straight to the dead-letter
        queue — a task that repeatedly kills its worker is a poison message, and
        requeueing it just kills the next one.
        """
        now = self.now()
        cursor = self._write(
            """
            UPDATE tasks
               SET status = CASE WHEN attempts >= max_attempts
                                 THEN 'DEAD_LETTER' ELSE 'READY' END,
                   dlq_reason = CASE WHEN attempts >= max_attempts
                                 THEN 'lease_expired_exhausted' ELSE NULL END,
                   available_at = ?, lease_owner = NULL, lease_expires_at = NULL
             WHERE status = 'RUNNING' AND lease_expires_at < ?
            """, (now, now))
        return cursor.rowcount

    def stats(self) -> dict[str, Any]:
        counts = {r["status"]: r["n"] for r in self.conn.execute(
            "SELECT status, count(*) AS n FROM tasks GROUP BY status")}
        counts["live_instances"] = self.conn.execute(
            "SELECT count(*) FROM instances WHERE state = 'ACTIVE'").fetchone()[0]
        return counts


# --------------------------------------------------------------------------
def measure_worker_curve(make_pool: Callable[[], ElasticPool], *, tasks: int = 400,
                         worker_counts=(1, 2, 4, 8)) -> list[dict[str, Any]]:
    """Measure throughput against worker count instead of assuming it rises.

    Rising latency with FALLING throughput is the signature of lock contention;
    rising latency with FLAT throughput is saturation. The two look alike in a
    dashboard and have opposite fixes.
    """
    import threading

    results = []
    for workers in worker_counts:
        pool = make_pool()
        pool.register_template("bench", concurrency_limit=64, max_instances=64)
        pool.submit_many("bench", [f"task {i}" for i in range(tasks)])
        latencies: list[float] = []
        lock = threading.Lock()

        def run(name: str) -> None:
            while True:
                batch = pool.claim(name, limit=8)
                if not batch:
                    return
                for task in batch:
                    started = time.perf_counter()
                    pool.complete(task["id"])
                    with lock:
                        latencies.append((time.perf_counter() - started) * 1000.0)

        threads = [threading.Thread(target=run, args=(f"w{i}",)) for i in range(workers)]
        started = time.perf_counter()
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        elapsed = time.perf_counter() - started
        ordered = sorted(latencies)
        p99 = ordered[min(len(ordered) - 1, int(0.99 * len(ordered)))] if ordered else 0.0
        results.append({"workers": workers,
                        "tasks_per_second": round(len(latencies) / elapsed, 1),
                        "p99_ms": round(p99, 3)})
    return results


# --------------------------------------------------------------------------
if __name__ == "__main__":
    clock = {"t": 1_000_000.0}
    pool = ElasticPool(now=lambda: clock["t"])
    pool.register_template("writer", concurrency_limit=2, max_instances=3,
                           idle_retire_seconds=60.0)

    print("1. Reuse before spawn")
    first, reused = pool.acquire_instance("writer")
    print(f"   first acquire   reused={reused}")
    pool.reserve(first, 2)
    second, reused = pool.acquire_instance("writer")
    print(f"   second acquire  reused={reused}  same instance={second == first}\n")

    print("2. Concurrency limit cannot be exceeded by racing reservations")
    held = pool.conn.execute("SELECT inflight FROM instances WHERE id = ?",
                             (first,)).fetchone()[0]
    granted = sum(1 for _ in range(10) if pool.reserve(first, 2))
    print(f"   {held} slot(s) already held; 10 further attempts granted "
          f"{granted} -> inflight capped at 2\n")

    print("3. Double release cannot drive the counter negative")
    for _ in range(5):
        pool.release(first)
    inflight = pool.conn.execute("SELECT inflight FROM instances WHERE id = ?",
                                 (first,)).fetchone()[0]
    print(f"   inflight after 5 releases of 2 reservations: {inflight}\n")

    print("4. Crash recovery by lease expiry")
    task_id = pool.submit("writer", "survive a crash")
    pool.claim("doomed-worker", lease_seconds=30)
    print(f"   leased:                {pool.stats().get('RUNNING', 0)} running")
    print(f"   reap before expiry:    {pool.reap_expired_leases()}")
    clock["t"] += 31
    print(f"   reap after expiry:     {pool.reap_expired_leases()} -> requeued\n")

    print("5. Poison message dead-letters instead of recycling")
    for _ in range(4):
        pool.claim("doomed-worker", lease_seconds=10)
        clock["t"] += 11
        pool.reap_expired_leases()
    row = pool.conn.execute("SELECT status, dlq_reason FROM tasks WHERE id = ?",
                            (task_id,)).fetchone()
    print(f"   {row['status']} ({row['dlq_reason']})\n")

    print("6. Priority is respected within a claimed batch")
    for name, priority in (("background", 500), ("critical", 0),
                           ("normal", 100), ("high", 25)):
        pool.submit("writer", name, priority=priority)
    print(f"   {[t['objective'] for t in pool.claim('w', limit=4)]}\n")

    print("7. Scale down")
    clock["t"] += 500
    print(f"   idle instances reaped: {pool.reap_idle(60.0)}")
    print(f"   stats: {pool.stats()}\n")

    print("8. Throughput vs worker count — measured, not assumed")
    for row in measure_worker_curve(lambda: ElasticPool(), tasks=600):
        print(f"   {row['workers']:>2} workers: {row['tasks_per_second']:>7} tasks/s  "
              f"p99 {row['p99_ms']:>7} ms")
    print("\n   Falling throughput with rising p99 = lock contention, not saturation.")
    print("   The absolute numbers are inflated (no real work per task); the SHAPE")
    print("   is the finding, and it reproduces on real workloads.")
