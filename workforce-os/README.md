# AI Workforce OS — v0.4 (pre-production)

A governed, testable runtime that builds, activates, supervises, pauses, merges, retires
and audits AI agents around reusable business workflow loops.

An agent here is **a governed runtime identity with a contract**, not a prompt. Every
task, tool call, delegation, memory write, quality decision and approval is traceable.

> **Status: pre-production.** Locally validated, not deployed. v0.4 performs no external
> execution — no shell, no browser, no outbound network calls by agents. That is a
> deliberate capability boundary enforced by tests, not a missing feature.

## Quick start

No dependencies, no install step — the runtime is standard library only.

```bash
cd workforce-os
export WORKFORCE_OS_OWNER_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
make serve                     # http://127.0.0.1:8420
```

Open the dashboard at `http://127.0.0.1:8420/` and paste the Owner token.

```bash
make test                      # 110 tests, fully offline
```

### Configuration

All configuration is environment-based; **no secrets live in the repository**.

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKFORCE_OS_OWNER_TOKEN` | *(unset)* | The Owner credential. Unset means Owner actions are disabled entirely. |
| `WORKFORCE_OS_DB` | `workforce_os.db` | SQLite database path. |
| `WORKFORCE_OS_HOST` / `_PORT` | `127.0.0.1` / `8420` | Bind address. |
| `WORKFORCE_OS_PROVIDER` | `local` | Provider adapter. `local` is deterministic and offline. |
| `WORKFORCE_OS_PROVIDER_API_KEY` | *(unset)* | Provider credential, read from the environment only. |
| `WORKFORCE_OS_APPROVAL_TTL` | `900` | Approval token lifetime, in seconds. |
| `WORKFORCE_OS_MAX_DEPTH` | `5` | Global delegation depth ceiling. |
| `WORKFORCE_OS_REWORK_THRESHOLD` | `2` | Failed evaluations before a CAPA opens. |

**Offline mode is the default.** With no provider key set, the deterministic local
adapter is used, so the whole system — including the Chief Agent Architect endpoint —
runs and tests with no network access.

## The authority model

1. **The human Owner is the final authority.** Approvals, retirement, CAPA closure and
   cross-project reads are Owner-only. No agent level substitutes for the Owner.
2. **The Chief Agent Architect** is the Owner's single primary AI interface and the only
   agent with system-wide visibility. Exactly one may be active at a time.
3. **L5 means full visibility and orchestration, not unrestricted execution.** Level
   governs who may see and orchestrate what. It grants no tool scope, and an L5 agent
   still needs Owner approval for high-risk actions.
4. **Every other agent is scoped** by project, role, tool, data domain, budget and
   action type — six independent gates, all deny-by-default.
5. **High-risk actions require explicit Owner approval** before execution, via a
   single-use token bound to the agent, tool and exact arguments.
6. **Secrets never reach prompts, logs, memory or source control.**
7. **No external action is ever claimed unless the tool confirms it.** An unconfirmed
   call is recorded as `attempted`, never `executed`.

## Architecture

```
workforce_os/
  config.py schemas.py errors.py redaction.py    # boundary types and secret handling
  db/            connection, numbered checksum-verified migrations
  policy/        authority · scopes · risk        (policy, separated from business logic)
  core/          registry · builder · templates · tasks · delegation · packets
                 budgets · memory · quality/CAPA · approvals · events · telemetry · bus
  gateway/       hardened tool gateway + the pure, local built-in tool set
  providers/     adapter interface + deterministic local adapter
  server/        stdlib HTTP API, explicit route table, dashboard
```

Key seams: **policy is separate from business logic** (`policy/` decides, `core/`
executes), and **provider adapters are separate from orchestration** (swapping a vendor
changes nothing above `providers/`).

### How a tool call is governed

Every call runs the same ordered pipeline, and every outcome is recorded:

```
agent + verified contract
  → scope gates   (active → project → known tool → tool → action type → data domain)
  → budget pre-flight   (agent and task, before anything executes)
  → risk classification
  → approval token      (high risk only; single-use, bound, expiring)
  → execute
  → charge · meter · audit
```

A denial at any step writes a tool-call record with a machine-readable reason code and
executes nothing.

### Governance guarantees, and where they are enforced

| Guarantee | Enforcement |
|-----------|-------------|
| Contracts are immutable and versioned | SQLite triggers + checksum verification on every read |
| The audit trail cannot be edited | Append-only triggers + a hash chain verified by `/api/audit/verify` |
| A child can never out-scope its parent | Scope intersection at delegation and at instantiation |
| A depth cap binds the whole chain beneath it | Minimum cap over every ancestor delegator |
| An over-budget call never runs | Pre-flight check before execution; spend recorded only after |
| An agent cannot sign off on its own work | Self-evaluation and self-approval both refused |
| A task with an open CAPA cannot close | Checked on the completion transition |

## API surface

All routes are under `/api`. Owner routes require `X-Owner-Token` (or
`Authorization: Bearer …`). The acting principal is derived from the credential — never
from the request body.

| Area | Routes |
|------|--------|
| Meta | `GET /health` · `GET /tools` · `GET /events` · `GET /audit/verify` |
| Projects | `POST GET /projects` · `GET /projects/{id}` |
| Agents | `POST GET /agents` · `GET /agents/{id}` · `POST /agents/{id}/revise` `…/rollback` `…/status` |
| Templates | `POST GET /templates` · `POST /templates/{id}/instantiate` |
| Tasks | `POST GET /tasks` · `GET /tasks/{id}` · `POST /tasks/{id}/status` `…/evaluate` |
| Delegation | `POST /delegations` · `GET /delegations/graph` |
| Gateway | `POST GET /tool-calls` |
| Approvals | `GET /approvals` · `POST /approvals/{id}/approve` `…/reject` |
| Memory | `POST GET /memory` |
| Quality | `GET /capas` · `POST /capas/{id}/close` |
| Telemetry | `GET /telemetry` |
| Architect | `GET /architect/system-view` · `POST /architect/brief` |
| Scheduler | `POST GET /jobs` |

## Testing

```bash
make test
```

110 tests, no network, no third-party packages. `tests/test_security.py` holds the
durable security-boundary tests: **a change that breaks one of those is a governance
regression, not a test that needs updating.**

Each acceptance criterion in `docs/claude/ACCEPTANCE_CRITERIA.md` names the test that
proves it.

## Documentation

- `docs/claude/V04_BUILD_SPEC.md` — what v0.4 is and where each rule is enforced
- `docs/claude/ACCEPTANCE_CRITERIA.md` — the criteria and their proving tests
- `CHANGELOG.md` — scope of this release, and its provenance

## Not in v0.4

Deployment and publishing, multi-node execution, real external tool adapters, streaming
provider responses, and any agent-initiated shell, browser or network access.
