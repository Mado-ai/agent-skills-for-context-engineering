# SCALING_STRATEGY.md

Everything here is grounded in `bench/results.json`. Where a claim is a
projection rather than a measurement, it says so.

---

## 1. What was measured, and what it means

**Test environment:** 4 vCPU, 16 GB, Linux 6.18, Python 3.11.15, SQLite 3.45.1,
single process, thread-backed workers, deterministic (zero-model) behaviour.

### The claim path does not degrade

| Scale | Claim p95 | Write p95 |
|---|---|---|
| 10 agents / 500 tasks | 0.140 ms | 0.064 ms |
| 100 agents / 2,000 tasks | 0.142 ms | 0.067 ms |
| 1,000 agents / 10,000 tasks | **0.154 ms** | 0.070 ms |

Flat across a 20× increase in table size. `idx_tasks_claim` is doing its job.
**The control plane's data structures are not the bottleneck.**

### Throughput falls as workers are added

| Workers | Throughput | Execution p99 |
|---|---|---|
| 1 | **595 tasks/s** | 11 ms |
| 4 | 528 tasks/s | 42 ms |
| 8 | 509 tasks/s | 108 ms |
| 16 | 388 tasks/s | 257 ms |
| 32 | **376 tasks/s** | **638 ms** |

Negative scaling, with p99 latency growing 58× — the signature of lock
contention, not of saturation. This is the headline result.

### Why

Profiling the single-threaded path:

- **6.17 write transactions per task** (7.16 before batching)
- **42.6% of wall time inside write transactions**

SQLite permits one writer. With 42.6% of the work already serialised, Amdahl's
law caps parallel speedup at ~2.3× *before* accounting for contention; adding
workers past that adds queueing on the lock and GIL contention, and the net is
negative.

**This is a property of the storage engine, not of the runtime architecture.**
The distinction matters: the queue, the governance chain, the telemetry and the
indexes all held up. The writer did not.

---

## 2. The bottleneck ladder

Addressed in order. Each step is only worth taking once the one above it is
resolved.

### Tier 1 — SQLite single-writer *(current ceiling)*

**Measured limit:** ~600 tasks/s single worker, ~370 at 8+ workers, and adding
hardware does not help.

**Fix: PostgreSQL** (ADR-0002). MVCC gives concurrent writers; the claim becomes
`SELECT ... FOR UPDATE SKIP LOCKED`, which is its natural form and scales to many
concurrent claimers without a global lock.

**Projected**, not measured: the 42.6% serialised fraction becomes largely
parallel, so throughput should scale with workers up to the connection-pool and
IO limits. A realistic first target is 2,000–5,000 tasks/s on a single well-sized
PostgreSQL instance. **This number is an estimate and must be re-measured before
it is relied on.**

### Tier 2 — Event volume

**Measured:** 7.6 events/task, ~23 KB/task, **233 MB for 10,000 tasks**.

At 1M tasks/day that is ~23 GB/day. The dominant growth term.

Fixes, in order of value:
1. Partition `events` and `usage_ledger` by time; drop old partitions rather than
   deleting rows.
2. Separate retention by `category`: audit for years, runtime for weeks. The
   discriminator and its partial index already exist for this.
3. Sample high-volume runtime events under load; **never** sample audit events.
4. Roll detail into pre-aggregated summaries for dashboards.

### Tier 3 — Single-process workers

Workers are already stateless and coordinate only through the store, so
multi-node is a deployment change rather than a redesign. It is untested, and
listed as a projection.

Needed first: a real connection pool, and either a leader election or a
partitioned assignment for the maintenance sweeps (currently a single
`maintenance_tick`).

### Tier 4 — Provider limits *(a different ceiling entirely)*

Benchmarks deliberately exclude model latency. With a real provider at, say,
900 ms typical latency and 100 concurrent requests permitted, the ceiling is
~110 tasks/s — **below the control plane's current SQLite-bound throughput**.

The consequence is worth stating plainly: for realistic model-backed workloads,
**the provider is the binding constraint long before the control plane is.**
Which is why the router has failover and circuit breakers, why budgets are
enforced per task, and why the control plane's job is to be reliable and cheap
rather than maximally fast.

---

## 3. Registry scale

The mandate distinguishes definitions from live instances, and asks for higher
registry counts where practical.

| Templates | Capability search p95 | List page p95 | Duplicate scan p95 |
|---|---|---|---|
| 100 | 0.021 ms | 1.30 ms | 0.12 ms |
| 1,000 | 0.019 ms | 1.15 ms | 1.25 ms |
| 5,000 | 0.026 ms | 1.19 ms | 7.73 ms |
| 10,000 | **0.020 ms** | 1.10 ms | 11.76 ms |

Capability search and listing are **flat**. Duplicate scan is O(n) but cheap
(a SQL `GROUP BY`), and it is a periodic maintenance query rather than a hot path.

**10,000 agent definitions are comfortably supported.** Capability search was
210 ms at this size before ADR-0008; the fix was structural (an index) rather
than a constant-factor optimisation, which is why the curve went flat rather
than merely lower.

---

## 4. Elasticity

Fleet size tracked offered load exactly at every scale: 11 live instances at 10
agents, 1,000 at 1,000. Instances are reused before being spawned and reaped when
idle, so capacity follows demand rather than ratcheting to peak.

The mandate's principle holds structurally: agent *count* is an outcome of load,
not a configured constant. The owner gate is on new **kinds** of agent
(ADR-0004), not on capacity — so elasticity and governance do not conflict.

---

## 5. Honest maximum safe scale today

| Dimension | Measured safe | Limited by |
|---|---|---|
| Agent definitions | **10,000+** | Nothing observed; reads are flat |
| Live instances | **1,000** (tested) | Memory (~0.29 MB each) |
| Task throughput | **~370–600 tasks/s** | **SQLite single writer** |
| Concurrent workers | **4–8** (more is worse) | **SQLite single writer** |
| Registry entries | **10,000** (tested) | Nothing observed |
| Task history | ~10,000 before size review | Event volume |
| Projects | Not scale-tested | Isolation is correct; volume unknown |

For a single-node deployment with modest throughput, v0.4 is sound today. For
the mandate's multi-business target, **PostgreSQL is the prerequisite**, and it
is the one change that unblocks the rest.
