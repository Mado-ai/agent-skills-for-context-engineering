---
name: agent-observability
description: This skill should be used when the user asks to "trace what an agent did", "debug a multi-agent failure", "audit agent actions", "find out why an agent run cost so much", or mentions agent tracing, distributed traces for agents, audit trails, event taxonomy, or reconstructing what happened across a delegation tree.
---

# Agent Observability

An agent system is observable when a person holding a single trace identifier can answer, without knowing the schema:

1. What exactly happened?
2. Which agent did it?
3. Why?
4. Which information did it use?
5. What did it cost?
6. Which tool was called?
7. Who approved it?
8. What failed?
9. Who corrected it?

If any of those requires joining tables by hand during an incident, the system is not observable — it is merely logged.

## When to Activate

Activate this skill when:
- Multiple agents collaborate on one request
- An agent run produced a wrong or expensive result and the cause is unclear
- Actions must be auditable for compliance or review
- Deciding what to record and what to leave out
- Log or event volume has become a cost problem

## Core Concepts

**One trace identifier per delegation tree.** Every packet, tool call, model call, memory read, and quality verdict in a workflow carries the same `trace_id`. Reconstruction then becomes one indexed query rather than a correlation exercise.

**Audit and runtime telemetry belong in one store, separated by a discriminator.** A separate audit system that can disagree with the runtime log is worse than one store with a `category` column and an index per access pattern.

**Audit is not sampled and not buffered.** Runtime events may be batched and dropped under load. A record of who approved what, and who was denied what, must survive the crash you most want to investigate.

**Provide a named query for the forensic questions.** A capability that requires knowing the schema is one most people will not have during an incident, which is exactly when they need it.

## Detailed Topics

### Event shape

Give every event the same fields so that queries are uniform:

```
id, ts, type, category            # category: runtime | audit
trace_id, span_id, parent_span    # the tree
task_id, agent_id, project_id, workflow_id
status, duration_ms, error_code
cost_micros, tokens_in, tokens_out, model, provider, tool
actor                             # WHO acted — for approvals, the human
payload                           # type-specific detail
```

`actor` deserves emphasis: it is what answers "who approved it". Without a distinct actor field, an approval event records only that an approval happened.

### A taxonomy that maps to the questions

| Group | Types | Answers |
|---|---|---|
| lifecycle | `contract.created/validated/approved`, `instance.spawned/retired` | what exists, who approved it |
| work | `task.submitted/claimed/started/completed/failed/retried/dead_lettered` | what happened |
| governance | `permission.denied`, `isolation.violation`, `approval.*`, `token.*`, `budget.exceeded`, `spawn.blocked` | who was stopped, who authorised |
| quality | `quality.evaluated/rework/escalated`, `capa.opened/closed` | what failed, who corrected it |
| resources | `model.routed/called`, `tool.called/blocked`, `memory.read/written` | which tools, which information, what cost |

Mark the governance and lifecycle-approval types as `category = audit`. Everything else is runtime.

### The named forensic query

```python
def explain_trace(trace_id):
    rows = query("SELECT * FROM events WHERE trace_id = ? ORDER BY ts, id", trace_id)
    return {
        "what_happened":   [r.type for r in rows],
        "agents_involved": sorted({r.agent_id for r in rows if r.agent_id}),
        "tools_called":    [{"tool": r.tool, "status": r.status} for r in rows if r.tool],
        "approvals":       [{"type": r.type, "actor": r.actor} for r in rows
                            if r.type.startswith("approval.")],
        "failures":        [{"type": r.type, "error": r.error_code} for r in rows
                            if r.error_code],
        "total_cost_micros": sum(r.cost_micros or 0 for r in rows),
        "duration_ms": (rows[-1].ts - rows[0].ts) * 1000,
    }
```

Making this a function rather than a documented query is the whole point.

### Propagating the trace

The most common observability defect is an event emitted without its `trace_id`. It is audited, it is queryable by task, and it is **invisible in the trace** — so the trace tells a story with pieces missing, and nothing indicates anything is absent.

Tool calls and model calls are where this happens, because those subsystems are often written before tracing exists and are called with only an agent and task identifier. Pass the trace explicitly and test for it:

```python
def test_which_tool_was_called():
    trace = explain_trace(trace_id)
    assert [t["tool"] for t in trace["tools_called"]] == ["kb.search", "kb.search"]
```

A test per forensic question is the only reliable defence, because the failure is silent.

### Volume

Full traceability is expensive. A measured example: 7.6 events per task, roughly 23 KB per task, 233 MB for 10,000 tasks. At a million tasks a day that is about 23 GB a day, and it is usually the largest object in the system.

Control it in this order:

1. **Partition by time** and drop old partitions rather than deleting rows.
2. **Retain by category** — audit for years, runtime for weeks.
3. **Sample high-volume runtime events** under load. Never sample audit.
4. **Pre-aggregate** for dashboards so the raw table is not the query target.

### What not to record

Store a **hash** of tool arguments and a **reference** to retrieved content, not the values. Otherwise the event table becomes a second copy of every sensitive payload the system has handled, usually under weaker access controls than the original.

The same applies to prompts and completions. Record token counts, model, and cost; store the text only where a specific, justified need exists.

## Practical Guidance

**Record blocked and denied actions with the same fidelity as successes.** An audit log of only successful actions describes a system in which nothing ever went wrong.

**Keep the queue's own metrics separate from agent metrics.** Queue depth, claim latency, and lease expiry describe infrastructure health; quality score and cost per task describe workforce health. Mixing them makes both dashboards harder to read.

**Measure latency percentiles, not averages.** An average hides the tail, and the tail is what users experience. Use nearest-rank percentiles rather than interpolated ones: with small samples, interpolation reports values that were never observed.

## Examples

**A complete trace:**

```
task.submitted -> task.claimed -> task.started -> memory.read ->
model.routed -> model.called -> tool.called -> quality.evaluated ->
task.completed

agents: [agi_01M1...]   tools: [kb.search]   cost: 205 micros
```

**The silent gap this skill exists to prevent:**

```
Before: task.submitted -> task.claimed -> quality.evaluated -> task.completed
        tools_called: []          <- two tool calls happened and were audited
After:  ... -> tool.called -> tool.called -> ...
        tools_called: [kb.search, kb.search]
```

## Guidelines

1. One trace identifier spans a whole delegation tree
2. Every event carries the same core field set, including `actor`
3. Audit and runtime share a store, separated by a category discriminator
4. Audit events are flushed synchronously and never sampled
5. A named function answers the forensic questions without schema knowledge
6. Blocked and denied actions are recorded as fully as successes
7. Argument hashes and content references are stored, never the payloads
8. Retention is differentiated by category and enforced by partitioning
9. Latency is reported as nearest-rank percentiles
10. Each forensic question has a test asserting it is answerable

## Gotchas

1. **Events emitted without a trace id**: The event is stored, queryable by task, and missing from the trace. Nothing errors and nothing indicates the gap — the trace simply tells an incomplete story. Test each forensic question.
2. **Audit batched with runtime telemetry**: Buffering for throughput loses precisely the records needed after a crash. Flush audit synchronously.
3. **Only successes recorded**: The denied and blocked attempts are the security signal, and their absence makes the system look flawless.
4. **Full payloads stored**: The event table becomes a second copy of every sensitive value, usually with weaker access controls than the source. Store hashes and references.
5. **Separate audit system**: Two stores that can disagree produce an incident where the first question is which log to believe.
6. **No retention policy**: Event volume is usually the largest growth term in an agent platform, and it is invisible until the storage bill arrives.
7. **Averages instead of percentiles**: The average latency hides the tail, and the tail is what users experience.
8. **Interpolated percentiles on small samples**: They report values that were never observed, which is misleading in exactly the low-traffic case where each observation matters.
9. **No actor field**: An approval event that records only that an approval occurred cannot answer "who approved it", which is usually the first question asked.
10. **Sampling applied uniformly**: Sampling audit events to control volume removes the records with the highest value per byte in the entire system.

## Integration

- agent-permissions - Denials and approvals are the highest-value audit events
- tool-governance - Tool call records, including blocked ones, are a primary source
- cost-governance - The usage ledger and cost fields make spend attributable
- work-packets - The shared trace id is what makes a delegation tree reconstructable
- quality-enforcement - Verdicts and corrective records complete the failure story
- workforce-elasticity - Queue depth and latency percentiles are the scaling signals
- context-degradation - Traces are how context failures are diagnosed after the fact

## References

- [Trace recorder](./scripts/trace_recorder.py) - Runnable event store, audit separation, forensic query, and retention
- Worked implementation: `examples/agent-factory-runtime/af/telemetry/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
