"""Worker pool.

Workers are **stateless**: everything durable lives in the store, so a worker
can die at any point and its leases simply lapse. Adding capacity means starting
more workers, on this machine or another — there is no coordination, no
registration, and no shared memory between them. That is the property that makes
horizontal scaling possible later without redesigning the runtime.

Threads, not processes, because the work here is IO- and SQLite-bound rather
than CPU-bound, and SQLite in WAL mode already serialises writes. Under the GIL
a thread pool is the right shape for this workload; a genuinely CPU-heavy agent
body would need process workers, which is a change of adapter, not of design.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from af.clock import Clock, SystemClock
from af.scheduler.queue import TaskQueue
from af.telemetry.events import Telemetry

__all__ = ["Worker", "WorkerPool", "PoolStats"]


@dataclass
class PoolStats:
    claimed: int = 0
    completed: int = 0
    failed: int = 0
    empty_polls: int = 0
    latencies_ms: list[float] = field(default_factory=list)
    queue_waits_ms: list[float] = field(default_factory=list)

    def merge(self, other: "PoolStats") -> None:
        self.claimed += other.claimed
        self.completed += other.completed
        self.failed += other.failed
        self.empty_polls += other.empty_polls
        self.latencies_ms.extend(other.latencies_ms)
        self.queue_waits_ms.extend(other.queue_waits_ms)


class Worker:
    """One claim/execute loop."""

    def __init__(self, worker_id: str, queue: TaskQueue, runtime, *,
                 batch_size: int = 1, lease_seconds: float = 60.0,
                 project_id: str | None = None, clock: Clock | None = None,
                 idle_sleep: float = 0.002) -> None:
        self.worker_id = worker_id
        self.queue = queue
        self.runtime = runtime
        self.batch_size = batch_size
        self.lease_seconds = lease_seconds
        self.project_id = project_id
        self.clock = clock or SystemClock()
        #: Poll interval when the queue is empty. Short because the benchmark
        #: measures throughput; a production deployment would back off further
        #: or use a notification channel instead of polling.
        self.idle_sleep = idle_sleep
        self.stats = PoolStats()
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run_once(self) -> int:
        """Claim and execute one batch. Returns the number of tasks executed."""
        claimed = self.queue.claim(self.worker_id, limit=self.batch_size,
                                   lease_seconds=self.lease_seconds,
                                   project_id=self.project_id)
        if not claimed:
            self.stats.empty_polls += 1
            return 0
        self.stats.claimed += len(claimed)
        for task in claimed:
            started = time.perf_counter()
            try:
                result = self.runtime.execute(task)
                if result.status in ("COMPLETED",):
                    self.stats.completed += 1
                else:
                    self.stats.failed += 1
            except Exception:
                # A worker must never die from one bad task; the lease will
                # lapse and the task will be retried or dead-lettered.
                self.stats.failed += 1
            self.stats.latencies_ms.append((time.perf_counter() - started) * 1000.0)
            self.stats.queue_waits_ms.append(task.queue_ms)
        return len(claimed)

    def run(self, *, max_seconds: float | None = None,
            drain: bool = True, max_idle_polls: int = 50) -> PoolStats:
        """Loop until stopped, drained, or timed out."""
        started = time.perf_counter()
        idle = 0
        while not self._stop.is_set():
            if max_seconds is not None and (time.perf_counter() - started) >= max_seconds:
                break
            n = self.run_once()
            if n == 0:
                idle += 1
                # Draining stops once the queue has stayed empty for a while,
                # which is what lets a benchmark terminate deterministically.
                if drain and idle >= max_idle_polls:
                    break
                time.sleep(self.idle_sleep)
            else:
                idle = 0
        return self.stats


class WorkerPool:
    """A set of workers on threads."""

    def __init__(self, queue: TaskQueue, runtime, telemetry: Telemetry, *, size: int = 4,
                 batch_size: int = 1, lease_seconds: float = 60.0,
                 project_id: str | None = None, clock: Clock | None = None) -> None:
        self.queue = queue
        self.telemetry = telemetry
        self.workers = [
            Worker(f"w{i}", queue, runtime, batch_size=batch_size,
                   lease_seconds=lease_seconds, project_id=project_id, clock=clock)
            for i in range(size)
        ]
        self._threads: list[threading.Thread] = []

    def run(self, *, max_seconds: float = 60.0, drain: bool = True,
            max_idle_polls: int = 50) -> PoolStats:
        """Run every worker to completion and return merged statistics."""
        self._threads = [
            threading.Thread(target=w.run, kwargs={
                "max_seconds": max_seconds, "drain": drain,
                "max_idle_polls": max_idle_polls}, daemon=True)
            for w in self.workers
        ]
        for thread in self._threads:
            thread.start()
        for thread in self._threads:
            thread.join(timeout=max_seconds + 30)
        merged = PoolStats()
        for worker in self.workers:
            merged.merge(worker.stats)
        self.telemetry.flush()
        return merged

    def stop(self) -> None:
        for worker in self.workers:
            worker.stop()
