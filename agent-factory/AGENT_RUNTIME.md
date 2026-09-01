# AGENT_RUNTIME.md

## 1. Contract lifecycle

```
DRAFT ──> VALIDATION ──> TESTING ──> APPROVAL ──> ACTIVE
  ^            │            │           │           │
  └────────────┴────────────┴───────────┘     ┌─────┼─────┬──────┐
       (failure returns to DRAFT)             │     │     │      │
                                        OBSERVATION │  PAUSED  RETIRED
                                              │  IMPROVEMENT      MERGED
                                              └─────┴──> VALIDATION
```

The rule "an invalid contract must never become ACTIVE" is enforced
structurally, not by convention:

1. `agent.activate` is owner-gated — no agent principal satisfies it.
2. The transition table admits **no edge into ACTIVE except from APPROVAL**.
3. Validation is re-run at activation and must be clean.

Guard 2 is proved over the whole graph in
`test_active_is_only_reachable_through_approval`: delete APPROVAL from the
transition table and ACTIVE becomes unreachable from DRAFT.

A contract is immutable after DRAFT. Improving an agent creates a **new version**
that re-enters at VALIDATION — which is what keeps "what exactly was approved"
answerable months later. `IMPROVEMENT → VALIDATION` exists for precisely this;
there is no path that promotes a revised contract straight back to ACTIVE.

Activation supersedes the previous version atomically: exactly one contract is
ACTIVE per template at any time.

---

## 2. The queue

Durable, in the store. Leases rather than "mark it running and hope".

**Claim** is one atomic statement:

```sql
UPDATE tasks SET status='RUNNING', lease_owner=?, lease_expires_at=?,
                 attempts=attempts+1, started_at=COALESCE(started_at,?)
 WHERE id IN (SELECT id FROM tasks
               WHERE status='READY' AND available_at<=?
               ORDER BY priority, available_at, id LIMIT ?)
RETURNING ...
```

SELECT-then-UPDATE would let two workers read the same row before either wrote —
the classic double-delivery. One statement in one `IMMEDIATE` transaction makes
that race unrepresentable. Verified with 8 threads claiming 400 tasks:
400 delivered, zero duplicates.

One subtlety, found by test: `RETURNING` yields rows in *storage* order, not the
subquery's `ORDER BY`. The subquery still selects the correct highest-priority
set — that is what matters for fairness across claims — but within a batch the
rows come back unsorted, so a worker would dispatch a BACKGROUND task before a
CRITICAL one. The batch is re-sorted in Python; it is at most `limit` rows.

**Statuses**

```
BLOCKED ──> READY ──> RUNNING ──> COMPLETED
                         │  ├───> REVIEW ──> REWORK ──> READY
                         │  ├───> WAITING_APPROVAL
                         │  └───> FAILED / DEAD_LETTER
                         └─(lease lapses)──> READY | DEAD_LETTER
   any active ──> CANCELLED
```

**DAG.** `task_deps` plus a `pending_deps` counter on the task. Completion
decrements dependents and promotes those reaching zero, in the same transaction —
so a task can never be observed at `pending_deps=0` while still BLOCKED. A
dead-lettered task cancels its waiters with `dependency_failed`, because a fan-in
join that blocks forever on a dead branch presents as a mysterious stall rather
than a failure.

**Backpressure.** Submission is refused above `max_queue_depth`. An unbounded
queue converts an overload into an outage plus a storage bill.

**Retry.** Exponential backoff with jitter applied at fail time, so a thousand
tasks failing on the same downstream outage do not retry in the same instant.
Verified: 50 simultaneous failures produced >40 distinct retry times.

**Rework raises `max_attempts`** rather than consuming a retry. A rework is a
deliberate second attempt requested by the quality engine, not a symptom of
flakiness; spending the retry budget on it would silently exhaust the allowance
meant for transient failures.

---

## 3. Crash recovery

The entire story is lease expiry. No heartbeat registry, no failure detector: if
a worker stops renewing, its lease lapses and `reap_expired_leases()` returns the
task to READY.

The one refinement: a task whose attempts are already spent goes straight to the
dead-letter queue instead of being requeued. A task that repeatedly kills its
worker is a poison message, and re-queueing it would only kill the next one.

---

## 4. Workers

Stateless. Everything durable lives in the store, so a worker can die at any
point. Adding capacity means starting more workers — no registration, no
coordination, no shared memory. That is the property that makes multi-node
possible later without redesigning the runtime.

Threads rather than processes: the work is IO- and SQLite-bound, and SQLite in
WAL mode already serialises writes, so under the GIL a thread pool is the right
shape. A genuinely CPU-heavy agent body would want process workers — a change of
adapter, not of design.

**Measured caveat:** on SQLite, *adding workers reduces throughput*
(595 tasks/s at 1 worker, 376 at 32). This is the single-writer lock, not the
worker model. See SCALING_STRATEGY.md.

---

## 5. Delegation

`WorkPacket.child()` is where authority narrowing is enforced, in the
constructor rather than by review:

```python
child.budget_micros = min(child.budget_micros, self.budget_micros)
child.token_budget  = min(child.token_budget,  self.token_budget)
child.spawn_budget  = min(child.spawn_budget,  max(0, self.spawn_budget - 1))
child.allowed_tools = tuple(t for t in child.allowed_tools if t in self.allowed_tools)
child.depth         = self.depth + 1
```

Clamping happens *after* overrides are applied, so a caller cannot widen by
passing a larger value. A parent cannot grant what it does not hold.

Three independent recursion limits, all checked before the spawn:

| Limit | Stops |
|---|---|
| `max_spawn_depth` | Deep chains |
| `max_children_per_task` | Wide fan-out |
| `max_total_spawns` (per root task tree) | The **product** of the two |

Depth alone is insufficient: a depth-2 tree with fan-out 1,000 at each level is
1,000,000 tasks. The cumulative per-tree cap is the backstop.

---

## 6. Elastic instancing

Packets normally target a **template**. `acquire_instance` then:

1. reuses an ACTIVE instance with spare concurrency (ordered by `inflight`, then
   `last_active_at` — keeps load even and recently-used instances warm), else
2. spawns a new instance if under `max_instances`, else
3. refuses with `SpawnLimitExceeded`.

`reserve_instance` carries its guard in the WHERE clause
(`inflight < concurrency_limit`), so two concurrent reservations cannot both
succeed past the limit. `release_instance` floors at zero, so a double release —
possible under at-least-once delivery — cannot grant extra concurrency.

`retire_idle_instances()` is the other half: without scale-down the fleet
ratchets to peak concurrency and stays there. Measured live instances tracked
offered load exactly at every scale tested (11 at 10 agents, 1,000 at 1,000).

---

## 7. Pluggable behaviour

The agent "body" is an injected `AgentBehaviour`. It receives an
`ExecutionContext` and **nothing else** — no store handle, no registry, no direct
gateway. `call_tool` and `delegate` are bound closures carrying their governance
checks, so a behaviour physically cannot reach an ungoverned path.

- `ModelBackedBehaviour` — one routed model call, structured output expected.
- `DeterministicBehaviour` — no model calls at all.

That second one is what makes the benchmarks honest: `tasks/second` measures the
control plane (queue, governance, telemetry, gates, ledger) rather than the
latency of whatever model sat behind the router. A provider rate limit and an
architecture limit are different ceilings, and the mandate is explicit that they
must not be conflated.
