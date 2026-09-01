# AI Workforce OS v0.4 — Data Model

Local development runs on `node:sqlite`, built into Node 22, so a clean
checkout runs the full suite with no native build step and no service to stand
up. The schema is written to move to PostgreSQL/Supabase later; §5 is the path.

---

## 1. Rules the schema follows

1. **Application-generated, time-sortable ids.** No AUTOINCREMENT, no SERIAL.
   Ids are ULID-shaped: a 48-bit millisecond timestamp then 80 bits of
   randomness, Crockford base32, with a type prefix (`agt_`, `pkt_`, `evt_`).
   Sortability is load-bearing — the audit tables have no sequence column, so
   `ORDER BY event_id` *is* insertion order, on either engine.
2. **ISO-8601 UTC text timestamps.** Map to `TIMESTAMPTZ` with a straight cast.
3. **INTEGER 0/1 booleans.** Map to `BOOLEAN`.
4. **JSON text for structured columns.** Map to `JSONB`.
5. **No engine-specific functions in DDL defaults.**
6. **CHECK constraints for every enum**, so a bad value fails at the database
   even if it slipped past Zod.
7. **No secret values.** `secret_refs` stores a provider and an environment
   variable name. A test walks every column and fails on one named for a secret.

---

## 2. Entities

23 tables. Grouped by what they are for.

### Organisation

| Table | Holds |
|---|---|
| `projects` | The primary isolation boundary. Optional parent for sub-projects. |
| `workflow_loops` | Repeatable work: manual, scheduled or event-triggered, with an ordered step definition. |

### Agents

| Table | Holds |
|---|---|
| `agent_templates` | Reusable specialist definitions. A template consumes nothing until instantiated. |
| `agents` | Registered identity and lifecycle only — the contract body lives elsewhere. |
| `agent_contract_versions` | Immutable versioned contracts, with the validation and test report for each. |
| `agent_instances` | Runtime instances. The elastic layer; reaped when idle. |

The split matters: `agents` answers "who exists", `agent_contract_versions`
answers "what were they allowed to do, and when", and `agent_instances` answers
"what is running right now". Conflating them would make the third question
impossible to answer cheaply at 1,000+ definitions.

### Work

| Table | Holds |
|---|---|
| `tasks` | Units of work, with attempt counts and a trace id. |
| `work_packets` | The typed control channel between agents. |
| `task_artifacts` | Delivered outputs, content-hashed, with provenance and attempt number. |

### Quality

| Table | Holds |
|---|---|
| `quality_gates` | Gate definitions: checks, threshold, blocking, separation-of-duties. |
| `quality_evaluations` | Append-only verdicts with per-check results. |
| `capa_records` | Corrective/preventive actions with a verification result. |

### Knowledge

| Table | Holds |
|---|---|
| `memory_records` | All four layers, with provenance, confidence, supersession and TTL. |

### Governance

| Table | Holds |
|---|---|
| `tool_definitions` | The catalogue. Risk class, schemas, required access and scopes, approval requirement, timeout, audit policy. |
| `tool_calls` | Append-only call log. One settle permitted, while still `requested`. |
| `approvals` | Owner-gated requests and their decisions. |
| `approval_tokens` | Hash, action fingerprint, actor, expiry, consumption. Never a plaintext token. |
| `events` | Strictly append-only audit log. |
| `secret_refs` | Where a credential lives. Never a value. |

### Operations

| Table | Holds |
|---|---|
| `budgets` | Limits and consumption at project, agent and task scope. |
| `usage_records` | Append-only per-unit consumption. |
| `jobs` | The durable local queue behind the scheduler. |
| `schema_migrations` | Applied version, name, checksum, timestamp. |

---

## 3. Relationships

```
projects ──┬── workflow_loops ── tasks ── work_packets ── task_artifacts
           │                       │            │              │
           │                       │            │              └── quality_evaluations
           │                       │            │
           │                       ├── capa_records
           │                       └── budgets (task scope)
           │
           ├── memory_records (scope_project_id; NULL = global)
           └── budgets (project scope)

agent_templates ──→ agents ──┬── agent_contract_versions   (versioned, immutable)
                             ├── agent_instances           (elastic, reaped)
                             ├── agents.parent_agent_id    (the delegation graph)
                             └── budgets (agent scope)

tool_definitions ──→ tool_calls ──→ approval_tokens ──→ approvals

events, usage_records: no inbound FKs by design — they must outlive whatever
they describe.
```

Foreign keys are **enabled** (`PRAGMA foreign_keys = ON` before anything else
runs); the scope-isolation guarantees lean on referential integrity, and it is
off by default in SQLite.

---

## 4. Append-only enforcement

Migration 002 adds triggers. Both layers matter: the repository exposes no
mutation path, and the triggers stop a future direct-SQL caller.

| Table | Rule |
|---|---|
| `events` | No UPDATE, no DELETE. |
| `quality_evaluations` | No UPDATE, no DELETE. |
| `usage_records` | No UPDATE, no DELETE. |
| `tool_calls` | No DELETE. One UPDATE, only while `phase = 'requested'`. |
| `agent_contract_versions` | Body, hash, version and agent are immutable; no DELETE. |
| `approval_tokens` | Fingerprint, actor, approval, hash and expiry immutable; no second consume. |

`tool_calls` is the one exception to strict append-only, and it is deliberate:
a row is written *before* execution and completed after, so a crash mid-flight
still leaves the attempt on record.

---

## 5. Migrating to PostgreSQL

### Type mapping

| SQLite | PostgreSQL |
|---|---|
| `TEXT` (id) | `TEXT` or `VARCHAR(40)` |
| `TEXT` (ISO timestamp) | `TIMESTAMPTZ` — `ALTER … USING col::timestamptz` |
| `INTEGER` (0/1) | `BOOLEAN` — `USING col::int::boolean` |
| `TEXT` (JSON) | `JSONB` — `USING col::jsonb` |
| `REAL` | `DOUBLE PRECISION`, or `NUMERIC(18,6)` for money |
| `CHECK (x IN (…))` | keep as-is, or promote to an `ENUM` type |

### Steps

1. Translate `001_init.sql` with the mapping above. Structure needs no change:
   no AUTOINCREMENT, no SQLite-only defaults.
2. Rewrite `002_append_only_audit.sql` as `BEFORE UPDATE OR DELETE` triggers
   raising an exception, **plus** `REVOKE UPDATE, DELETE … FROM app_role`.
   Belt and braces: the trigger catches bugs, the grant catches the trigger
   being dropped.
3. `003_system_bootstrap.sql` ports unchanged apart from quoting.
4. Swap the driver behind the `Db` interface in `src/db/connection.ts`. Two
   changes: `?` placeholders become `$1, $2, …`, and every method becomes
   async, which propagates outward. Nothing above the repository layer knows
   what engine it is on.
5. Replace `db.tx()` savepoint handling with the driver's transaction API —
   the nesting semantics (savepoints for inner scopes) are the same.
6. Consider moving `jobs` to a real queue at the same time; the scheduler
   interface is narrow precisely to make that a local change.

### Indexes to add under load

Present already: agent parent and status, task project+status, task trace,
packet task/trace/receiver, artifact task, evaluation task, memory
scope+layer+key, event trace/kind/project, tool-call trace/agent, usage
project/agent, jobs due.

Worth adding on Postgres:

- `memory_records USING gin (content jsonb_path_ops)` for content search.
- Partial index on `tool_calls (agent_id) WHERE decision = 'deny'` — the
  denial view is read far more than the full log.
- `events (created_at DESC)` for time-ranged audit queries.
- `BRIN` on `usage_records (created_at)` once the table is large.

### What will need care

- **Concurrent job claiming.** The conditional UPDATE is correct on Postgres
  too, but `SELECT … FOR UPDATE SKIP LOCKED` is the better idiom there.
- **`estimated_cost` as `REAL`.** Move to `NUMERIC` before anyone reconciles it
  against an invoice.
- **Id sortability** must survive: keep generating ids in the application.

---

## 6. Migration discipline

Migrations are numbered SQL files applied in order, with a SHA-256 checksum
recorded per migration. Editing an applied migration is a **hard error**, not a
warning — the runner refuses to start and names both checksums. Schema creation
lives in files, never in application startup.

```
migrations/
  001_init.sql               tables, constraints, indexes
  002_append_only_audit.sql  audit and immutability triggers
  003_system_bootstrap.sql   tool catalogue and quality gates
```

`003` is runtime configuration, not demo data: the gateway refuses any tool not
in the catalogue, so an empty catalogue would mean a runtime that can do
nothing. Demo organisation data (projects, agents, templates, authoritative
memory) is applied separately by `npm run seed`, so it can be reshaped without
a schema version.
