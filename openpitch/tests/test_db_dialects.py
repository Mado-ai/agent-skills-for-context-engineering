"""Validate the schema compiles for the PostgreSQL dialect (no live server).

This proves the SQLAlchemy metadata is Postgres-ready without needing a running
Postgres — the live connection check belongs in CI/deploy.
"""

from __future__ import annotations

from sqlalchemy import create_mock_engine

from openpitch import db

EXPECTED_TABLES = {
    "users", "jobs", "sites", "devices", "ingest_keys", "audit_log", "teams",
    "organizations", "memberships", "players", "matches", "player_match_stats",
}


def test_metadata_compiles_for_postgres():
    statements: list[str] = []

    def dump(sql, *args, **kwargs):
        statements.append(str(sql.compile(dialect=engine.dialect)))

    engine = create_mock_engine("postgresql+psycopg://u:p@h/db", dump)
    db.metadata.create_all(engine, checkfirst=False)

    ddl = "\n".join(statements)
    for table in EXPECTED_TABLES:
        assert f"CREATE TABLE {table}" in ddl, f"missing CREATE TABLE for {table}"
    # autoincrement integer PK renders for Postgres (SERIAL or IDENTITY)
    assert "SERIAL" in ddl.upper() or "IDENTITY" in ddl.upper()
