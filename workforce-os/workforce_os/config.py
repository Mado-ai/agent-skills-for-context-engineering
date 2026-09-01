"""Configuration. Secrets come from the environment only — never from the repository."""

import os
from dataclasses import dataclass, field

# Environment variable names whose values must never be persisted or logged.
SECRET_ENV_KEYS = (
    "WORKFORCE_OS_OWNER_TOKEN",
    "WORKFORCE_OS_PROVIDER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
)


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc


@dataclass(frozen=True)
class Config:
    """Runtime configuration.

    `offline` is the default: with no provider key configured the runtime uses the
    deterministic local provider so the full system runs and tests with no network.
    """

    database_path: str = "workforce_os.db"
    host: str = "127.0.0.1"
    port: int = 8420
    owner_token: str = field(repr=False, default="")
    provider: str = "local"
    provider_api_key: str = field(repr=False, default="")
    approval_token_ttl_seconds: int = 900
    max_delegation_depth: int = 5
    rework_threshold: int = 2
    default_agent_budget_usd: float = 5.0
    default_task_budget_usd: float = 1.0

    @property
    def offline(self) -> bool:
        return self.provider == "local" or not self.provider_api_key

    def redacted(self) -> dict:
        """Config safe to expose over the API or write to logs."""
        return {
            "database_path": self.database_path,
            "host": self.host,
            "port": self.port,
            "provider": self.provider,
            "offline": self.offline,
            "owner_token_configured": bool(self.owner_token),
            "approval_token_ttl_seconds": self.approval_token_ttl_seconds,
            "max_delegation_depth": self.max_delegation_depth,
            "rework_threshold": self.rework_threshold,
        }


def load_config(**overrides) -> Config:
    """Build config from the environment, with explicit overrides for tests."""
    cfg = Config(
        database_path=os.environ.get("WORKFORCE_OS_DB", "workforce_os.db"),
        host=os.environ.get("WORKFORCE_OS_HOST", "127.0.0.1"),
        port=_int_env("WORKFORCE_OS_PORT", 8420),
        owner_token=os.environ.get("WORKFORCE_OS_OWNER_TOKEN", ""),
        provider=os.environ.get("WORKFORCE_OS_PROVIDER", "local"),
        provider_api_key=os.environ.get("WORKFORCE_OS_PROVIDER_API_KEY", ""),
        approval_token_ttl_seconds=_int_env("WORKFORCE_OS_APPROVAL_TTL", 900),
        max_delegation_depth=_int_env("WORKFORCE_OS_MAX_DEPTH", 5),
        rework_threshold=_int_env("WORKFORCE_OS_REWORK_THRESHOLD", 2),
        default_agent_budget_usd=_float_env("WORKFORCE_OS_AGENT_BUDGET_USD", 5.0),
        default_task_budget_usd=_float_env("WORKFORCE_OS_TASK_BUDGET_USD", 1.0),
    )
    if overrides:
        cfg = Config(**{**cfg.__dict__, **overrides})
    return cfg
