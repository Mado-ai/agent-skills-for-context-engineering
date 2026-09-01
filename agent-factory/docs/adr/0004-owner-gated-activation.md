# ADR-0004: Agent activation is owner-gated; the Chief proposes only

**Status:** Accepted · **Date:** 2026-09-01

## Context
The mandate's headline capability is that an agent can "governably create,
assign, manage, review and improve other agents", while the Chief "must NOT
possess unrestricted authority over owner-gated actions."

Those pull in opposite directions. The question is where the line falls.

## Decision
The Chief may do everything up to and including submitting a contract for
approval. It **cannot** perform the final promotion to ACTIVE. `agent.activate`
is `owner_gated`, which means no principal of kind `agent` satisfies it — at any
level, holding any grant, on any project.

The same treatment applies to `agent.merge`, `budget.raise`, `quality.override`,
`memory.authoritative.write`, and `memory.shared_org.write`.

## Rationale
Activation is the compounding step. A new active agent consumes budget, holds
tools, and can itself propose more agents. Every other action is bounded by
limits an existing contract already declares; this one *creates* new limits.

Three independent guards, so no single mistake is sufficient:
1. The capability is owner-gated (`PermissionEngine.check`, checked first).
2. The lifecycle machine admits no edge into ACTIVE except from APPROVAL.
3. Validation is re-run at activation and must be clean.

`tests/test_contracts.py::test_active_is_only_reachable_through_approval`
proves guard 2 over the whole transition graph, by deleting APPROVAL from the
graph and showing ACTIVE becomes unreachable from DRAFT.

## Consequences
- The workforce cannot grow without a human in the loop. **This is the point**,
  and it is the difference between an elastic workforce and an uncontrolled one.
- Elasticity is preserved where it is safe: *instances* of already-approved
  contracts scale up and down automatically with no human involvement. The gate
  is on new *kinds* of agent, not on capacity.
- If per-agent approval becomes a bottleneck, the right answer is a pre-approved
  template class the owner authorises once — not weakening this gate.
