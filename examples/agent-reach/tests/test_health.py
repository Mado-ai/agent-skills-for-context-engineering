"""Health checks, driven against a stub MCP server rather than the network."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

from agent_reach.console import FAIL, PASS, SKIP, WARN
from agent_reach.health import check_provider
from agent_reach.registry import _provider

FAKE_SERVER = str(Path(__file__).parent / "fake_mcp_server.py")


def fake(**overrides) -> object:
    """A provider whose command runs the stub server with the given flags."""
    server_args = overrides.pop("server_args", [])
    document = {
        "id": "fake",
        "name": "Fake",
        "capabilities": ["search"],
        "runtime": "python",
        "command": {"exec": sys.executable, "args": [FAKE_SERVER, *server_args]},
        "expected_tools": ["search"],
        "probe": {"tool": "search", "arguments": {"query": "x"}},
    }
    document.update(overrides)
    return _provider(document)


class HandshakeTests(unittest.TestCase):
    def test_a_healthy_server_passes_every_check(self) -> None:
        result = check_provider(fake(), timeout=20)
        self.assertEqual(result.status, PASS)
        self.assertEqual(result.server, "fake-server 9.9.9")
        self.assertEqual(result.tools, ["search", "fetch_content"])

    def test_non_json_banner_output_is_skipped(self) -> None:
        result = check_provider(fake(server_args=["--banner"]), timeout=20)
        self.assertEqual(result.status, PASS)

    def test_a_missing_launcher_fails_before_anything_starts(self) -> None:
        provider = _provider(
            {
                "id": "ghost",
                "name": "Ghost",
                "capabilities": ["search"],
                "command": {"exec": "definitely-not-installed-xyz", "args": []},
            }
        )
        result = check_provider(provider, timeout=5)
        self.assertEqual(result.status, FAIL)
        self.assertEqual(result.checks[0].name, "launcher")

    def test_a_missing_key_fails_without_starting_the_server(self) -> None:
        provider = fake(keys=[{"env": "NEEDED_KEY", "required": True}])
        result = check_provider(provider, timeout=20, env={})
        self.assertEqual(result.status, FAIL)
        self.assertTrue(any(c.name == "credentials" and c.status == FAIL for c in result.checks))

    def test_a_present_key_lets_the_check_proceed(self) -> None:
        provider = fake(keys=[{"env": "NEEDED_KEY", "required": True}])
        result = check_provider(provider, timeout=20, env={"NEEDED_KEY": "value"})
        self.assertEqual(result.status, PASS)

    def test_a_server_that_exits_during_handshake_fails(self) -> None:
        result = check_provider(fake(server_args=["--crash-on", "initialize"]), timeout=20)
        self.assertEqual(result.status, FAIL)

    def test_a_hanging_server_fails_on_the_timeout(self) -> None:
        result = check_provider(fake(server_args=["--hang"]), timeout=2)
        self.assertEqual(result.status, FAIL)
        self.assertTrue(any("within" in c.detail for c in result.checks))

    def test_a_server_with_no_tools_fails(self) -> None:
        result = check_provider(fake(server_args=["--no-tools"]), timeout=20)
        self.assertEqual(result.status, FAIL)


class DriftTests(unittest.TestCase):
    def test_a_renamed_tool_warns_instead_of_failing(self) -> None:
        # The server is healthy; the catalog is stale. That is a warning, because
        # the agent still gets working internet access.
        result = check_provider(fake(server_args=["--tools", "web_search"]), timeout=20)
        self.assertEqual(result.status, WARN)
        tools_check = next(c for c in result.checks if c.name == "tools")
        self.assertIn("out of date", tools_check.detail)


class ProbeTests(unittest.TestCase):
    def test_the_probe_is_skipped_unless_requested(self) -> None:
        result = check_provider(fake(), timeout=20)
        self.assertTrue(any(c.name == "probe" and c.status == SKIP for c in result.checks))

    def test_a_successful_probe_reports_returned_content(self) -> None:
        result = check_provider(fake(), timeout=20, probe=True)
        self.assertEqual(result.status, PASS)
        probe = next(c for c in result.checks if c.name == "probe")
        self.assertEqual(probe.status, PASS)

    def test_a_tool_error_during_the_probe_fails_the_check(self) -> None:
        result = check_provider(fake(server_args=["--fail-probe"]), timeout=20, probe=True)
        self.assertEqual(result.status, FAIL)
        probe = next(c for c in result.checks if c.name == "probe")
        self.assertIn("upstream rejected the key", probe.detail)

    def test_an_empty_probe_result_warns(self) -> None:
        result = check_provider(fake(server_args=["--empty-probe"]), timeout=20, probe=True)
        self.assertEqual(result.status, WARN)

    def test_a_probe_for_an_absent_tool_is_skipped_not_failed(self) -> None:
        provider = fake(
            server_args=["--tools", "search"],
            probe={"tool": "not_there", "arguments": {}},
            expected_tools=["search"],
        )
        result = check_provider(provider, timeout=20, probe=True)
        self.assertEqual(result.status, PASS)
        probe = next(c for c in result.checks if c.name == "probe")
        self.assertEqual(probe.status, SKIP)


class ReportingTests(unittest.TestCase):
    def test_results_serialize_for_json_output(self) -> None:
        payload = check_provider(fake(), timeout=20).as_dict()
        self.assertEqual(payload["provider"], "fake")
        self.assertIn("checks", payload)
        self.assertIsInstance(payload["duration_seconds"], float)


if __name__ == "__main__":
    unittest.main()


class OptionalKeyTests(unittest.TestCase):
    def test_an_unset_optional_key_is_reported_as_keyless_not_as_satisfied(self) -> None:
        provider = fake(keys=[{"env": "OPTIONAL_KEY", "required": False}])
        result = check_provider(provider, timeout=20, env={})
        credentials = next(c for c in result.checks if c.name == "credentials")
        self.assertEqual(credentials.status, SKIP)
        self.assertIn("keyless", credentials.detail)
        self.assertEqual(result.status, PASS)

    def test_a_set_optional_key_is_acknowledged(self) -> None:
        provider = fake(keys=[{"env": "OPTIONAL_KEY", "required": False}])
        result = check_provider(provider, timeout=20, env={"OPTIONAL_KEY": "v"})
        credentials = next(c for c in result.checks if c.name == "credentials")
        self.assertEqual(credentials.status, PASS)
        self.assertIn("optional key set", credentials.detail)


class NegativeSignalTests(unittest.TestCase):
    def test_a_success_response_that_reads_like_a_failure_warns(self) -> None:
        message = "No results were found for your search query, possibly due to bot detection."
        result = check_provider(
            fake(server_args=["--probe-text", message]), timeout=20, probe=True
        )
        self.assertEqual(result.status, WARN)
        probe = next(c for c in result.checks if c.name == "probe")
        self.assertIn("reads like a failure", probe.detail)

    def test_a_long_result_mentioning_a_signal_phrase_still_passes(self) -> None:
        # A real result set that happens to discuss rate limits must not warn.
        message = "Rate limit best practices. " + ("useful prose about the topic. " * 40)
        result = check_provider(
            fake(server_args=["--probe-text", message]), timeout=20, probe=True
        )
        self.assertEqual(result.status, PASS)
