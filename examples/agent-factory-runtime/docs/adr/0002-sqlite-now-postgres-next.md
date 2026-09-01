# ADR-0002: SQLite for development and single-node; PostgreSQL for scale

**Status:** Accepted · **Date:** 2026-09-01

## Context
The mandate asks whether SQLite should remain only for local development, and
insists the answer be justified rather than fashionable.

## Decision
**SQLite is the development and single-node adapter. PostgreSQL is the scale
target.** The migration is deferred, not skipped, and the schema is written so
that it is an adapter swap rather than a rewrite.

## Evidence (measured, not assumed)
From `bench/results.json` on a 4-vCPU / 16 GB Linux container:

| Observation | Measurement |
|---|---|
| Task claim latency, 10 → 1,000 agents | **flat at 0.14–0.18 ms p95** |
| Single-row write latency | flat at ~0.07 ms p95 |
| Write transactions per task | 6.17 (after batching; 7.16 before) |
| Share of single-threaded wall time inside write transactions | **42.6%** |
| Throughput, 1 worker → 32 workers | **595 → 376 tasks/s (worse)** |
| Execution latency p99, 1 worker → 32 workers | **11 ms → 638 ms** |

The indexes are doing their job — claim latency does not move as the table
grows. The ceiling is **SQLite's single-writer lock**. With 42.6% of the work
already inside write transactions, Amdahl's law caps parallel speedup at ~2.3×
even before contention; in practice contention plus the GIL makes added workers
*negative*.

This is a property of the storage engine, not of the runtime architecture. The
control plane is not the limit; the writer is.

## Why PostgreSQL specifically
1. **Concurrent writers (MVCC).** The one thing SQLite structurally cannot do,
   and precisely the measured bottleneck.
2. **`SELECT ... FOR UPDATE SKIP LOCKED`.** The claim is already written as a
   single atomic statement; this is its natural PostgreSQL form and it scales to
   many concurrent claimers without a global lock.
3. **Row-level security.** Project isolation is currently enforced in
   application code. Every tenant-scoped table already carries `project_id`
   directly, so RLS becomes one policy per table — enforcement moves *below* the
   application, where a bug in a query cannot bypass it.
4. **Partitioning.** `events` reached 233 MB for 10,000 tasks (~23 KB/task).
   Native range partitioning by time is the retention story.
5. Mature operational tooling: replication, backups, connection pooling.

## Why not something else
- **MySQL** — workable, but weaker partial-index support (the partial indexes on
  `tasks` and `memory_records` are load-bearing) and RLS is not native.
- **A dedicated queue (Redis/SQS/RabbitMQ)** — solves the queue but not the
  store, and would split state across two systems that must then agree. Worth
  doing *after* PostgreSQL, if queue throughput becomes the limit again. See
  ADR-0005.
- **A distributed SQL engine (CockroachDB/Yugabyte)** — real horizontal write
  scaling, but the operational cost is not justified until a single PostgreSQL
  writer is proven insufficient. That is a long way past current requirements.
- **Staying on SQLite** — viable only for single-node deployments. It cannot
  serve the mandate's multi-business, multi-tenant target.

## What makes the migration cheap
- All SQL is in `af/store/` and the component modules; no ORM dialect to re-verify.
- Every tenant table carries `project_id` directly — the RLS predicate shape.
- IDs are ULID-style strings, so no sequence coordination is needed.
- `Store` is a port; `SqliteStore` is one adapter.
- Timestamps are epoch floats — portable.

Known non-trivial parts: `RETURNING` semantics differ subtly; `INSERT OR REPLACE`
becomes `ON CONFLICT DO UPDATE`; `COALESCE`-based unique indexes need review;
and the batcher's flush semantics should be re-tuned once writers are concurrent.
