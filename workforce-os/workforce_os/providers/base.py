"""Provider adapter interface.

Adapters are deliberately separated from orchestration: the runtime never learns which
vendor is behind a model, and swapping one changes nothing above this seam. Credentials
live in the adapter and come from the environment.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Completion:
    """A provider response.

    `confirmed` records whether the provider actually returned this content. The runtime
    never reports a completion as real unless the adapter says so.
    """

    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    confirmed: bool = False
    metadata: dict = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class Provider:
    """Base adapter. Subclasses implement `complete`."""

    name = "base"

    def complete(self, *, system_prompt: str, messages: list[dict], model: str,
                 max_tokens: int = 1024) -> Completion:
        raise NotImplementedError

    def describe(self) -> dict:
        return {"provider": self.name}
