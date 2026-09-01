# ARCHITECTURE_V04.md — AI Agent Factory v0.4

**Status:** implemented and measured · **Date:** 2026-09-01
**Scope:** local R&D build. Nothing is deployed. No external action is performed.

> **Read CURRENT_STATE.md first.** The v0.3 runtime the build mandate refers to
> does not exist in this repository. v0.4 is a greenfield build, and every number
> in V04_PERFORMANCE_REPORT.md is a first absolute measurement, not an
> improvement over a measured predecessor.

---

## 1. What this is

A control plane for an elastic AI workforce: a system where an agent can create,
assign, manage, review and improve other agents *under governance that the
agents themselves cannot reach*.

The organising principle is a single sentence:

> **Authority is read from stored contracts and enforced by code paths an agent
> cannot reach. Nothing an agent emits is ever an input to an authority decision.**

Everything else follows. Permissions are not prompt instructions. Budgets are not
requests. Tool access is not a callable the agent holds. Quality is not the
agent's self-assessment.

---

## 2. Layer map

```
                            ┌──────────────┐
                            │    OWNER     │  the only holder of owner-gated
                            └──────┬───────┘  capabilities
                                   │ approvals, activations
                            ┌──────┴───────┐
                            │ CHIEF (L5)   │  system-wide visibility,
                            └──────┬───────┘  governed execution authority
              ┌────────────────────┼────────────────────┐
        ┌─────┴─────┐        ┌─────┴─────┐        ┌─────┴─────┐
        │ MASTER L4 │        │ MASTER L4 │        │ MASTER L4 │  domain agents
        └─────┬─────┘        └─────┬─────┘        └─────┬─────┘
        ┌─────┴─────┐        ┌─────┴─────┐        ┌─────┴─────┐
        │ SENIOR L3 │        │ SPEC.  L2 │        │ SPEC.  L2 │
        └─────┬─────┘        └───────────┘        └───────────┘
        ┌─────┴─────┐
        │ WORKER L1 │  ephemeral, spawned on demand
        └───────────┘
```

**Level is reach, not authority.** L5 widens what an agent can *see and
coordinate*. It grants nothing. Authority comes from an explicit capability
grant, and owner-gated capabilities are unreachable for every agent principal
regardless of level (ADR-0004).

### Component layers

```
┌───────────────────────────────────────────────────────────────────┐
│ ORCHESTRATION   chief.py — decompose, gap-analyse, propose,       │
│                 delegate, monitor, recommend                       │
├───────────────────────────────────────────────────────────────────┤
│ LIFECYCLE       factory.py · registry.py · contracts/              │
│                 draft → validate → test → approve → activate       │
├───────────────────────────────────────────────────────────────────┤
│ EXECUTION       runtime.py · scheduler/queue.py · scheduler/worker │
│                 claim → govern → execute → gate → settle           │
├───────────────────────────────────────────────────────────────────┤
│ GOVERNANCE      permissions · approvals · tools/gateway ·          │
│                 budget/governor · quality/gates · quality/capa     │
├───────────────────────────────────────────────────────────────────┤
│ KNOWLEDGE       memory/layers.py (6 layers) · router/ (providers)  │
├───────────────────────────────────────────────────────────────────┤
│ PLATFORM        store/ (ports + SQLite adapter) · telemetry/ ·     │
│                 clock · ids · errors · jsonschema                  │
└───────────────────────────────────────────────────────────────────┘
```

Dependencies point strictly downward. `system.py` is the only place that wires
them together, so the dependency graph is readable in one file.

---

## 3. The execution path

Every task follows exactly this sequence. Each step can refuse, and every
refusal is audited.

```
 1. claim              atomic UPDATE...RETURNING under a lease
 2. resolve receiver   named instance, or acquire/spawn from a template
 3. derive principal   FROM THE STORED CONTRACT — never from model output
 4. reserve slot       atomic; guarded on inflight < concurrency_limit
 5. budget pre-flight  task → agent → project → system (narrowest first)
 6. assemble context   memory search, filtered in SQL by scope and trust
 7. route model        requirements → concrete provider; failover; breaker
 8. run behaviour      tools only via the gateway; delegation only via packets
 9. quality gate       PASS | REWORK | ESCALATE | REJECT
10. settle             usage ledger + budget counters
11. remember           episodic record, trust=DERIVED at best
12. release slot       floored at zero
```

Steps 3–5 are the governance envelope: authority is established from durable
state before any work happens, and capacity is reserved before any is consumed.

### Elasticity

The mandate is explicit that agent *count* is not the objective. So:

- A **contract** is a definition. 10,000 contracts are 10,000 rows.
- An **instance** is a live worker with concurrency and budget.

Packets normally target a **template**, not an instance. The factory then
reuses a warm instance with spare concurrency, or spawns one, or refuses if the
ceiling is reached. `retire_idle_instances()` reaps instances with nothing in
flight. Fleet size is therefore a function of load, and measured live instances
tracked offered load exactly at every scale tested.

---

## 4. Design decisions and their consequences

| Decision | Consequence | ADR |
|---|---|---|
| Stdlib-only core | Benchmarks run anywhere; more code owned | 0001 |
| SQLite now, PostgreSQL next | Single-writer ceiling, measured and quantified | 0002 |
| WorkPackets, not agent chat | Delegation can only narrow authority | 0003 |
| Owner-gated activation | Workforce cannot grow without a human | 0004 |
| At-least-once delivery | Duplicates made safe, not assumed away | 0005 |
| Lexical memory retrieval | Governance built first; retrieval swappable | 0006 |
| Write-behind batching | +8.4% throughput; two read hazards found | 0007 |
| Denormalised capability index | Planner search flat at 10k templates | 0008 |

---

## 5. What is real and what is stubbed

Being explicit, because a system that overstates itself is worse than a small one.

**Real, tested, measured:**
- Contract schema, validation (40+ rules), lifecycle state machine
- Registry with capability matching and duplicate detection
- Factory: full governed pipeline, elastic instancing, idle reaping
- Durable queue: leases, DAG fan-out/fan-in, retries, DLQ, idempotency,
  backpressure, deadline enforcement, crash recovery
- Capability permissions, project isolation, approval engine, single-use tokens
- Tool gateway: 11-step policy chain, R0–R5 risk classes, rate limits, audit
- Six-layer memory with trust ceilings, provenance, versioning, retention
- Model router: requirement-based selection, failover, circuit breakers
- Quality gates, four verdicts, CAPA loop with verification-before-closure
- Budget governor: reservations, ledger, spawn/depth/fan-out/tree limits
- Telemetry: events, audit trail, trace reconstruction
- 94 automated tests; benchmarks to 1,000 agents and 10,000 registry entries

**Deliberately stubbed or deferred:**
- **Model providers are mock.** Deterministic, no network. Real adapters
  implement `ModelProvider`; nothing above changes.
- **Tools are inert.** `email.send` and `cms.publish` return simulated results.
  The policy chain around them is what is being demonstrated.
- **Retrieval is lexical**, not semantic (ADR-0006).
- **`run_tests` is a structural smoke test**, not a behavioural evaluation. It
  says so in its own result payload; it must not be mistaken for a quality bar.
- **No HTTP/API surface.** `system.control_center()` returns the dashboard data
  as a dict; serving it is a later, separate concern.
- **No distributed coordination.** Workers are stateless and coordinate only
  through the store, which is what makes multi-node possible later — but
  multi-node has not been built or tested.

---

## 6. Companion documents

| Document | Covers |
|---|---|
| `CURRENT_STATE.md` | Phase 0 audit; the missing-v0.3 finding |
| `DATA_MODEL_V04.md` | Tables, indexes, and why each index exists |
| `SECURITY_MODEL.md` | Threat model, principals, capabilities, isolation |
| `AGENT_RUNTIME.md` | Execution path, scheduler, delegation, recovery |
| `MEMORY_ARCHITECTURE.md` | Six layers, trust, provenance, retention |
| `TOOL_GATEWAY.md` | Risk classes and the policy chain |
| `QUALITY_ENGINE.md` | Gates, verdicts, rework, CAPA |
| `SCALING_STRATEGY.md` | Bottlenecks and the path past them |
| `V04_PERFORMANCE_REPORT.md` | Measured results, honestly reported |
| `docs/adr/` | Eight architecture decision records |
