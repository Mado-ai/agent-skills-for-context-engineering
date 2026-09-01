# DATA_MODEL_V04.md

17 tables across 2 migrations. Every index below exists for a named query;
indexes without a caller were removed rather than kept "just in case".

## Conventions

- **IDs** are ULID-style prefixed strings (`tsk_01M1...`). Lexicographically
  sortable, so primary-key order equals creation order: inserts stay
  append-mostly (no page splits from random UUID4), time-range scans work on the
  PK alone, and an ID pasted into a bug report identifies its own table.
- **Timestamps** are epoch-second floats. Portable, and comparable in SQL.
- **Money** is integer micros (1e-6 USD). Floats drift when accumulated across
  millions of calls; integers are exact.
- **`project_id` is carried directly** on every tenant-scoped row, never reached
  through a join. This is what makes PostgreSQL RLS a one-line policy per table.
- **JSON columns** hold canonical JSON (sorted keys, tight separators) so that
  hashing a spec gives a stable content hash.

---

## Table groups

### Tenancy
`projects` — the security boundary.

### Agent definition
| Table | Purpose |
|---|---|
| `agent_templates` | A kind of agent. Points at its currently ACTIVE contract. |
| `agent_contracts` | A versioned, immutable-after-DRAFT definition. |
| `agent_capabilities` | Denormalised capability index (ADR-0008). |
| `agent_instances` | A *live worker*. Distinct from a definition. |

The template/contract/instance split is the mandate's core distinction made
physical: 10,000 contracts are 10,000 rows; 10,000 *instances* are real
concurrency, so instances are created on demand and reaped when idle.

`UNIQUE(template_id, version)` plus `content_hash` gives both version history
and duplicate detection — two contracts describing identical behaviour hash
identically regardless of who authored them or when.

### Work
| Table | Purpose |
|---|---|
| `tasks` | WorkPackets with queue state: status, lease, attempts, priority, deps counter |
| `task_deps` | DAG edges for fan-in |

`tasks` carries both the durable packet (JSON) and the denormalised queue
columns the claim reads. Keeping status, priority and `available_at` as real
columns is what lets the claim be a single indexed statement rather than a scan
plus a JSON parse.

### Observability
| Table | Purpose |
|---|---|
| `events` | Runtime events **and** audit trail, split by `category` |
| `usage_ledger` | Append-only cost/token/duration detail |
| `budgets` | O(1) counters per scope, aggregating the ledger |
| `tool_calls` | Every tool call, including blocked ones |

One table backs events and audit deliberately: a separate audit store that can
disagree with the runtime log is worse than one store with a discriminator and
an index per access pattern.

`budgets` and `usage_ledger` are a deliberate pair. The ledger is the truth; the
counters make the hot-path budget check O(1) instead of a `SUM` over history.
Both are written in one transaction so they cannot disagree.

### Governance
| Table | Purpose |
|---|---|
| `approvals` | Owner decisions, with `params_hash` of exactly what was shown |
| `exec_tokens` | Single-use grants; `secret_hash` only, never plaintext |

### Knowledge & quality
| Table | Purpose |
|---|---|
| `memory_records` | Six layers, with trust, provenance, version, retention |
| `quality_reviews` | Every verdict and its findings |
| `capa_records` | Corrective action with enforced verification-before-closure |

---

## The indexes that matter

### `idx_tasks_claim` — the single most load-bearing line in the schema

```sql
CREATE INDEX idx_tasks_claim ON tasks (priority, available_at, id)
  WHERE status = 'READY';
```

Two decisions, both measured:

**Column order is `(priority, available_at, id)`** — matching the claim's
`ORDER BY` exactly, so the planner walks the index in output order and stops at
`LIMIT` without materialising or sorting the backlog. The intuitive alternative
puts `available_at` first because it is the *filtered* column; that forces a sort
of every runnable row on every claim, and claim latency then grows with queue
depth.

**It is partial (`WHERE status = 'READY'`)** — so the index is proportional to
the *runnable backlog*, not to total history. A completed task leaves the index.

Measured: claim p95 stayed **flat at 0.14–0.18 ms** from 10 agents / 500 tasks
to 1,000 agents / 10,000 tasks. The claim path does not degrade with scale.

### `idx_capabilities_lookup`

```sql
CREATE INDEX idx_capabilities_lookup ON agent_capabilities (capability, project_id)
  WHERE state = 'ACTIVE';
```
Turned the Chief's reuse lookup from 210 ms to 0.02 ms at 10,000 templates, and
from linear to flat (ADR-0008).

### `idx_tasks_idem`

```sql
CREATE UNIQUE INDEX idx_tasks_idem ON tasks (project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```
Idempotency enforced by the database, so concurrent duplicate submissions
collide here rather than racing a check-then-insert in application code.

### `idx_memory_scope`

```sql
CREATE INDEX idx_memory_scope ON memory_records (layer, project_id, mkey)
  WHERE deleted_at IS NULL;
```
Leads with `(layer, project_id)` — the shape that makes cross-project leakage
awkward to express by accident, because the natural query is already scoped.

### Other partial indexes
`idx_tasks_lease` (lease sweep), `idx_approvals_pending` (the owner's queue),
`idx_events_audit`, `idx_capa_open`, `idx_instances_live`. Each keeps a hot index
proportional to *open* work rather than to history.

---

## SQLite configuration

```
journal_mode = WAL          readers proceed during writes
synchronous  = NORMAL       fsync at checkpoint, not per commit
busy_timeout = 10000        wait on the write lock rather than failing
foreign_keys = ON
cache_size   = -64000       64 MB, to keep hot indexes resident
mmap_size    = 256MB
```

`synchronous=NORMAL` can lose the last few committed transactions on a hard
crash but never corrupts the file. The runtime already tolerates that class of
loss — leases expire and tasks re-run — so paying `FULL`'s per-commit fsync
would buy durability the design does not need.

**Every write transaction uses `BEGIN IMMEDIATE`.** Python's `sqlite3` defaults
to deferred transactions, which take the write lock only at the first write — so
two transactions that both read-then-write can deadlock, and one dies with
"database is locked" *after doing real work*. Taking the lock up front turns that
deadlock into a short retryable wait. This was a real failure mode under
concurrent claims before the change.

---

## Growth and retention

Measured at 1,000 agents / 10,000 tasks: **233 MB**, ~23 KB per task,
7.6 events per task.

That is the dominant growth term and it needs a retention policy before any
sustained run. The plan (see SCALING_STRATEGY.md): partition `events` and
`usage_ledger` by time, keep `category='audit'` far longer than
`category='runtime'`, and roll detail into pre-aggregated summaries. The
`category` discriminator and the time-ordered primary keys exist to make that
partitioning straightforward rather than a migration.

`memory_records` uses **soft delete**: the row is retained with `deleted_at` set
so the audit trail can still show that a record existed and was removed. A hard
delete would make deletion itself untraceable. Hard erasure for a data-subject
request is a separate, owner-driven operation.
