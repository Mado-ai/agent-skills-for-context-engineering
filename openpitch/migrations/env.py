"""Alembic environment — targets the SQLAlchemy metadata in openpitch.db.

URL resolution: DATABASE_URL env var, falling back to db.DATABASE_URL
(sqlite). Run with e.g.:

    DATABASE_URL=postgresql+psycopg://u:p@host/db alembic upgrade head
"""

from __future__ import annotations

import os

from alembic import context
from sqlalchemy import create_engine

from openpitch import db

target_metadata = db.metadata
URL = os.environ.get("DATABASE_URL", db.DATABASE_URL)


def run_migrations_offline() -> None:
    context.configure(url=URL, target_metadata=target_metadata,
                      literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(URL)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                          compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
