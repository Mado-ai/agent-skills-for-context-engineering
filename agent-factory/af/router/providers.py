"""Model provider port and a deterministic mock adapter.

The mock is not a toy: it is what makes the benchmark suite honest. Measuring
control-plane throughput must not depend on a paid API, and quality gates must
be reproducible. It produces byte-identical output for identical input (seeded
from a hash of the request), simulates configurable latency and failure rates,
and reports plausible token counts — so the whole runtime can be exercised at
1,000-agent scale without a single external call.

A real provider is added by implementing ``ModelProvider`` and registering a
``ModelSpec``. Nothing above this layer changes.
"""

from __future__ import annotations

import hashlib
import random
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from af.errors import ProviderError, ProviderTimeout

__all__ = ["ModelSpec", "ModelRequest", "ModelResponse", "ModelProvider",
           "MockProvider", "PRICE_TABLE"]


@dataclass(frozen=True, slots=True)
class ModelSpec:
    """What a model can do and what it costs.

    Prices are micros per 1,000 tokens. Declared here rather than in contracts
    so a price change is one edit, not a fleet-wide contract migration.
    """

    model_id: str
    provider: str
    tier: str                          # cheap|standard|frontier
    reasoning: str                     # basic|intermediate|advanced
    max_context_tokens: int
    typical_latency_ms: int
    input_micros_per_ktok: int
    output_micros_per_ktok: int
    supports_tools: bool = True
    supports_structured_output: bool = True
    privacy_class: str = "standard"    # standard|sensitive|restricted
    reliability: float = 0.99          # observed success rate, 0..1

    @property
    def reasoning_rank(self) -> int:
        return {"basic": 0, "intermediate": 1, "advanced": 2}[self.reasoning]

    @property
    def tier_rank(self) -> int:
        return {"cheap": 0, "standard": 1, "frontier": 2}[self.tier]

    @property
    def privacy_rank(self) -> int:
        return {"standard": 0, "sensitive": 1, "restricted": 2}[self.privacy_class]

    def cost_micros(self, tokens_in: int, tokens_out: int) -> int:
        return round(tokens_in * self.input_micros_per_ktok / 1000
                     + tokens_out * self.output_micros_per_ktok / 1000)


@dataclass(slots=True)
class ModelRequest:
    prompt: str
    system: str = ""
    max_tokens: int = 1024
    temperature: float = 0.0
    tools: tuple[str, ...] = ()
    output_schema: dict[str, Any] = field(default_factory=dict)
    timeout_seconds: float = 30.0
    #: Used to seed the mock so results are reproducible across runs.
    seed: str = ""

    def fingerprint(self) -> str:
        return hashlib.sha256(
            f"{self.system}|{self.prompt}|{self.max_tokens}|{self.seed}".encode()).hexdigest()


@dataclass(slots=True)
class ModelResponse:
    text: str
    model_id: str
    provider: str
    tokens_in: int
    tokens_out: int
    latency_ms: float
    cost_micros: int
    structured: dict[str, Any] | None = None
    finish_reason: str = "stop"


class ModelProvider(Protocol):
    name: str

    def models(self) -> list[ModelSpec]:
        """Models this provider offers."""

    def complete(self, spec: ModelSpec, request: ModelRequest) -> ModelResponse:
        """Execute. Raise ProviderError/ProviderTimeout on failure."""


#: Reference price table for the mock fleet. Numbers are illustrative and chosen
#: to span a realistic cheap/standard/frontier spread, NOT quoted from any real
#: provider's pricing — using them for cost forecasting would be wrong.
PRICE_TABLE: list[ModelSpec] = [
    ModelSpec("mock-small", "mockprov", "cheap", "basic", 128_000, 300, 150, 600,
              reliability=0.995),
    ModelSpec("mock-standard", "mockprov", "standard", "intermediate", 200_000, 900,
              900, 4_500, reliability=0.99),
    ModelSpec("mock-frontier", "mockprov", "frontier", "advanced", 400_000, 2_400,
              5_000, 25_000, reliability=0.985),
    # A second provider so failover and provider-preference routing are testable.
    ModelSpec("alt-standard", "altprov", "standard", "intermediate", 128_000, 700,
              800, 4_000, reliability=0.97),
    # Privacy-restricted option, e.g. a self-hosted deployment.
    ModelSpec("local-secure", "localprov", "standard", "intermediate", 64_000, 1_500,
              0, 0, privacy_class="restricted", reliability=0.96),
]


class MockProvider:
    """Deterministic provider for tests and benchmarks. Never makes a network call."""

    def __init__(self, name: str = "mockprov", *, failure_rate: float = 0.0,
                 timeout_rate: float = 0.0, latency_scale: float = 0.0,
                 specs: list[ModelSpec] | None = None) -> None:
        self.name = name
        #: Injected failure rates drive the failure-testing suite. Zero by
        #: default so benchmark numbers are not polluted by synthetic errors.
        self.failure_rate = failure_rate
        self.timeout_rate = timeout_rate
        #: Fraction of the model's declared latency to actually sleep. 0 means
        #: "no sleeping" — the right default for control-plane benchmarking,
        #: where sleeping would measure time.sleep rather than the runtime.
        self.latency_scale = latency_scale
        self._specs = specs or [s for s in PRICE_TABLE if s.provider == name]

    def models(self) -> list[ModelSpec]:
        return list(self._specs)

    def complete(self, spec: ModelSpec, request: ModelRequest) -> ModelResponse:
        started = time.perf_counter()
        # Seeded from the request so identical inputs give identical outputs and
        # identical failures — reproducible tests, not flaky ones.
        rng = random.Random(request.fingerprint())

        if rng.random() < self.timeout_rate:
            raise ProviderTimeout(f"{spec.model_id} timed out", model=spec.model_id,
                                  provider=self.name)
        if rng.random() < self.failure_rate:
            raise ProviderError(f"{spec.model_id} returned an error", model=spec.model_id,
                                provider=self.name)

        if self.latency_scale > 0:
            time.sleep(spec.typical_latency_ms / 1000.0 * self.latency_scale)

        # ~4 chars/token, the usual English rule of thumb. Good enough for cost
        # modelling; a real adapter reports the provider's actual counts.
        tokens_in = max(1, (len(request.system) + len(request.prompt)) // 4)
        tokens_out = max(1, min(request.max_tokens, 40 + rng.randint(0, 160)))

        structured = None
        if request.output_schema:
            structured = _synthesise(request.output_schema, rng)
        text = f"[{spec.model_id}] response to: {request.prompt[:80]}"

        return ModelResponse(
            text=text, model_id=spec.model_id, provider=self.name,
            tokens_in=tokens_in, tokens_out=tokens_out,
            latency_ms=(time.perf_counter() - started) * 1000.0,
            cost_micros=spec.cost_micros(tokens_in, tokens_out),
            structured=structured)


def _synthesise(schema: dict[str, Any], rng: random.Random) -> Any:
    """Build a minimal instance satisfying a schema.

    Lets the mock produce output that passes the schema quality gate, so gate
    behaviour can be exercised without a real model. Only the keywords the
    bundled validator understands are honoured.
    """
    kind = schema.get("type", "object")
    if kind == "object":
        out: dict[str, Any] = {}
        props = schema.get("properties", {})
        for key in schema.get("required", list(props)[:3]):
            out[key] = _synthesise(props.get(key, {"type": "string"}), rng)
        return out
    if kind == "array":
        item = schema.get("items", {"type": "string"})
        return [_synthesise(item, rng) for _ in range(max(1, schema.get("minItems", 1)))]
    if kind == "integer":
        return int(schema.get("minimum", 1))
    if kind == "number":
        return float(schema.get("minimum", 1.0))
    if kind == "boolean":
        return True
    if "enum" in schema:
        return schema["enum"][0]
    return "generated-value"
