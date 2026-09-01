"""Acceptance: H1, H2 — migrations apply cleanly, are idempotent, and detect tampering."""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from base import RuntimeTestCase  # noqa: F401  (adds workforce_os to sys.path)
from workforce_os.db import migrator
from workforce_os.db.connection import Database
from workforce_os.errors import IntegrityError


class TestMigrations(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self._tmp.name, "m.db")

    def tearDown(self):
        self._tmp.cleanup()

    def test_apply_and_reapply(self):
        """H1: migrations apply from empty and are idempotent."""
        db = Database(self.db_path)
        applied = migrator.migrate(db)
        self.assertEqual(applied, [1, 2])

        expected = {"projects", "agents", "agent_contracts", "agent_templates", "tasks",
                    "work_packets", "delegations", "approval_requests", "approval_tokens",
                    "tool_calls", "events", "memory_records", "evaluations", "capa_records",
                    "budget_ledger", "metrics", "scheduler_jobs", "schema_migrations"}
        tables = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue(expected <= tables, f"missing: {expected - tables}")

        self.assertEqual(migrator.migrate(db), [], "re-running must be a no-op")
        self.assertEqual(len(migrator.applied_versions(db)), 2)
        db.close()

    def test_tampered_migration_detected(self):
        """H2: editing an already-applied migration halts startup."""
        db = Database(self.db_path)
        migrator.migrate(db)

        # Copy the migrations elsewhere and edit one, simulating a post-apply change.
        staging = Path(self._tmp.name) / "migrations"
        shutil.copytree(migrator.MIGRATIONS_DIR, staging)
        target = staging / "0002_memory_quality_telemetry.sql"
        target.write_text(target.read_text() + "\n-- an unauthorised edit\n")

        with self.assertRaises(IntegrityError) as ctx:
            migrator.migrate(db, staging)
        self.assertIn("modified after being applied", str(ctx.exception))
        db.close()

    def test_foreign_keys_enforced(self):
        db = Database(self.db_path)
        migrator.migrate(db)
        with self.assertRaises(Exception):
            db.execute("INSERT INTO agents (id, project_id, name, role, level, status, created_at, updated_at)"
                       " VALUES ('a','nonexistent','n','specialist',2,'draft','t','t')")
        db.close()
