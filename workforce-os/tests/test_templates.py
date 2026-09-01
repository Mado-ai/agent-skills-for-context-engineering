"""Acceptance: C7 — dynamic specialist instantiation from templates."""

from base import RuntimeTestCase
from workforce_os.errors import PolicyDenied, ValidationError


class TestTemplates(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.template = self.rt.templates.create({
            "name": "Research Specialist", "role": "specialist", "level": 2,
            "prompt_template": "You research {{topic}} for the {{audience}} audience.",
            "parameters": ["topic", "audience"],
            "allowed_tools": ["echo", "summarize"], "data_domains": ["public", "internal"],
            "action_types": ["read", "analyze"], "budget": {"max_usd": 3.0},
        }, actor_id="owner")

    def test_instantiate_specialist(self):
        """C7: instantiation yields an active, scope-capped agent."""
        agent = self.rt.templates.instantiate(
            self.template["id"], self.project_id,
            {"topic": "supply chains", "audience": "executive"},
            actor_id="owner", agent_name="Supply Chain Researcher")

        self.assertEqual(agent["status"], "active")
        contract = self.rt.agents.get_contract(agent["id"])
        self.assertIn("supply chains", contract.system_prompt)
        self.assertIn("executive", contract.system_prompt)
        self.assertEqual(contract.scope.allowed_tools, ("echo", "summarize"))
        self.assertEqual(contract.budget.max_usd, 3.0)
        self.assertEqual(contract.template_id, self.template["id"])

    def test_parameters_are_validated(self):
        for label, params in [("missing", {"topic": "x"}),
                              ("unknown", {"topic": "x", "audience": "y", "extra": "z"}),
                              ("non-string", {"topic": "x", "audience": 5})]:
            with self.subTest(case=label):
                with self.assertRaises(ValidationError):
                    self.rt.templates.instantiate(self.template["id"], self.project_id, params,
                                                  actor_id="owner")

    def test_undeclared_placeholder_rejected_at_authoring(self):
        with self.assertRaises(ValidationError) as ctx:
            self.rt.templates.create({
                "name": "Broken", "role": "specialist",
                "prompt_template": "You handle {{undeclared}} work.", "parameters": [],
                "allowed_tools": ["echo"], "data_domains": ["public"], "action_types": ["read"],
            }, actor_id="owner")
        self.assertEqual(ctx.exception.details["field"], "prompt_template")

    def test_agent_instantiation_is_attenuated_to_the_instantiator(self):
        """An agent can never spawn a subordinate more powerful than itself."""
        lead = self.make_agent(name="Narrow Lead", role="project_lead", tools=("echo",),
                               domains=("public",), actions=("read",),
                               budget={"max_usd": 1.0})
        spawned = self.rt.templates.instantiate(
            self.template["id"], self.project_id, {"topic": "x", "audience": "y"},
            actor_id=lead["id"], instantiated_by_agent_id=lead["id"], agent_name="Spawned")

        contract = self.rt.agents.get_contract(spawned["id"])
        parent_contract = self.rt.agents.get_contract(lead["id"])
        self.assertTrue(contract.scope.is_subset_of(parent_contract.scope))
        self.assertNotIn("summarize", contract.scope.allowed_tools)   # template had it, lead did not
        self.assertNotIn("internal", contract.scope.data_domains)
        self.assertLessEqual(contract.budget.max_usd, parent_contract.budget.max_usd)
        self.assertLess(spawned["level"], lead["level"])
        self.assertEqual(spawned["parent_agent_id"], lead["id"])

    def test_too_junior_to_instantiate(self):
        operator = self.make_agent(name="Junior", role="operator", level=1, tools=("echo",),
                                   domains=("public",), actions=("read",))
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.templates.instantiate(
                self.template["id"], self.project_id, {"topic": "x", "audience": "y"},
                actor_id=operator["id"], instantiated_by_agent_id=operator["id"])
        self.assertEqual(ctx.exception.code, "delegation_upward_denied")
