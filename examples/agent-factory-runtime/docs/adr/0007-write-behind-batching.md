# ADR-0007: Write-behind batching for append-only tables

**Status:** Accepted · **Date:** 2026-09-01

## Context
Profiling showed **7.16 write transactions per task** and **46.1% of
single-threaded wall time inside write transactions**. Because SQLite serialises
writers, that share was the parallel-scaling ceiling.

## Decision
Coalesce inserts into append-only tables — `quality_reviews`, `usage_ledger`,
`tool_calls`, and buffered `events` — into periodic multi-row transactions.

**Never batched**, because correctness depends on immediate visibility:
- task status transitions (queue control state — a stale read double-delivers)
- concurrency reservations (a stale read grants excess concurrency)
- budget counters (a stale read lets spending exceed its ceiling)
- approvals and execution tokens (single-use redemption must be atomic)
- audit events (a record of who was denied what must survive a crash)

## Measured result
| Metric | Before | After |
|---|---|---|
| Write transactions per task | 7.16 | **6.17** |
| Time inside write transactions | 46.1% | **42.6%** |
| Single-threaded throughput | 740 tasks/s | **802 tasks/s** (+8.4%) |
| 8-worker throughput, 1,000 agents | 350 tasks/s | **373 tasks/s** |

Real but modest. It does not change the conclusion of ADR-0002: the remaining
6.17 transactions are the *unbatchable* control-state writes, and only a store
with concurrent writers removes that floor.

## The bug this introduced, and what it cost
Two defects appeared immediately, both caught by tests rather than review:

1. **Silently emptied rework feedback.** `_previous_feedback` read
   `quality_reviews` directly and missed reviews still in the buffer. Reworks
   still ran — just blind, without the findings that would let them succeed. The
   worst kind of bug: nothing failed, the work simply got worse.
2. **Self-cancelling optimisation.** The fix for (1) routed through a
   flush-on-read accessor, which then flushed on *every* task and cancelled the
   batching entirely. Measured improvement was exactly zero until the fetch was
   restricted to reworks only.

Both are now regression-tested in `tests/test_batching.py`. The general lesson,
recorded because it will recur: **every write-behind buffer creates a read
hazard for its own table**, and the fix for the hazard can silently undo the
optimisation. Neither shows up as a failure; both show up as numbers not moving.

## Trade accepted
On unclean shutdown, up to `max_batch` rows of *observability* data can be lost.
No control state is at risk, and the runtime already tolerates that class of
loss — leases expire and tasks re-run.
