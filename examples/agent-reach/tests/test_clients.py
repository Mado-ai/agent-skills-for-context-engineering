"""Config editing: preserve what the user wrote, never write a secret."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent_reach.clients import (
    Client,
    build_entry,
    discover_clients,
    env_block,
    get_spec,
    install_providers,
    is_managed,
    read_servers,
    remove_providers,
    server_name,
    unresolved_keys,
)
from agent_reach.registry import load_registry

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover - 3.10 has no TOML reader
    tomllib = None

REGISTRY = load_registry(use_overlay=False)
TAVILY = REGISTRY.get("tavily")
FETCH = REGISTRY.get("fetch")


def client_for(client_id: str, path: Path) -> Client:
    return Client(spec=get_spec(client_id), path=path, detected=True, reason="test")


class EntryTests(unittest.TestCase):
    def test_vscode_entries_declare_a_transport_type(self) -> None:
        entry = build_entry(FETCH, get_spec("vscode"))
        self.assertEqual(entry["type"], "stdio")

    def test_other_clients_omit_the_type_field(self) -> None:
        entry = build_entry(FETCH, get_spec("claude-code"))
        self.assertNotIn("type", entry)

    def test_shell_clients_get_dollar_brace_placeholders(self) -> None:
        block = env_block(TAVILY, get_spec("claude-code"))
        self.assertEqual(block, {"TAVILY_API_KEY": "${TAVILY_API_KEY}"})

    def test_vscode_gets_its_own_placeholder_syntax(self) -> None:
        block = env_block(TAVILY, get_spec("vscode"))
        self.assertEqual(block, {"TAVILY_API_KEY": "${env:TAVILY_API_KEY}"})

    def test_clients_without_expansion_get_no_env_block(self) -> None:
        self.assertEqual(env_block(TAVILY, get_spec("codex")), {})
        self.assertIn("TAVILY_API_KEY", unresolved_keys(TAVILY, get_spec("codex")))

    def test_a_real_key_value_is_never_written(self) -> None:
        with mock.patch.dict("os.environ", {"TAVILY_API_KEY": "sk-do-not-leak"}):
            entry = build_entry(TAVILY, get_spec("claude-code"))
        self.assertNotIn("sk-do-not-leak", json.dumps(entry))

    def test_managed_entries_are_namespaced(self) -> None:
        self.assertEqual(server_name(FETCH), "agent-reach-fetch")
        self.assertTrue(is_managed(server_name(FETCH)))
        self.assertFalse(is_managed("my-own-server"))


class JsonConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "config.json"
        self.client = client_for("claude-code", self.path)

    def test_install_creates_a_config_and_parent_directories(self) -> None:
        nested = client_for("vscode", self.tmp / "a" / "b" / "mcp.json")
        install_providers(nested, [FETCH])
        self.assertTrue(nested.path.exists())
        self.assertIn("agent-reach-fetch", read_servers(nested))

    def test_unrelated_settings_survive_a_write(self) -> None:
        self.path.write_text(json.dumps({"numStartups": 12, "theme": "dark"}), encoding="utf-8")
        install_providers(self.client, [FETCH])
        data = json.loads(self.path.read_text())
        self.assertEqual(data["numStartups"], 12)
        self.assertEqual(data["theme"], "dark")

    def test_hand_written_servers_are_left_alone(self) -> None:
        self.path.write_text(
            json.dumps({"mcpServers": {"mine": {"command": "x"}}}), encoding="utf-8"
        )
        install_providers(self.client, [FETCH])
        remove_providers(self.client, ["fetch"])
        servers = read_servers(self.client)
        self.assertEqual(list(servers), ["mine"])

    def test_remove_only_touches_managed_entries(self) -> None:
        self.path.write_text(
            json.dumps({"mcpServers": {"fetch": {"command": "hand-written"}}}), encoding="utf-8"
        )
        removed, _ = remove_providers(self.client, ["fetch"])
        self.assertEqual(removed, [])
        self.assertIn("fetch", read_servers(self.client))

    def test_reinstall_is_idempotent(self) -> None:
        install_providers(self.client, [FETCH])
        install_providers(self.client, [FETCH])
        self.assertEqual(list(read_servers(self.client)), ["agent-reach-fetch"])

    def test_a_backup_is_written_before_an_existing_file_changes(self) -> None:
        self.path.write_text(json.dumps({"mcpServers": {}}), encoding="utf-8")
        _, backup = install_providers(self.client, [FETCH])
        self.assertIsNotNone(backup)
        self.assertTrue(Path(str(backup)).exists())

    def test_no_backup_is_made_for_a_brand_new_file(self) -> None:
        _, backup = install_providers(self.client, [FETCH])
        self.assertIsNone(backup)

    def test_malformed_json_is_reported_rather_than_overwritten(self) -> None:
        self.path.write_text("{ broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            install_providers(self.client, [FETCH])
        self.assertEqual(self.path.read_text(), "{ broken")

    def test_an_empty_file_is_treated_as_an_empty_config(self) -> None:
        self.path.write_text("", encoding="utf-8")
        install_providers(self.client, [FETCH])
        self.assertIn("agent-reach-fetch", read_servers(self.client))


@unittest.skipIf(tomllib is None, "reading back TOML needs Python 3.11+")
class TomlConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "config.toml"
        self.client = client_for("codex", self.path)

    def test_written_toml_parses_and_keeps_other_tables(self) -> None:
        self.path.write_text(
            'model = "o3"\n\n[mcp_servers.mine]\ncommand = "echo"\n\n[history]\nsize = 5\n',
            encoding="utf-8",
        )
        install_providers(self.client, [FETCH, TAVILY])
        data = tomllib.loads(self.path.read_text())
        self.assertEqual(data["model"], "o3")
        self.assertEqual(data["history"], {"size": 5})
        self.assertIn("mine", data["mcp_servers"])
        self.assertEqual(data["mcp_servers"]["agent-reach-fetch"]["command"], "uvx")

    def test_rewriting_a_server_replaces_rather_than_duplicates(self) -> None:
        install_providers(self.client, [FETCH])
        install_providers(self.client, [FETCH])
        text = self.path.read_text()
        self.assertEqual(text.count("[mcp_servers.agent-reach-fetch]"), 1)

    def test_removing_a_server_leaves_the_rest_of_the_file(self) -> None:
        self.path.write_text('[other]\nkeep = true\n', encoding="utf-8")
        install_providers(self.client, [FETCH, TAVILY])
        remove_providers(self.client, ["tavily"])
        data = tomllib.loads(self.path.read_text())
        self.assertEqual(data["other"], {"keep": True})
        self.assertIn("agent-reach-fetch", data["mcp_servers"])
        self.assertNotIn("agent-reach-tavily", data["mcp_servers"])

    def test_codex_entries_carry_no_type_key(self) -> None:
        install_providers(self.client, [FETCH])
        entry = tomllib.loads(self.path.read_text())["mcp_servers"]["agent-reach-fetch"]
        self.assertNotIn("type", entry)

    def test_args_round_trip_as_a_toml_array(self) -> None:
        install_providers(self.client, [TAVILY])
        data = tomllib.loads(self.path.read_text())
        entry = data["mcp_servers"]["agent-reach-tavily"]
        self.assertEqual(entry["args"], ["-y", "tavily-mcp@latest"])


class DiscoveryTests(unittest.TestCase):
    def test_project_scoped_paths_follow_the_given_project_directory(self) -> None:
        project = Path(tempfile.mkdtemp())
        clients = {c.id: c for c in discover_clients(project)}
        self.assertEqual(clients["vscode"].path, project / ".vscode" / "mcp.json")
        self.assertEqual(clients["claude-code-project"].path, project / ".mcp.json")

    def test_an_existing_config_marks_a_client_as_detected(self) -> None:
        project = Path(tempfile.mkdtemp())
        (project / ".cursor").mkdir()
        (project / ".cursor" / "mcp.json").write_text("{}", encoding="utf-8")
        clients = {c.id: c for c in discover_clients(project)}
        self.assertTrue(clients["cursor-project"].detected)

    def test_every_spec_resolves_to_a_path(self) -> None:
        for client in discover_clients(Path(tempfile.mkdtemp())):
            with self.subTest(client=client.id):
                self.assertTrue(str(client.path))


if __name__ == "__main__":
    unittest.main()
