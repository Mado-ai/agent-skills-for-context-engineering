# AI Workforce OS v0.4 — API

Base URL `http://127.0.0.1:8787` by default. 78 routes.

**Authentication.** There is none. `x-workforce-actor-type` and
`x-workforce-actor-id` assert who is acting; nothing verifies it. Setting
`WORKFORCE_API_TOKEN` requires `Authorization: Bearer <token>` on every
request — a shared secret, not authentication. The server binds to loopback and
**refuses to bind anywhere else** without that token. See `V04_SECURITY.md` §5.

---

## Conventions

Requests are JSON objects; bodies over 1MB are refused. Responses are JSON.
Every error, from every route, has one shape:

```json
{
  "error": {
    "code": "DENIED_PROJECT_SCOPE",
    "message": "agent has no access to project prj_01ABC…",
    "details": { "checks": [ { "name": "project_scope", "passed": false, "detail": "…" } ] },
    "trace_id": "trc_01ABC…"
  }
}
```

### Status codes

| Status | Meaning | Codes |
|---|---|---|
| 200 | Success | — |
| 400 | Malformed or invalid input | `VALIDATION_FAILED`, `CONTRACT_INVALID` |
| 401 | Bearer token missing or wrong | `DENIED_DEFAULT` |
| 403 | Policy denial, or a bad approval token | `DENIED_*`, `APPROVAL_TOKEN_*` |
| 404 | No such route or entity | `NOT_FOUND` |
| 409 | State conflict | `CONFLICT`, `IMMUTABLE`, `INVALID_LIFECYCLE_TRANSITION`, `REQUIRED_TESTS_NOT_PASSED` |
| 422 | Quality failure | `QUALITY_GATE_FAILED`, `REWORK_LIMIT_EXCEEDED` |
| **428** | **Legitimate, but the Owner must decide first** | `APPROVAL_REQUIRED` |
| 429 | Budget limit | `BUDGET_SOFT_EXCEEDED`, `BUDGET_HARD_EXCEEDED` |
| 504 | Timeout | `TOOL_TIMEOUT`, `DEADLINE_EXCEEDED` |
| 500 | Unexpected | `INTERNAL` |

**428 is the interesting one.** It separates "you may not do this" from "this
needs a human", which the Control Center renders differently and which any
client should too.

---

## Health and metadata

| Route | Purpose |
|---|---|
| `GET /api/health` | Version, provider, database path, applied migrations, scheduler handlers, live counts. |
| `GET /api/routes` | Every registered route. |
| `GET /api/policy` | What the runtime enforces: owner-gated classes, owner-only and explicit-grant scopes, defaults, lifecycle, gates, secret handling. |

`/api/policy` exists so the enforced rules can be **checked rather than
assumed** — the Settings view renders it directly.

---

## Registry and agent builder

| Route | Purpose |
|---|---|
| `GET /api/registry/agents` | Filter by `status`, `role_level`, `parent_agent_id`. |
| `GET /api/registry/agents/:id` | Agent, current contract, versions, instances, children. |
| `GET /api/registry/agents/:id/versions` | Contract version history with hashes. |
| `GET /api/registry/agents/:id/instances` | Live and historical instances. |
| `GET /api/registry/graph` | The delegation graph: nodes with scope, keys, tools, access level, live instance count; plus edges. |
| `GET /api/registry/templates` | Template definitions. |
| `GET /api/registry/duplicates` | Capability-overlap pairs. |
| `POST /api/registry/agents` | Create a draft. |
| `PATCH /api/registry/agents/:id/contract` | New version; returns the agent to `draft`. |
| `POST /api/registry/agents/:id/validate` | Validation result with issues and warnings. |
| `POST /api/registry/agents/:id/test` | Required test run against the real policy engine. |
| `POST /api/registry/agents/:id/activate` | Refuses unless validation **and** tests passed. |
| `POST /api/registry/agents/:id/pause` \| `/retire` \| `/merge` | Lifecycle. |
| `POST /api/registry/agents/:id/instantiate` | Instantiate a template as this agent. |

### The activation sequence

```
POST /api/registry/agents                    → { agent, next }
POST /api/registry/agents/:id/validate       → { valid, issues[], warnings[] }
POST /api/registry/agents/:id/test           → { passed, cases[] }
POST /api/registry/agents/:id/activate       → { agent: { status: "active" } }
```

Activating early returns 409 with `CONTRACT_INVALID` or
`REQUIRED_TESTS_NOT_PASSED`, naming which gate is unmet.

---

## Projects and workflow loops

| Route | Purpose |
|---|---|
| `GET /api/projects` | Projects with budget status, loop count, open tasks. |
| `POST /api/projects` | Create. `key` is lowercase-hyphenated. |
| `GET /api/projects/:id` | Project with loops, budget, usage, tasks and in-scope agents. |
| `GET /api/loops` · `POST /api/loops` | List (optionally by project) and create. |
| `POST /api/loops/:id/status` | active \| paused \| retired. |

---

## Tasks, packets and execution

| Route | Purpose |
|---|---|
| `GET /api/tasks` · `POST /api/tasks` | List and create. |
| `GET /api/tasks/:id` | Task with packets, artifacts, evaluations, CAPA, budget and tool calls. |
| `GET /api/tasks/:id/artifacts` | The rework chain, by attempt. |
| `POST /api/tasks/:id/status` · `/escalate` | Guarded transitions. |
| `GET /api/packets` · `POST /api/packets` | List and delegate. |
| `GET /api/packets/:id` | Packet with its artifacts and child packets. |
| `POST /api/packets/:id/execute` | Execute once, delivering an artifact. |
| `POST /api/packets/:id/run` | **execute → evaluate → rework**, to a terminal state. |
| `POST /api/packets/:id/rework` · `/escalate` | Route a packet manually. |
| `GET /api/traces/:traceId` | One trace: packets, tool calls, events, usage, tasks. |

`POST /api/packets/:id/run` returns:

```json
{
  "cycles": 2,
  "outcome": {
    "action": "escalated",
    "passed": false,
    "evaluations": [ … ],
    "capa": { "capa_id": "capa_01ABC…", "issue": "…" },
    "attempt": 2
  }
}
```

`action` is `accepted`, `rework_requested` or `escalated`.

---

## Quality and CAPA

| Route | Purpose |
|---|---|
| `GET /api/quality/gates` | Gate definitions with checks and flags. |
| `GET /api/quality/evaluations` | Filter by task, project, pass/fail. |
| `POST /api/quality/evaluate` | Run one gate against one artifact. |
| `POST /api/quality/review` | Run every gate and route the task. |
| `GET /api/capa` · `POST /api/capa` · `GET /api/capa/:id` · `PATCH /api/capa/:id` | CAPA records. |

`PATCH` to `state: "closed"` returns 400 unless a root cause, both actions and
a verification result are present.

---

## Memory

| Route | Purpose |
|---|---|
| `GET /api/memory` | Without `agent_id`, the Owner's unscoped view. With `agent_id`, a scope-enforced read — an out-of-scope project returns 403. |
| `POST /api/memory` | Write. `agent_id` is **required**, so every write is attributed and scope-checked. |
| `GET /api/memory/:id` | One record with provenance and supersession links. |

---

## Tool Gateway

| Route | Purpose |
|---|---|
| `GET /api/tools` | Catalogue, each with an `owner_gated` flag. |
| `GET /api/tools/:name` | One definition. |
| `POST /api/tools/:name/status` | Enable or disable. |
| `POST /api/tools/dry-run` | Authorization preview: no execution, no side effects, same verdict. |
| `POST /api/tools/call` | Execute through the gateway. |
| `GET /api/tool-calls` | The call log; filter by trace, agent, task, decision. |

Dry-run returns the ordered checks, which is what makes a denial diagnosable:

```json
{
  "allowed": false,
  "code": "APPROVAL_REQUIRED",
  "requiresApproval": true,
  "reason": "finance.commit_payment requires an Owner approval and a valid execution token",
  "checks": [
    { "name": "agent_active", "passed": true, "detail": "agent is active" },
    { "name": "tool_in_contract", "passed": true, "detail": "finance.commit_payment is allowlisted" },
    { "name": "owner_approval", "passed": false, "detail": "no execution token supplied" }
  ]
}
```

---

## Approvals

| Route | Purpose |
|---|---|
| `GET /api/approvals` | Filter by status and project. |
| `POST /api/approvals` | Request an owner-gated action. |
| `GET /api/approvals/:id` | Approval plus token **metadata** — never a plaintext token. |
| `POST /api/approvals/:id/decide` | Approve or deny. |
| `POST /api/approvals/:id/revoke` | Revoke, invalidating outstanding tokens. |

### The full owner-gated flow

```
POST /api/tools/call                → 428 APPROVAL_REQUIRED
POST /api/approvals                 → { approval: { approval_id, args_fingerprint } }
POST /api/approvals/:id/decide      → { execution_token, token_id, expires_at, note }
POST /api/tools/call + token        → 200
POST /api/tools/call + same token   → 403 APPROVAL_TOKEN_CONSUMED
```

`execution_token` is returned **once**. Only its hash is stored; re-reading the
approval never yields it again. Replaying it against different arguments, a
different tool, or a different agent returns `APPROVAL_TOKEN_MISMATCH`.

---

## Budgets, usage and telemetry

| Route | Purpose |
|---|---|
| `GET /api/budgets` · `POST /api/budgets` | Read and define at project/agent/task scope. |
| `POST /api/budgets/pause` · `/resume` | Halt or resume spending in a scope. |
| `GET /api/usage` | Totals plus append-only usage records. |
| `GET /api/telemetry/events` | The audit log; filter by trace, kind, project, severity. |
| `GET /api/telemetry/summary` | Event counts by kind and severity, tool-call health, latency p50/p95/max. |

---

## Scheduler

| Route | Purpose |
|---|---|
| `GET /api/scheduler/jobs` | Jobs and registered handler kinds. |
| `POST /api/scheduler/tick` | Drain due jobs now. |
| `POST /api/scheduler/emit` | Fire an event key; subscribed jobs run. |
| `POST /api/scheduler/jobs/:id/cancel` | Cancel before it runs. |

---

## Chief Agent Architect

| Route | Purpose |
|---|---|
| `GET /api/chief/report` | System-wide situation report. |
| `POST /api/chief/assess` | State-derived findings. **No model call.** |
| `POST /api/chief/propose-team` | A proposal, filtered to templates this Chief may instantiate. |
| `POST /api/chief/instantiate` | Instantiate approved roles, through the gateway. |
| `POST /api/chief/delegate` | Delegate a typed packet, through the gateway. |
| `POST /api/chief/review` | Review a delivered artifact as an independent evaluator. |
| `GET /api/chief/consolidation` | Merge and retirement recommendations, with evidence. |

`assess` returns findings at three severities:

```json
{
  "findings": [
    {
      "severity": "blocker",
      "kind": "budget_exhausted",
      "message": "The project budget for hardware-lab is exhausted. New work will be refused until the Owner raises it.",
      "evidence": { "consumed": { … }, "limits": { … } }
    }
  ]
}
```

Every finding carries the evidence behind it, because a Chief that objects
without evidence is just noise.
