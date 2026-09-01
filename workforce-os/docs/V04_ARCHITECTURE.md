# AI Workforce OS v0.4 — Architecture

This is a **pre-production build**. It is not deployed, and it is not ready to
be. What it is: a runtime where the governance is real — enforced in code,
recorded in an append-only log, and covered by tests that fail when it breaks.

---

## 1. What this build actually is

Four claims, each of which you can check:

1. **Agents are first-class runtime objects.** An agent is a validated,
   versioned contract. Nothing about what an agent may do lives anywhere else —
   not in configuration, not in a prompt, not in a hardcoded branch.
2. **Authorization has exactly one implementation.** Every tool call in the
   system passes through `authorizeToolCall` in `src/policy/engine.ts`. There
   is no second path and no bypass, including for the Chief.
3. **Owner authority is not delegable.** No agent holds Owner access level. An
   owner-gated action reaches execution only with a token the Owner minted for
   that exact action, arguments, actor and project — single-use, short-lived,
   stored only as a hash.
4. **Quality gating is deterministic by default.** A gate's verdict comes from
   stored state, not from a model. The model evaluator exists, is separated
   out, and is used only where a gate asks for it.

What it is **not**: production-hardened. See `V04_SECURITY.md` for the full
list of blockers, starting with the absence of Owner authentication.

---

## 2. The hierarchy

```
OWNER
  └── Chief Agent Architect        system-wide visibility; admin, never owner
        ├── Operations Master      one project each; write access
        ├── Content Master
        └── Hardware Master
              └── Specialists      instantiated on demand, retired when idle
                    └── Ephemeral  sub-agents, task-scoped
```

Authority narrows on the way down, and the narrowing is enforced in two places:
contract validation refuses a child that claims more than its parent
(`src/registry/validation.ts`), and the delegation runtime refuses a packet
carrying more than its sender holds (`src/delegation/service.ts`).

The Chief is the only agent with `project_scope.all_projects`. That is checked
as an invariant, not a convention — `validateContract` rejects it for anyone
else, and a test asserts it holds across the whole registry.

---

## 3. Layer map

```
                        ┌───────────────────────────────┐
                        │  Control Center (15 views)    │
                        └───────────────┬───────────────┘
                                        │ HTTP, one error envelope
                        ┌───────────────▼───────────────┐
                        │  API — src/api                │
                        └───────────────┬───────────────┘
                                        │
   ┌───────────┬───────────┬────────────┼───────────┬────────────┬───────────┐
   │ registry  │ delegation│ execution  │ quality   │ memory     │ chief     │
   │ contracts │ packets   │ run loop   │ gates     │ 4 layers   │ analysis  │
   │ lifecycle │ instances │ artifacts  │ CAPA      │ provenance │ proposals │
   └─────┬─────┴─────┬─────┴─────┬──────┴─────┬─────┴──────┬─────┴─────┬─────┘
         │           │           │            │            │           │
         └───────────┴───────────┴──────┬─────┴────────────┴───────────┘
                                        │  every tool call, no exceptions
                        ┌───────────────▼───────────────┐
                        │  Tool Gateway — src/gateway   │
                        │  schema · policy · audit      │
                        └───────────────┬───────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
     ┌────────▼────────┐      ┌─────────▼────────┐      ┌─────────▼────────┐
     │ Policy engine   │      │ Approvals        │      │ Budgets          │
     │ default deny    │      │ exact-action     │      │ project/agent/   │
     │ ordered checks  │      │ tokens           │      │ task             │
     └─────────────────┘      └──────────────────┘      └──────────────────┘
              │                         │                         │
              └─────────────────────────┼─────────────────────────┘
                        ┌───────────────▼───────────────┐
                        │  Persistence — node:sqlite    │
                        │  versioned migrations         │
                        │  append-only audit surfaces   │
                        └───────────────────────────────┘
```

`src/runtime.ts` is the composition root. Nothing constructs its own
dependencies, which is what lets a test stand up a complete isolated system
against an in-memory database in one call.

Two cycles are broken by deferring lookup to call time rather than construction
time: the gateway needs the registry for activation testing while the registry
needs the gateway to dry-run authorize, and tool handlers need the finished
runtime.

---

## 4. The agent contract

`src/domain/agent.ts`. The contract is the whole of an agent's definition:
identity and role, mission, owned loops, parent and permitted child templates,
project and data scope, allowed tools and forbidden actions, access level,
input/output schemas, persona, required knowledge sources, memory policy,
budget policy, time limits, KPIs, quality gates, escalation rules, rework
policy, human-approval requirements, concurrency limit and activation mode.

Contracts are **immutable and versioned**. A revision writes a new version and
returns the agent to `draft`, so a permission change cannot slip into a running
agent. Migration 002 backs that with a trigger; a test asserts it.

### Lifecycle

```
draft → validated → testing → approved → active → paused → merged/retired
```

`activate()` refuses unless the current version has **both** a passing
validation and a passing test run on record. The test run is not a formality:
it exercises the real policy engine through `dryRunAuthorize` — every
allowlisted tool must resolve to a decision the runtime understands, and the
negative cases (an unlisted tool, an out-of-scope project, each forbidden
action) must actually deny. An agent whose contract looks fine but whose
denials do not fire cannot be activated.

### Definitions vs. instances

A **definition** is a registered agent; an **instance** is a running one. A
definition with no work has zero instances. This is what makes 1,000+
specialist definitions tractable: the count that matters is live instances,
bounded by `concurrency_limit` per agent and by `concurrency_limit × 10`
children per parent, and reaped when idle past the contract timeout.

---

## 5. WorkPackets

Free-form agent-to-agent chat is deliberately not a control mechanism. Work
moves as a typed `WorkPacket` carrying its own authority bounds: intent,
objective, context refs, input payload, allowed tools, data scope, expected
output schema, acceptance criteria, quality gates, priority, budget, deadline,
TTL, escalation target and status.

```
created → dispatched → accepted → in_progress → delivered
                                                    │
                    ┌───────────────────────────────┼──────────────┐
                    ▼                               ▼              ▼
             accepted_final                 rework_requested    escalated
                                                    │
                                                    └──→ in_progress
```

Escalation is reachable from every live state — a packet the receiver cannot
afford to start must escalate rather than expire silently. (That gap was a real
bug the budget tests found; the lifecycle error was masking the budget denial.)

`allowed_tools` on a packet **narrows** and never widens: the effective set is
the intersection of the sender's contract, the receiver's contract and the
packet.

---

## 6. Memory

Four layers, ordered by precedence:

| Layer | Holds | Written by |
|---|---|---|
| `authoritative` | verified policy, approved standards, canonical facts | humans, or an agent with a granted Owner approval |
| `project` | reusable project knowledge and decisions | agents with the layer in `writable_layers` |
| `episodic` | past tasks, events, results | agents |
| `working` | short-lived execution context, TTL-swept | agents |

Every record carries scope, source, provenance, confidence (if inferred),
timestamps, supersession links, TTL and an authoritative flag.

The rule that matters: **an agent cannot launder an inference into a fact.**
An authoritative write needs the contract grant *and* provenance that is either
human-sourced or references a granted Owner approval. A privileged agent
writing from its own inference is refused with `DENIED_FORBIDDEN_ACTION`.

Reads are scope-bound at the repository, not filtered by the caller. Asking for
a project you do not hold is a denial, not an empty list — silence would hide a
misconfiguration.

---

## 7. The quality loop

```
execute → evaluate → pass ──────────────────→ accepted
                       │
                     fail
                       │
              attempt < max ──→ rework ──→ execute
                       │
              attempt = max ──→ CAPA + escalate
```

Gates are data, not code paths: a gate names its checks, threshold, whether it
blocks, and whether it demands separation of duties. Six checks ship:
`schema`, `acceptance_criteria`, `evidence`, `permission_compliance`,
`duplication` and `model_evaluator`. The first five are deterministic.

A criterion nobody can check automatically does not silently pass — a `manual`
criterion evaluates to *not passed* and needs a model or human evaluator.

Repeated failure opens a CAPA record. A CAPA cannot be **closed** without a
root cause, both actions, and a verification result; the runtime refuses the
transition rather than accepting an empty record.

---

## 8. The Tool Gateway

Every call, in order:

1. Resolve agent, contract, tool and packet.
2. **Authorize** (`src/policy/engine.ts`) — see below.
3. Validate arguments against the schema the *database* declares.
4. Consume the approval token, if one is in play. Single-use is enforced by a
   conditional UPDATE, so two concurrent calls holding one token race and
   exactly one wins.
5. Execute the handler under the tool's declared timeout.
6. Validate the output against its declared schema.
7. Settle the call row, record usage against every enclosing budget, audit.

Authorization comes **before** schema validation, deliberately: a caller with
no right to a tool is refused before it learns anything about that tool's
shape.

The ordered checks, each recorded on the decision so a denial can say which
rule fired: agent active → tool registered, enabled, allowlisted → not
forbidden → project scope → data scope → access level → concurrency → risk and
Owner approval → budget. Default is deny; a request is allowed only when every
check passes.

One rule constrains handlers themselves: the gateway authorizes against the
project on the *request*, so a handler that resolves a different project from
its own arguments must re-check scope for it. `requireProjectScope` in
`handlers.ts` exists for that, and every handler that resolves an entity from
arguments routes through it.

**No shell, filesystem-write, or arbitrary-code tool is registered.** v0.4
runtime agents have no route to a shell, and a test enumerates the catalogue to
keep it that way.

---

## 9. Approvals and execution tokens

An agent may *request* any owner-gated action. Execution requires a token the
Owner minted, bound by fingerprint to:

```
sha256(canonical_json({ action, tool_name, args, actor_agent_id, project_id }))
```

Canonical JSON sorts keys at every depth, so reordering arguments does not
change the fingerprint and changing any value does.

A token is single-use, short-lived (default 300s), and stored only as a
SHA-256 hash — the plaintext is returned once, to the approver, and never
again. Every failure mode is a distinct code, so the audit trail distinguishes
a replay against different arguments (`APPROVAL_TOKEN_MISMATCH`) from an
expiry (`APPROVAL_TOKEN_EXPIRED`) from a second use
(`APPROVAL_TOKEN_CONSUMED`).

An Owner token does not buy everything. `policy.update` still refuses an agent
targeting its own contract, with `DENIED_SELF_MUTATION`.

---

## 10. Budgets, scheduler, telemetry

**Budgets** exist at project, agent and task level and track model calls,
tokens, estimated cost, tool calls, executions, retries and elapsed time. The
check is pre-flight — a call that *would* cross a hard limit is refused before
it runs. The most restrictive enclosing scope wins: a generous project budget
cannot rescue an agent that has spent its own. A hard limit pauses and
escalates; it never continues quietly.

**Scheduler**: durable jobs in a table, claimed by conditional UPDATE so two
workers cannot run the same job. Supports one-shot, interval and
event-triggered work. The surface (`enqueue`, `every`, `on`, `emit`, `tick`) is
deliberately narrow because it is meant to be replaced by SQS, Temporal or
pg-boss without touching a caller.

**Telemetry**: `events` is append-only. The audit interface exposes exactly
`append` and `list` — no update, no delete — and migration 002 enforces the
same at the database level. `tool_calls` permits exactly one settle while the
row is still in `requested` phase; anything later is refused.

---

## 11. The Chief Agent Architect

Two design choices carry the behaviour the brief asks for:

**Its skepticism is mechanical.** `chief.assess()` derives findings from
registry, budget, quality and approval state — unknown or inactive project,
unresolved escalations, open CAPA, exhausted or missing budget, duplicate
capability, pending approvals, permission friction, a too-thin objective,
agents stuck pre-activation. It makes no model call at all. A model having an
agreeable day cannot make a duplicate agent or a blown budget disappear.

**It has no privileged path.** Delegation and instantiation run through the
Tool Gateway on the Chief's own contract. `proposeTeam()` consults the provider
but filters every suggested role against what this Chief may actually
instantiate, so a hallucinated template never reaches the Owner as an option —
and the filtering is itself reported as a finding.

---

## 12. Model provider

`src/llm/provider.ts` defines the interface. `DeterministicMockProvider` is
the default and the only one the test suite uses: same request in, same
response out, no network, no clock dependence. `AnthropicProvider` is a thin
adapter over the official SDK (an optional dependency, imported lazily) and is
**not exercised by the test suite** — it needs a real API key.

The entire build, including every test, runs offline.

---

## 13. Deliberate limitations

Stated here rather than discovered later:

- **No authentication.** The acting identity is a header. Loopback-only bind is
  the mitigation, not a solution.
- **Owner-gated effects are simulated.** The governance around
  `finance.commit_payment` and its siblings is real — request, approval, exact
  -action token, audit — but the external effect is a no-op that returns
  `simulated: true`.
- **SQLite, single process.** Fine for development; the schema and SQL are kept
  portable, and `V04_DATA_MODEL.md` documents the PostgreSQL path.
- **Interval scheduling, not cron.** `schedule_expr` holds milliseconds. The
  field is there so a cron parser is a local change.
- **No egress.** `http.fetch` is registered and disabled.
