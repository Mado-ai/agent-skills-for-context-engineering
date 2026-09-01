"""Acceptance: F1-F4 — the evaluator, rework loop and CAPA gate."""

from base import RuntimeTestCase
from workforce_os.errors import PolicyDenied, ValidationError
from workforce_os.policy.authority import Principal, owner_principal


class TestQualityLoop(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.worker = self.make_agent(name="Doer")
        self.evaluator = self.make_agent(name="Evaluator", role="evaluator")
        self.task = self.make_task(assignee=self.worker["id"], criteria=["accurate", "concise"])

    def _fail(self, task_id=None, score=0.2):
        return self.rt.quality.evaluate(task_id or self.task["id"],
                                        evaluator_agent_id=self.evaluator["id"],
                                        score=score, findings=[{"issue": "inaccurate"}])

    def test_passing_evaluation_opens_no_rework(self):
        outcome = self.rt.quality.evaluate(self.task["id"],
                                           evaluator_agent_id=self.evaluator["id"], score=0.95)
        self.assertEqual(outcome["evaluation"]["verdict"], "pass")
        self.assertIsNone(outcome["rework_task"])
        self.assertIsNone(outcome["capa"])
        self.assertEqual(self.rt.tasks.get(self.task["id"])["rework_count"], 0)

    def test_failing_evaluation_opens_rework(self):
        """F1: a failing verdict opens a rework task linked to the original."""
        outcome = self._fail()
        self.assertEqual(outcome["evaluation"]["verdict"], "fail")
        rework = outcome["rework_task"]
        self.assertIsNotNone(rework)
        self.assertEqual(rework["rework_of_task_id"], self.task["id"])
        self.assertEqual(rework["assignee_agent_id"], self.worker["id"])
        self.assertEqual(self.rt.tasks.get(self.task["id"])["rework_count"], 1)
        # The rework task inherits the original's acceptance criteria.
        self.assertEqual(self.rt.tasks.hydrate(rework)["criteria"], ["accurate", "concise"])

    def test_capa_opens_after_threshold(self):
        """F2: rework beyond the configured threshold opens a CAPA."""
        self.assertEqual(self.rt.config.rework_threshold, 2)
        first = self._fail()
        self.assertIsNone(first["capa"], "one failure is below the threshold")

        second = self._fail()
        capa = second["capa"]
        self.assertIsNotNone(capa)
        self.assertEqual(capa["task_id"], self.task["id"])
        self.assertEqual(capa["status"], "open")
        self.assertEqual(capa["rework_count"], 2)

        # A third failure reuses the open CAPA rather than stacking duplicates.
        self._fail()
        self.assertEqual(len(self.rt.quality.open_capas(project_id=self.project_id)), 1)

    def test_open_capa_blocks_completion(self):
        """F3: a task carrying an open CAPA cannot be completed."""
        self._fail()
        second = self._fail()
        capa = second["capa"]

        self.rt.tasks.set_status(self.task["id"], "in_progress", actor_id="owner")
        self.rt.tasks.set_status(self.task["id"], "review", actor_id="owner")
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.tasks.set_status(self.task["id"], "completed", actor_id="owner")
        self.assertEqual(ctx.exception.code, "open_capa_blocks_completion")

        # Once the Owner closes the CAPA with a documented root cause, completion proceeds.
        self.rt.quality.close_capa(capa["id"], principal=owner_principal(),
                                   root_cause="The source dataset was stale.",
                                   corrective_action="Refresh the dataset before each run.")
        completed = self.rt.tasks.set_status(self.task["id"], "completed", actor_id="owner")
        self.assertEqual(completed["status"], "completed")

    def test_only_owner_closes_capa(self):
        """A CAPA is an Owner decision — no agent level substitutes."""
        self._fail(); second = self._fail()
        chief = Principal(kind="agent", id="agt_chief", project_id=self.project_id,
                          role="chief_architect", level=5)
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.quality.close_capa(second["capa"]["id"], principal=chief,
                                       root_cause="I have decided it is fine.",
                                       corrective_action="Nothing further is required.")
        self.assertEqual(ctx.exception.code, "owner_authority_required")

    def test_capa_closure_demands_documentation(self):
        self._fail(); second = self._fail()
        with self.assertRaises(ValidationError):
            self.rt.quality.close_capa(second["capa"]["id"], principal=owner_principal(),
                                       root_cause="x", corrective_action="also too short")

    def test_evaluation_audited(self):
        """F4: evaluations are recorded and attributable to their evaluator."""
        self.rt.quality.evaluate(self.task["id"], evaluator_agent_id=self.evaluator["id"],
                                 score=0.9)
        stored = self.rt.quality.evaluations_for(self.task["id"])
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["evaluator_agent_id"], self.evaluator["id"])
        self.assertEqual(stored[0]["criteria"], ["accurate", "concise"])

        events = self.rt.events.list(project_id=self.project_id, event_type="quality.evaluated")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["actor_id"], self.evaluator["id"])
        self.rt.events.verify_chain()

    def test_agent_cannot_evaluate_its_own_work(self):
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.quality.evaluate(self.task["id"], evaluator_agent_id=self.worker["id"],
                                     score=1.0)
        self.assertEqual(ctx.exception.code, "self_evaluation_denied")
