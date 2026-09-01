"""Acceptance: I1, I2 — the HTTP API surface and its authentication boundary."""

from api_client import ApiHarness
from base import OWNER_TOKEN, RuntimeTestCase


class ApiTestCase(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.api = ApiHarness(self.rt, OWNER_TOKEN)

    def tearDown(self):
        self.api.stop()
        super().tearDown()


class TestApiAuth(ApiTestCase):
    def test_auth_required(self):
        """I2: protected routes reject missing and wrong credentials."""
        for token in (None, "", "wrong-token"):
            with self.subTest(token=token):
                status, payload = self.api.get("/api/agents", token=token)
                self.assertEqual(status, 401)
                self.assertEqual(payload["error"], "unauthenticated")

    def test_health_is_public_and_leaks_nothing(self):
        status, payload = self.api.get("/api/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(payload["version"], "0.4.0")
        self.assertNotIn(OWNER_TOKEN, str(payload))
        self.assertTrue(payload["config"]["owner_token_configured"])

    def test_owner_only_routes(self):
        """I2: Owner-only routes are refused for a non-Owner credential."""
        for method, path in [("GET", "/api/approvals"), ("GET", "/api/architect/system-view"),
                             ("GET", "/api/events"), ("POST", "/api/projects")]:
            with self.subTest(route=f"{method} {path}"):
                status, _ = self.api.request(method, path,
                                             {} if method == "POST" else None, token="bad")
                self.assertEqual(status, 401)

    def test_unknown_route_is_404(self):
        status, payload = self.api.get("/api/nope")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"], "not_found")

    def test_malformed_body_is_rejected(self):
        status, payload = self.api.request(
            "POST", "/api/projects", None,
            headers={"Content-Type": "application/json"})
        # An empty body fails validation on `name`, not with a server error.
        self.assertIn(status, (400, 422))

    def test_internal_errors_do_not_leak_stack_traces(self):
        status, payload = self.api.post("/api/tool-calls", {"agent_id": "nope",
                                                            "tool_name": "echo"})
        self.assertEqual(status, 404)
        self.assertNotIn("Traceback", str(payload))


class TestApiSurface(ApiTestCase):
    def test_full_surface_reachable(self):
        """I1: every capability is reachable over HTTP."""
        status, project = self.api.post("/api/projects", {"name": "API Project"})
        self.assertEqual(status, 201)
        pid = project["id"]

        # Build and activate an agent.
        status, agent = self.api.post("/api/agents", {"project_id": pid, "contract": {
            "name": "API Worker", "role": "specialist",
            "system_prompt": "A specialist reachable entirely over the HTTP API.",
            "allowed_tools": ["echo", "summarize"], "data_domains": ["public"],
            "action_types": ["read", "analyze"], "budget": {"max_usd": 5.0}}})
        self.assertEqual(status, 201)
        self.assertEqual(agent["status"], "draft")
        status, agent = self.api.post(f"/api/agents/{agent['id']}/status", {"status": "active"})
        self.assertEqual((status, agent["status"]), (200, "active"))

        # Contract detail, versions and budget in one read.
        status, detail = self.api.get(f"/api/agents/{agent['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(detail["contract"]["version"], 1)
        self.assertEqual(detail["budget"]["budget"]["max_usd"], 5.0)

        # Task, tool call, memory, telemetry.
        status, task = self.api.post("/api/tasks", {"project_id": pid, "title": "API task",
                                                    "assignee_agent_id": agent["id"],
                                                    "criteria": ["accurate"]})
        self.assertEqual(status, 201)

        status, call = self.api.post("/api/tool-calls", {
            "agent_id": agent["id"], "tool_name": "echo", "task_id": task["id"],
            "arguments": {"message": "over http"}})
        self.assertEqual((status, call["status"]), (200, "executed"))
        self.assertEqual(call["output"]["echoed"], "over http")

        status, memory = self.api.post("/api/memory", {
            "project_id": pid, "layer": "semantic", "key": "api fact",
            "content": "Recorded through the API.",
            "provenance": {"author_agent_id": agent["id"], "source": "api test",
                           "origin": "observation"}})
        self.assertEqual(status, 201)
        status, read = self.api.get(f"/api/memory?project_id={pid}&layer=semantic")
        self.assertEqual(len(read["records"]), 1)

        status, telemetry = self.api.get(f"/api/telemetry?project_id={pid}")
        self.assertEqual(status, 200)
        self.assertGreater(telemetry["totals"]["latency_ms"], 0)

        # Audit chain verifies over the API too.
        status, verified = self.api.get("/api/audit/verify")
        self.assertEqual((status, verified["verified"]), (200, True))

    def test_tools_and_packet_kinds_are_discoverable(self):
        status, payload = self.api.get("/api/tools")
        self.assertEqual(status, 200)
        self.assertIn("echo", {t["name"] for t in payload["tools"]})
        self.assertIn("work_request", {k["kind"] for k in payload["packet_kinds"]})

    def test_validation_errors_name_the_field(self):
        status, payload = self.api.post("/api/agents", {"project_id": self.project_id,
                                                        "contract": {"name": "x", "role": "nope"}})
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "validation_failed")
        self.assertIn("field", payload["details"])

    def test_architect_system_view(self):
        status, view = self.api.get("/api/architect/system-view")
        self.assertEqual(status, 200)
        self.assertIn("totals", view)
        self.assertIn("attention_required", view)


class TestDashboard(ApiTestCase):
    def test_dashboard_is_served(self):
        status, _ = self.api.get("/api/health", token=None)
        self.assertEqual(status, 200)
        import urllib.request
        with urllib.request.urlopen(f"http://{self.api.host}:{self.api.port}/", timeout=10) as r:
            body = r.read().decode()
        self.assertEqual(r.status, 200)
        self.assertIn("AI Workforce OS", body)
        # The dashboard must not ship an embedded credential.
        self.assertNotIn(OWNER_TOKEN, body)
