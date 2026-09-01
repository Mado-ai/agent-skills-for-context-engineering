# AI Agent Factory v0.4

A control plane for an elastic AI workforce: a runtime where **an agent can
create, assign, manage, review and improve other agents — under governance the
agents themselves cannot reach.**

> **Local R&D build.** Nothing is deployed. No external action is performed. No
> paid model calls are made — the benchmark suite costs $0.00 to run.

> **This is the worked implementation behind the collection's workforce-governance
> skills.** Each of those skills teaches one concept platform-agnostically and links
> here for a running version of it: agent-contracts, agent-permissions, work-packets,
> tool-governance, workforce-elasticity, quality-enforcement, cost-governance, and
> agent-observability. Read the skills for the principles; read this for the details.

---

## Start here

```bash
cd examples/agent-factory-runtime
python3 demo.py                      # end-to-end walkthrough, ~1 second
python3 -m pytest tests/ -q          # 103 tests
python3 -m bench.run_all scale       # benchmarks to 1,000 agents
python3 -m bench.registry_scale      # registry to 10,000 templates
```

No dependencies beyond Python 3.11 and `pytest` for the test suite (ADR-0001).

---

## The one idea

**Authority is read from stored contracts and enforced by code paths an agent
cannot reach. Nothing an agent emits is ever an input to an authority decision.**

A prompt instruction is a suggestion to a model. It is not a security control,
and this system never treats it as one. Permissions, budgets, tool access and
quality verdicts are all enforced by code that reads durable state.

The clearest expression of it: the Chief Agent Architect has system-wide
visibility and can plan anything — and **cannot activate an agent**, because
`agent.activate` is owner-gated and no principal of kind `agent` satisfies it at
any level, holding any grant. The Chief proposes; the owner disposes.

---

## What it does

| Capability | Where |
|---|---|
| Governed agent lifecycle (DRAFT→VALIDATION→TESTING→APPROVAL→ACTIVE) | `af/factory.py`, `af/contracts/` |
| Agent contracts: 30+ fields, 40+ validation rules, content-hashed versions | `af/contracts/schema.py` |
| Registry with capability matching and duplicate detection | `af/registry.py` |
| Durable queue: leases, DAG fan-out/fan-in, retries, DLQ, idempotency, backpressure | `af/scheduler/queue.py` |
| WorkPackets — structured delegation that can only *narrow* authority | `af/workpacket.py` |
| Capability permissions, project isolation, owner gating | `af/governance/permissions.py` |
| Owner approvals + single-use, parameter-bound execution tokens | `af/governance/approvals.py` |
| Tool gateway: R0–R5 risk classes, 11-step policy chain, full audit | `af/tools/gateway.py` |
| Six-layer memory with trust ceilings, provenance, versioning, retention | `af/memory/layers.py` |
| Provider-independent model router with failover and circuit breakers | `af/router/` |
| Quality gates (PASS/REWORK/ESCALATE/REJECT) and the CAPA loop | `af/quality/` |
| Budgets, usage ledger, spawn/depth/fan-out/tree limits | `af/budget/governor.py` |
| Events, audit trail, trace reconstruction | `af/telemetry/` |
| Chief Agent Architect | `af/chief.py` |

---

## Measured results

Full detail in **`V04_PERFORMANCE_REPORT.md`**. The short version:

**What held up.** Task-claim latency **flat at 0.14–0.18 ms p95** from 10 to
1,000 agents. Registry capability search **flat at ~0.02 ms** to 10,000
templates. Zero errors, zero lost tasks, zero double-delivery. Live instances
tracked offered load exactly.

**What did not.** Throughput **falls as workers are added** (595 tasks/s at one
worker, 376 at thirty-two) because 42.6% of wall time sits inside SQLite write
transactions and SQLite permits one writer.

**The honest headline:** *the architecture scales; the storage engine does not.*
PostgreSQL (ADR-0002) is the single change that unblocks the rest.

---

## Documentation

| Document | Covers |
|---|---|
| `CURRENT_STATE.md` | Phase 0 audit — **read first**; the assumed v0.3 baseline does not exist |
| `ARCHITECTURE_V04.md` | Layer map, execution path, what is real vs. stubbed |
| `DATA_MODEL_V04.md` | 17 tables, and why each index exists |
| `SECURITY_MODEL.md` | Threat model, principals, capabilities, isolation |
| `AGENT_RUNTIME.md` | Lifecycle, queue, recovery, delegation, elasticity |
| `MEMORY_ARCHITECTURE.md` | Six layers, trust, provenance, retention |
| `TOOL_GATEWAY.md` | Risk classes and the policy chain |
| `QUALITY_ENGINE.md` | Gates, verdicts, rework, CAPA |
| `SCALING_STRATEGY.md` | Bottleneck ladder and the path past it |
| `V04_PERFORMANCE_REPORT.md` | Measured results, reported honestly |
| `docs/adr/` | Eight architecture decision records |

---

## Layout

```
af/
  contracts/   schema, validation, lifecycle state machine
  store/       migrations, SQLite adapter, write-behind batcher
  scheduler/   durable queue, worker pool
  governance/  capability permissions, approvals, execution tokens
  tools/       gateway, risk classes, reference catalogue
  memory/      six-layer memory with trust and provenance
  router/      model router, provider port, deterministic mock
  quality/     gates, verdicts, CAPA
  budget/      budgets, ledger, blast-radius limits
  telemetry/   events, audit, tracing
  factory.py   governed agent lifecycle
  registry.py  the catalogue
  runtime.py   the execution path
  chief.py     Chief Agent Architect
  system.py    composition root
tests/         103 tests
bench/         benchmark harness and results
```

---

## Honest limitations

Stated plainly, because a system that overstates itself is worse than a small
one that does not:

- **Model providers are mock.** Deterministic, no network. Real adapters
  implement `ModelProvider`; nothing above that port changes.
- **Tools are inert.** `email.send` and `cms.publish` simulate. The *policy
  chain* around them is what is demonstrated.
- **Memory retrieval is lexical**, not semantic (ADR-0006). Paraphrases are missed.
- **`run_tests` is a structural smoke test**, not a behavioural evaluation. Its
  own output says so.
- **Multi-node is untested.** Workers are stateless by design, but that is a
  property, not a measurement.
- **No HTTP API.** `system.control_center()` returns the dashboard data as a dict.
- **Event volume has no retention policy yet** (~23 KB/task).
