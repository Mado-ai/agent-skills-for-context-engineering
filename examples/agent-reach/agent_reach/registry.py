"""Provider catalog: the curated answer to 'which internet access should I install?'.

The catalog ships as data (`data/registry.json`) rather than code so that access
methods can turn over without a release: a user overlay at
`~/.agent-reach/registry.json` is deep-merged over the bundled copy, and
`agent-reach update` refreshes that overlay from a URL or file.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BUNDLED_REGISTRY = Path(__file__).parent / "data" / "registry.json"

CAPABILITIES = (
    "search",
    "fetch",
    "extract",
    "crawl",
    "docs",
    "browse",
    "deep_research",
)


class RegistryError(RuntimeError):
    """Raised when a registry file is missing, malformed, or the wrong schema."""


def home_dir() -> Path:
    """Agent Reach's own state directory. Overridable for tests and sandboxes."""
    override = os.environ.get("AGENT_REACH_HOME")
    return Path(override).expanduser() if override else Path.home() / ".agent-reach"


def overlay_path() -> Path:
    return home_dir() / "registry.json"


@dataclass(frozen=True)
class KeySpec:
    env: str
    required: bool = True
    signup: str = ""
    free_tier: str = ""


@dataclass(frozen=True)
class Command:
    exec: str
    args: list[str] = field(default_factory=list)

    def as_list(self) -> list[str]:
        return [self.exec, *self.args]

    def display(self) -> str:
        return " ".join(self.as_list())


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    summary: str
    capabilities: tuple[str, ...]
    runtime: str
    command: Command
    fallback_commands: tuple[Command, ...] = ()
    keys: tuple[KeySpec, ...] = ()
    stability: int = 50
    cost: str = "unknown"
    expected_tools: tuple[str, ...] = ()
    probe: dict[str, Any] | None = None
    docs: str = ""
    transport: str = "stdio"

    @property
    def required_keys(self) -> tuple[KeySpec, ...]:
        return tuple(k for k in self.keys if k.required)

    @property
    def optional_keys(self) -> tuple[KeySpec, ...]:
        return tuple(k for k in self.keys if not k.required)

    def covers(self, capability: str) -> bool:
        return capability in self.capabilities


@dataclass(frozen=True)
class Registry:
    revision: str
    providers: tuple[Provider, ...]
    profiles: dict[str, tuple[str, ...]]
    default_profile: str
    sources: tuple[str, ...] = ()

    def get(self, provider_id: str) -> Provider:
        for provider in self.providers:
            if provider.id == provider_id:
                return provider
        known = ", ".join(p.id for p in self.providers)
        raise RegistryError(f"unknown provider '{provider_id}' (known: {known})")

    def by_capability(self, capability: str) -> tuple[Provider, ...]:
        matches = [p for p in self.providers if p.covers(capability)]
        return tuple(sorted(matches, key=lambda p: -p.stability))

    def profile(self, name: str) -> tuple[str, ...]:
        if name not in self.profiles:
            known = ", ".join(sorted(self.profiles))
            raise RegistryError(f"unknown profile '{name}' (known: {known})")
        return self.profiles[name]


def _command(raw: dict[str, Any]) -> Command:
    return Command(exec=raw["exec"], args=list(raw.get("args", [])))


def _provider(raw: dict[str, Any]) -> Provider:
    missing = {"id", "name", "capabilities", "command"} - raw.keys()
    if missing:
        raise RegistryError(f"provider entry missing fields: {sorted(missing)}")
    unknown_caps = set(raw["capabilities"]) - set(CAPABILITIES)
    if unknown_caps:
        raise RegistryError(
            f"provider '{raw['id']}' declares unknown capabilities: {sorted(unknown_caps)}"
        )
    return Provider(
        id=raw["id"],
        name=raw["name"],
        summary=raw.get("summary", ""),
        capabilities=tuple(raw["capabilities"]),
        runtime=raw.get("runtime", "node"),
        command=_command(raw["command"]),
        fallback_commands=tuple(_command(c) for c in raw.get("fallback_commands", [])),
        keys=tuple(
            KeySpec(
                env=k["env"],
                required=k.get("required", True),
                signup=k.get("signup", ""),
                free_tier=k.get("free_tier", ""),
            )
            for k in raw.get("keys", [])
        ),
        stability=int(raw.get("stability", 50)),
        cost=raw.get("cost", "unknown"),
        expected_tools=tuple(raw.get("expected_tools", [])),
        probe=raw.get("probe"),
        docs=raw.get("docs", ""),
        transport=raw.get("transport", "stdio"),
    )


def merge_documents(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Merge an overlay registry over a base one.

    Providers merge by `id`: an overlay entry patches the bundled entry field by
    field (so a user can bump one command without restating the whole record) and
    a new `id` appends. An overlay entry with `"removed": true` drops a provider
    that has gone stale.
    """
    merged = dict(base)
    for key, value in overlay.items():
        if key == "providers":
            continue
        if key == "profiles" and isinstance(value, dict):
            merged["profiles"] = {**base.get("profiles", {}), **value}
        else:
            merged[key] = value

    by_id: dict[str, dict[str, Any]] = {p["id"]: dict(p) for p in base.get("providers", [])}
    order = [p["id"] for p in base.get("providers", [])]
    for entry in overlay.get("providers", []):
        if "id" not in entry:
            raise RegistryError("overlay provider entry has no 'id'")
        pid = entry["id"]
        if entry.get("removed"):
            by_id.pop(pid, None)
            order = [i for i in order if i != pid]
            continue
        if pid in by_id:
            by_id[pid].update({k: v for k, v in entry.items() if k != "removed"})
        else:
            by_id[pid] = dict(entry)
            order.append(pid)
    merged["providers"] = [by_id[i] for i in order if i in by_id]
    return merged


def load_document(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RegistryError(f"registry not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RegistryError(f"registry is not valid JSON ({path}): {exc}") from exc
    if not isinstance(raw, dict):
        raise RegistryError(f"registry must be a JSON object: {path}")
    version = raw.get("schema_version", 1)
    if version != 1:
        raise RegistryError(
            f"registry schema_version {version} is newer than this Agent Reach "
            "understands — upgrade the package"
        )
    return raw


def load_registry(
    overlay: Path | None = None,
    use_overlay: bool = True,
    replace: Path | None = None,
) -> Registry:
    """Load the catalog.

    By default this is the bundled catalog with the user overlay merged over it.
    `replace` instead treats one file as the entire catalog — for pinning a
    reviewed catalog in CI, where a silent merge with whatever shipped in the
    package would defeat the point.
    """
    if replace is not None:
        document = load_document(replace)
        sources = [str(replace)]
    else:
        document = load_document(BUNDLED_REGISTRY)
        sources = [str(BUNDLED_REGISTRY)]

        candidate = overlay if overlay is not None else (overlay_path() if use_overlay else None)
        if candidate is not None and candidate.exists():
            document = merge_documents(document, load_document(candidate))
            sources.append(str(candidate))

    providers = tuple(_provider(p) for p in document.get("providers", []))
    seen: set[str] = set()
    for provider in providers:
        if provider.id in seen:
            raise RegistryError(f"duplicate provider id: {provider.id}")
        seen.add(provider.id)

    profiles = {k: tuple(v) for k, v in document.get("profiles", {}).items()}
    default_profile = document.get("default_profile", "standard")
    if profiles and default_profile not in profiles:
        raise RegistryError(f"default_profile '{default_profile}' is not a defined profile")

    return Registry(
        revision=document.get("revision", "unknown"),
        providers=providers,
        profiles=profiles,
        default_profile=default_profile,
        sources=tuple(sources),
    )
