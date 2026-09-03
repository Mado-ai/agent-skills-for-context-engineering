"""Selection: turn 'I want internet access' into a concrete, installable set.

The rule is coverage first, then evidence. For each requested capability we take
the highest-stability provider that can actually start on this machine, and we
prefer a provider that closes several requested capabilities at once over a pile
of single-purpose servers — every extra server is tool definitions spent from the
agent's attention budget.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .registry import Provider, Registry
from .runtime import Readiness, readiness_map


@dataclass(frozen=True)
class Rejection:
    provider: Provider
    reason: str


@dataclass(frozen=True)
class Gap:
    capability: str
    best_blocked: Provider | None
    reason: str

    @property
    def remedy(self) -> str:
        if self.best_blocked is None:
            return "no provider in the catalog offers this capability"
        keys = ", ".join(k.env for k in self.best_blocked.required_keys)
        if keys:
            signup = next((k.signup for k in self.best_blocked.required_keys if k.signup), "")
            tail = f" (sign up: {signup})" if signup else ""
            return f"set {keys} to use {self.best_blocked.name}{tail}"
        return f"install the runtime for {self.best_blocked.name}"


@dataclass(frozen=True)
class Plan:
    capabilities: tuple[str, ...]
    selected: tuple[Provider, ...]
    coverage: dict[str, str]
    gaps: tuple[Gap, ...] = ()
    rejected: tuple[Rejection, ...] = ()
    profile: str = ""
    forced: tuple[str, ...] = field(default_factory=tuple)

    @property
    def complete(self) -> bool:
        return not self.gaps

    @property
    def provider_ids(self) -> tuple[str, ...]:
        return tuple(p.id for p in self.selected)


# Stability is banded to a decade before consolidation is considered. Within a
# band, closing more of the request wins (fewer servers, fewer tool definitions);
# across bands, quality wins — a second server is cheaper than a weak search.
STABILITY_BAND = 10


def _score(
    provider: Provider,
    remaining: set[str],
    ready: bool,
    prefer_ready: bool = True,
) -> tuple[int, int, int, int, str]:
    """Sort key: startable first, then stability band, then coverage, then exact score.

    Under `--allow-blocked` the user has said they will supply the missing key,
    so readiness drops to a tie-break and quality leads instead.
    """
    covered = len(remaining & set(provider.capabilities))
    band = provider.stability // STABILITY_BAND
    startable = 1 if ready else 0
    if prefer_ready:
        return (startable, band, covered, provider.stability, provider.id)
    return (band, covered, startable, provider.stability, provider.id)


def build_plan(
    registry: Registry,
    capabilities: tuple[str, ...] | None = None,
    profile: str | None = None,
    include: tuple[str, ...] = (),
    exclude: tuple[str, ...] = (),
    env: dict[str, str] | None = None,
    allow_blocked: bool = False,
) -> Plan:
    """Choose providers covering `capabilities` (or a named profile's list).

    `include` forces providers in regardless of ranking; `exclude` removes them
    from consideration. With `allow_blocked`, providers whose key or runtime is
    missing are still selected — useful for writing a config now and supplying
    the key later.
    """
    profile_name = profile or (registry.default_profile if capabilities is None else "")
    wanted = tuple(capabilities) if capabilities is not None else registry.profile(profile_name)

    ready = readiness_map(registry, env)
    excluded = set(exclude)

    selected: list[Provider] = []
    rejected: list[Rejection] = []
    gaps: list[Gap] = []
    coverage: dict[str, str] = {}

    for pid in include:
        provider = registry.get(pid)
        if provider.id in excluded:
            raise ValueError(f"provider '{pid}' is both included and excluded")
        if provider.id not in {s.id for s in selected}:
            selected.append(provider)

    remaining = {c for c in wanted if not any(p.covers(c) for p in selected)}

    for capability in wanted:
        if capability not in remaining:
            continue

        chosen_ids = {s.id for s in selected}
        candidates = [
            p
            for p in registry.by_capability(capability)
            if p.id not in excluded and p.id not in chosen_ids
        ]
        usable = [p for p in candidates if allow_blocked or ready[p.id].ready]

        if not usable:
            blocked = candidates[0] if candidates else None
            gaps.append(
                Gap(
                    capability=capability,
                    best_blocked=blocked,
                    reason=ready[blocked.id].blocker if blocked else "no provider offers it",
                )
            )
            rejected.extend(
                Rejection(provider=p, reason=ready[p.id].blocker or "not selected")
                for p in candidates
            )
            remaining.discard(capability)
            continue

        # Blocked candidates are reported too: "tavily needs TAVILY_API_KEY" is
        # the most actionable line in the output when a weaker provider wins.
        rejected.extend(
            Rejection(provider=p, reason=ready[p.id].blocker)
            for p in candidates
            if p not in usable
        )

        best = max(
            usable,
            key=lambda p: _score(p, remaining, ready[p.id].ready, not allow_blocked),
        )
        selected.append(best)
        for cap in set(best.capabilities) & remaining:
            coverage[cap] = best.id
        remaining -= set(best.capabilities)
        rejected.extend(
            Rejection(provider=p, reason=_why_not(p, best, ready[p.id]))
            for p in usable
            if p.id != best.id
        )

    for provider in selected:
        for cap in wanted:
            if provider.covers(cap):
                coverage.setdefault(cap, provider.id)

    return Plan(
        capabilities=wanted,
        selected=tuple(selected),
        coverage=coverage,
        gaps=tuple(gaps),
        rejected=tuple(_dedupe(rejected, {p.id for p in selected})),
        profile=profile_name,
        forced=tuple(include),
    )


def _why_not(candidate: Provider, winner: Provider, readiness: Readiness) -> str:
    if not readiness.ready:
        return readiness.blocker
    if candidate.stability // STABILITY_BAND < winner.stability // STABILITY_BAND:
        return f"lower stability than {winner.id} ({candidate.stability} vs {winner.stability})"
    return f"{winner.id} covers more of the request at comparable stability"


def _dedupe(rejections: list[Rejection], selected_ids: set[str]) -> list[Rejection]:
    seen: set[str] = set()
    out: list[Rejection] = []
    for rejection in rejections:
        if rejection.provider.id in selected_ids or rejection.provider.id in seen:
            continue
        seen.add(rejection.provider.id)
        out.append(rejection)
    return out
