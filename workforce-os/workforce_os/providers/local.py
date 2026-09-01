"""Deterministic local provider.

This is what makes offline development real: no network, no credentials, and identical
output for identical input, so tests are reproducible. It is explicit about being a
local echo — it never pretends to be a hosted model.
"""

from __future__ import annotations

import hashlib
import time

from .base import Completion, Provider


class LocalProvider(Provider):
    name = "local"

    # Nominal pricing so cost telemetry exercises the same code path as a real provider.
    COST_PER_1K_INPUT = 0.0
    COST_PER_1K_OUTPUT = 0.0

    def complete(self, *, system_prompt: str, messages: list[dict], model: str = "local-echo",
                 max_tokens: int = 1024) -> Completion:
        started = time.perf_counter()
        last_user = next((m.get("content", "") for m in reversed(messages)
                          if m.get("role") == "user"), "")
        digest = hashlib.sha256((system_prompt + last_user).encode("utf-8")).hexdigest()[:12]
        text = (f"[local-echo:{digest}] Acknowledged {len(messages)} message(s). "
                f"Deterministic offline response; no external model was called.")
        # Word count stands in for tokenisation — enough to exercise budget accounting.
        input_tokens = len((system_prompt + " " + last_user).split())
        output_tokens = len(text.split())
        return Completion(
            text=text, model=model, input_tokens=input_tokens, output_tokens=output_tokens,
            cost_usd=0.0, latency_ms=(time.perf_counter() - started) * 1000,
            confirmed=True, metadata={"offline": True, "digest": digest},
        )

    def describe(self) -> dict:
        return {"provider": self.name, "offline": True, "model": "local-echo"}


def get_provider(config) -> Provider:
    """Resolve the configured provider. Without a key, the local adapter is used."""
    if config.provider == "local" or not config.provider_api_key:
        return LocalProvider()
    raise ValueError(
        f"Provider {config.provider!r} is not available in v0.4; only the local adapter ships. "
        "Add an adapter under workforce_os/providers/ and register it here.")
