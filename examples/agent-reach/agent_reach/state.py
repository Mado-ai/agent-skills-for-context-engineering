"""What Agent Reach has installed, so `doctor` and `remove` know where to look."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .registry import home_dir


def state_path() -> Path:
    return home_dir() / "state.json"


@dataclass
class Installation:
    client_id: str
    config_path: str
    provider_ids: list[str] = field(default_factory=list)
    server_names: list[str] = field(default_factory=list)
    registry_revision: str = ""
    installed_at: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "client_id": self.client_id,
            "config_path": self.config_path,
            "provider_ids": self.provider_ids,
            "server_names": self.server_names,
            "registry_revision": self.registry_revision,
            "installed_at": self.installed_at,
        }


def load_state() -> dict[str, Installation]:
    path = state_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}  # state is a convenience cache; never fail a command over it
    out: dict[str, Installation] = {}
    for entry in raw.get("installations", []):
        try:
            out[entry["client_id"]] = Installation(
                client_id=entry["client_id"],
                config_path=entry.get("config_path", ""),
                provider_ids=list(entry.get("provider_ids", [])),
                server_names=list(entry.get("server_names", [])),
                registry_revision=entry.get("registry_revision", ""),
                installed_at=entry.get("installed_at", ""),
            )
        except KeyError:
            continue
    return out


def save_state(installations: dict[str, Installation]) -> Path:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "schema_version": 1,
        "installations": [i.as_dict() for i in installations.values()],
    }
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return path


def record_install(
    client_id: str,
    config_path: str,
    provider_ids: list[str],
    server_names: list[str],
    registry_revision: str,
) -> None:
    state = load_state()
    existing = state.get(client_id)
    previous_providers = existing.provider_ids if existing else []
    merged_providers = list(dict.fromkeys(previous_providers + provider_ids))
    previous_servers = existing.server_names if existing else []
    merged_servers = list(dict.fromkeys(previous_servers + server_names))
    state[client_id] = Installation(
        client_id=client_id,
        config_path=config_path,
        provider_ids=merged_providers,
        server_names=merged_servers,
        registry_revision=registry_revision,
        installed_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    )
    save_state(state)


def record_removal(client_id: str, provider_ids: list[str]) -> None:
    state = load_state()
    entry = state.get(client_id)
    if entry is None:
        return
    entry.provider_ids = [p for p in entry.provider_ids if p not in provider_ids]
    entry.server_names = [
        s for s in entry.server_names if s.removeprefix("agent-reach-") not in provider_ids
    ]
    if not entry.provider_ids:
        state.pop(client_id, None)
    save_state(state)
