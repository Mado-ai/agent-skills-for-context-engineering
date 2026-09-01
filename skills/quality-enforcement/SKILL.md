---
name: quality-enforcement
description: This skill should be used when the user asks to "act on an evaluation score", "make an agent retry failed work", "route bad agent output for review", "build a corrective action loop", or mentions quality verdicts, rework loops, escalation policy, CAPA, or turning agent quality checks into runtime control flow.
---

# Quality Enforcement

Evaluation produces a score. Enforcement decides what happens next. These are different problems, and systems that solve only the first end up with dashboards full of quality metrics and no mechanism that acts on them.

This skill covers the control flow: turning a gate result into one of a small set of outcomes, feeding failures back into a second attempt that is actually better informed than the first, and closing the loop so a recurring defect gets fixed rather than re-observed.

## When to Activate

Activate this skill when:
- Agent output must be checked before it reaches a caller or a customer
- Failed work should be retried, escalated, or rejected on different criteria
- The same defect keeps recurring across executions
- Deciding who reviews what, and when a human must be involved
- An agent pipeline needs a defensible record of what failed and what was done

## Core Concepts

**Four verdicts, not two.** Pass/fail is too coarse. The useful distinction is *why* something failed and therefore who should handle it:

| Verdict | Meaning | Effect |
|---|---|---|
| `PASS` | Meets policy | Result returns to the caller |
| `REWORK` | Wrong but plausibly fixable by the same agent | Requeue with the findings |
| `ESCALATE` | Unlikely to be fixed by this agent alone | Park for a higher level or a human |
| `REJECT` | Unusable and not worth reworking | Terminate |

**Inconclusive is not passing.** A gate that could not reach a conclusion must say so, and must be excluded from the score rather than contributing a neutral value. Otherwise absent checks quietly raise the average.

**Confidence is about the verdict, not the model.** Define it as the fraction of gates that reached a conclusion. A model's self-reported confidence is weak evidence and belongs at low weight, if it is used at all.

**A corrective loop that cannot verify is theatre.** If a corrective action can be marked done without a re-execution that passed, the process records intentions rather than outcomes.

## Detailed Topics

### Gates

Each gate is a deterministic function of `(output, request, contract)` returning a score, findings, and whether it reached a conclusion.

| Gate | Checks | Suggested weight |
|---|---|---|
| `schema` | Output validates against the declared schema | 2.0 |
| `policy` | No forbidden action appears in the output | 2.0 |
| `completeness` | Every declared output is present and non-empty | 1.0 |
| `evidence` | Claims carry sources or citations | 1.0 |
| `confidence` | Self-reported confidence meets a floor | 0.5 |

Weight `schema` and `policy` highest because they are objective and consequential. Weight self-reported confidence lowest because it is the least reliable signal in the set — its value is not that a high number means good work, but that a *low* number is a genuine warning the agent has given you.

### Scoring honestly

```python
def weighted_score(results):
    # Inconclusive gates are excluded ENTIRELY, not scored at a neutral value.
    # A task with no schema and no evidence would otherwise drift upward toward
    # passing on the strength of checks that never ran.
    conclusive = [r for r in results if not r.inconclusive]
    if not conclusive:
        return 0.0
    total_weight = sum(r.weight for r in conclusive)
    return sum(r.score * r.weight for r in conclusive) / total_weight

confidence = len(conclusive) / len(results)   # how much we trust THIS verdict
```

Excluding inconclusive gates keeps the score meaningful and pushes the uncertainty into confidence, where the verdict logic can act on it deliberately.

### Verdict policy

Order the decision by severity. The ordering encodes judgements that are easy to get wrong:

```python
def decide(results, score, confidence, policy, attempt):
    by_id = {r.gate_id: r for r in results}

    # 1. A policy breach ESCALATES, never reworks. The agent just demonstrated
    #    it will do the forbidden thing; asking it to try again is how a breach
    #    becomes a loop.
    if failed(by_id.get("policy")):
        return ESCALATE

    # 2. Structurally invalid output on the final attempt is unusable.
    if failed(by_id.get("schema")) and attempt > policy.max_rework_attempts:
        return REJECT

    # 3. Passing on the numbers but with too little conclusive evidence means
    #    we do not actually know that it passed.
    if score >= policy.min_score and all_conclusive_passed(results):
        if confidence < policy.min_confidence:
            return ESCALATE
        return PASS

    # 4. Rework while attempts remain, then escalate or reject.
    if attempt > policy.max_rework_attempts:
        return ESCALATE if policy.escalate_on_repeat_failure else REJECT
    return REWORK
```

### Rework must carry the findings

A rework without the reason is a re-roll — the same agent, the same inputs, a different sample from the same distribution. Pass the previous findings into the next attempt:

```python
feedback = previous_findings(task_id) if attempt > 1 else []
```

Fetch them only on a rework. Fetching unconditionally is harmless logically but forces a read (and, behind a write buffer, a flush) on every single task.

**Cap rework.** More than a small number of cycles means the contract is wrong, not the attempt. Two or three, then escalate.

### Escalation needs a terminal state

An escalated task must land somewhere no worker will pick it up again — a review queue, a human inbox, a parked status. Escalating back into the same queue produces a task that cycles forever while appearing active.

### The corrective loop

```
Issue -> Root Cause -> Corrective Action -> Re-execution -> Verification -> Closure
```

The value is one constraint: **closure requires a verified re-execution.** Enforce it in the state machine rather than in the process document.

```python
ALLOWED = {
    OPEN:            {ACTION_PROPOSED, CLOSED},
    ACTION_PROPOSED: {REEXECUTED, CLOSED},
    REEXECUTED:      {VERIFIED, ACTION_PROPOSED},   # a failed rework goes BACK
    VERIFIED:        {CLOSED},
    CLOSED:          set(),
}
```

A failed re-execution returns to `ACTION_PROPOSED`, not to closure: if the fix did not work, the analysis was wrong.

Require root cause and corrective action to be substantive. A minimum length is a crude proxy for rigour, but it reliably blocks the one-word root cause that makes the record worthless.

## Practical Guidance

**Make an unimplemented gate fail loudly.** If a contract names a gate the engine does not have, treat it as inconclusive and push toward escalation. Silently skipping it means a contract believes it is protected and is not.

**Separate the reviewer from the gate.** Who reviews (automated, peer agent, senior agent, human) is a different field from which checks run. Conflating them produces contracts that configure a "human" gate the engine can never execute.

**Record every verdict, including passes.** The pass rate over time is the signal that a contract has drifted; only recording failures hides the trend.

## Examples

**A policy breach escalates rather than reworking:**

```
Input:  output references a forbidden action, attempt 1 of 3
Output: ESCALATE (not REWORK) — retrying an agent that just breached policy
        is how a breach becomes a loop
```

**A failed rework reopens analysis:**

```
Input:  CAPA in REEXECUTED, verification fails
Output: -> ACTION_PROPOSED (the corrective action was wrong)
        NOT -> CLOSED
```

## Guidelines

1. Four verdicts, each with a distinct downstream effect
2. Inconclusive gates are excluded from the score, never scored neutrally
3. Confidence measures the verdict's own reliability, not the model's self-report
4. Policy breaches escalate; they are never reworked
5. Rework carries the previous findings into the next attempt
6. Rework attempts are capped, then escalated or rejected
7. Escalation lands in a state no worker will re-claim
8. A corrective record cannot close without a verified re-execution
9. A failed re-execution returns to analysis, not to closure
10. An unimplemented gate is inconclusive, never a silent pass

## Gotchas

1. **Inconclusive gates scored neutrally**: Contributing 0.5 for a check that never ran lets output with no schema and no evidence drift upward toward passing. The score ends up measuring the absence of checks.
2. **Rework without feedback**: The second attempt has exactly the same information as the first, so the improvement is chance. Pass the findings back or do not rework at all.
3. **Policy breaches reworked**: Asking an agent that just attempted a forbidden action to try again is a loop, not a correction.
4. **Self-reported confidence trusted**: A model's stated confidence is weak evidence for correctness. Its real value is asymmetric — a low number is informative, a high one is not.
5. **Unbounded rework**: Without a cap, a badly specified contract consumes budget indefinitely while looking busy. Repeated failure is a contract problem, not an attempt problem.
6. **Corrective records closed without verification**: The process then records that someone intended to fix something. Put the constraint in the state machine, not the runbook.
7. **Escalation without a terminal state**: The task returns to the same queue and cycles forever while appearing active — indistinguishable from progress on a dashboard.
8. **Unknown gates silently skipped**: A contract naming a gate the engine lacks believes it is protected. Fail closed by treating it as inconclusive.
9. **Feedback fetched on every attempt**: Logically harmless, but it forces a read per task and, behind a write buffer, a flush that can cancel the buffering entirely. Fetch only on reworks.
10. **Only failures recorded**: Without pass records there is no pass *rate*, and contract drift becomes invisible until it is severe.

## Integration

- evaluation - Produces the scores and rubrics this skill acts on
- advanced-evaluation - LLM-as-judge techniques for gates that need judgement
- agent-contracts - The output schema and quality policy drive gate selection and thresholds
- work-packets - A rework is a new attempt on the same packet, not a new packet
- agent-permissions - Overriding a verdict is an owner-gated capability
- agent-observability - Verdicts and corrective records are primary audit events

## References

- [Quality gates and corrective loop](./scripts/quality_gates.py) - Runnable gates, verdict policy, rework feedback, and a CAPA state machine
- Worked implementation: `examples/agent-factory-runtime/af/quality/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
