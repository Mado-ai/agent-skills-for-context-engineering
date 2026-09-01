"""Acceptance: H3 — the audit trail is append-only and hash-chained."""

from base import RuntimeTestCase
from workforce_os.errors import IntegrityError


class TestAuditChain(RuntimeTestCase):
    def test_event_chain_integrity(self):
        """H3: a verified chain covers every event, in order."""
        for i in range(5):
            self.rt.events.append("test.event", actor_type="system", actor_id="test",
                                  project_id=self.project_id, payload={"i": i})
        result = self.rt.events.verify_chain()
        self.assertTrue(result["verified"])
        self.assertGreaterEqual(result["events"], 6)  # 5 + project.created

    def test_events_are_append_only(self):
        self.rt.events.append("test.event", actor_type="system", actor_id="t",
                              project_id=self.project_id, payload={})
        for sql in ("UPDATE events SET payload = '{}' WHERE seq = 1",
                    "DELETE FROM events WHERE seq = 1"):
            with self.subTest(sql=sql.split()[0]):
                with self.assertRaises(Exception) as ctx:
                    self.rt.db.execute(sql)
                self.assertIn("append-only", str(ctx.exception))

    def test_tampered_event_breaks_chain(self):
        """H3: altering an event around the trigger is detected by re-verification."""
        for i in range(3):
            self.rt.events.append("test.event", actor_type="system", actor_id="t",
                                  project_id=self.project_id, payload={"i": i})
        self.rt.db.execute("DROP TRIGGER events_immutable_update")
        self.rt.db.execute("UPDATE events SET payload = '{\"i\":999}' WHERE seq = 2")

        with self.assertRaises(IntegrityError) as ctx:
            self.rt.events.verify_chain()
        self.assertEqual(ctx.exception.details["seq"], 2)

    def test_deleted_event_breaks_chain(self):
        for i in range(3):
            self.rt.events.append("test.event", actor_type="system", actor_id="t",
                                  project_id=self.project_id, payload={"i": i})
        self.rt.db.execute("DROP TRIGGER events_immutable_delete")
        self.rt.db.execute("DELETE FROM events WHERE seq = 2")
        with self.assertRaises(IntegrityError):
            self.rt.events.verify_chain()
