"""Acceptance: A1-A3, A6, C5, E3, G5, H4 — durable security-boundary tests.

These encode the non-negotiable authority model. A change that breaks one of these is a
governance regression, not a test that needs updating.
"""

import ast
import inspect
import os

from base import OWNER_TOKEN, RuntimeTestCase
from workforce_os.errors import (
    ApprovalRequired, AuthenticationError, PolicyDenied,
)
from workforce_os.gateway import tools as tools_module
from workforce_os.policy.authority import (
    Principal, authenticate_owner, owner_principal, require_owner,
)
from workforce_os.redaction import REDACTED, redact


class TestOwnerAuthority(RuntimeTestCase):
    def test_owner_authentication_requires_the_configured_token(self):
        self.assertTrue(authenticate_owner(OWNER_TOKEN, OWNER_TOKEN).is_owner)
        for bad in (None, "", "wrong-token", OWNER_TOKEN + "x"):
            with self.subTest(token=bad):
                with self.assertRaises(AuthenticationError):
                    authenticate_owner(bad, OWNER_TOKEN)

    def test_unset_owner_token_denies_everything(self):
        """A deployment with no Owner token cannot perform Owner actions at all."""
        with self.assertRaises(AuthenticationError):
            authenticate_owner("anything", "")

    def test_agent_cannot_approve_own_request(self):
        """A1 & A2: approval is Owner-only, and never by the requesting agent."""
        agent = self.make_agent(name="Ambitious", tools=("request_external_publication",),
                                domains=("public",), actions=("read", "transact"))
        args = {"destination": "world", "content": "unreviewed"}
        with self.assertRaises(ApprovalRequired) as ctx:
            self.rt.gateway.call(agent_id=agent["id"],
                                 tool_name="request_external_publication", arguments=args)
        request_id = ctx.exception.request_id

        # No agent principal may approve — not even a level-5 chief architect.
        for label, principal in [
            ("requesting agent", Principal(kind="agent", id=agent["id"],
                                           project_id=self.project_id, role="specialist", level=2)),
            ("chief architect", Principal(kind="agent", id="agt_chief",
                                          project_id=self.project_id,
                                          role="chief_architect", level=5)),
            ("system", Principal(kind="system", id="system", level=0)),
        ]:
            with self.subTest(principal=label):
                with self.assertRaises(PolicyDenied) as denied:
                    self.rt.approvals.approve(request_id, principal=principal)
                self.assertEqual(denied.exception.code, "owner_authority_required")

        self.assertEqual(self.rt.approvals.get_request(request_id)["status"], "pending")

        # An Owner impersonating the agent's id is still refused by the self-approval guard.
        with self.assertRaises(PolicyDenied) as denied:
            self.rt.approvals.approve(request_id, principal=owner_principal(agent["id"]))
        self.assertEqual(denied.exception.code, "self_approval_denied")

    def test_owner_only_actions_reject_every_agent_level(self):
        for level in (1, 2, 3, 4, 5):
            with self.subTest(level=level):
                principal = Principal(kind="agent", id="agt_x", project_id=self.project_id,
                                      role="specialist", level=level)
                with self.assertRaises(PolicyDenied):
                    require_owner(principal, "retire_agent")


class TestLevelDoesNotGrantScope(RuntimeTestCase):
    def test_l5_does_not_grant_tool_scope(self):
        """A3: full visibility is not full capability."""
        chief = self.rt.agents.build(self.project_id, {
            "name": "Chief Architect", "role": "chief_architect",
            "system_prompt": "System-wide visibility and orchestration, no execution scope.",
            "allowed_tools": ["echo"], "data_domains": ["public"], "action_types": ["read"],
        }, actor_id="owner")
        self.rt.agents.set_status(chief["id"], "active", actor_id="owner")
        self.assertEqual(chief["level"], 5)

        # In contract: allowed. Out of contract: denied, despite being L5.
        self.assertEqual(
            self.rt.gateway.call(agent_id=chief["id"], tool_name="echo",
                                 arguments={"message": "hi"})["status"], "executed")
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=chief["id"], tool_name="draft_document",
                                 arguments={"title": "T",
                                            "sections": [{"heading": "H", "content": "C"}]})
        self.assertEqual(ctx.exception.code, "tool_not_in_contract")

    def test_l5_still_needs_owner_approval_for_high_risk(self):
        chief = self.rt.agents.build(self.project_id, {
            "name": "Chief Architect", "role": "chief_architect",
            "system_prompt": "System-wide visibility with a high-risk tool in contract.",
            "allowed_tools": ["request_external_publication"], "data_domains": ["public"],
            "action_types": ["transact"],
        }, actor_id="owner")
        self.rt.agents.set_status(chief["id"], "active", actor_id="owner")
        with self.assertRaises(ApprovalRequired):
            self.rt.gateway.call(agent_id=chief["id"], tool_name="request_external_publication",
                                 arguments={"destination": "d", "content": "c"})


class TestApprovalTokenBinding(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.agent = self.make_agent(name="Bound", tools=("request_external_publication",),
                                     domains=("public",), actions=("transact",))
        self.args = {"destination": "newsletter", "content": "approved copy"}
        with self.assertRaises(ApprovalRequired) as ctx:
            self.rt.gateway.call(agent_id=self.agent["id"],
                                 tool_name="request_external_publication", arguments=self.args)
        self.grant = self.rt.approvals.approve(ctx.exception.request_id,
                                               principal=owner_principal())

    def test_token_bound_to_arguments(self):
        """A6: a token approved for one payload cannot be replayed against another."""
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=self.agent["id"],
                                 tool_name="request_external_publication",
                                 arguments={"destination": "newsletter",
                                            "content": "SUBSTITUTED, UNAPPROVED COPY"},
                                 approval_token=self.grant["token"])
        self.assertEqual(ctx.exception.code, "approval_token_arguments_mismatch")
        # The token survives the failed attempt for its legitimate use.
        self.assertEqual(
            self.rt.gateway.call(agent_id=self.agent["id"],
                                 tool_name="request_external_publication", arguments=self.args,
                                 approval_token=self.grant["token"])["status"], "attempted")

    def test_token_bound_to_agent(self):
        other = self.make_agent(name="Impostor", tools=("request_external_publication",),
                                domains=("public",), actions=("transact",))
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=other["id"], tool_name="request_external_publication",
                                 arguments=self.args, approval_token=self.grant["token"])
        self.assertEqual(ctx.exception.code, "approval_token_agent_mismatch")

    def test_revoked_token_refused(self):
        self.rt.approvals.revoke_token(self.grant["token_id"], principal=owner_principal())
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=self.agent["id"],
                                 tool_name="request_external_publication", arguments=self.args,
                                 approval_token=self.grant["token"])
        self.assertEqual(ctx.exception.code, "approval_token_revoked")

    def test_plaintext_token_is_never_persisted(self):
        rows = self.rt.db.query("SELECT * FROM approval_tokens")
        self.assertNotIn(self.grant["token"], str(rows))
        self.assertNotIn(self.grant["token"], str(self.rt.events.list(limit=100)))


class TestProjectIsolation(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.other_project = self.rt.projects.create("Other Project")
        self.insider = self.make_agent(name="Insider", role="project_lead")
        self.outsider = self.make_agent(name="Outsider", project_id=self.other_project["id"])

    def test_cross_project_delegation_denied(self):
        """C5: delegation never crosses a project boundary."""
        task = self.make_task(assignee=self.insider["id"])
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.delegation.delegate(
                parent_agent_id=self.insider["id"], child_agent_id=self.outsider["id"],
                parent_task_id=task["id"], packet_kind="work_request",
                packet_payload=self.WORK_REQUEST)
        self.assertEqual(ctx.exception.code, "project_isolation")

    def test_cross_project_memory_denied(self):
        """E3: no agent level reads another project's memory; only the Owner does."""
        self.rt.memory.write(project_id=self.other_project["id"], layer="semantic",
                             key="their secret", content="confidential to the other project",
                             provenance={"author_agent_id": self.outsider["id"],
                                         "source": "test", "origin": "observation"})
        for level, role in ((2, "specialist"), (4, "project_lead"), (5, "chief_architect")):
            with self.subTest(level=level):
                principal = Principal(kind="agent", id=self.insider["id"],
                                      project_id=self.project_id, role=role, level=level)
                with self.assertRaises(PolicyDenied) as ctx:
                    self.rt.memory.read(principal, project_id=self.other_project["id"])
                self.assertEqual(ctx.exception.code, "project_isolation")

        # The Owner, and only the Owner, may read across projects.
        self.assertEqual(
            len(self.rt.memory.read(owner_principal(), project_id=self.other_project["id"])), 1)

    def test_cross_project_task_assignment_denied(self):
        task = self.make_task()
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.tasks.assign(task["id"], self.outsider["id"], actor_id="owner")
        self.assertEqual(ctx.exception.code, "project_isolation")

    def test_cross_project_tool_call_denied(self):
        other_task = self.make_task(title="Their task", project_id=self.other_project["id"])
        with self.assertRaises(PolicyDenied) as ctx:
            self.rt.gateway.call(agent_id=self.insider["id"], tool_name="echo",
                                 arguments={"message": "peek"}, task_id=other_task["id"])
        self.assertEqual(ctx.exception.code, "project_isolation")


class TestNoExternalExecution(RuntimeTestCase):
    FORBIDDEN_MODULES = {
        "subprocess", "socket", "urllib", "urllib.request", "requests", "httpx",
        "http", "http.client", "webbrowser", "selenium", "playwright", "ftplib",
        "telnetlib", "smtplib", "asyncio", "ctypes", "pty", "shutil",
    }
    FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "open", "system", "popen"}

    def test_no_external_execution_tools(self):
        """G5: no built-in tool can reach a shell, a browser, or the network.

        Checked against the parsed AST rather than the source text, so the assertion is
        about what the module actually does — prose in a docstring cannot trip it, and
        an added import cannot hide from it.
        """
        tree = ast.parse(inspect.getsource(tools_module))

        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        offending = {name for name in imported
                     if name in self.FORBIDDEN_MODULES
                     or name.split(".")[0] in self.FORBIDDEN_MODULES}
        self.assertEqual(offending, set(),
                         f"built-in tools must not import {sorted(offending)}")

        called = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func = node.func
                if isinstance(func, ast.Name):
                    called.add(func.id)
                elif isinstance(func, ast.Attribute):
                    called.add(func.attr)
        dangerous = called & self.FORBIDDEN_CALLS
        self.assertEqual(dangerous, set(),
                         f"built-in tools must not call {sorted(dangerous)}")

    def test_the_runtime_registers_only_the_audited_tool_set(self):
        """A tool added outside this audited set would fail this test deliberately."""
        self.assertEqual(
            self.rt.tools.names(),
            {"echo", "text_stats", "summarize", "draft_document", "record_decision",
             "request_external_publication"})

    def test_every_builtin_tool_is_declared_and_pure(self):
        for spec in self.rt.tools.describe_all():
            with self.subTest(tool=spec["name"]):
                self.assertIn(spec["action_type"],
                              ("read", "write", "analyze", "communicate", "transact", "admin"))
                self.assertTrue(spec["data_domains"], "a tool must declare its data domains")
                self.assertIn(spec["declared_risk"], ("low", "medium", "high"))

    def test_the_only_transact_tool_confirms_nothing_happened(self):
        """v0.4 performs no outbound execution, and says so rather than implying success."""
        spec = self.rt.tools.get("request_external_publication")
        result = spec.handler({"destination": "d", "content": "c"}, {})
        self.assertFalse(result.confirmed)
        self.assertEqual(result.output["status"], "recorded_intent")


class TestSecretHandling(RuntimeTestCase):
    def test_secrets_redacted(self):
        """H4: credential-shaped fields and known secret values never reach storage."""
        payload = {"api_key": "sk-live-should-not-persist", "nested": {"password": "hunter2xyz"},
                   "safe": "ordinary text", "items": [{"authorization": "Bearer abc123456"}]}
        cleaned = redact(payload)
        self.assertEqual(cleaned["api_key"], REDACTED)
        self.assertEqual(cleaned["nested"]["password"], REDACTED)
        self.assertEqual(cleaned["items"][0]["authorization"], REDACTED)
        self.assertEqual(cleaned["safe"], "ordinary text")

        # Through the audit trail and the gateway's stored arguments.
        self.rt.events.append("test.secret", actor_type="system", actor_id="t",
                              project_id=self.project_id, payload=payload)
        stored = str(self.rt.events.list(event_type="test.secret"))
        self.assertNotIn("sk-live-should-not-persist", stored)
        self.assertNotIn("hunter2xyz", stored)

    def test_secret_values_redacted_wherever_they_appear(self):
        os.environ["WORKFORCE_OS_PROVIDER_API_KEY"] = "super-secret-value-123"
        try:
            leaked = redact({"note": "the key is super-secret-value-123 , keep it safe"})
            self.assertNotIn("super-secret-value-123", leaked["note"])
            self.assertIn(REDACTED, leaked["note"])
        finally:
            del os.environ["WORKFORCE_OS_PROVIDER_API_KEY"]

    def test_config_never_exposes_secrets(self):
        redacted = self.rt.config.redacted()
        self.assertNotIn(OWNER_TOKEN, str(redacted))
        self.assertTrue(redacted["owner_token_configured"])
        self.assertNotIn("owner_token", redacted)
        self.assertNotIn(OWNER_TOKEN, repr(self.rt.config))

    def test_no_secrets_committed_to_the_repository(self):
        """The repository must carry no real credentials — only env var names."""
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        suspicious = ("sk-ant-", "sk-live-", "AKIA", "-----BEGIN PRIVATE KEY-----")
        for path in root.rglob("*.py"):
            if "tests" in path.parts:
                continue
            content = path.read_text()
            for marker in suspicious:
                self.assertNotIn(marker, content, f"{path} appears to contain a secret")
