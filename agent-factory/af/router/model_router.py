"""Model Router — provider-independent model selection.

A contract states *requirements* (tier, reasoning, latency, context, privacy);
the router resolves them to a concrete model at call time. That indirection is
the point: a provider outage, a price change, or a new model is a router
concern, not a fleet-wide contract migration.

Selection is: filter to models that satisfy every hard requirement, score the
survivors, take the best, and fail over to the next on error. Hard requirements
are never traded off against score — a privacy-restricted contract will fail
rather than silently route to a cheaper standard-privacy model.

Per-provider circuit breakers stop a dead provider from absorbing every retry in
the system. The breaker opens after consecutive failures and half-opens after a
cooldown, so recovery needs no operator action.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from af.clock import Clock, SystemClock
from af.errors import ProviderError
from af.router.providers import (ModelProvider, ModelRequest, ModelResponse,
                                 ModelSpec)
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["ModelRouter", "RoutingDecision", "CircuitBreaker"]


@dataclass(slots=True)
class RoutingDecision:
    model: ModelSpec
    score: float
    reason: str
    alternatives: list[str] = field(default_factory=list)
    rejected: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"model_id": self.model.model_id, "provider": self.model.provider,
                "score": round(self.score, 4), "reason": self.reason,
                "alternatives": self.alternatives, "rejected": self.rejected}


class CircuitBreaker:
    """Per-provider breaker: CLOSED → OPEN after N consecutive failures,
    HALF_OPEN after a cooldown, CLOSED again on the next success."""

    __slots__ = ("threshold", "cooldown", "_failures", "_opened_at", "clock")

    def __init__(self, clock: Clock, *, threshold: int = 5, cooldown: float = 30.0) -> None:
        self.clock = clock
        self.threshold = threshold
        self.cooldown = cooldown
        self._failures: dict[str, int] = {}
        self._opened_at: dict[str, float] = {}

    def is_open(self, provider: str) -> bool:
        opened = self._opened_at.get(provider)
        if opened is None:
            return False
        if self.clock.now() - opened >= self.cooldown:
            # Half-open: allow one probe through. If it fails, record_failure
            # re-opens immediately because the failure count is still at
            # threshold.
            del self._opened_at[provider]
            return False
        return True

    def record_success(self, provider: str) -> None:
        self._failures.pop(provider, None)
        self._opened_at.pop(provider, None)

    def record_failure(self, provider: str) -> None:
        n = self._failures.get(provider, 0) + 1
        self._failures[provider] = n
        if n >= self.threshold:
            self._opened_at[provider] = self.clock.now()

    def state(self, provider: str) -> str:
        if self.is_open(provider):
            return "OPEN"
        return "HALF_OPEN" if self._failures.get(provider, 0) >= self.threshold else "CLOSED"


class ModelRouter:
    def __init__(self, telemetry: Telemetry, clock: Clock | None = None,
                 *, breaker_threshold: int = 5, breaker_cooldown: float = 30.0) -> None:
        self.telemetry = telemetry
        self.clock = clock or SystemClock()
        self._providers: dict[str, ModelProvider] = {}
        self._specs: list[ModelSpec] = []
        self.breaker = CircuitBreaker(self.clock, threshold=breaker_threshold,
                                      cooldown=breaker_cooldown)

    def register(self, provider: ModelProvider) -> None:
        self._providers[provider.name] = provider
        self._specs.extend(provider.models())

    # -- selection -----------------------------------------------------------
    def select(self, policy, *, estimated_tokens: int = 0,
               complexity: str | None = None) -> RoutingDecision:
        """Pick a model for a ModelPolicy. Raises ProviderError if none qualify."""
        rejected: dict[str, str] = {}
        candidates: list[tuple[float, ModelSpec, str]] = []

        # Complexity can raise the required reasoning above the contract floor,
        # but never lower it — a contract's stated minimum is a floor, not a hint.
        required_reasoning = policy.min_reasoning
        if complexity == "high" and _rank(required_reasoning) < 2:
            required_reasoning = "advanced"
        elif complexity == "low" and _rank(policy.min_reasoning) == 0:
            required_reasoning = "basic"

        for spec in self._specs:
            why = self._disqualify(spec, policy, required_reasoning, estimated_tokens)
            if why:
                rejected[spec.model_id] = why
                continue
            score, reason = self._score(spec, policy, complexity)
            candidates.append((score, spec, reason))

        if not candidates:
            raise ProviderError(
                "no model satisfies the contract's model policy",
                required={"tier": policy.tier, "reasoning": required_reasoning,
                          "max_latency_ms": policy.max_latency_ms,
                          "privacy": policy.privacy_class,
                          "context_tokens": estimated_tokens},
                rejected=rejected)

        candidates.sort(key=lambda c: -c[0])
        best_score, best, reason = candidates[0]
        return RoutingDecision(
            model=best, score=best_score, reason=reason,
            alternatives=[s.model_id for _, s, _ in candidates[1:4]], rejected=rejected)

    def _disqualify(self, spec: ModelSpec, policy, required_reasoning: str,
                    estimated_tokens: int) -> str | None:
        """Hard requirements. Any one of these disqualifies outright."""
        if spec.provider in policy.forbidden_providers:
            return "provider forbidden by contract"
        if policy.preferred_providers and spec.provider not in policy.preferred_providers:
            return "provider not in the contract's preferred list"
        if spec.reasoning_rank < _rank(required_reasoning):
            return f"reasoning '{spec.reasoning}' below required '{required_reasoning}'"
        # Privacy is a floor, not a preference: a 'restricted' contract must not
        # be served by a 'standard' model, though the reverse is fine.
        if spec.privacy_rank < _privacy_rank(policy.privacy_class):
            return f"privacy class '{spec.privacy_class}' below required '{policy.privacy_class}'"
        if spec.max_context_tokens < max(estimated_tokens, policy.max_context_tokens):
            return (f"context window {spec.max_context_tokens} < required "
                    f"{max(estimated_tokens, policy.max_context_tokens)}")
        if spec.typical_latency_ms > policy.max_latency_ms:
            return f"typical latency {spec.typical_latency_ms}ms > budget {policy.max_latency_ms}ms"
        if policy.requires_tool_use and not spec.supports_tools:
            return "does not support tool use"
        if policy.requires_structured_output and not spec.supports_structured_output:
            return "does not support structured output"
        if self.breaker.is_open(spec.provider):
            return "provider circuit breaker is open"
        return None

    def _score(self, spec: ModelSpec, policy, complexity: str | None) -> tuple[float, str]:
        """Rank qualifying models. All hard constraints are already satisfied,
        so this trades off cost, latency, reliability and tier fit."""
        # Cost: cheaper is better, normalised against the most expensive option.
        max_cost = max((s.output_micros_per_ktok for s in self._specs), default=1) or 1
        cost_score = 1.0 - (spec.output_micros_per_ktok / max_cost)
        latency_score = 1.0 - min(1.0, spec.typical_latency_ms / max(1, policy.max_latency_ms))
        reliability_score = spec.reliability
        # Prefer the tier the contract asked for; over-provisioning wastes money,
        # under-provisioning risks quality, so distance is penalised either way.
        tier_score = 1.0 - abs(spec.tier_rank - _tier_rank(policy.tier)) * 0.4

        weights = (0.30, 0.20, 0.25, 0.25)   # cost, latency, reliability, tier fit
        if complexity == "high":
            # For hard work, capability and reliability matter more than price.
            weights = (0.10, 0.15, 0.35, 0.40)
        elif complexity == "low":
            weights = (0.50, 0.25, 0.15, 0.10)

        score = (cost_score * weights[0] + latency_score * weights[1]
                 + reliability_score * weights[2] + tier_score * weights[3])
        reason = (f"cost={cost_score:.2f} latency={latency_score:.2f} "
                  f"reliability={reliability_score:.2f} tier_fit={tier_score:.2f}")
        return score, reason

    # -- execution -------------------------------------------------------------
    def complete(self, policy, request: ModelRequest, *, project_id: str | None = None,
                 task_id: str | None = None, agent_id: str | None = None,
                 complexity: str | None = None, trace_id: str | None = None,
                 max_failover: int = 2) -> tuple[ModelResponse, RoutingDecision]:
        """Route and execute, failing over to alternatives on provider error."""
        decision = self.select(policy, estimated_tokens=len(request.prompt) // 4,
                               complexity=complexity)
        self.telemetry.emit(Event(
            type=EventType.MODEL_ROUTED, trace_id=trace_id, project_id=project_id, task_id=task_id,
            agent_id=agent_id, model=decision.model.model_id,
            provider=decision.model.provider, payload=decision.to_dict()))

        tried: list[str] = []
        attempt_specs = [decision.model] + [
            s for s in self._specs if s.model_id in decision.alternatives][:max_failover]

        last_error: Exception | None = None
        for spec in attempt_specs:
            provider = self._providers.get(spec.provider)
            if provider is None or self.breaker.is_open(spec.provider):
                continue
            tried.append(spec.model_id)
            try:
                response = provider.complete(spec, request)
            except Exception as exc:
                last_error = exc
                self.breaker.record_failure(spec.provider)
                self.telemetry.emit(Event(
                    type=EventType.MODEL_CALLED, trace_id=trace_id, project_id=project_id,
                    task_id=task_id, agent_id=agent_id, model=spec.model_id,
                    provider=spec.provider, status="error", error_code=getattr(exc, "code", "provider_error"),
                    payload={"error": str(exc)[:300],
                             "breaker": self.breaker.state(spec.provider)}))
                continue
            self.breaker.record_success(spec.provider)
            self.telemetry.emit(Event(
                type=EventType.MODEL_CALLED, trace_id=trace_id, project_id=project_id,
                task_id=task_id, agent_id=agent_id, model=spec.model_id,
                provider=spec.provider, status="ok", duration_ms=response.latency_ms,
                cost_micros=response.cost_micros, tokens_in=response.tokens_in,
                tokens_out=response.tokens_out,
                payload={"failover_from": tried[:-1]}))
            return response, decision

        raise ProviderError(
            f"all candidate models failed: {tried}",
            tried=tried, last_error=str(last_error) if last_error else None)

    def fleet(self) -> list[dict[str, Any]]:
        return [{"model_id": s.model_id, "provider": s.provider, "tier": s.tier,
                 "reasoning": s.reasoning, "breaker": self.breaker.state(s.provider)}
                for s in self._specs]


def _rank(reasoning: str) -> int:
    return {"basic": 0, "intermediate": 1, "advanced": 2}.get(reasoning, 0)


def _tier_rank(tier: str) -> int:
    return {"cheap": 0, "standard": 1, "frontier": 2}.get(tier, 1)


def _privacy_rank(privacy: str) -> int:
    return {"standard": 0, "sensitive": 1, "restricted": 2}.get(privacy, 0)
