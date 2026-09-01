---
name: workforce-elasticity
description: This skill should be used when the user asks to "scale an agent system", "run thousands of agents", "add workers to speed up agents", "stop paying for idle agents", "benchmark an agent platform", or mentions agent pools, durable queues, worker leases, agent templates versus instances, or finding the bottleneck in an agent runtime.
---

# Workforce Elasticity

The number of agents is not the metric. Productive workflow loops are. A system running a thousand idle agents is worse than one running twenty busy ones — it costs more, is harder to reason about, and its size tells you nothing about its capability.

Elasticity means capacity follows demand: agents are instantiated when work requires them and retired when it disappears. This skill covers the structure that makes that possible, and the measurement discipline that keeps scaling claims honest.

## When to Activate

Activate this skill when:
- An agent system must handle variable or unpredictable load
- Agent definitions number in the hundreds or thousands
- Throughput must be measured rather than asserted
- Adding workers has not improved throughput
- Idle agents are consuming budget or memory
- Deciding whether a system is limited by its architecture or its model provider

## Core Concepts

**A definition is not an instance.** A template (with its versioned contract) is a *kind* of agent. An instance is a live worker holding concurrency and budget. Ten thousand definitions are ten thousand rows and cost almost nothing. Ten thousand instances cost real resources. Conflating them is what makes "we support 10,000 agents" a meaningless claim.

**Target kinds, not individuals.** A work packet names the *kind* of agent it needs; the runtime resolves that to a warm instance or spawns one. A sender that names a specific instance is coupled to fleet state, which prevents that instance from being scaled, replaced, or reaped.

**Scale down is half the design.** Without idle reaping, a fleet ratchets up to peak concurrency and stays there forever. The peak becomes the floor.

**Measure the layer you are claiming about.** Control-plane throughput and model-provider throughput are different ceilings with different fixes. Benchmarking with real model calls measures the provider; benchmarking with deterministic workers measures the architecture. Conflating them makes every number meaningless.

## Detailed Topics

### Demand-driven instancing

```python
def acquire_instance(template_id, project_id, policy):
    # 1. Reuse a warm instance with spare concurrency.
    #    Order by inflight, then last_active: keeps load even and keeps
    #    recently used instances warm rather than round-robining across all.
    warm = find_active(template_id, project_id, inflight_below=policy.concurrency_limit)
    if warm:
        return warm

    # 2. Spawn, if under the ceiling.
    if live_count(template_id, project_id) < policy.max_instances:
        return spawn(template_id, project_id)

    # 3. Refuse. A ceiling that silently stretches is not a ceiling.
    raise SpawnLimitExceeded(...)
```

Reservation must be atomic, with the guard inside the write:

```sql
UPDATE instances SET inflight = inflight + 1
 WHERE id = ? AND state = 'ACTIVE' AND inflight < ?
```

A read-then-write lets two concurrent reservations both pass the check. Release must floor at zero, because at-least-once delivery means a release can happen twice, and a negative counter silently grants extra concurrency.

### Durable queues and leases

Workers should be stateless: everything durable lives in the store, so a worker can die at any point and another picks up its work. The whole crash-recovery story is lease expiry — no heartbeat registry, no failure detector.

Claim in **one** atomic statement:

```sql
UPDATE tasks SET status='RUNNING', lease_owner=?, lease_expires_at=?,
                 attempts = attempts + 1
 WHERE id IN (SELECT id FROM tasks
               WHERE status='READY' AND available_at <= ?
               ORDER BY priority, available_at, id
               LIMIT ?)
RETURNING ...
```

A SELECT followed by an UPDATE lets two workers read the same row before either writes — the classic double delivery. One statement makes that race unrepresentable.

Two refinements worth knowing before you need them:

**The claim index must match the ORDER BY.** Index on `(priority, available_at, id)` filtered to runnable rows. The intuitive alternative leads with the filtered column, `available_at`, which forces a sort of the entire runnable backlog on every claim — so claim latency grows with queue depth instead of staying flat.

**A poison message must dead-letter, not recycle.** When a lease expires and attempts are already exhausted, send the task to a dead-letter queue. Requeueing it just kills the next worker too.

### Finding the real bottleneck

Do not assume more workers means more throughput. Measure the curve.

A worked example, measured on a 4-vCPU single node with a SQLite-backed store and deterministic workers:

| Workers | Throughput | Execution p99 |
|---|---|---|
| 1 | 595 tasks/s | 11 ms |
| 4 | 528 tasks/s | 42 ms |
| 8 | 509 tasks/s | 108 ms |
| 16 | 388 tasks/s | 257 ms |
| 32 | 376 tasks/s | 638 ms |

Throughput *fell* as workers were added, while p99 latency grew 58×. Rising latency with falling throughput is the signature of **lock contention**, not of resource saturation — the two look similar in a dashboard and have opposite fixes.

Profiling located it: 42.6% of single-threaded wall time was spent inside write transactions, against a store that permits one writer. Amdahl's law caps parallel speedup at about 2.3× before contention is even counted; past that, workers queue on the lock and the net is negative.

The lesson generalises. **Count your serialised fraction before adding concurrency.** If a meaningful share of each task is spent in a globally serialised section, more workers make things worse, and the fix is to remove the serialisation rather than to add capacity.

### Separating the ceilings

Run the same workload two ways:

- **Deterministic workers, no model calls** — measures queue, governance, storage, telemetry. This is the architecture's ceiling.
- **Real provider calls** — measures the provider's concurrency and rate limits.

They are usually far apart. At 900 ms typical model latency with 100 permitted concurrent requests, the provider ceiling is roughly 110 tasks/s — often *below* the control plane's, which means the control plane's job is to be reliable and cheap rather than maximally fast.

Report them separately. A provider rate limit is not an architecture limitation, and fixing the wrong one wastes a quarter.

## Practical Guidance

**Apply backpressure at submission.** Refuse work above a queue-depth ceiling. An unbounded queue converts an overload into an outage plus a storage bill, and it hides the overload until it is expensive.

**Jitter retry backoff.** A thousand tasks failing on the same downstream outage will otherwise retry in the same instant, and the retry storm outlasts the original failure.

**Measure claim latency against a full table, not an empty one.** Index degradation only appears once history accumulates, which is exactly when a benchmark against a fresh table will tell you everything is fine.

**Refresh planner statistics after bulk load.** A cold table can produce a scan where an index was intended, and the resulting numbers describe a system nobody will run.

## Examples

**Elasticity working:** live instances tracked offered load exactly across a scale sweep — 11 instances at 10 agents, 1,000 at 1,000 agents — with instances reused before being spawned and reaped when idle.

**A scale claim that is not one:**

```
Claim:   "supports 10,000 agents"
Reality: 10,000 rows in a table, nothing executing
Honest:  "10,000 agent definitions, 1,000 concurrent live instances tested,
          ~370-600 tasks/s, limited by the storage engine's single writer"
```

## Guidelines

1. Definitions and instances are separate concepts with separate limits
2. Packets target templates; the runtime resolves the instance
3. Reservation is atomic, with the concurrency guard inside the write
4. Release floors at zero
5. Idle instances are reaped; scale-down is implemented, not assumed
6. Claims are a single atomic statement, never select-then-update
7. The claim index column order matches the claim's ORDER BY
8. Poison messages dead-letter rather than recycle
9. Submission applies backpressure above a depth ceiling
10. Control-plane and provider ceilings are measured and reported separately

## Gotchas

1. **Counting rows as scale**: A registry with 10,000 definitions demonstrates nothing about execution. Report definitions, concurrent instances, and throughput as three separate numbers.
2. **Adding workers without measuring**: When a meaningful fraction of each task is serialised, added workers reduce throughput. Measure the curve before provisioning; the fix is removing serialisation, not adding capacity.
3. **Falling throughput mistaken for saturation**: Rising latency plus falling throughput means contention; rising latency plus flat throughput means saturation. The fixes are opposite, and dashboards make them look alike.
4. **No scale-down path**: The fleet ratchets to peak concurrency and stays there. Idle reaping is not an optimisation; without it the system has no elasticity at all.
5. **Read-then-write reservation**: Two concurrent reservations both pass the check and the concurrency limit is exceeded. Put the guard in the WHERE clause.
6. **Release without a floor**: At-least-once delivery means a double release happens eventually, and a negative counter silently grants extra concurrency forever.
7. **Claim index leading with the filtered column**: The natural choice forces a sort of the whole runnable backlog per claim, so latency grows with depth. Match the index to the ORDER BY.
8. **Poison messages recycled**: A task that kills its worker is requeued and kills the next one. Dead-letter once attempts are exhausted.
9. **Unbounded queues**: An overload silently becomes a storage problem and stays invisible until it is expensive.
10. **Benchmarking with real model calls**: The result measures the provider, not the architecture, and the two have completely different fixes.
11. **Benchmarking against an empty table**: Index degradation appears only with history. Measure after the drain, not before the load.

## Integration

- work-packets - Template targeting is what makes elastic resolution possible
- agent-contracts - Contracts carry the concurrency, instance, and idle-retire limits
- cost-governance - Elastic scaling without budget ceilings scales the bill too
- multi-agent-patterns - Chooses the topology; this skill runs it under load
- agent-observability - Queue depth, latency percentiles, and error rate are the signals
- project-development - Cost and capacity estimation for the overall pipeline

## References

- [Elastic pool](./scripts/elastic_pool.py) - Runnable instance pool, leased queue, reaping, and a bottleneck measurement harness
- Worked implementation and full benchmark results: `examples/agent-factory-runtime/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
