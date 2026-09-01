"""SQLite connection management.

Foreign keys are enforced, WAL is enabled for concurrent reads, and rows come back
as dictionaries so callers never index by ordinal.
"""

import sqlite3
import threading


class Database:
    """Thread-local SQLite connections over a single database file."""

    def __init__(self, path: str):
        self.path = path
        self._local = threading.local()
        self._write_lock = threading.RLock()

    @property
    def connection(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=30.0, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            self._local.conn = conn
        return conn

    def query(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        cur = self.connection.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]

    def query_one(self, sql: str, params: tuple | dict = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self._write_lock:
            return self.connection.execute(sql, params)

    def executescript(self, sql: str) -> None:
        with self._write_lock:
            self.connection.executescript(sql)

    class _Transaction:
        def __init__(self, db: "Database"):
            self.db = db

        def __enter__(self):
            self.db._write_lock.acquire()
            self.db.connection.execute("BEGIN IMMEDIATE")
            return self.db

        def __exit__(self, exc_type, exc, tb):
            try:
                if exc_type is None:
                    self.db.connection.execute("COMMIT")
                else:
                    self.db.connection.execute("ROLLBACK")
            finally:
                self.db._write_lock.release()
            return False

    def transaction(self) -> "_Transaction":
        """Serialised write transaction: `with db.transaction(): ...`"""
        return Database._Transaction(self)

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None
