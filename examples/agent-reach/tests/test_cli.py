"""End-to-end CLI behavior: exit codes, JSON output, and files on disk."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from agent_reach.cli import EXIT_FAILED, EXIT_OK, EXIT_USAGE, main

FAKE_SERVER = str(Path(__file__).parent / "fake_mcp_server.py")

# A catalog of stub servers, so CLI tests never touch the network.
TEST_CATALOG = {
    "schema_version": 1,
    "revision": "cli-test",
    "default_profile": "standard",
    "profiles": {"standard": ["search", "fetch"], "wide": ["search", "fetch", "docs"]},
    "providers": [
        {
            "id": "stub-search",
            "name": "Stub Search",
            "summary": "stub",
            "capabilities": ["search", "fetch"],
            "runtime": "python",
            "command": {"exec": sys.executable, "args": [FAKE_SERVER]},
            "expected_tools": ["search"],
            "stability": 80,
            "cost": "free",
            "probe": {"tool": "search", "arguments": {"query": "x"}},
        },
        {
            "id": "stub-docs",
            "name": "Stub Docs",
            "summary": "stub",
            "capabilities": ["docs"],
            "runtime": "python",
            "command": {"exec": sys.executable, "args": [FAKE_SERVER, "--tools", "docs"]},
            "expected_tools": ["docs"],
            "stability": 60,
            "cost": "free",
            "keys": [{"env": "STUB_DOCS_KEY", "required": True, "signup": "https://docs.example"}],
        },
    ],
}


class CliTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.project = self.tmp / "project"
        self.project.mkdir()
        self.registry = self.tmp / "registry.json"
        self.registry.write_text(json.dumps(TEST_CATALOG), encoding="utf-8")
        patcher = mock.patch.dict(
            "os.environ", {"AGENT_REACH_HOME": str(self.tmp / "home"), "NO_COLOR": "1"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_cli(self, *args: str) -> tuple[int, str, str]:
        argv = ["--registry", str(self.registry), "--no-overlay", *args]
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def run_json(self, *args: str) -> tuple[int, dict]:
        code, out, _ = self.run_cli("--json", *args)
        return code, json.loads(out)

    @property
    def config_path(self) -> Path:
        return self.project / ".vscode" / "mcp.json"

    def install(self, *extra: str) -> tuple[int, str, str]:
        return self.run_cli(
            "install", "--client", "vscode", "--project", str(self.project), "--yes", *extra
        )


class InspectionCommandTests(CliTestCase):
    def test_detect_reports_runtimes_clients_and_keys(self) -> None:
        code, payload = self.run_json("detect", "--project", str(self.project))
        self.assertEqual(code, EXIT_OK)
        self.assertIn("python3", payload["runtimes"])
        self.assertIn("STUB_DOCS_KEY", payload["api_keys"])
        self.assertTrue(any(c["id"] == "vscode" for c in payload["clients"]))

    def test_providers_lists_the_active_catalog(self) -> None:
        code, payload = self.run_json("providers")
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["revision"], "cli-test")
        self.assertEqual({p["id"] for p in payload["providers"]}, {"stub-search", "stub-docs"})

    def test_plan_succeeds_when_every_capability_is_covered(self) -> None:
        code, payload = self.run_json("plan")
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(payload["complete"])
        self.assertEqual([p["id"] for p in payload["selected"]], ["stub-search"])

    def test_plan_exits_nonzero_when_a_capability_cannot_be_covered(self) -> None:
        code, payload = self.run_json("plan", "--profile", "wide")
        self.assertEqual(code, EXIT_FAILED)
        self.assertFalse(payload["complete"])
        self.assertEqual(payload["gaps"][0]["capability"], "docs")
        self.assertIn("STUB_DOCS_KEY", payload["gaps"][0]["remedy"])

    def test_global_flags_are_accepted_after_the_subcommand(self) -> None:
        code, out, _ = self.run_cli("plan", "--json")
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(json.loads(out)["complete"])


class InstallTests(CliTestCase):
    def test_dry_run_writes_nothing(self) -> None:
        code, _, _ = self.install("--dry-run")
        self.assertEqual(code, EXIT_OK)
        self.assertFalse(self.config_path.exists())

    def test_install_writes_the_config_and_verifies_it_live(self) -> None:
        code, out, _ = self.install("--timeout", "30")
        self.assertEqual(code, EXIT_OK)
        servers = json.loads(self.config_path.read_text())["servers"]
        self.assertIn("agent-reach-stub-search", servers)
        self.assertIn("installed and verified", out)

    def test_install_records_state_for_later_commands(self) -> None:
        self.install("--no-verify")
        state = json.loads((self.tmp / "home" / "state.json").read_text())
        self.assertEqual(state["installations"][0]["provider_ids"], ["stub-search"])

    def test_a_failing_health_check_exits_nonzero_but_keeps_the_config(self) -> None:
        broken = dict(TEST_CATALOG)
        broken["providers"] = [
            {
                **TEST_CATALOG["providers"][0],
                "command": {
                    "exec": sys.executable,
                    "args": [FAKE_SERVER, "--crash-on", "initialize"],
                },
            }
        ]
        self.registry.write_text(json.dumps(broken), encoding="utf-8")
        code, out, _ = self.install("--timeout", "10")
        self.assertEqual(code, EXIT_FAILED)
        self.assertTrue(self.config_path.exists())
        self.assertIn("failed their health check", out)

    def test_probe_calls_a_real_tool(self) -> None:
        code, payload = self.run_json(
            "install", "--client", "vscode", "--project", str(self.project),
            "--yes", "--probe", "--timeout", "30",
        )
        self.assertEqual(code, EXIT_OK)
        checks = {c["name"]: c for c in payload["health"][0]["checks"]}
        self.assertEqual(checks["probe"]["status"], "ok")

    def test_an_unknown_client_is_a_usage_error(self) -> None:
        code, _, err = self.run_cli("install", "--client", "nope", "--yes")
        self.assertEqual(code, EXIT_USAGE)
        self.assertIn("unknown client", err)

    def test_an_uncoverable_capability_is_a_usage_error(self) -> None:
        code, _, err = self.run_cli("install", "--capability", "browse", "--yes")
        self.assertEqual(code, EXIT_USAGE)
        self.assertIn("browse", err)


class DoctorAndRemoveTests(CliTestCase):
    def test_doctor_reports_healthy_after_an_install(self) -> None:
        self.install("--no-verify")
        code, payload = self.run_json(
            "doctor", "--client", "vscode", "--project", str(self.project), "--timeout", "30"
        )
        self.assertEqual(code, EXIT_OK)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["health"][0]["provider"], "stub-search")

    def test_doctor_separates_managed_servers_from_hand_written_ones(self) -> None:
        self.install("--no-verify")
        data = json.loads(self.config_path.read_text())
        data["servers"]["hand-written"] = {"command": "x"}
        self.config_path.write_text(json.dumps(data), encoding="utf-8")
        _, payload = self.run_json(
            "doctor", "--client", "vscode", "--project", str(self.project), "--timeout", "30"
        )
        client = payload["clients"][0]
        self.assertEqual(client["managed_servers"], ["agent-reach-stub-search"])
        self.assertEqual(client["other_servers"], ["hand-written"])

    def test_doctor_is_quiet_when_nothing_is_installed(self) -> None:
        code, out, _ = self.run_cli(
            "doctor", "--client", "vscode", "--project", str(self.project)
        )
        self.assertEqual(code, EXIT_OK)
        self.assertIn("nothing installed", out)

    def test_remove_deletes_only_managed_entries(self) -> None:
        self.install("--no-verify")
        data = json.loads(self.config_path.read_text())
        data["servers"]["hand-written"] = {"command": "x"}
        self.config_path.write_text(json.dumps(data), encoding="utf-8")
        code, _, _ = self.run_cli("remove", "--client", "vscode", "--project", str(self.project))
        self.assertEqual(code, EXIT_OK)
        servers = json.loads(self.config_path.read_text())["servers"]
        self.assertEqual(list(servers), ["hand-written"])


class UpdateTests(CliTestCase):
    def test_update_adopts_a_valid_catalog(self) -> None:
        source = self.tmp / "new.json"
        source.write_text(
            json.dumps({"schema_version": 1, "revision": "2030-01-01"}), encoding="utf-8"
        )
        code, out, _ = self.run_cli("update", "--from", str(source))
        self.assertEqual(code, EXIT_OK)
        self.assertIn("2030-01-01", out)
        self.assertTrue((self.tmp / "home" / "registry.json").exists())

    def test_an_invalid_catalog_is_refused(self) -> None:
        source = self.tmp / "bad.json"
        source.write_text(json.dumps({"schema_version": 1, "providers": [{"nope": 1}]}), "utf-8")
        code, _, err = self.run_cli("update", "--from", str(source))
        self.assertEqual(code, EXIT_USAGE)
        self.assertIn("rejected", err)
        self.assertFalse((self.tmp / "home" / "registry.json").exists())

    def test_update_without_a_source_explains_itself(self) -> None:
        code, _, err = self.run_cli("update")
        self.assertEqual(code, EXIT_USAGE)
        self.assertIn("--from", err)

    def test_plain_http_is_refused_by_default(self) -> None:
        code, _, err = self.run_cli("update", "--from", "http://example.com/registry.json")
        self.assertEqual(code, EXIT_USAGE)
        self.assertIn("HTTP", err)


if __name__ == "__main__":
    unittest.main()
