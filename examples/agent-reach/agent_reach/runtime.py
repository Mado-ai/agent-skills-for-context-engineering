"""Environment probing: what can actually run on this machine right now."""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

from .registry import Provider, Registry

# A provider's `runtime` maps to the launcher that must be on PATH for it to boot.
RUNTIME_LAUNCHERS = {
    "node": ("npx", "https://nodejs.org — install Node.js 18+ (ships npx)"),
    "python": ("uvx", "https://docs.astral.sh/uv — install uv (ships uvx)"),
}


@dataclass(frozen=True)
class ToolInfo:
    name: str
    path: str | None
    version: str = ""

    @property
    def present(self) -> bool:
        return self.path is not None


def which(name: str) -> str | None:
    return shutil.which(name)


def _version_of(name: str, path: str) -> str:
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    output = (result.stdout or result.stderr or "").strip().splitlines()
    return output[0].strip() if output else ""


def probe_tool(name: str, with_version: bool = True) -> ToolInfo:
    path = which(name)
    if path is None:
        return ToolInfo(name=name, path=None)
    return ToolInfo(name=name, path=path, version=_version_of(name, path) if with_version else "")


def probe_runtimes(with_version: bool = True) -> dict[str, ToolInfo]:
    """Probe every launcher the catalog can depend on, plus node/python themselves."""
    names = ["node", "npx", "uv", "uvx", "python3"]
    return {name: probe_tool(name, with_version=with_version) for name in names}


def launcher_for(provider: Provider) -> str:
    """The executable that must exist for this provider — its own, or its runtime's."""
    launcher, _ = RUNTIME_LAUNCHERS.get(provider.runtime, (provider.command.exec, ""))
    return provider.command.exec or launcher


def runtime_hint(provider: Provider) -> str:
    _, hint = RUNTIME_LAUNCHERS.get(provider.runtime, ("", ""))
    return hint


def resolve_command(provider: Provider):
    """Pick the first command whose executable exists on PATH.

    Returns `(command, resolved)`. When nothing resolves, the primary command is
    returned with `resolved=False` so callers can still show and record it.
    """
    for candidate in (provider.command, *provider.fallback_commands):
        if which(candidate.exec):
            return candidate, True
    return provider.command, False


def missing_keys(provider: Provider, env: dict[str, str] | None = None) -> list[str]:
    env = os.environ if env is None else env
    return [k.env for k in provider.required_keys if not env.get(k.env)]


def present_keys(provider: Provider, env: dict[str, str] | None = None) -> list[str]:
    env = os.environ if env is None else env
    return [k.env for k in provider.keys if env.get(k.env)]


@dataclass(frozen=True)
class Readiness:
    """Whether a provider can be installed and started here, and why not."""

    provider_id: str
    runtime_ok: bool
    missing_keys: tuple[str, ...]
    launcher: str

    @property
    def ready(self) -> bool:
        return self.runtime_ok and not self.missing_keys

    @property
    def blocker(self) -> str:
        if not self.runtime_ok:
            return f"{self.launcher} not on PATH"
        if self.missing_keys:
            return f"missing {', '.join(self.missing_keys)}"
        return ""


def readiness(provider: Provider, env: dict[str, str] | None = None) -> Readiness:
    command, resolved = resolve_command(provider)
    return Readiness(
        provider_id=provider.id,
        runtime_ok=resolved,
        missing_keys=tuple(missing_keys(provider, env)),
        launcher=command.exec,
    )


def readiness_map(registry: Registry, env: dict[str, str] | None = None) -> dict[str, Readiness]:
    return {p.id: readiness(p, env) for p in registry.providers}


def key_environment(provider: Provider, env: dict[str, str] | None = None) -> dict[str, str]:
    """Env passthrough entries for a client config: `{"KEY": "${KEY}"}`.

    Values are written as placeholders, never literals — a real key must not land
    in a config file that gets committed or synced.
    """
    env = os.environ if env is None else env
    out: dict[str, str] = {}
    for key in provider.keys:
        if key.required or env.get(key.env):
            out[key.env] = "${" + key.env + "}"
    return out
