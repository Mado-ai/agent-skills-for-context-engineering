"""Write-behind batching for append-only tables.

Benchmarking showed 7.16 write transactions per task, with 46% of
single-threaded wall time spent inside write transactions. Because SQLite
serialises writers, that share is the parallel-scaling ceiling: adding workers
adds contention to the same lock instead of adding write capacity, and measured
throughput actually *fell* from 563 tasks/s at one worker to 351 at thirty-two.

This batcher coalesces inserts into append-only tables — quality reviews, the
usage ledger, tool-call audit rows, episodic memory — into periodic multi-row
transactions, the same treatment telemetry already had.

**What is deliberately NOT batched**, because correctness depends on it being
durable and visible immediately:

* task status transitions (the queue's control state)
* concurrency reservations (a stale read grants excess concurrency)
* budget counters (a stale read lets spending exceed its ceiling)
* approvals and execution tokens (single-use redemption must be atomic)
* audit events (already flushed synchronously by Telemetry)

The trade is explicit: on an unclean shutdown, up to ``max_batch`` rows of
*observability* data can be lost. No control state is at risk, and the runtime
already tolerates that class of loss — leases expire, tasks re-run.
"""

from __future__ import annotations

import threading
from typing import Any, Sequence

from af.store.sqlite_store import SqliteStore

__all__ = ["WriteBatcher"]


class WriteBatcher:
    """Groups inserts per SQL statement and flushes them together."""

    def __init__(self, store: SqliteStore, *, max_batch: int = 64) -> None:
        self.store = store
        self.max_batch = max_batch
        self._pending: dict[str, list[Sequence[Any]]] = {}
        self._lock = threading.Lock()

    def add(self, sql: str, params: Sequence[Any]) -> None:
        """Queue one row. Flushes when any statement reaches ``max_batch``."""
        ready: dict[str, list[Sequence[Any]]] | None = None
        with self._lock:
            rows = self._pending.setdefault(sql, [])
            rows.append(params)
            if len(rows) >= self.max_batch:
                ready, self._pending = self._pending, {}
        if ready:
            self._write(ready)

    def flush(self) -> int:
        with self._lock:
            ready, self._pending = self._pending, {}
        return self._write(ready) if ready else 0

    def _write(self, groups: dict[str, list[Sequence[Any]]]) -> int:
        """All statements in ONE transaction — the whole point of batching."""
        total = 0
        with self.store.write() as conn:
            for sql, rows in groups.items():
                conn.executemany(sql, rows)
                total += len(rows)
        return total

    @property
    def depth(self) -> int:
        with self._lock:
            return sum(len(rows) for rows in self._pending.values())
