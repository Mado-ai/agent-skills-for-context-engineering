# ADR-0005: At-least-once delivery with idempotent submission and single-use tokens

**Status:** Accepted · **Date:** 2026-09-01

## Context
A task can be executed twice: a worker completes the work, then dies before
recording it, and the lease lapses. Exactly-once delivery across a database and
an external side effect is not achievable without distributed transactions the
external system does not offer.

## Decision
Accept **at-least-once** delivery and make duplicates safe rather than pretend
they cannot happen.

Three mechanisms:
1. **Idempotent submission.** A unique partial index on
   `(project_id, idempotency_key)` means a duplicate submit returns the existing
   task id instead of creating a second one. The race is resolved by the
   database, not by a check-then-insert.
2. **Single-use execution tokens.** A duplicated *high-risk* action is refused at
   the point where duplication would actually matter: the token's redemption
   carries `uses < max_uses` in its WHERE clause, so two concurrent redemptions
   cannot both succeed.
3. **Guarded state transitions.** `complete()` and `fail()` match on
   `lease_owner`, so a worker that already lost its lease cannot overwrite the
   result of the worker that took over.

## What this does not cover
An R0/R1 tool with a side effect could still run twice. That is accepted: those
classes are read-only or low-risk internal writes by definition. Any tool whose
duplication would be harmful must be classified R2 or above, and the
classification is part of tool registration.

## Alternative rejected
A distributed transaction or an outbox with a dedupe window would reduce but not
eliminate duplicates, at significant complexity. Making duplicates *safe* is
cheaper and more honest than making them *rare* and assuming they are absent.
