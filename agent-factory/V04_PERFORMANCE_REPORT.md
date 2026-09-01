# V04_PERFORMANCE_REPORT.md

**AI Agent Factory v0.4 — measured results**  
**Date:** 2026-09-01 · **Status:** local R&D. Nothing deployed. No external action performed.

---

## Executive summary

v0.4 is a **greenfield build**. The v0.3 runtime the mandate refers to does not
exist in this repository (see `CURRENT_STATE.md` §0, verified across the working
tree and both branches' full history). Every number below is a first absolute
measurement, **not** an improvement over a measured predecessor.

All 20 Definition-of-Done criteria are met and are executed as tests
(`tests/test_definition_of_done.py`). 94 automated tests pass. Benchmarks ran to
1,000 live agents / 10,000 tasks and to 10,000 registry entries.

**What held up.** The control plane's data structures do not degrade with scale.
Task-claim latency was **flat at 0.14–0.18 ms p95** from 10 to 1,000 agents — a
20× increase in table size with no measurable change. Registry capability search
is **flat at ~0.02 ms** to 10,000 templates. Error rate was **0.0** in every
non-fault-injected scenario, with zero tasks lost or double-delivered.

**What did not.** Throughput **falls as workers are added** — 595 tasks/s at one
worker, 376 at thirty-two, with p99 execution latency growing 58× (11 ms → 638 ms).
This is SQLite's single-writer lock, not the runtime architecture: profiling shows
**42.6% of single-threaded wall time inside write transactions**, which caps
parallel speedup at ~2.3× by Amdahl's law before contention is even counted.

**The honest headline:** *the architecture scales; the storage engine does not.*
PostgreSQL (ADR-0002) is the single change that unblocks the rest, and until it
lands the safe operating point is **4–8 workers at ~370–600 tasks/s**.

One further result worth stating up front: with a realistic model provider
(~900 ms latency, 100 concurrent requests), the provider ceiling is ~110 tasks/s —
**below** the current control-plane throughput. For model-backed workloads the
provider binds first, and the control plane's job is to be reliable and cheap
rather than maximally fast.

---

## Architecture tested

Full stack, no components stubbed out of the measured path: governed contract
lifecycle, elastic instancing, durable leased queue with DAG dependencies,
capability permissions, project isolation, tool gateway policy chain, budget
reservations and ledger, four-verdict quality gates, six-layer memory, model
router, and full event/audit telemetry.

**Model calls are excluded deliberately.** Benchmarks use `DeterministicBehaviour`
so that `tasks/second` measures the control plane rather than provider latency.
The mandate is explicit that control-plane scalability and provider scalability
are different ceilings; conflating them would make every number here meaningless.

---

## Test environment

```
platform   Linux-6.18.44-fc-v22-x86_64-with-glibc2.39
cpu        4 vCPU (x86_64)
memory     16 GB
python     3.11.15
sqlite     3.45.1   (WAL, synchronous=NORMAL, 64 MB cache)
process    single process, thread-backed workers
providers  deterministic mock — zero network calls, zero cost
```

Reproduce: `python3 -m bench.run_all all` and `python3 -m bench.registry_scale`.
Raw output: `bench/results.json`.

---

## Benchmark results

### Scale sweep — 8 workers, tasks scaled with fleet size

| Agents | Tasks | Throughput | Exec time | Queue p50 | Queue p95 | Exec p50 | Exec p95 | Exec p99 |
|---|---|---|---|---|---|---|---|---|
| 10 | 500 | **506.64 /s** | 0.987 s | 431 ms | 832 ms | 7.211 ms | 43.85 ms | 92.213 ms |
| 50 | 1,000 | **564.24 /s** | 1.772 s | 841 ms | 1603 ms | 6.832 ms | 41.373 ms | 83.832 ms |
| 100 | 2,000 | **502.38 /s** | 3.981 s | 1865 ms | 3689 ms | 8.545 ms | 53.217 ms | 110.665 ms |
| 250 | 2,500 | **461.28 /s** | 5.42 s | 2529 ms | 4998 ms | 9.299 ms | 57.684 ms | 121.988 ms |
| 500 | 5,000 | **436.18 /s** | 11.463 s | 5471 ms | 10560 ms | 11.114 ms | 56.766 ms | 108.131 ms |
| 1000 | 10,000 | **372.94 /s** | 26.814 s | 12639 ms | 24992 ms | 14.912 ms | 57.327 ms | 114.47 ms |

| Agents | Claim p95 | DB write p95 | Peak RSS | DB size | Events/task | Errors | Live instances |
|---|---|---|---|---|---|---|---|
| 10 | **0.14 ms** | 0.064 ms | 35.9 MB | 16.8 MB | 7.53 | 0.0 | 11 |
| 50 | **0.165 ms** | 0.059 ms | 42.7 MB | 16.41 MB | 7.51 | 0.0 | 52 |
| 100 | **0.142 ms** | 0.067 ms | 55.5 MB | 27.74 MB | 7.4 | 0.0 | 100 |
| 250 | **0.159 ms** | 0.069 ms | 70.4 MB | 42.82 MB | 7.68 | 0.0 | 250 |
| 500 | **0.14 ms** | 0.068 ms | 129.8 MB | 112.5 MB | 7.64 | 0.0 | 500 |
| 1000 | **0.154 ms** | 0.07 ms | 291.9 MB | 233.07 MB | 7.62 | 0.0 | 1000 |

**Reading these numbers:**

- **Claim p95 is flat** (0.140 → 0.154 ms across a 20× table-size increase). The
  partial index on `(priority, available_at, id) WHERE status='READY'` holds. This
  is the single most important positive result: the queue does not degrade.
- **Throughput declines 507 → 373 tasks/s** (10 → 1,000 agents, −26%). Not the
  claim path — see the worker sweep below for the cause.
- **Queue p50 grows linearly** (431 ms → 12,639 ms). This is *expected and not a
  defect*: with a fixed drain rate and a 20× larger backlog submitted up front,
  wait time is backlog ÷ throughput. It measures the batch shape, not a slowdown.
- **Error rate 0.0 everywhere.** No task lost, none double-delivered.
- **Live instances track offered load exactly** (11 → 1,000). Elasticity works.
- **Memory ~0.29 MB per live instance.** 1,000 instances cost 292 MB.

### Worker sweep — 100 agents, 2,000 tasks *(the important result)*

| Workers | Throughput | Exec p50 | Exec p95 | Exec p99 | Claim p95 |
|---|---|---|---|---|---|
| 1 | **595.23 /s** | 1.295 ms | 2.214 ms | 11.21 ms | 0.152 ms |
| 2 | **562.59 /s** | 2.901 ms | 8.188 ms | 13.34 ms | 0.127 ms |
| 4 | **528.19 /s** | 4.734 ms | 21.852 ms | 41.693 ms | 0.138 ms |
| 8 | **509.13 /s** | 7.969 ms | 59.166 ms | 107.67 ms | 0.184 ms |
| 16 | **387.72 /s** | 18.836 ms | 125.496 ms | 257.059 ms | 0.156 ms |
| 32 | **375.74 /s** | 38.661 ms | 255.909 ms | 638.031 ms | 0.156 ms |

**Adding workers makes throughput worse.** 595 → 376 tasks/s from 1 to 32 workers,
while p99 execution latency grows from 11 ms to 638 ms — a 58× increase. Rising
latency with falling throughput is the signature of **lock contention**, not of
resource saturation. Claim latency stays flat throughout, which locates the
contention in the write path rather than in the queue.

### Work shapes — 100 agents, 1,000 tasks, 8 workers

| Shape | Throughput | Events/task | Error rate | Notes |
|---|---|---|---|---|
| with 2 tool calls/task | 368.26 /s | 9.81 | 0.0 | final depth 0 |
| with CPU work | 349.84 /s | 7.81 | 0.0 | final depth 0 |
| 10% failure injection | 395.44 /s | 7.51 | 0.16698 | final depth 102 |

Two gateway-mediated tool calls per task cost ~28% throughput and add 2.4
events/task — the price of auditing every call, and it is the intended trade.
Under 10% injected failure the observed error rate is 16.7% (failures consume
retry attempts, so a 10% per-attempt rate yields more failed *executions*), and
102 tasks correctly terminate in the dead-letter queue rather than looping.

### Registry scale

| Templates | Capability search p95 | List page p95 | Duplicate scan p95 | Overview p95 | DB size |
|---|---|---|---|---|---|
| 100 | **0.021 ms** | 1.299 ms | 0.122 ms | 0.061 ms | 0.88 MB |
| 1,000 | **0.019 ms** | 1.151 ms | 1.251 ms | 0.378 ms | 10.03 MB |
| 5,000 | **0.026 ms** | 1.188 ms | 7.729 ms | 1.965 ms | 47.3 MB |
| 10,000 | **0.02 ms** | 1.097 ms | 11.76 ms | 3.399 ms | 93.93 MB |

Capability search and keyset-paginated listing are **flat to 10,000 templates**.
Duplicate scan is O(n) but cheap and is a periodic maintenance query, not a hot path.

### Governed agent creation

| Agents created | Wall time | Rate |
|---|---|---|
| 10 | 0.017 s | 588.87 contracts/s |
| 50 | 0.121 s | 411.76 contracts/s |
| 100 | 0.196 s | 511.2 contracts/s |
| 250 | 0.518 s | 482.16 contracts/s |
| 500 | 1.055 s | 474.1 contracts/s |
| 1,000 | 2.127 s | 470.24 contracts/s |

Each of these runs the **full governed pipeline** — DRAFT → VALIDATION (40+ rules)
→ TESTING → APPROVAL → ACTIVE with owner authorisation and re-validation. ~470–590
contracts/s means agent creation is not a bottleneck at any plausible fleet size.

---

## Bottlenecks

### 1. SQLite single-writer lock — the binding constraint

Profiled on the single-threaded path:

```
write transactions per task                6.17   (7.16 before batching)
share of wall time inside write txns      42.6%   (46.1% before batching)
```

SQLite permits one writer. With 42.6% of work serialised, Amdahl's law caps
parallel speedup at ~2.3× before contention; past that, added workers queue on the
lock and contend for the GIL, and the net is negative — exactly what the sweep shows.

The remaining 6.17 transactions are the **unbatchable** ones: concurrency
reservation, budget counters, task status, instance release, and buffered event
flush. Each must be immediately durable or a correctness property breaks
(ADR-0007 lists which). They cannot be optimised away on a single-writer store.

**Fix: PostgreSQL** (ADR-0002). Not measured — stated as the next step, not as a result.

### 2. Event volume

233 MB for 10,000 tasks (~23 KB/task, 7.6 events/task). At 1M tasks/day that is
~23 GB/day. Needs time partitioning and category-differentiated retention before
any sustained run.

### 3. Capability search *(found and fixed)*

Was O(contracts) — it loaded and JSON-parsed every ACTIVE contract:

| Templates | Before | After |
|---|---|---|
| 100 | 2.1 ms | 0.021 ms |
| 1,000 | 21.3 ms | 0.019 ms |
| 5,000 | 110.4 ms | 0.026 ms |
| 10,000 | **210.5 ms** | **0.020 ms** |

The Chief runs this on every planning cycle, so at the mandate's 10,000-agent
target the *planner* would have become the bottleneck before the runtime — and
invisibly, since nothing fails, the Chief just gets slow. Fixed with a
denormalised indexed capability table (ADR-0008): ~10,000× at 10k templates, and
**flat rather than linear**, which was the point.

---

## Failure modes found

Found by building and testing, not by inspection. Each is now regression-tested.

| # | Failure | Impact | Resolution |
|---|---|---|---|
| 1 | `RETURNING` does not preserve the subquery's `ORDER BY` | A worker would dispatch a BACKGROUND task before a CRITICAL one | Re-sort each claimed batch (≤ `limit` rows) |
| 2 | Deferred transactions deadlocked under concurrent read-then-write | 'database is locked' *after doing real work* | `BEGIN IMMEDIATE` on every write transaction |
| 3 | Validator's gate list drifted from the engine's gate registry | `completeness` was implemented but rejected, silently blocking every contract using it | Derive `VALID_GATES` from `BUILTIN_GATES` — one source of truth |
| 4 | Default `max_spawn_depth=3` failed the validator for default L2 agents | A contract nobody tuned could not be activated | Default lowered to 1; safe-by-default, coordinators opt up |
| 5 | Write-behind batching silently emptied rework feedback | Reworks ran **blind**, without the findings meant to fix them. Nothing failed — the work just got worse | Route through the flush-on-read accessor |
| 6 | The fix for #5 flushed on *every* task | Cancelled the batching entirely; measured gain was exactly zero | Fetch feedback only on attempts > 1 |
| 7 | `Finding` used `slots=True` but was serialised via `__dict__` | Validation reports crashed on persist | Use `dataclasses.asdict` |
| 8 | Benchmark behaviour sent wrong-shaped tool arguments | Scenario measured the *rejection* path at 0 tasks/s | Per-tool argument table + a constructor guard |

**#5 and #6 are the ones worth remembering.** Neither surfaced as an error;
one degraded output quality invisibly, the other made an optimisation
no-op while looking correct. Every write-behind buffer creates a read hazard
for its own table, and the natural fix for that hazard can silently undo the
optimisation. Both were caught by tests, not by review.

**#8 is a positive result in disguise:** the gateway correctly rejected malformed
model-supplied arguments. The benchmark was wrong, not the runtime.

---

## Fixes implemented

| Fix | Measured effect |
|---|---|
| Capability index (ADR-0008) | 210 ms → 0.02 ms at 10k templates; O(n) → flat |
| Write-behind batching (ADR-0007) | 7.16 → 6.17 write txns/task; +8.4% single-threaded (740 → 802 tasks/s) |
| `BEGIN IMMEDIATE` transactions | Eliminated deadlocks under concurrent claims |
| Claim index column order | Claim latency flat instead of growing with queue depth |
| Batch submission (`submit_many`) | One transaction per 500 packets instead of 500 |
| Safe-by-default spawn depth | Default contracts now validate |
| Single-source gate vocabulary | Removes an entire class of drift bug |

Batching's honest assessment: **real but modest**, and it does not change the
conclusion. The remaining transactions are structural on a single-writer store.

---

## Remaining risks

| Risk | Severity | Status |
|---|---|---|
| SQLite write lock caps throughput and punishes concurrency | **High** | Understood, quantified, fix specified (ADR-0002), not implemented |
| Event volume unbounded (~23 KB/task) | **High** | No retention policy implemented; partitioning designed only |
| Multi-node never tested | Medium | Workers are stateless by design, but this is a projection |
| Project isolation enforced in application code | Medium | Correct and tested; belongs in PostgreSQL RLS |
| Model providers are mock | Medium | Real adapters unwritten; provider ceiling is a calculation, not a measurement |
| `run_tests` is a smoke test, not a behavioural eval | Medium | Labelled as such in its own output |
| Lexical memory retrieval only | Medium | Deliberate (ADR-0006); misses paraphrases |
| No LLM-as-judge / peer review gate | Medium | `reviewer_type` modelled but not implemented |
| Hand-written JSON Schema subset | Low | No `$ref`/`allOf`/`anyOf`; swap when a driver is added |
| Maintenance sweeps are single-instance | Low | Needs leader election for multi-node |
| Project count not scale-tested | Low | Isolation correct; volume behaviour unknown |

---

## Maximum safe current scale

| Dimension | Safe today | Limited by |
|---|---|---|
| Agent definitions (contracts) | **10,000+** | Nothing observed — reads flat |
| Live agent instances | **1,000** (tested) | Memory, ~0.29 MB each |
| Task throughput | **~370–600 tasks/s** | SQLite single writer |
| Concurrent workers | **4–8** (more is counterproductive) | SQLite single writer |
| Governed agent creation | **~470–590 contracts/s** | Not a bottleneck |
| Task history | ~10,000 before a size review | Event volume |
| Deployment topology | **Single node only** | Multi-node untested |

Stated plainly: **v0.4 is sound for a single-node deployment at moderate
throughput. It is not yet ready for the mandate's multi-business target**, and
the gap is storage, not architecture.

---

## Recommended next architecture

1. **PostgreSQL** (ADR-0002). The one change that unblocks everything else.
   `SELECT ... FOR UPDATE SKIP LOCKED` for claims, RLS for isolation, native
   partitioning for events. Re-run this exact benchmark suite afterwards — the
   projected 2,000–5,000 tasks/s is an estimate and must be verified.
2. **Event retention.** Time partitioning plus category-differentiated retention
   (audit for years, runtime for weeks). Required before any sustained run.
3. **Multi-node workers.** Already stateless; needs a connection pool and leader
   election for the maintenance sweeps.
4. **A real provider adapter**, so provider-side limits become measurements
   rather than calculations.

Deliberately *not* recommended yet: a separate queue broker, microservice
decomposition, or a distributed SQL engine. Each solves a problem this system
does not yet have, and none addresses the measured bottleneck.

---

## v0.5 priorities

1. PostgreSQL migration + re-benchmark **(unblocks everything)**
2. Event retention and partitioning **(prevents unbounded growth)**
3. Real model provider adapter + provider-limit benchmarks
4. Multi-node worker deployment and test
5. PostgreSQL RLS for project isolation (move enforcement below the app)
6. Semantic memory retrieval behind the existing `search()` port (ADR-0006)
7. LLM-as-judge and peer-review quality gates
8. Behavioural agent evaluation to replace the `run_tests` smoke test
9. Control Center HTTP API over `system.control_center()`
10. Chaos testing: kill workers mid-flight, partition the store, exhaust disk

---

## Definition of Done

All 20 criteria met and executed as tests in `tests/test_definition_of_done.py`.

| # | Criterion | Test |
|---|---|---|
| 1 | Chief can inspect the registry | `test_01` |
| 2 | Chief detects a missing capability | `test_02` |
| 3 | Chief creates/proposes a Specialist contract | `test_03_04` |
| 4 | Contract validation occurs | `test_03_04 / test_04b` |
| 5 | Agent instantiated under defined limits | `test_05` |
| 6 | Parent delegates a structured task | `test_06_to_12` |
| 7 | Agent executes with scoped tools/context | `test_06_to_12` |
| 8 | Output passes a Quality Gate | `test_06_to_12` |
| 9 | Failed output enters REWORK | `test_09` |
| 10 | Successful output returns to parent | `test_06_to_12` |
| 11 | Complete trace exists | `test_06_to_12` |
| 12 | Cost/resource telemetry exists | `test_06_to_12` |
| 13 | Permissions cannot be bypassed | `test_13` |
| 14 | Owner-gated actions protected | `test_14 (×6)` |
| 15 | Multiple projects isolated | `test_15` |
| 16 | Runtime has automated tests | `94 tests` |
| 17 | Benchmark suite exists | `bench/` |
| 18 | 1,000-agent simulation attempted and measured | `scale sweep` |
| 19 | Bottlenecks documented honestly | `this report` |
| 20 | No deployment occurred | `test_20` |

---

## Method notes

- Percentiles are **nearest-rank**, not interpolated. With small samples an
  interpolating percentile reports values that were never observed.
- Each scenario runs in a **fresh process**; `ru_maxrss` is a lifetime peak, so
  sequential runs would attribute the largest scenario's memory to all later ones.
- `ANALYZE` is run after bulk load so the planner has statistics — without it
  SQLite can choose a scan over `idx_tasks_claim` on a cold table.
- Claim latency is measured **after** the drain, against the full task history,
  which is where index degradation would show if it existed.
- Zero paid model calls were made. Total cost of this benchmark suite: **$0.00**.
