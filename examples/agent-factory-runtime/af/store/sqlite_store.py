"""SQLite adapter.

**SQLite is the development and single-node adapter, not the scale target.**
See ADR-0002 for why, and V04_PERFORMANCE_REPORT.md for the write-lock ceiling
we actually measured.

Two things here are load-bearing:

1. **WAL + per-thread connections.** WAL lets readers proceed during a write,
   which is what makes a claim-heavy workload viable at all. Connections are
   thread-local because a sqlite3 connection is not safe to share across threads
   and the worker pool is thread-backed (blocking DB calls are pushed off the
   event loop with ``asyncio.to_thread``).

2. **`BEGIN IMMEDIATE` for every write transaction.** Python's sqlite3 defaults
   to deferred transactions, which take the write lock only at the first write —
   so two transactions that both *read then write* can deadlock and one dies with
   "database is locked" after doing real work. Taking the lock up front converts
   that deadlock into a short, retryable wait. This was a real failure mode
   under concurrent claims before the change.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, Sequence

from af.store.migrations import MIGRATIONS, SCHEMA_VERSION

__all__ = ["SqliteStore", "connect"]

# How long SQLite waits on a held write lock before raising. Generous, because
# the alternative to waiting is a spurious failure the caller must retry anyway.
BUSY_TIMEOUT_MS = 10_000


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=BUSY_TIMEOUT_MS / 1000.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # WAL is persistent on the file, but setting it per-connection is harmless
    # and makes an in-memory DB behave consistently.
    if path != ":memory:":
        cur.execute("PRAGMA journal_mode=WAL")
    # NORMAL: fsync at checkpoint rather than every commit. On a crash we can
    # lose the last few committed transactions but never corrupt the file. The
    # runtime is already built to tolerate that (leases expire, tasks re-run),
    # so paying FULL's per-commit fsync would buy durability we don't need.
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    # 64MB page cache; the hot indexes should live in memory.
    cur.execute("PRAGMA cache_size=-64000")
    cur.execute("PRAGMA temp_store=MEMORY")
    # Let SQLite memory-map the DB for reads — meaningfully faster scans.
    cur.execute("PRAGMA mmap_size=268435456")
    cur.close()
    return conn


class SqliteStore:
    """Thread-safe store. One connection per thread, created on demand."""

    def __init__(self, path: str = ":memory:") -> None:
        self.path = path
        self._local = threading.local()
        self._shared: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        if path == ":memory:":
            # An in-memory DB is per-connection, so thread-locals would each get
            # their own empty database. Share one connection and serialise on a
            # lock instead. Only used by tests.
            self._shared = connect(path)
        self.migrate()

    # -- connection management ------------------------------------------
    @property
    def conn(self) -> sqlite3.Connection:
        if self._shared is not None:
            return self._shared
        c = getattr(self._local, "conn", None)
        if c is None:
            c = connect(self.path)
            self._local.conn = c
        return c

    def close(self) -> None:
        if self._shared is not None:
            self._shared.close()
            self._shared = None
            return
        c = getattr(self._local, "conn", None)
        if c is not None:
            c.close()
            self._local.conn = None

    # -- transactions ----------------------------------------------------
    @contextmanager
    def write(self) -> Iterator[sqlite3.Connection]:
        """Write transaction. Takes the write lock immediately (see module docstring)."""
        conn = self.conn
        guard = self._lock if self._shared is not None else _NULL_GUARD
        with guard:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            else:
                conn.execute("COMMIT")

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        conn = self.conn
        guard = self._lock if self._shared is not None else _NULL_GUARD
        with guard:
            yield conn

    # -- migrations ------------------------------------------------------
    def migrate(self) -> int:
        conn = self.conn
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)"
        )
        applied = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for version, statements in MIGRATIONS:
            if version in applied:
                continue
            with self.write() as c:
                for stmt in statements:
                    c.execute(stmt)
                c.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (version, time.time()),
                )
        return SCHEMA_VERSION

    # -- query helpers ---------------------------------------------------
    def one(self, sql: str, params: Sequence[Any] = ()) -> sqlite3.Row | None:
        with self.read() as c:
            return c.execute(sql, params).fetchone()

    def all(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        with self.read() as c:
            return c.execute(sql, params).fetchall()

    def scalar(self, sql: str, params: Sequence[Any] = ()) -> Any:
        row = self.one(sql, params)
        return None if row is None else row[0]

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        with self.write() as c:
            cur = c.execute(sql, params)
            return cur.rowcount

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> int:
        with self.write() as c:
            cur = c.executemany(sql, list(rows))
            return cur.rowcount

    # -- maintenance -----------------------------------------------------
    def checkpoint(self) -> None:
        """Fold the WAL back into the main DB. Left to the caller because
        checkpointing mid-benchmark distorts latency measurements."""
        with self.read() as c:
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def analyze(self) -> None:
        """Refresh planner statistics. Worth running after bulk load — without
        it SQLite can pick a scan over ``idx_tasks_claim`` on a cold table."""
        with self.write() as c:
            c.execute("ANALYZE")

    def size_bytes(self) -> int:
        if self.path == ":memory:":
            return 0
        total = 0
        for suffix in ("", "-wal", "-shm"):
            try:
                total += os.path.getsize(self.path + suffix)
            except OSError:
                pass
        return total


class _NullGuard:
    """No-op context manager for the thread-local (non-shared) case."""

    __slots__ = ()

    def __enter__(self) -> None:
        return None

    def __exit__(self, *exc: object) -> bool:
        return False


_NULL_GUARD = _NullGuard()


def dumps(obj: Any) -> str:
    """Canonical JSON. Sorted keys and tight separators so that hashing a spec
    gives a stable content hash regardless of dict construction order."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def loads(text: str | None) -> Any:
    return None if text is None else json.loads(text)
