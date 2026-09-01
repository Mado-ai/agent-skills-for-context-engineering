"""Storage port + SQLite adapter.

The rest of the runtime depends only on the ``Store`` shape defined here, never
on sqlite3 directly. That is what keeps ADR-0002's PostgreSQL path a swap.
"""

from af.store.sqlite_store import SqliteStore, connect

__all__ = ["SqliteStore", "connect"]
