# ADR-0008: Denormalised capability index

**Status:** Accepted · **Date:** 2026-09-01

## Context
`AgentRegistry.find_by_capability` is the reuse mechanism — the Chief calls it
before proposing any new agent, so it runs on every planning cycle. The first
implementation loaded every ACTIVE contract and JSON-parsed each spec in Python
to read its capability list.

## Measured problem
Capability search p95 against a growing catalogue:

| Templates | p95 before |
|---|---|
| 100 | 2.1 ms |
| 1,000 | 21.3 ms |
| 5,000 | 110.4 ms |
| 10,000 | **210.5 ms** |

Cleanly linear. At the mandate's target of 10,000+ agent definitions, the
*planner* would have become the bottleneck long before the runtime did — and it
would have been invisible, because nothing fails: the Chief just gets slow.

## Decision
Add `agent_capabilities (contract_id, template_id, project_id, capability, state)`
with a partial index on `(capability, project_id) WHERE state = 'ACTIVE'`,
maintained by the factory on draft, activation and every lifecycle transition.

Search probes the index for an exact match first (the common case) and falls
back to a LIKE pass over short capability strings only when that misses.

## Measured result
| Templates | p95 before | p95 after |
|---|---|---|
| 100 | 2.1 ms | 0.021 ms |
| 1,000 | 21.3 ms | 0.019 ms |
| 5,000 | 110.4 ms | 0.026 ms |
| 10,000 | 210.5 ms | **0.020 ms** |

~10,000× at 10k templates, and **flat** rather than linear — the shape mattered
more than the constant.

## Cost
Denormalisation: the capability list now exists in two places (the contract spec
and the index), and they can drift if a write path forgets to update the index.
Mitigated by confining all writes to `AgentFactory`, and by the state being
synced on every lifecycle transition rather than only on create.

Accepted because contracts are immutable after DRAFT, so the index only changes
on the small number of governed lifecycle operations — not on arbitrary edits.
