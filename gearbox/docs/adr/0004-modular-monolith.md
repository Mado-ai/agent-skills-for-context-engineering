# ADR 0004 — Modular monolith, not microservices

- Status: accepted
- Date: 2026-08

## Context

The GearBox master prompt lists 16 services. The team is 3–5 engineers
(`docs/gearbox/01-assumptions-risks.md` A1).

## Decision

One deployable, `@gearbox/core`, containing one module per future service. Modules
expose a `ports/` directory and may not deep-import each other; the rule is enforced by
ESLint (`eslint.config.js`) and verified by a probe during scaffolding.

## Rationale

With this team size, distributed transactions, per-service CI and 16 dashboards cost
more than the coupling they remove. The prompt's own §22 says the same. Drawing the
module boundaries now means splitting later is a deployment change rather than a
refactor.

## Consequences

- A module becomes a service when its scaling or availability profile genuinely
  diverges. First realistic candidates: `asset` (CPU-heavy ingest), `location`
  (high write rate), `media` (LiveKit webhooks).
- The boundary rule must stay enforced. A lint rule nobody runs is not a boundary.
