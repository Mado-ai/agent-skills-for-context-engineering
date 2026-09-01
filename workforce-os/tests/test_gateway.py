"""Acceptance: A4, A5, A7, B6, G1-G4, G6 — the hardened Tool Gateway."""

import time
from unittest import mock

from base import RuntimeTestCase
from workforce_os.errors import ApprovalRequired, BudgetExceeded, NotFoundError, PolicyDenied
from workforce_os.policy.authority import owner_principal


class GatewayTestCase(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.agent = self.make_agent(
            name="Gateway Agent", tools=("echo", "summarize", "draft_document"),
            domains=("public", "internal"), actions=("read", "analyze", "write"))
        self.task = self.make_task(assignee=self.agent["id"])

    def call(self, tool="echo", args=None, **kw):
        return self.rt.gateway.call(agent_id=self.agent["id"], tool_name=tool,
                                    arguments=args if args is not None else {"message": "hello"},
                                    task_id=kw.pop("task_id", self.task["id"]), **kw)


class TestScopeGates(GatewayTestCase):
    def test_allowed_call_executes(self):
        result = self.call()
        self.assertEqual(result["status"], "executed")
        self.assertTrue(result["confirmed"])
        self.assertEqual(result["output"]["echoed"], "hello")

    def test_unknown_tool_denied(self):
        """G1: a tool the runtime does not know is refused."""
        with self.assertRaises(PolicyDenied) as ctx:
            self.call(tool="rm_rf_everything", args={})
        self.assertEqual(ctx.exception.code, "unknown_tool")

    def test_tool_not_in_contract_denied(self):
        """G2: a real tool absent from the contract is still refused."""
        with self.assertRaises(PolicyDenied) as ctx:
            self.call(tool="record_decision",
                      args={"decision": "d", "rationale": "because"})
        self.assertEqual(ctx.exception.code, "tool_not_in_contract")

    def test_action_type_denied(self):
        """G3: the contract's action types gate the call."""
        reader = self.make_agent(name="Reader Only", tools=("echo", "draft_document"),
                                 domains=("public", "internal"), actions=("read",))
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=reader["id"], tool_name="draft_document",
                                 arguments={"title": "T", "sections": [{"heading": "H",
                                                                        "content": "C"}]})
        self.assertEqual(ctx.exception.code, "action_type_denied")

    def test_data_domain_denied(self):
        """G3: the contract's data domains gate the call."""
        public_only = self.make_agent(name="Public Only", tools=("echo", "draft_document"),
                                      domains=("public",), actions=("read", "write"))
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=public_only["id"], tool_name="draft_document",
                                 arguments={"title": "T", "sections": [{"heading": "H",
                                                                        "content": "C"}]})
        self.assertEqual(ctx.exception.code, "data_domain_denied")

    def test_paused_agent_denied(self):
        """B6: paused and retired agents cannot execute tools."""
        for status in ("paused", "retired"):
            with self.subTest(status=status):
                agent = self.make_agent(name=f"Halted {status}")
                self.rt.agents.set_status(agent["id"], status, actor_id="owner")
                with self.assertRaises(PolicyDenied) as ctx:
                    self.rt.gateway.call(agent_id=agent["id"], tool_name="echo",
                                         arguments={"message": "hi"})
                self.assertEqual(ctx.exception.code, "agent_not_active")

    def test_unknown_agent_rejected(self):
        with self.assertRaises(NotFoundError):
            self.rt.gateway.call(agent_id="agt_does_not_exist", tool_name="echo",
                                 arguments={"message": "hi"})

    def test_all_calls_audited(self):
        """G4: every call, allowed or denied, leaves a record with a reason code."""
        self.call()
        for tool, args in [("rm_rf", {}), ("record_decision", {"decision": "d", "rationale": "r"})]:
            with self.assertRaises(PolicyDenied):
                self.call(tool=tool, args=args)

        calls = self.rt.gateway.calls_for(agent_id=self.agent["id"])
        self.assertEqual(len(calls), 3)
        self.assertEqual({c["reason_code"] for c in calls},
                         {"executed", "unknown_tool", "tool_not_in_contract"})
        self.assertEqual({c["decision"] for c in calls}, {"allowed", "denied"})
        self.rt.events.verify_chain()

    def test_budget_denial_is_preflight_and_audited(self):
        """D1 at the gateway: an over-budget call is refused and never executed."""
        broke = self.make_agent(name="Broke", tools=("echo",), domains=("public",),
                                actions=("read",), budget={"max_tool_calls": 1})
        self.rt.gateway.call(agent_id=broke["id"], tool_name="echo", arguments={"message": "one"})
        with self.assertRaises(BudgetExceeded):
            self.rt.gateway.call(agent_id=broke["id"], tool_name="echo", arguments={"message": "two"})

        calls = self.rt.gateway.calls_for(agent_id=broke["id"])
        self.assertEqual([c["reason_code"] for c in calls], ["budget_exceeded", "executed"])
        self.assertEqual(len([c for c in calls if c["status"] == "executed"]), 1)

    def test_invalid_tool_arguments_recorded_as_attempted(self):
        with self.assertRaises(Exception):
            self.call(args={"message": ""})
        latest = self.rt.gateway.calls_for(agent_id=self.agent["id"])[0]
        self.assertEqual(latest["status"], "attempted")
        self.assertFalse(latest["confirmed"])


class TestApprovalFlow(GatewayTestCase):
    def setUp(self):
        super().setUp()
        self.risky_agent = self.make_agent(
            name="Risky", tools=("request_external_publication",), domains=("public",),
            actions=("read", "transact"))
        self.args = {"destination": "newsletter", "content": "Quarterly update."}

    def _request(self):
        with self.assertRaises(ApprovalRequired) as ctx:
            self.rt.gateway.call(agent_id=self.risky_agent["id"],
                                 tool_name="request_external_publication", arguments=self.args)
        return ctx.exception.request_id

    def test_high_risk_requires_approval(self):
        """A4: a high-risk call is denied without a token, and an request is opened."""
        request_id = self._request()
        request = self.rt.approvals.get_request(request_id)
        self.assertEqual(request["status"], "pending")
        self.assertEqual(request["risk_level"], "high")
        self.assertEqual(request["tool_name"], "request_external_publication")

        denied = self.rt.gateway.calls_for(agent_id=self.risky_agent["id"])[0]
        self.assertEqual(denied["decision"], "denied")
        self.assertEqual(denied["reason_code"], "approval_required")

    def test_approved_token_permits_exactly_one_call(self):
        """A5: the token works once, then is spent."""
        request_id = self._request()
        grant = self.rt.approvals.approve(request_id, principal=owner_principal(), note="ok")

        result = self.rt.gateway.call(agent_id=self.risky_agent["id"],
                                      tool_name="request_external_publication",
                                      arguments=self.args, approval_token=grant["token"])
        # G6: the tool performs no external call, so it is reported attempted, not executed.
        self.assertFalse(result["confirmed"])
        self.assertEqual(result["status"], "attempted")
        self.assertIn("no external execution", result["output"]["notice"].lower())

        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=self.risky_agent["id"],
                                 tool_name="request_external_publication",
                                 arguments=self.args, approval_token=grant["token"])
        self.assertEqual(ctx.exception.code, "approval_token_already_used")

    def test_approval_token_is_single_use(self):
        self.test_approved_token_permits_exactly_one_call()

    def test_expired_token_refused(self):
        """A7: a token past its TTL is refused."""
        request_id = self._request()
        grant = self.rt.approvals.approve(request_id, principal=owner_principal())
        # Age the token past its expiry rather than sleeping.
        self.rt.db.execute("UPDATE approval_tokens SET expires_at = ? WHERE id = ?",
                           ("2020-01-01T00:00:00+00:00", grant["token_id"]))
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=self.risky_agent["id"],
                                 tool_name="request_external_publication",
                                 arguments=self.args, approval_token=grant["token"])
        self.assertEqual(ctx.exception.code, "approval_token_expired")

    def test_garbage_token_refused(self):
        self._request()
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=self.risky_agent["id"],
                                 tool_name="request_external_publication",
                                 arguments=self.args, approval_token="not-a-real-token")
        self.assertEqual(ctx.exception.code, "approval_token_invalid")

    def test_rejected_request_mints_no_token(self):
        request_id = self._request()
        rejected = self.rt.approvals.reject(request_id, principal=owner_principal(), note="no")
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(
            self.rt.db.query_one("SELECT COUNT(*) AS n FROM approval_tokens")["n"], 0)

    def test_unconfirmed_result_not_claimed(self):
        """G6: an unconfirmed tool result is never recorded as a completed action."""
        request_id = self._request()
        grant = self.rt.approvals.approve(request_id, principal=owner_principal())
        self.rt.gateway.call(agent_id=self.risky_agent["id"],
                             tool_name="request_external_publication",
                             arguments=self.args, approval_token=grant["token"])
        record = self.rt.gateway.calls_for(agent_id=self.risky_agent["id"])[0]
        self.assertEqual(record["status"], "attempted")
        self.assertFalse(record["confirmed"])
