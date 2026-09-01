"""Numbered, checksum-verified schema migrations.

Migrations are plain `.sql` files named `NNNN_name.sql`. Each applied migration records
its SHA-256; if a checked-in migration is later edited, startup halts rather than
running against a database whose schema no longer matches its recorded history.
"""

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

from ..errors import IntegrityError

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_FILENAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


def _checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def discover(directory: Path | None = None) -> list[tuple[int, str, str]]:
    """Return [(version, name, sql)] ordered by version."""
    directory = directory or MIGRATIONS_DIR
    found = []
    for path in sorted(directory.glob("*.sql")):
        match = _FILENAME.match(path.name)
        if not match:
            raise IntegrityError(f"Malformed migration filename: {path.name}")
        found.append((int(match.group(1)), match.group(2), path.read_text()))
    versions = [v for v, _, _ in found]
    if len(versions) != len(set(versions)):
        raise IntegrityError("Duplicate migration version numbers")
    return found


def _ensure_table(db) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            checksum   TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
        """
    )


def applied_versions(db) -> dict[int, dict]:
    _ensure_table(db)
    return {row["version"]: row for row in db.query("SELECT * FROM schema_migrations ORDER BY version")}


def migrate(db, directory: Path | None = None) -> list[int]:
    """Apply pending migrations. Idempotent. Returns the versions applied this run."""
    _ensure_table(db)
    already = applied_versions(db)
    newly_applied = []

    for version, name, sql in discover(directory):
        checksum = _checksum(sql)
        if version in already:
            recorded = already[version]["checksum"]
            if recorded != checksum:
                raise IntegrityError(
                    f"Migration {version:04d}_{name}.sql was modified after being applied "
                    f"(recorded {recorded[:12]}…, found {checksum[:12]}…). Refusing to start.",
                    details={"version": version, "name": name},
                )
            continue

        # DDL in SQLite is transactional; a failure inside leaves nothing half-applied.
        with db.transaction():
            for statement in _split_statements(sql):
                db.connection.execute(statement)
            db.connection.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)",
                (version, name, checksum, datetime.now(timezone.utc).isoformat()),
            )
        newly_applied.append(version)

    return newly_applied


def _split_statements(sql: str) -> list[str]:
    """Split a migration into statements, keeping multi-statement CREATE TRIGGER bodies whole."""
    statements, buffer, in_trigger = [], [], False
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        upper = stripped.upper()
        if upper.startswith("CREATE TRIGGER"):
            in_trigger = True
        buffer.append(line)
        if in_trigger:
            if upper.startswith("END;"):
                statements.append("\n".join(buffer))
                buffer, in_trigger = [], False
        elif stripped.endswith(";"):
            statements.append("\n".join(buffer))
            buffer = []
    if any(line.strip() for line in buffer):
        statements.append("\n".join(buffer))
    return statements
