"""Acceptance: C1-C4 — the delegation graph's security invariants."""

from base import RuntimeTestCase
from workforce_os.errors import PolicyDenied


class TestDelegation(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.lead = self.make_agent(name="Lead", role="project_lead",
                                    tools=("echo", "summarize"), domains=("public", "internal"),
                                    actions=("read", "analyze", "write"))
        self.worker = self.make_agent(name="Worker", role="specialist",
                                      tools=("echo",), domains=("public",), actions=("read",))
        self.task = self.make_task(assignee=self.lead["id"])

    def _delegate(self, parent, child, task=None, **kw):
        return self.rt.delegation.delegate(
            parent_agent_id=parent["id"], child_agent_id=child["id"],
            parent_task_id=(task or self.task)["id"], packet_kind="work_request",
            packet_payload=self.WORK_REQUEST, **kw)

    def test_delegation_succeeds_downward(self):
        result = self._delegate(self.lead, self.worker)
        self.assertEqual(result["delegation"]["depth"], 1)
        self.assertEqual(result["task"]["assignee_agent_id"], self.worker["id"])
        self.assertEqual(result["packet"]["to_agent_id"], self.worker["id"])
        # The edge is queryable as a graph.
        graph = self.rt.delegation.graph(self.project_id)
        self.assertEqual(len(graph["edges"]), 1)

    def test_cannot_delegate_upward(self):
        """C1: delegation to an equal or higher level is refused."""
        peer = self.make_agent(name="Peer", tools=("echo",), domains=("public",), actions=("read",))
        with self.assertRaises(PolicyDenied) as ctx:      # equal level
            self._delegate(self.worker, peer)
        self.assertEqual(ctx.exception.code, "delegation_upward_denied")

        with self.assertRaises(PolicyDenied) as ctx:      # higher level
            self._delegate(self.worker, self.lead)
        self.assertEqual(ctx.exception.code, "delegation_upward_denied")

    def test_scope_attenuation(self):
        """C2: a child may never hold scope its parent lacks."""
        overreaching = self.make_agent(
            name="Overreach", tools=("echo", "transfer_funds"), domains=("public", "financial"),
            actions=("read", "transact"), level=1)
        with self.assertRaises(PolicyDenied) as ctx:
            self._delegate(self.lead, overreaching)
        self.assertEqual(ctx.exception.code, "scope_escalation_denied")
        excess = ctx.exception.details["excess"]
        self.assertIn("transfer_funds", excess["tools"])
        self.assertIn("financial", excess["data_domains"])
        self.assertIn("transact", excess["action_types"])

        # The intersection helper never widens either side.
        parent_contract = self.rt.agents.get_contract(self.lead["id"])
        attenuated = self.rt.delegation.effective_child_scope(
            parent_contract, self.rt.agents.get_contract(overreaching["id"]).scope)
        self.assertTrue(attenuated.is_subset_of(parent_contract.scope))
        self.assertNotIn("transfer_funds", attenuated.allowed_tools)

    def test_cycle_rejected(self):
        """C3: an edge that would close a loop is refused."""
        with self.assertRaises(PolicyDenied) as ctx:
            self._delegate(self.lead, self.lead)
        # Self-delegation is caught by the level gate first; both are correct refusals.
        self.assertIn(ctx.exception.code, ("delegation_cycle", "delegation_upward_denied"))

        # A real cycle only becomes level-legal after a revision changes an agent's
        # level, which is exactly the case the cycle check exists to catch.
        mid = self.make_agent(name="Mid", role="evaluator", tools=("echo",),
                              domains=("public",), actions=("read",))
        first = self._delegate(self.lead, mid)

        # Demote the lead below mid, and narrow it so scope attenuation would pass.
        self.rt.agents.revise(self.lead["id"], {
            "name": "Lead", "role": "operator", "level": 1,
            "system_prompt": "A demoted lead used to exercise cycle detection.",
            "allowed_tools": ["echo"], "data_domains": ["public"], "action_types": ["read"],
        }, actor_id="owner")

        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.delegation.delegate(
                parent_agent_id=mid["id"], child_agent_id=self.lead["id"],
                parent_task_id=first["task"]["id"], packet_kind="work_request",
                packet_payload=self.WORK_REQUEST)
        self.assertEqual(ctx.exception.code, "delegation_cycle")

    def test_depth_cap(self):
        """C4: a senior agent's depth cap binds the whole chain beneath it."""
        shallow_lead = self.make_agent(
            name="Shallow Lead", role="project_lead", tools=("echo",), domains=("public",),
            actions=("read",), depth=1)
        mid = self.make_agent(name="Depth Mid", role="evaluator", tools=("echo",),
                              domains=("public",), actions=("read",))
        task = self.make_task(title="Depth root", assignee=shallow_lead["id"])

        first = self.rt.delegation.delegate(
            parent_agent_id=shallow_lead["id"], child_agent_id=mid["id"],
            parent_task_id=task["id"], packet_kind="work_request",
            packet_payload=self.WORK_REQUEST)
        self.assertEqual(first["delegation"]["depth"], 1)

        # `mid` has a permissive cap of its own, but cannot escape its lead's cap of 1.
        self.assertGreater(self.rt.agents.get_contract(mid["id"]).max_delegation_depth, 1)
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.delegation.delegate(
                parent_agent_id=mid["id"], child_agent_id=self.worker["id"],
                parent_task_id=first["task"]["id"], packet_kind="work_request",
                packet_payload=self.WORK_REQUEST)
        self.assertEqual(ctx.exception.code, "delegation_depth_exceeded")
        self.assertEqual(ctx.exception.details["bound_by"], shallow_lead["id"])

    def test_inactive_agents_cannot_participate(self):
        self.rt.agents.set_status(self.worker["id"], "paused", actor_id="owner")
        with self.assertRaises(PolicyDenied) as ctx:
            self._delegate(self.lead, self.worker)
        self.assertEqual(ctx.exception.code, "agent_not_active")
