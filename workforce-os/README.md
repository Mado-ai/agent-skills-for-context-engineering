# AI Workforce OS — runtime v0.4

A governed operating system for a workforce of AI agents. The Owner talks to
one agent, the **Chief Agent Architect**; the Chief designs teams, delegates
typed work, inspects quality and cost, and escalates anything that belongs to
the Owner.

> **Pre-production build. Do not deploy.**
> There is no Owner authentication, and the owner-gated tool handlers record
> real governance but simulate their external effects.
> `docs/V04_SECURITY.md` §5 lists every blocker.

---

## What is actually built

The governance is real code, not scaffolding:

- **Agents are validated, versioned contracts.** Nothing about what an agent may
  do lives outside its contract. Reaching `active` requires a passing validation
  **and** a passing test run that exercises the real policy engine — including
  the negative cases.
- **One authorization point.** Every tool call passes through the same ordered,
  default-deny check list. There is no bypass, including for the Chief.
- **Owner authority is not delegable.** No agent holds Owner access level. An
  owner-gated action executes only with a single-use, short-lived token bound by
  fingerprint to that exact action, arguments, actor and project.
- **Typed delegation.** Work moves as `WorkPacket`s that can never carry more
  authority than the sender holds.
- **Deterministic quality gating.** Verdicts come from stored state; the model
  evaluator is separated out and used only where a gate asks for it.
- **Append-only audit**, enforced by the absence of any mutation path *and* by
  database triggers.

**184 tests, all offline.** The default model provider is deterministic; the
full suite needs no API access and no network.

---

## Quick start

Requires Node ≥ 22.5 (for the built-in `node:sqlite` — no native build step,
no service to stand up).

```bash
npm install
npm run migrate      # apply versioned migrations
npm run seed         # bootstrap organisation: 3 projects, Chief + 3 masters
npm start            # Control Center on http://127.0.0.1:8787
```

Verify it:

```bash
npm test             # 184 tests
npm run smoke        # 15-step end-to-end check with real pass/fail output
npm run typecheck
```

`npm run reset` drops the database and re-seeds.

---

## What the smoke test proves

`npm run smoke` boots a throwaway runtime and drives one governed piece of work
end to end, plus the denial paths that matter:

```
PASS  runtime boots and applies migrations
PASS  seed creates a governed organisation
PASS  every seeded agent passed validation and required tests
PASS  Chief assessment surfaces state-derived findings
PASS  Master instantiates a specialist from an allowed template
PASS  instantiating a template outside the parent contract is refused
PASS  task created and delegated as a typed WorkPacket
PASS  delegating a tool the sender does not hold is refused
PASS  execute → evaluate → accept completes the quality loop
PASS  an owner-gated tool without a token reports APPROVAL_REQUIRED
PASS  approval + token executes once, and the replay is refused
PASS  a token cannot be reused for different arguments
PASS  cross-project memory access is denied by default
PASS  the audit log refuses to be rewritten
PASS  HTTP API serves real runtime state
```

---

## Control Center

Fifteen views, all bound to real backend state. There are no optimistic
updates: an action re-reads from the runtime before it changes what the screen
says, and a refusal renders the runtime's own error code.

| | View | Shows |
|---|---|---|
| 1 | Command Center | Live state, blockers needing the Owner, recent policy denials |
| 2 | Chief Agent Architect | Situation report, state-derived findings, team proposals |
| 3 | Agent Factory | The activation pipeline: draft → validate → test → activate |
| 4 | Agent Registry | Definitions, contracts, permissions, live instances |
| 5 | Organization | The delegation graph with scope and authority at each level |
| 6 | Projects & Loops | Project isolation boundaries and their workflow loops |
| 7 | Task Queue | Execution state, attempt counts, rework chains |
| 8 | Trace Viewer | One trace: packets, tool calls, events, spend |
| 9 | Quality & CAPA | Gates, verdicts, failing checks, corrective actions |
| 10 | Memory | Four layers with provenance, confidence and supersession |
| 11 | Tool Gateway | Risk class, required scopes, owner-gating, authorization preview |
| 12 | Approvals | Pending decisions; the execution token, shown once |
| 13 | Budgets & Usage | Consumption against limits at every scope |
| 14 | Telemetry & Audit | The append-only log |
| 15 | Settings & Policy | What the runtime enforces, so it can be checked |

---

## Layout

```
workforce-os/
  migrations/       versioned SQL; editing an applied one is a hard error
  src/
    domain/         Zod schemas — contracts, packets, memory, quality, budgets
    db/             connection, migration runner, repositories, seed
    policy/         the single authorization point; scope derivation; fingerprints
    registry/       agent builder, contract validation, lifecycle, instances
    gateway/        Tool Gateway, schema validation, built-in handlers
    delegation/     WorkPacket runtime, elastic specialist instantiation
    execution/      task execution and the run-to-completion loop
    memory/         four-layer memory with provenance and precedence
    quality/        gates, deterministic checks, CAPA
    approvals/      Owner approvals and exact-action execution tokens
    budget/         limits and usage at project, agent and task scope
    scheduler/      durable jobs and the event bus
    chief/          the Chief Agent Architect
    llm/            provider interface, deterministic mock, Claude adapter
    api/            HTTP router, routes, server
    ui/             the Control Center
  tests/            12 suites, 184 tests
  scripts/smoke.ts  end-to-end smoke test
  docs/             architecture, security, API, data model, test report
```

---

## Configuration

Copy `.env.example` to `.env`. Nothing here is a secret store — credentials are
read from the process environment at call time and never persisted.

| Variable | Default | Meaning |
|---|---|---|
| `WORKFORCE_DB_PATH` | `.data/workforce.db` | Database file. |
| `WORKFORCE_PORT` | `8787` | HTTP port. |
| `WORKFORCE_HOST` | `127.0.0.1` | Bind address. Any other value **requires** `WORKFORCE_API_TOKEN`. |
| `WORKFORCE_API_TOKEN` | unset | When set, requires `Authorization: Bearer …`. A shared secret, not authentication. |
| `WORKFORCE_LLM_PROVIDER` | `mock` | `mock` (deterministic, offline) or `anthropic`. |
| `WORKFORCE_LLM_MODEL` | `claude-opus-5` | Used only when the provider is `anthropic`. |
| `ANTHROPIC_API_KEY` | unset | Required only for the `anthropic` provider. |

---

## Documentation

| Document | Covers |
|---|---|
| [`docs/V04_ARCHITECTURE.md`](docs/V04_ARCHITECTURE.md) | How it fits together, and what it deliberately does not do |
| [`docs/V04_SECURITY.md`](docs/V04_SECURITY.md) | Threat model, enforced properties, known-weak areas, **production blockers** |
| [`docs/V04_API.md`](docs/V04_API.md) | All 78 routes, error envelope, status codes, worked flows |
| [`docs/V04_DATA_MODEL.md`](docs/V04_DATA_MODEL.md) | 23 entities and the PostgreSQL migration path |
| [`docs/V04_TEST_REPORT.md`](docs/V04_TEST_REPORT.md) | Actual results, coverage by requirement, and what is **not** tested |
| [`CHANGELOG.md`](CHANGELOG.md) | What v0.4 adds |
