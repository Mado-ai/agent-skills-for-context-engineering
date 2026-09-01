---
name: cost-governance
description: This skill should be used when the user asks to "cap agent spending", "stop runaway agent costs", "budget tokens per agent", "attribute LLM cost to a project or customer", or mentions cost controls, spend limits, token budgets, blast radius limits, or preventing agents from spawning unlimited sub-agents.
---

# Cost Governance

There are two separate problems here and conflating them produces a system that does neither well.

**Budgets** are about money and tokens: a finite allowance that work consumes. Exceeding one is an expected condition with a defined response.

**Blast-radius limits** are about structure: how deep an agent may recurse, how wide it may fan out, how many sub-agents a task tree may contain. Exceeding one is a *structural error*, not an expense — an agent hitting its spawn depth limit is malfunctioning, not merely busy.

Both must be enforced *before* the work happens. Detecting an overrun afterwards is accounting.

## When to Activate

Activate this skill when:
- Agents can spend money without a human in the loop
- Agents can spawn sub-agents, which can spawn sub-agents
- Cost must be attributed to a customer, project, or team
- An agent run produced a surprising bill
- Setting limits at more than one level of a hierarchy
- Deciding what happens when an agent exhausts its allowance mid-task

## Core Concepts

**Reserve, then settle.** Check the projected cost against every applicable ceiling before starting, and record actual usage afterwards. A check that runs after the spend is a report, not a control.

**Money is integers.** Use micros (1e-6 of the currency unit) as integers. Floating-point cents accumulated across millions of calls drift, and the drift lands in the direction of under-counting.

**Counters for the hot path, a ledger for the truth.** Keep an O(1) counter per scope for the pre-flight check, and an append-only ledger row per execution for attribution. Write both in one transaction so they cannot disagree.

**The narrowest scope binds.** Check task, then agent, then project, then system. Reporting the widest violated ceiling first produces "system budget exceeded" when the real answer was "raise this one agent's limit".

## Detailed Topics

### Nested scopes

```
system      the whole platform
  project   one customer, business, or tenant
    team    a group of agents working together
      agent one agent's lifetime allowance
        task one unit of work
```

Check from the inside out and stop at the first refusal:

```python
def check(scopes, cost_micros, tokens):
    # Ordered narrowest -> widest, so the error names the tightest binding
    # constraint rather than whichever was listed first.
    for scope_type, scope_id in scopes:
        state = get(scope_type, scope_id)
        if state is None:
            continue                     # no budget configured means unlimited
        if state.spend + cost_micros > state.cost_limit:
            raise BudgetExceeded(scope_type, scope_id, "cost")
        if state.tokens_used + tokens > state.token_limit:
            raise BudgetExceeded(scope_type, scope_id, "tokens")
```

An unconfigured scope means unlimited, which is a deliberate choice: requiring a budget everywhere means the first unbudgeted scope blocks all work, and the pressure that creates is to set every limit implausibly high.

### Enforcing mid-flight, not only at the start

A pre-flight check uses an *estimate*. An agent that makes many model calls can blow through its allowance after the check passed. Enforce as the work happens too:

```python
def on_model_call(response):
    used["tokens"] += response.tokens_in + response.tokens_out
    if used["tokens"] > min(packet.token_budget, contract.per_task_token_limit):
        raise BudgetExceeded("task token budget exhausted")
```

This stops a runaway loop mid-flight rather than discovering it in the ledger.

### Blast radius

Three limits, all independent, all checked before the spawn:

| Limit | Bounds | Why it alone is insufficient |
|---|---|---|
| depth | Chain length | Depth 2 with fan-out 1,000 is a million tasks |
| fan-out width | Children per task | Width 5 at depth 10 is ~10 million |
| total per task tree | The whole tree | This is the backstop for the product |

Treat a violation as an error, not as an exhausted budget. The response is to stop and report, not to wait for more allowance.

### Attribution

The ledger row is what answers "why was the bill this size":

```
ts, project_id, task_id, agent_id, template_id, model, provider,
tokens_in, tokens_out, model_cost_micros, tool_cost_micros,
duration_ms, queue_ms, retries
```

Recording `retries` separately matters more than it looks: a system whose cost doubled because of a retry storm looks identical to one whose traffic doubled, unless retries are counted.

### Rolling windows

For a rate limit ("$100 per day"), reset counters lazily on read rather than with a background job:

```python
if now - window_start >= window_seconds:
    reset(spend=0, tokens=0, window_start=now)
```

A budget nobody is checking does not need rolling, and a lazy reset cannot drift out of sync with the check that depends on it. A background resetter that fails silently leaves every budget permanently exhausted — a failure mode that presents as "all agents stopped working" with no obvious cause.

## Practical Guidance

**Decide what happens when a budget is exhausted mid-task.** The options are to fail the task, park it for a human, or let it finish and go over. Choose deliberately and encode it, because the default — whatever the code happens to do — is rarely what anyone wanted.

**Charge tool costs to the same scopes as model costs.** Otherwise an agent with a cheap model and an expensive tool appears free.

**Budget in tokens as well as money.** Token limits bound context growth and latency, not just spend, and they remain meaningful when prices change.

**Attribute at the template level, not only the instance.** "Which *kind* of agent costs the most" is the question that leads to a fix; "which instance" usually just names whichever one ran most recently.

## Examples

**The narrowest scope names the real problem:**

```
Input:  agent limit 300 (200 used), project limit 100000 (200 used)
        request costing 200
Output: BudgetExceeded scope=agent — used 200, requested 200, limit 300
        (not "project budget exceeded", which would be misleading)
```

**Blast radius is an error, not an expense:**

```
Input:  depth=1, fan_out=0, but the task tree already holds 200 tasks
Output: SpawnLimitExceeded(reason="tree_size")
        -> stop and report; do not wait for budget
```

## Guidelines

1. Budgets are checked before work starts and enforced again during it
2. Costs are integer micros, never floats
3. Counters serve the hot path; an append-only ledger serves attribution
4. Counter and ledger are written in one transaction
5. Scopes are checked narrowest first
6. An unconfigured scope means unlimited, deliberately
7. Blast-radius violations are structural errors, not budget conditions
8. Depth, width, and total tree size are all bounded
9. Retries are counted separately in the ledger
10. Rolling windows reset lazily on read, not by a background job

## Gotchas

1. **Post-hoc accounting mistaken for governance**: A dashboard showing yesterday's overspend is a report. If the check does not run before the spend, there is no control.
2. **Floating-point money**: Accumulated float arithmetic drifts across millions of calls, and reconciliation against a provider invoice becomes impossible to do exactly. Integers throughout.
3. **Only the widest scope checked**: Reporting "system budget exceeded" when one agent's limit was the real constraint sends people to the wrong fix.
4. **Children inherit the parent's full budget**: Three children each receiving the parent's whole allowance can spend three times it. Either divide the budget or bound the task tree's total.
5. **Pre-flight check only**: The check passes on an estimate, then a multi-call agent spends far more. Enforce during execution as well.
6. **Counters without a ledger**: The total is known and unattributable, so nothing can be fixed. Counters without a ledger answer "how much" but never "why".
7. **Ledger without counters**: A `SUM` over history on every pre-flight check makes the budget check slower as the system ages, exactly when it matters most.
8. **Tool costs uncharged**: An agent with a cheap model and an expensive tool looks free, and the expensive part is invisible in every per-agent report.
9. **Background window reset fails silently**: Every budget stays exhausted and all agents stop, with no error anywhere pointing at the resetter.
10. **Retries not counted separately**: A retry storm and a traffic increase produce identical cost curves, and the wrong one gets investigated.
11. **Blast-radius limits treated as budgets**: Waiting for more allowance when an agent hits its spawn depth misreads a malfunction as demand.

## Integration

- work-packets - Packets carry the budget and spawn allowance that this enforces
- agent-contracts - Contracts declare per-agent and per-task ceilings
- workforce-elasticity - Elastic scaling without ceilings scales the bill too
- agent-permissions - Raising a ceiling is an owner-gated capability
- agent-observability - The usage ledger is a primary telemetry source
- project-development - Cost estimation and task-model fit for the wider pipeline
- context-optimization - Reducing tokens per task is the other half of cost control

## References

- [Budget governor](./scripts/budget_governor.py) - Runnable nested budgets, reservations, ledger, and blast-radius limits
- Worked implementation: `examples/agent-factory-runtime/af/budget/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
