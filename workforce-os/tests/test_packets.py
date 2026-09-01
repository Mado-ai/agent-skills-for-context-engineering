"""Acceptance: C6 — typed work packets validate against their registered schema."""

from base import RuntimeTestCase
from workforce_os.core.packets import validate_payload
from workforce_os.errors import ValidationError


class TestWorkPackets(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.sender = self.make_agent(name="Sender", role="project_lead")
        self.receiver = self.make_agent(name="Receiver")

    def test_valid_packet_roundtrips(self):
        packet = self.rt.packets.create(
            project_id=self.project_id, kind="work_request", schema_version=1,
            payload={"objective": "Summarise the report", "acceptance_criteria": ["under 200 words"]},
            from_agent_id=self.sender["id"], to_agent_id=self.receiver["id"])
        hydrated = self.rt.packets.hydrate(self.rt.packets.get(packet["id"]))
        self.assertEqual(hydrated["payload"]["objective"], "Summarise the report")
        self.assertEqual(len(self.rt.packets.inbox(self.receiver["id"])), 1)

    def test_invalid_packet_rejected(self):
        """C6: unknown kinds, missing fields, wrong types and stray fields all fail."""
        cases = [
            ("unknown kind", "no_such_kind", 1, {"objective": "x"}),
            ("missing required field", "work_request", 1, {"acceptance_criteria": []}),
            ("wrong type", "work_request", 1, {"objective": 42, "acceptance_criteria": []}),
            ("unknown field", "work_request", 1,
             {"objective": "x", "acceptance_criteria": [], "sneaky": "value"}),
            ("unknown schema version", "work_request", 99, {"objective": "x", "acceptance_criteria": []}),
        ]
        for label, kind, version, payload in cases:
            with self.subTest(case=label):
                with self.assertRaises(ValidationError):
                    validate_payload(kind, version, payload)
                with self.assertRaises(ValidationError):
                    self.rt.packets.create(
                        project_id=self.project_id, kind=kind, schema_version=version,
                        payload=payload, from_agent_id=self.sender["id"],
                        to_agent_id=self.receiver["id"])
        # Nothing invalid was persisted.
        self.assertEqual(self.rt.db.query_one("SELECT COUNT(*) AS n FROM work_packets")["n"], 0)

    def test_optional_fields_may_be_omitted(self):
        validate_payload("work_result", 1, {"summary": "done"})
        validate_payload("work_result", 1, {"summary": "done", "artifacts": [], "confidence": 0.9})

    def test_known_kinds_are_introspectable(self):
        kinds = {k["kind"] for k in self.rt.packets.known_kinds()}
        self.assertTrue({"work_request", "work_result", "review_request",
                         "review_result", "escalation"} <= kinds)
