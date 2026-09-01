---
name: work-packets
description: This skill should be used when the user asks to "structure agent-to-agent delegation", "pass tasks between agents safely", "build a task DAG for agents", "stop runaway agent recursion", or mentions structured delegation, work packets, fan-out and fan-in, task dependencies, spawn limits, or replacing free-form agent chat with a protocol.
---

# Work Packets

Agents should not converse with each other. They should exchange structured work packets.

A natural-language message between agents carries no enforceable constraints. If one agent tells another "research this, use only the search tool, keep it under a dollar, return JSON", every one of those limits must be re-derived from prose by the receiving model — which is to say, not enforced. Swap the message for a record whose fields the runtime reads, and the same limits become mechanical.

This skill covers the packet as a contract between agents, and the three structural controls that keep delegation from becoming unbounded recursion.

## When to Activate

Activate this skill when:
- One agent assigns work to another
- Sub-agents can themselves spawn sub-agents
- Tasks have dependencies, or results must be joined from parallel branches
- An agent system has produced runaway recursion or surprising cost
- Delegated work must be traceable end to end
- Deciding what an orchestrator is allowed to hand a worker

## Core Concepts

**The packet is the enforcement surface.** Tools, budget, deadline, output schema, depth, and spawn allowance are fields the runtime reads before execution. A model on the receiving end cannot alter any of them.

**Delegation may only narrow authority.** A child packet can never carry a larger budget, a longer deadline, a deeper spawn allowance, or a wider tool set than its parent holds. Enforce this in the constructor that builds children, not in review.

**Depth alone does not bound recursion.** A depth-2 tree with fan-out of 1,000 at each level is a million tasks. Bound depth, width, *and* the cumulative size of the task tree.

**Structure enables the join.** Fan-out is easy; fan-in is where naive implementations stall forever. Dependencies need an explicit representation and an explicit failure path.

## Detailed Topics

### The packet

```python
@dataclass
class WorkPacket:
    id: str
    trace_id: str              # constant across the whole tree
    root_id: str               # the originating task
    parent_task_id: str | None
    project_id: str

    sender_agent_id: str
    receiver_template_id: str  # a KIND of agent, not a specific instance

    objective: str
    inputs: dict
    context_refs: tuple[str, ...]      # references, not inlined content
    required_output_schema: dict

    allowed_tools: tuple[str, ...]
    budget_micros: int
    token_budget: int
    deadline_at: float | None
    priority: int

    depth: int                 # travels with the work
    spawn_budget: int          # children this packet may create
    max_attempts: int
    idempotency_key: str | None
```

Two field choices carry weight beyond their size.

**Target a template, not an instance.** The sender says what *kind* of agent it needs; the runtime picks a warm worker or spawns one. Naming a specific instance couples the sender to fleet state and makes elastic scaling impossible — see workforce-elasticity.

**Pass `context_refs`, not content.** References keep packets small and let the receiver apply its own context policy to decide how much to actually load. Inlining content means the sender decides the receiver's attention budget, which it is not positioned to do.

### Narrowing, enforced in the constructor

```python
def child(self, **overrides) -> "WorkPacket":
    child = WorkPacket(
        trace_id=self.trace_id,          # one trace for the whole tree
        root_id=self.root_id,
        parent_task_id=self.id,
        project_id=self.project_id,
        depth=self.depth + 1,
        budget_micros=self.budget_micros,
        spawn_budget=max(0, self.spawn_budget - 1),
        ...)
    for key, value in overrides.items():
        setattr(child, key, value)

    # Clamp AFTER overrides, so a caller cannot widen by passing a larger value.
    child.budget_micros = min(child.budget_micros, self.budget_micros)
    child.token_budget = min(child.token_budget, self.token_budget)
    child.spawn_budget = min(child.spawn_budget, max(0, self.spawn_budget - 1))
    child.depth = self.depth + 1
    if self.allowed_tools:
        child.allowed_tools = tuple(t for t in child.allowed_tools
                                    if t in self.allowed_tools)
    return child
```

Ordering is the subtle part. Clamping before applying overrides lets a caller widen authority by passing a larger value afterwards, and the code still looks correct.

Note that budgets are *inherited*, not *divided*. Dividing is often more correct for money — three children of a $1 parent should not each get $1 — but it requires the parent to know its fan-out in advance. Inherit-and-clamp is the safe default; add a per-tree ceiling (below) to bound the total.

### Three independent recursion limits

| Limit | Bounds | Failure it prevents |
|---|---|---|
| `max_spawn_depth` | Chain length | Infinite regress |
| `max_children_per_task` | Fan-out width | One task spawning thousands |
| `max_total_spawns` per root | Whole tree | The *product* of depth and width |

Check all three before creating the child, never after:

```python
def check_spawn(depth, siblings, root_id, policy):
    if depth > policy.max_spawn_depth:
        raise SpawnLimitExceeded("depth")
    if siblings >= policy.max_children_per_task:
        raise SpawnLimitExceeded("fan_out")
    if count_tasks_in_tree(root_id) >= policy.max_total_spawns:
        raise SpawnLimitExceeded("tree_size")
```

The third is the backstop. Depth and width limits that look individually reasonable multiply into numbers nobody intended.

### Dependencies, fan-out and fan-in

Represent edges explicitly and keep a counter on the dependent task:

```
submit(a); submit(b); submit(c)
submit(join, depends_on=[a, b, c])   # starts BLOCKED, pending_deps = 3

on_complete(x):
    decrement pending_deps for dependents of x
    promote to READY any that reach zero
```

Do the decrement and the promotion in one transaction, so a task can never be observed at `pending_deps == 0` while still blocked.

**Give failure an explicit path.** When a dependency terminates unsuccessfully, cancel its waiters with a reason. Without this, a join blocks forever on a dead branch — and a permanent stall is far harder to diagnose than a failure, because nothing appears wrong.

### Idempotency

Delivery in any durable queue is at-least-once: a worker can complete work and die before recording it. Rather than pretending otherwise, make duplicates safe.

Put an `idempotency_key` on the packet and a unique index on `(project_id, idempotency_key)`. A duplicate submission then returns the existing task id, and the race is resolved by the database rather than by a check-then-insert that two callers can interleave.

## Practical Guidance

**Keep one trace id across the entire tree.** Every packet in a delegation tree shares `trace_id` and `root_id`. This is what turns "what happened in this workflow" into one indexed query rather than a reconstruction exercise.

**Distinguish retries from reworks.** A transient failure consumes a retry attempt; a quality rework is a deliberate second attempt requested by a reviewer. If a rework consumes the retry budget, it silently exhausts the allowance meant for genuine flakiness. Increment the attempt ceiling when re-queueing for quality.

**Let packets narrow tool access, never widen it.** A packet may list fewer tools than the receiver's contract grants. If it lists more, intersect — do not union.

## Examples

**A child cannot widen its authority:**

```
Input:  parent(budget=1000, spawn_budget=3, tools=("a","b"))
        parent.child(budget=999999, spawn_budget=99, tools=("a","c"))
Output: child(budget=1000, spawn_budget=2, tools=("a",), depth=parent.depth+1)
```

**Fan-in releases only when every branch completes:**

```
Input:  join depends on [a, b];  complete(a)
Output: join stays BLOCKED (pending_deps 2 -> 1)
Input:  complete(b)
Output: join -> READY
```

## Guidelines

1. Agents exchange packets; there is no free-form agent-to-agent channel
2. Child packets are built by a constructor that clamps after applying overrides
3. Depth, fan-out width, and total tree size are all bounded, and checked before the spawn
4. `trace_id` and `root_id` are constant across a delegation tree
5. Dependency decrement and promotion happen in one transaction
6. A terminally failed dependency cancels its waiters with a reason
7. Packets carry context references, not inlined content
8. Idempotency is enforced by a unique constraint, not by an application check
9. Rework raises the attempt ceiling rather than consuming a retry

## Gotchas

1. **Child budgets inherited without clamping**: Each child receives the parent's full budget, so N children can spend N times what the parent was allotted. The per-tree ceiling is what actually bounds total spend; inheritance alone does not.
2. **Clamping applied before overrides**: The clamp runs, then an override widens the value back, and the code reads as correct in review. Clamp last, unconditionally.
3. **Only depth is bounded**: Depth 3 with fan-out 50 is 125,000 tasks. Any two of the three limits still leaves the product unbounded.
4. **Fan-in stalls on a dead branch**: When a dependency dead-letters and nothing cancels its waiters, the join waits forever. This presents as a mysterious stall rather than a failure, and is often found days later.
5. **Trace id regenerated per packet**: Losing the shared trace makes a delegation tree unreconstructable, and the loss is invisible until the first incident when it is needed.
6. **Content inlined instead of referenced**: The sender decides the receiver's context budget, packets grow with every hop, and the queue table becomes the largest object in the system.
7. **Reworks consuming retry attempts**: Two quality reworks exhaust a three-attempt budget, leaving no allowance for a genuine transient failure, and the task dead-letters for the wrong reason.
8. **Targeting a specific instance**: The sender couples to fleet state, so the receiver cannot be scaled, replaced, or reaped. Target a template and let the runtime resolve it.
9. **Idempotency checked in application code**: A read-then-insert lets two concurrent submissions both pass the check. Put a unique constraint on the key and handle the conflict.

## Integration

- multi-agent-patterns - Chooses the topology; work packets are the protocol that makes it governable
- agent-permissions - Delegation narrows authority; it can never widen it
- agent-contracts - Contract runtime policy supplies the spawn and budget limits a packet carries
- cost-governance - Per-tree spawn and cost caps are enforced against packet fields
- workforce-elasticity - Template targeting is what lets the runtime resolve a receiver elastically
- agent-observability - The shared trace id is what makes a delegation tree reconstructable

## References

- [Work packet implementation](./scripts/work_packet.py) - Runnable packet, authority narrowing, DAG dependencies, and recursion limits
- Worked implementation: `examples/agent-factory-runtime/af/workpacket.py`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
