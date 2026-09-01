# AI Workforce OS — v0.4 Pre-Production Build Spec

> Status: authored for the greenfield v0.4 build. No v0.3 runtime was present in this
> repository or in any repository reachable from the build session, so v0.4 is
> implemented from scratch against the Owner's project instructions rather than
> migrated from a baseline. See `../../CHANGELOG.md` for the provenance note.

## 1. Purpose

A governed, testable, pre-production runtime that can build, activate, supervise,
pause, merge, retire and audit AI agents around reusable business workflow loops.

The runtime is a **governance kernel**, not a chat wrapper. Every capability below is
enforced server-side and recorded in an append-only audit trail.

## 2. Non-negotiable authority model

| Rule | Enforcement point |
|------|-------------------|
| The human Owner is the final authority | `policy.authority` — only an Owner principal may approve, override, retire or raise a level |
| The Chief Agent Architect is the Owner's single primary AI interface and the only agent with system-wide visibility | `core.registry` — exactly one active `chief_architect` role per deployment; `policy.scopes.visible_projects` returns all projects only for L5 |
| L5 means full system visibility and orchestration, not unrestricted external execution | `gateway` — level grants **no** tool scope; external/high-risk actions still require an Owner approval token regardless of level |
| All other agents are scoped by project, role, tool, data domain, budget and action type | `policy.scopes.check` — deny by default, six independent gates |
| High-risk actions require explicit Owner approval before execution | `gateway` + `core.approvals` — risk classification precedes execution; execution refuses without a valid single-use token |
| Never expose secrets to prompts, logs, memory or source control | `config` loads secrets from env only; `redaction` scrubs values before persistence |
| Never claim an external action occurred unless the tool/runtime confirms it | Tool call records carry `confirmed` set solely from adapter return; unconfirmed calls persist as `attempted` |

### Authority levels

`L1` operator · `L2` specialist · `L3` senior specialist · `L4` project lead · `L5` chief architect.

Level governs **visibility and orchestration breadth** (who may delegate to whom, who
may read across projects). Level never widens tool scope, data domains or budget.

## 3. Runtime objects

All runtime objects are typed schemas (`workforce_os.schemas`) validated on the way in
and on the way out of SQLite.

- **Project** — isolation boundary. Every agent, task, memory row and tool call belongs
  to exactly one project.
- **AgentContract** — the governed identity: role, level, allowed tools, data domains,
  action types, budget, system prompt, provider model. Immutable once written.
- **Agent** — registry entry pointing at an active contract version, with lifecycle
  status: `draft → active ⇄ paused → retired`.
- **AgentTemplate** — a parameterised contract used to instantiate specialists on demand.
- **Task** — unit of work, scoped to a project and an assignee, with its own budget.
- **Delegation** — an edge in the parent/child graph, carrying a work packet.
- **WorkPacket** — typed, schema-validated payload passed between agents.
- **MemoryRecord** — a layered memory row with mandatory provenance.
- **Evaluation / CAPA** — quality verdicts and corrective-action records.
- **ApprovalRequest / ApprovalToken** — the Owner approval execution flow.
- **ToolCall / Event / Metric** — audit and telemetry.

## 4. Capability requirements

### 4.1 Agent Builder and versioned contracts
Contracts are validated (role, level, tool names, budget shape, non-empty prompt) and
content-addressed by checksum. Editing an agent writes a **new version**; prior versions
remain readable. Rollback re-points the agent at an earlier version. Contract rows are
never mutated in place.

### 4.2 Delegation graph
A parent may delegate only to agents within the same project and only at a **strictly
lower level**. The child's effective scope must be a **subset** of the parent's
(attenuation) — tools, data domains and action types are intersected, never widened.
Depth is capped per contract; cycles are rejected.

### 4.3 Dynamic specialist instantiation
A template plus a parameter map produces a validated contract and an active agent, with
the instantiating agent recorded as parent. Instantiation is itself budget-charged and
audited, and the template's scope caps the result.

### 4.4 Budgets and limits
Per-agent and per-task budgets over USD, tokens and tool calls. Every spend writes a
ledger row. Enforcement is **pre-flight**: a call that would exceed either budget is
denied before execution, not after.

### 4.5 Typed work packets
Each packet declares a `kind` and `schema_version`; payloads validate against a
registered packet schema. Invalid packets are rejected at delegation time.

### 4.6 Multi-layer memory with provenance
Three layers — `working` (task-scoped), `episodic` (agent-scoped), `semantic`
(project-scoped). Every row carries provenance: author agent, source task, origin kind
and confidence. Reads are project-isolated; cross-project reads are refused even for L5
unless the caller is the Owner.

### 4.7 Quality evaluator and rework/CAPA loop
Deliverables are scored against per-task criteria. A failing verdict opens a **rework
task** linked to the original and increments the rework counter. Repeated failure past a
threshold opens a **CAPA** record demanding root cause and corrective action; the task
cannot be closed while a CAPA is open.

### 4.8 Hardened Tool Gateway
Every call passes, in order: agent active → project match → tool allowed → action type
allowed → data domain allowed → budget available → risk classification → approval token
if high-risk. Denials and executions are both logged with a machine-readable reason.
Approval tokens are single-use, bound to `(agent, tool, argument hash)` and expiring.

**v0.4 explicitly forbids** arbitrary shell, browser and network execution by agents. The
built-in tool set is pure and local.

### 4.9 Scheduler and event bus
An in-process bus with durable event persistence and typed subscriptions, plus a
scheduler that claims due jobs exactly once. Both are abstractions so a distributed
implementation can replace them without touching orchestration.

### 4.10 Telemetry
Cost and latency recorded per tool call and per provider call, aggregated by project,
agent and task.

## 5. Engineering constraints

- Standard library only — no third-party runtime dependencies, guaranteeing an offline
  local development mode.
- Small explicit modules; policy separated from business logic; provider adapters
  separated from orchestration.
- All external input validated at the boundary.
- Deny by default.
- Schema changes ship as numbered, checksum-verified migrations.
- No secrets in the repository; configuration via environment variables.

## 6. Out of scope for v0.4

Deployment, publishing, multi-node execution, real external tool adapters, streaming
provider responses, and any agent-initiated shell/browser/network access.
