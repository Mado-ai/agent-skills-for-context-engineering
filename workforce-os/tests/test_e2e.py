"""Acceptance: I3, I4 — the complete governed workflow loop, end to end.

build → activate → delegate → execute → evaluate → rework → approve → retire,
with every step persisted, enforced and audited, and no network anywhere.
"""

import sys

from base import RuntimeTestCase
from workforce_os.errors import ApprovalRequired, PolicyDenied
from workforce_os.policy.authority import Principal, owner_principal


class TestFullWorkflowLoop(RuntimeTestCase):
    def test_full_workflow_loop(self):
        owner = owner_principal()

        # ---- 1. build the chief architect and a project lead -------------------
        chief = self.rt.agents.build(self.project_id, {
            "name": "Chief Architect", "role": "chief_architect",
            "system_prompt": "The Owner's primary interface, with system-wide visibility.",
            "allowed_tools": ["echo"], "data_domains": ["public"], "action_types": ["read"],
        }, actor_id="owner")
        self.rt.agents.set_status(chief["id"], "active", actor_id="owner")

        lead = self.make_agent(name="Delivery Lead", role="project_lead",
                               tools=("echo", "summarize", "draft_document"),
                               domains=("public", "internal"),
                               actions=("read", "analyze", "write"),
                               budget={"max_usd": 10.0, "max_tool_calls": 50})

        # ---- 2. instantiate a specialist from a template on demand -------------
        template = self.rt.templates.create({
            "name": "Analyst", "role": "specialist", "level": 2,
            "prompt_template": "You analyse {{subject}} and report concisely.",
            "parameters": ["subject"],
            "allowed_tools": ["echo", "summarize"], "data_domains": ["public", "internal"],
            "action_types": ["read", "analyze"], "budget": {"max_usd": 2.0},
        }, actor_id="owner")
        analyst = self.rt.templates.instantiate(
            template["id"], self.project_id, {"subject": "quarterly demand"},
            actor_id=lead["id"], instantiated_by_agent_id=lead["id"], agent_name="Demand Analyst")
        self.assertEqual(analyst["status"], "active")
        self.assertLess(analyst["level"], lead["level"])

        evaluator = self.make_agent(name="QA", role="evaluator", tools=("echo",),
                                    domains=("public",), actions=("read",))

        # ---- 3. root task and delegation ---------------------------------------
        root_task = self.make_task(title="Quarterly demand report", assignee=lead["id"],
                                   criteria=["cites data", "under 500 words"])
        delegated = self.rt.delegation.delegate(
            parent_agent_id=lead["id"], child_agent_id=analyst["id"],
            parent_task_id=root_task["id"], packet_kind="work_request",
            packet_payload={"objective": "Analyse quarterly demand",
                            "acceptance_criteria": ["cites data"]})
        child_task = delegated["task"]
        self.assertEqual(delegated["delegation"]["depth"], 1)
        self.assertEqual(self.rt.packets.inbox(analyst["id"])[0]["id"], delegated["packet"]["id"])

        # ---- 4. the specialist executes through the gateway --------------------
        self.rt.tasks.set_status(child_task["id"], "in_progress", actor_id=analyst["id"])
        result = self.rt.gateway.call(
            agent_id=analyst["id"], tool_name="summarize", task_id=child_task["id"],
            arguments={"text": "Demand rose 12%. Supply held flat. Margins improved. "
                               "Backlog cleared.", "max_sentences": 2})
        self.assertEqual(result["status"], "executed")
        self.assertTrue(result["confirmed"])

        # Out-of-contract work is refused even mid-flow.
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=analyst["id"], tool_name="draft_document",
                                 task_id=child_task["id"],
                                 arguments={"title": "T", "sections": [{"heading": "H",
                                                                        "content": "C"}]})
        self.assertEqual(ctx.exception.code, "tool_not_in_contract")

        # ---- 5. memory with provenance -----------------------------------------
        self.rt.memory.write(project_id=self.project_id, layer="working", key="draft finding",
                             content=result["output"]["summary"], task_id=child_task["id"],
                             agent_id=analyst["id"],
                             provenance={"author_agent_id": analyst["id"],
                                         "source": f"tool_call:{result['tool_call_id']}",
                                         "origin": "tool_result"})
        self.rt.memory.write(project_id=self.project_id, layer="semantic",
                             key="demand trend", content="Demand rose 12% quarter on quarter.",
                             agent_id=analyst["id"],
                             provenance={"author_agent_id": analyst["id"],
                                         "source": "analysis", "origin": "derived"})

        # ---- 6. quality: fail, rework, fail again, CAPA -------------------------
        self.rt.tasks.set_status(child_task["id"], "review", actor_id=analyst["id"])
        first = self.rt.quality.evaluate(child_task["id"], evaluator_agent_id=evaluator["id"],
                                         score=0.35, findings=[{"issue": "no data cited"}])
        self.assertEqual(first["evaluation"]["verdict"], "fail")
        self.assertIsNotNone(first["rework_task"])
        self.assertIsNone(first["capa"])

        second = self.rt.quality.evaluate(child_task["id"], evaluator_agent_id=evaluator["id"],
                                          score=0.4, findings=[{"issue": "still thin"}])
        capa = second["capa"]
        self.assertIsNotNone(capa, "the second failure must open a CAPA")

        # The task is blocked from completing while the CAPA is open.
        self.rt.tasks.set_status(child_task["id"], "in_progress", actor_id=analyst["id"])
        self.rt.tasks.set_status(child_task["id"], "review", actor_id=analyst["id"])
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.tasks.set_status(child_task["id"], "completed", actor_id=analyst["id"])
        self.assertEqual(ctx.exception.code, "open_capa_blocks_completion")

        self.rt.quality.close_capa(capa["id"], principal=owner,
                                   root_cause="The analyst lacked access to the source dataset.",
                                   corrective_action="Grant the internal data domain and re-run.",
                                   preventive_action="Add a data-access check to the template.")
        third = self.rt.quality.evaluate(child_task["id"], evaluator_agent_id=evaluator["id"],
                                         score=0.92)
        self.assertEqual(third["evaluation"]["verdict"], "pass")
        completed = self.rt.tasks.set_status(child_task["id"], "completed",
                                             actor_id=analyst["id"],
                                             result={"summary": "Approved analysis."})
        self.assertEqual(completed["status"], "completed")

        # ---- 7. a high-risk action needs the Owner ------------------------------
        publisher = self.make_agent(name="Publisher", tools=("request_external_publication",),
                                    domains=("public",), actions=("transact",))
        publish_args = {"destination": "investor update", "content": "Demand rose 12%."}
        with self.assertRaises(ApprovalRequired) as ctx:
            self.rt.gateway.call(agent_id=publisher["id"],
                                 tool_name="request_external_publication",
                                 arguments=publish_args)
        request_id = ctx.exception.request_id

        # No agent can self-approve, whatever its level.
        with self.assertRaises(PolicyDenied):
            self.rt.approvals.approve(request_id, principal=Principal(
                kind="agent", id=chief["id"], project_id=self.project_id,
                role="chief_architect", level=5))

        grant = self.rt.approvals.approve(request_id, principal=owner, note="Cleared for release.")
        published = self.rt.gateway.call(agent_id=publisher["id"],
                                         tool_name="request_external_publication",
                                         arguments=publish_args,
                                         approval_token=grant["token"])
        # v0.4 performs no external call, and reports that honestly.
        self.assertFalse(published["confirmed"])
        self.assertEqual(published["status"], "attempted")

        # ---- 8. retire, and confirm a retired agent cannot act ------------------
        self.rt.agents.set_status(analyst["id"], "retired", actor_id="owner")
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=analyst["id"], tool_name="echo",
                                 arguments={"message": "still here?"})
        self.assertEqual(ctx.exception.code, "agent_not_active")

        # ---- 9. everything is auditable and metered ----------------------------
        self.assertTrue(self.rt.events.verify_chain()["verified"])
        event_types = {e["event_type"] for e in self.rt.events.list(limit=500)}
        for expected in ("agent.built", "agent.active", "agent.instantiated",
                         "delegation.created", "tool.allowed", "tool.denied",
                         "memory.written", "quality.evaluated", "quality.rework_opened",
                         "capa.opened", "capa.closed", "approval.requested",
                         "approval.granted", "agent.retired"):
            self.assertIn(expected, event_types, f"missing audit event: {expected}")

        telemetry = self.rt.telemetry.summary(project_id=self.project_id)
        self.assertGreater(telemetry["totals"]["latency_ms"], 0)

        # Budgets reconcile against the ledger.
        status = self.rt.budgets.agent_status(
            analyst["id"], self.rt.agents.get_contract(analyst["id"]).budget)
        entries = self.rt.budgets.entries(agent_id=analyst["id"])
        self.assertAlmostEqual(status.spent_usd, sum(e["amount_usd"] for e in entries), places=6)

        # The Owner's system view surfaces the whole picture.
        view = self.rt.architect.system_view(owner)
        self.assertEqual(view["chief_architect"]["id"], chief["id"])
        self.assertGreaterEqual(view["totals"]["agents"], 5)

    def test_runtime_has_no_third_party_dependencies(self):
        """I4: the runtime imports nothing outside the standard library."""
        import ast
        from pathlib import Path

        stdlib = set(sys.stdlib_module_names)
        root = Path(__file__).resolve().parents[1] / "workforce_os"
        offenders = []
        for path in root.rglob("*.py"):
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom):
                    if node.level:      # relative import within the package
                        continue
                    names = [node.module or ""]
                for name in names:
                    top = name.split(".")[0]
                    if top and top not in stdlib:
                        offenders.append(f"{path.name}: {name}")
        self.assertEqual(offenders, [], f"third-party imports found: {offenders}")

    def test_architect_brief_runs_offline(self):
        """I4: the Chief Architect endpoint works with no network and no credentials."""
        chief = self.rt.agents.build(self.project_id, {
            "name": "Chief Architect", "role": "chief_architect",
            "system_prompt": "The Owner's primary interface for system questions.",
            "allowed_tools": [], "data_domains": [], "action_types": [],
        }, actor_id="owner")
        self.rt.agents.set_status(chief["id"], "active", actor_id="owner")

        self.assertTrue(self.rt.config.offline)
        brief = self.rt.architect.brief(owner_principal(), "What needs my attention?")
        self.assertTrue(brief["confirmed"])
        self.assertTrue(brief["offline"])
        self.assertIn("system_view", brief)
