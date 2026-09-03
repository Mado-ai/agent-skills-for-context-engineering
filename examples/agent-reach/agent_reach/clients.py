"""Agent clients: where each one keeps its MCP config, and how to edit it safely.

Every write is read-modify-write on the real file (these configs hold unrelated
user state), atomic via a same-directory temp file, and backed up first.

Secrets are never written. Each client declares how it resolves environment
placeholders, and a client that resolves none gets no `env` block at all — the
key is expected in the environment the client itself launches from.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .registry import Provider
from .runtime import resolve_command, which

# How a client resolves `${VAR}` inside its MCP config.
ENV_SHELL = "shell"  # ${VAR} is expanded by the client
ENV_VSCODE = "vscode"  # ${env:VAR} is expanded by the client
ENV_INHERIT = "inherit"  # no expansion; the server inherits the client's environment

SERVER_PREFIX = "agent-reach"


@dataclass(frozen=True)
class ClientSpec:
    id: str
    name: str
    scope: str  # "user" or "project"
    fmt: str  # "json" or "toml"
    servers_key: str
    env_style: str
    entry_type: bool = False  # emit `"type": "stdio"` (VS Code requires it)
    markers: tuple[str, ...] = ()  # extra paths that prove the client is installed
    cli: tuple[str, ...] = ()  # executables that prove the client is installed
    docs: str = ""


def _platform_path(mac: str, windows: str, linux: str) -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / mac
    if os.name == "nt":
        base = os.environ.get("APPDATA")
        return (Path(base) if base else home) / windows
    return home / linux


CLIENT_SPECS: tuple[ClientSpec, ...] = (
    ClientSpec(
        id="claude-code",
        name="Claude Code (user scope)",
        scope="user",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_SHELL,
        markers=(".claude",),
        cli=("claude",),
        docs="https://docs.claude.com/en/docs/claude-code/mcp",
    ),
    ClientSpec(
        id="claude-code-project",
        name="Claude Code (project scope, .mcp.json)",
        scope="project",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_SHELL,
        docs="https://docs.claude.com/en/docs/claude-code/mcp",
    ),
    ClientSpec(
        id="claude-desktop",
        name="Claude Desktop",
        scope="user",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_INHERIT,
        docs="https://modelcontextprotocol.io/quickstart/user",
    ),
    ClientSpec(
        id="cursor",
        name="Cursor (user scope)",
        scope="user",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_SHELL,
        markers=(".cursor",),
        cli=("cursor",),
        docs="https://docs.cursor.com/context/model-context-protocol",
    ),
    ClientSpec(
        id="cursor-project",
        name="Cursor (project scope, .cursor/mcp.json)",
        scope="project",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_SHELL,
        docs="https://docs.cursor.com/context/model-context-protocol",
    ),
    ClientSpec(
        id="windsurf",
        name="Windsurf",
        scope="user",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_INHERIT,
        markers=(".codeium/windsurf",),
        cli=("windsurf",),
        docs="https://docs.windsurf.com/windsurf/mcp",
    ),
    ClientSpec(
        id="vscode",
        name="VS Code / Copilot (project scope, .vscode/mcp.json)",
        scope="project",
        fmt="json",
        servers_key="servers",
        env_style=ENV_VSCODE,
        entry_type=True,
        cli=("code",),
        docs="https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
    ),
    ClientSpec(
        id="gemini-cli",
        name="Gemini CLI",
        scope="user",
        fmt="json",
        servers_key="mcpServers",
        env_style=ENV_SHELL,
        markers=(".gemini",),
        cli=("gemini",),
        docs="https://github.com/google-gemini/gemini-cli",
    ),
    ClientSpec(
        id="codex",
        name="Codex CLI",
        scope="user",
        fmt="toml",
        servers_key="mcp_servers",
        env_style=ENV_INHERIT,
        markers=(".codex",),
        cli=("codex",),
        docs="https://github.com/openai/codex",
    ),
)


def config_path(spec: ClientSpec, project_dir: Path) -> Path:
    home = Path.home()
    paths = {
        "claude-code": home / ".claude.json",
        "claude-code-project": project_dir / ".mcp.json",
        "claude-desktop": _platform_path(
            "Library/Application Support/Claude/claude_desktop_config.json",
            "Claude/claude_desktop_config.json",
            ".config/Claude/claude_desktop_config.json",
        ),
        "cursor": home / ".cursor" / "mcp.json",
        "cursor-project": project_dir / ".cursor" / "mcp.json",
        "windsurf": home / ".codeium" / "windsurf" / "mcp_config.json",
        "vscode": project_dir / ".vscode" / "mcp.json",
        "gemini-cli": home / ".gemini" / "settings.json",
        "codex": home / ".codex" / "config.toml",
    }
    return paths[spec.id]


@dataclass(frozen=True)
class Client:
    spec: ClientSpec
    path: Path
    detected: bool
    reason: str

    @property
    def id(self) -> str:
        return self.spec.id

    @property
    def name(self) -> str:
        return self.spec.name

    @property
    def exists(self) -> bool:
        return self.path.exists()


def get_spec(client_id: str) -> ClientSpec:
    for spec in CLIENT_SPECS:
        if spec.id == client_id:
            return spec
    known = ", ".join(s.id for s in CLIENT_SPECS)
    raise KeyError(f"unknown client '{client_id}' (known: {known})")


def discover_clients(project_dir: Path | None = None) -> list[Client]:
    """List every supported client, marking which ones are present on this machine."""
    project_dir = Path(project_dir or Path.cwd())
    home = Path.home()
    found: list[Client] = []
    for spec in CLIENT_SPECS:
        path = config_path(spec, project_dir)
        detected, reason = False, "no config or install found"
        if path.exists():
            detected, reason = True, "config file present"
        else:
            for marker in spec.markers:
                if (home / marker).exists():
                    detected, reason = True, f"~/{marker} present"
                    break
            else:
                for cli in spec.cli:
                    if which(cli):
                        detected, reason = True, f"`{cli}` on PATH"
                        break
        found.append(Client(spec=spec, path=path, detected=detected, reason=reason))
    return found


def detected_clients(project_dir: Path | None = None) -> list[Client]:
    return [c for c in discover_clients(project_dir) if c.detected]


def server_name(provider: Provider, prefix: bool = True) -> str:
    """Config key for a provider's server entry.

    Prefixed by default so Agent Reach can tell its own entries from ones the
    user wrote by hand, and never clobbers or removes someone else's server.
    """
    return f"{SERVER_PREFIX}-{provider.id}" if prefix else provider.id


def is_managed(name: str) -> bool:
    return name.startswith(f"{SERVER_PREFIX}-")


def env_block(provider: Provider, spec: ClientSpec) -> dict[str, str]:
    """Environment placeholders for this provider, in the client's own syntax."""
    if spec.env_style == ENV_INHERIT:
        return {}
    out: dict[str, str] = {}
    for key in provider.keys:
        if not key.required and not os.environ.get(key.env):
            continue
        out[key.env] = (
            "${env:" + key.env + "}" if spec.env_style == ENV_VSCODE else "${" + key.env + "}"
        )
    return out


def build_entry(provider: Provider, spec: ClientSpec) -> dict[str, Any]:
    command, _ = resolve_command(provider)
    entry: dict[str, Any] = {}
    if spec.entry_type:
        entry["type"] = "stdio"
    entry["command"] = command.exec
    entry["args"] = list(command.args)
    env = env_block(provider, spec)
    if env:
        entry["env"] = env
    return entry


def unresolved_keys(provider: Provider, spec: ClientSpec) -> list[str]:
    """Keys this client will not expand — the user must export them itself."""
    if spec.env_style != ENV_INHERIT:
        return []
    return [k.env for k in provider.keys if k.required or os.environ.get(k.env)]


# --- file IO -----------------------------------------------------------------


def backup_path(path: Path) -> Path:
    return path.with_name(path.name + ".agent-reach.bak")


def atomic_write(path: Path, text: str, backup: bool = True) -> Path | None:
    """Write `text` to `path` atomically, returning the backup path if one was made."""
    path.parent.mkdir(parents=True, exist_ok=True)
    made_backup: Path | None = None
    if backup and path.exists():
        made_backup = backup_path(path)
        shutil.copy2(path, made_backup)

    handle = tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    )
    try:
        with handle as fh:
            fh.write(text)
        if path.exists():
            shutil.copymode(path, handle.name)
        os.replace(handle.name, path)
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise
    return made_backup


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def read_servers(client: Client) -> dict[str, Any]:
    """Existing MCP server entries in a client's config, keyed by server name."""
    if client.spec.fmt == "toml":
        return _toml_servers(client)
    data = read_json(client.path)
    servers = data.get(client.spec.servers_key, {})
    return servers if isinstance(servers, dict) else {}


def write_servers(
    client: Client,
    entries: dict[str, Any],
    remove: tuple[str, ...] = (),
    backup: bool = True,
) -> Path | None:
    """Merge `entries` into the client's config and delete `remove` entries."""
    if client.spec.fmt == "toml":
        return _write_toml_servers(client, entries, remove, backup)

    data = read_json(client.path)
    servers = data.get(client.spec.servers_key)
    if not isinstance(servers, dict):
        servers = {}
    for name in remove:
        servers.pop(name, None)
    servers.update(entries)
    data[client.spec.servers_key] = servers
    return atomic_write(client.path, json.dumps(data, indent=2) + "\n", backup=backup)


# --- TOML (Codex) ------------------------------------------------------------
#
# Codex keeps unrelated settings in the same file and stdlib has no TOML writer,
# so entries are spliced at the table level and the rest of the file is left byte
# for byte as the user wrote it.


def _toml_table_header(servers_key: str, name: str) -> str:
    quoted = name if re.fullmatch(r"[A-Za-z0-9_-]+", name) else json.dumps(name)
    return f"[{servers_key}.{quoted}]"


def _toml_value(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k} = {_toml_value(v)}" for k, v in value.items()) + " }"
    raise TypeError(f"cannot serialize {type(value)!r} to TOML")


def _toml_block(servers_key: str, name: str, entry: dict[str, Any]) -> str:
    lines = [_toml_table_header(servers_key, name)]
    for key, value in entry.items():
        if key == "type":
            continue  # Codex infers stdio; an explicit type key is rejected
        lines.append(f"{key} = {_toml_value(value)}")
    return "\n".join(lines) + "\n"


def _toml_sections(text: str, servers_key: str) -> dict[str, tuple[int, int]]:
    """Locate `[<servers_key>.<name>]` blocks as (start, end) character spans."""
    header = re.compile(
        r"^\[\s*" + re.escape(servers_key) + r"\s*\.\s*(?P<name>\"[^\"]+\"|[A-Za-z0-9_-]+)\s*\]",
        re.MULTILINE,
    )
    any_header = re.compile(r"^\[", re.MULTILINE)
    spans: dict[str, tuple[int, int]] = {}
    for match in header.finditer(text):
        name = match.group("name").strip('"')
        following = any_header.search(text, match.end())
        spans[name] = (match.start(), following.start() if following else len(text))
    return spans


def _toml_servers(client: Client) -> dict[str, Any]:
    if not client.path.exists():
        return {}
    text = client.path.read_text(encoding="utf-8")
    try:
        import tomllib

        data = tomllib.loads(text)
        servers = data.get(client.spec.servers_key, {})
        if isinstance(servers, dict):
            return servers
        return {}
    except ModuleNotFoundError:  # Python 3.10: report names only
        return {name: {} for name in _toml_sections(text, client.spec.servers_key)}
    except Exception as exc:  # malformed TOML — surface it rather than overwrite
        raise ValueError(f"{client.path} is not valid TOML: {exc}") from exc


def _write_toml_servers(
    client: Client,
    entries: dict[str, Any],
    remove: tuple[str, ...],
    backup: bool,
) -> Path | None:
    text = client.path.read_text(encoding="utf-8") if client.path.exists() else ""
    key = client.spec.servers_key

    for name in remove:
        spans = _toml_sections(text, key)
        if name in spans:
            start, end = spans[name]
            text = text[:start] + text[end:]

    for name, entry in entries.items():
        block = _toml_block(key, name, entry)
        spans = _toml_sections(text, key)
        if name in spans:
            start, end = spans[name]
            text = text[:start] + block + text[end:]
        else:
            if text and not text.endswith("\n\n"):
                text = text.rstrip("\n") + "\n\n" if text.strip() else ""
            text += block

    return atomic_write(client.path, text, backup=backup)


def install_providers(
    client: Client,
    providers: list[Provider],
    prefix: bool = True,
    backup: bool = True,
) -> tuple[dict[str, Any], Path | None]:
    """Write one server entry per provider. Returns the entries and backup path."""
    entries = {
        server_name(provider, prefix): build_entry(provider, client.spec)
        for provider in providers
    }
    written = write_servers(client, entries, backup=backup)
    return entries, written


def remove_providers(
    client: Client,
    provider_ids: list[str],
    backup: bool = True,
) -> tuple[list[str], Path | None]:
    """Remove Agent Reach-managed entries only. Hand-written servers are left alone."""
    existing = read_servers(client)
    targets = []
    for pid in provider_ids:
        managed = f"{SERVER_PREFIX}-{pid}"
        if managed in existing:
            targets.append(managed)
    if not targets:
        return [], None
    written = write_servers(client, {}, remove=tuple(targets), backup=backup)
    return targets, written
