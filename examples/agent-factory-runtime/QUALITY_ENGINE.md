# QUALITY_ENGINE.md

## 1. Quality as infrastructure

Quality is enforced by deterministic code, not by asking a model to be careful.
Each gate is a function of `(output, packet, contract)` returning a score and
findings; the engine combines them into one of four verdicts.

---

## 2. Gates

| Gate | Checks | Weight |
|---|---|---|
| `schema` | Output validates against the declared schema | 2.0 |
| `policy` | No forbidden action appears in the output | 2.0 |
| `evidence` | Claims carry sources/citations | 1.0 |
| `completeness` | Every declared output is present and non-empty | 1.0 |
| `confidence` | Self-reported confidence meets the floor | **0.5** |

`confidence` is weighted low on purpose. A model's own confidence is weak
evidence, and a *missing* confidence is treated as inconclusive rather than as a
failure. Its real value is the case where the agent itself says it is unsure —
that is a reliable signal and worth escalating on.

`policy` is a coarse lexical check and is documented as such. Real enforcement is
the tool gateway; this gate is defence in depth, catching an agent that
*describes or attempts* a forbidden action.

---

## 3. Inconclusive gates

A gate that cannot reach a conclusion says so, and inconclusive gates are
**excluded from the score entirely**.

Letting an inconclusive gate contribute a nominal 0.5 would let a task with no
schema and no evidence drift to a passing average — the score would be measuring
the absence of checks rather than the quality of work. Excluding them keeps the
score honest and pushes the uncertainty into `confidence`, defined here as *how
much we trust this verdict* (the fraction of gates that reached a conclusion),
where the verdict logic can act on it.

---

## 4. Verdicts

| Verdict | Meaning | Effect |
|---|---|---|
| `PASS` | Meets policy | Result returns to the parent |
| `REWORK` | Wrong but plausibly fixable by the same agent | Requeued with findings |
| `ESCALATE` | Unlikely to be fixed by this agent alone | Parked for a higher level |
| `REJECT` | Unusable and not worth reworking | Dead-lettered |

Decision order encodes severity:

1. **A policy breach escalates immediately** — never reworks. Asking an agent
   that just breached policy to try again is how a breach becomes a loop.
2. **Schema-invalid on the final attempt rejects** — rework has been tried.
3. **Passing on the numbers but with low confidence escalates** — if too few
   gates reached a conclusion, we do not actually know that it passed.
4. Otherwise: rework while attempts remain, then escalate or reject per policy.

**Rework carries the findings back.** A rework without the reason is just a
re-roll; passing the previous findings into the next attempt is what makes the
second attempt more likely to succeed than the first. This is fetched only on
attempts > 1 — see ADR-0007 for why that detail was load-bearing.

---

## 5. CAPA

```
Issue → Root Cause → Corrective Action → Re-execution → Verification → Closure
```

The value is not the record-keeping, it is one constraint:

> **A CAPA cannot be closed without a verified re-execution.**

`close()` refuses unless the record is `VERIFIED` (owner override excepted, and
recorded as an override). Without that rule, CAPA degenerates into the common
failure mode where a defect is "addressed" by an explanation and nothing changes.

A **failed** rework returns the record to `ACTION_PROPOSED` rather than closing
it — a failed corrective action means the analysis was wrong, so the loop goes
back to analysis.

Root cause and corrective action must be substantive (a minimum length is
enforced). It is a crude proxy for rigour, but it reliably blocks the
empty-ritual case of a one-word root cause.

This is the ISO-minded traceability the mandate asks for: for any failure the
system can answer what went wrong, why, what was done, whether it worked, and who
closed it.

---

## 6. Escalation

The contract's escalation rules choose the destination: `escalate_parent`,
`escalate_chief`, `owner_approval`, or `abort`. Escalated tasks are parked in
`WAITING_APPROVAL` — terminal for the worker, so no worker re-claims them and
they do not loop while awaiting a decision.

---

## 7. Limits

- Gates are **deterministic**. There is no LLM-as-judge gate in v0.4. The
  `reviewer_type` field (`peer`/`master`/`chief`/`owner`) is carried through the
  data model and reported, but agent-performed review is not implemented.
- `evidence` checks that sources are *present*, not that they are *real*. It
  cannot detect a fabricated citation.
- `policy` is substring matching over the output.
- `AgentFactory.run_tests` is a **structural smoke test**, not a behavioural
  evaluation. Its own result payload says so. A passing smoke test must not be
  mistaken for a quality bar on the agent's actual work.
