"""Quality gates as runtime control flow, plus a corrective-action loop.

Evaluation produces a score; this decides what happens next. Four verdicts
(PASS / REWORK / ESCALATE / REJECT) with distinct downstream effects, and a
corrective record that cannot be closed without a verified re-execution.

Use when:
    - Agent output must be checked before it reaches a caller.
    - Failed work should be retried, escalated, or rejected on different criteria.
    - The same defect keeps recurring and needs a closed loop.

Standard library only.

Typical usage::

    engine = QualityEngine()
    review = engine.evaluate(output=result, contract=contract, attempt=1)
    if review.verdict is Verdict.REWORK:
        requeue(task, feedback=review.findings)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

__all__ = [
    "Verdict", "GateResult", "QualityReview", "QualityEngine", "QualityPolicy",
    "BUILTIN_GATES", "CapaStatus", "CapaRecord", "CapaEngine",
]


class Verdict(str, Enum):
    PASS = "PASS"          # meets policy -> return to caller
    REWORK = "REWORK"      # fixable by the same agent -> requeue WITH findings
    ESCALATE = "ESCALATE"  # not fixable alone -> park for a higher level
    REJECT = "REJECT"      # unusable -> terminate


@dataclass
class GateResult:
    gate_id: str
    passed: bool
    score: float                       # 0..1
    findings: list[str] = field(default_factory=list)
    #: A gate that could not reach a conclusion says so. Inconclusive results
    #: are EXCLUDED from the score rather than contributing a neutral value.
    inconclusive: bool = False
    weight: float = 1.0


@dataclass(frozen=True)
class QualityPolicy:
    gates: tuple[str, ...] = ("schema", "policy", "completeness", "evidence")
    min_score: float = 0.7
    min_confidence: float = 0.6
    max_rework_attempts: int = 2
    escalate_on_repeat_failure: bool = True


@dataclass
class QualityReview:
    verdict: Verdict
    score: float
    confidence: float
    attempt: int
    gate_results: list[GateResult]
    findings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {"verdict": self.verdict.value, "score": round(self.score, 4),
                "confidence": round(self.confidence, 4), "attempt": self.attempt,
                "findings": self.findings,
                "gates": {g.gate_id: ("inconclusive" if g.inconclusive
                                      else ("pass" if g.passed else "fail"))
                          for g in self.gate_results}}


# --------------------------------------------------------------------------
# Gates
# --------------------------------------------------------------------------
def schema_gate(output: Any, contract: Any) -> GateResult:
    """Structural validity. Objective and consequential, so weighted high."""
    schema = getattr(contract, "output_schema", None)
    if not schema:
        return GateResult("schema", True, 1.0, ["no schema declared"], inconclusive=True)
    if not isinstance(output, dict):
        return GateResult("schema", False, 0.0, ["output is not an object"], weight=2.0)
    missing = [k for k in schema.get("required", []) if k not in output]
    return GateResult("schema", not missing, 1.0 if not missing else 0.0,
                      [f"missing required property '{k}'" for k in missing], weight=2.0)


def policy_gate(output: Any, contract: Any) -> GateResult:
    """Forbidden-action check. A coarse lexical scan; the real enforcement is
    the tool gateway. This is defence in depth, catching an agent that describes
    or attempts a forbidden action."""
    text = str(output).lower()
    findings = [f"output references forbidden action '{a}'"
                for a in getattr(contract, "forbidden_actions", ())
                if a.lower() in text]
    return GateResult("policy", not findings, 1.0 if not findings else 0.0,
                      findings, weight=2.0)


def completeness_gate(output: Any, contract: Any) -> GateResult:
    if not isinstance(output, dict):
        return GateResult("completeness", False, 0.0, ["output is not an object"])
    declared = getattr(contract, "outputs", ())
    missing = [name for name in declared
               if name not in output or output[name] in (None, "", [], {})]
    score = 1.0 - (len(missing) / max(1, len(declared)))
    return GateResult("completeness", not missing, score,
                      [f"missing or empty output '{m}'" for m in missing])


def evidence_gate(output: Any, contract: Any) -> GateResult:
    """Require claims to be traceable. Checks that sources are PRESENT — it
    cannot detect a fabricated citation."""
    if not isinstance(output, dict):
        return GateResult("evidence", False, 0.0, ["output is not structured"])
    for key in ("evidence", "sources", "citations"):
        value = output.get(key)
        if value:
            n = len(value) if isinstance(value, (list, tuple)) else 1
            return GateResult("evidence", True, min(1.0, 0.5 + 0.25 * n),
                              [f"{n} evidence item(s)"])
    return GateResult("evidence", False, 0.0, ["no evidence or sources provided"])


def confidence_gate(output: Any, contract: Any) -> GateResult:
    """Self-reported confidence, treated with suspicion.

    Weighted low because a model's own confidence is weak evidence for
    correctness. Its value is asymmetric: a LOW number is a genuine warning the
    agent has given you; a high one means very little.
    """
    if not isinstance(output, dict) or "confidence" not in output:
        return GateResult("confidence", True, 0.5, ["no self-reported confidence"],
                          inconclusive=True, weight=0.5)
    try:
        value = float(output["confidence"])
    except (TypeError, ValueError):
        return GateResult("confidence", False, 0.0, ["confidence is not a number"],
                          weight=0.5)
    floor = getattr(contract, "min_confidence", 0.6)
    return GateResult("confidence", value >= floor, max(0.0, min(1.0, value)),
                      [] if value >= floor else [f"confidence {value:.2f} < {floor:.2f}"],
                      weight=0.5)


BUILTIN_GATES: dict[str, Callable[[Any, Any], GateResult]] = {
    "schema": schema_gate,
    "policy": policy_gate,
    "completeness": completeness_gate,
    "evidence": evidence_gate,
    "confidence": confidence_gate,
}


# --------------------------------------------------------------------------
class QualityEngine:
    def __init__(self, gates: dict[str, Callable] | None = None) -> None:
        self.gates = dict(BUILTIN_GATES)
        if gates:
            self.gates.update(gates)

    def evaluate(self, *, output: Any, contract: Any, attempt: int = 1,
                 policy: QualityPolicy | None = None) -> QualityReview:
        policy = policy or getattr(contract, "quality", None) or QualityPolicy()
        results: list[GateResult] = []

        for gate_id in policy.gates:
            gate = self.gates.get(gate_id)
            if gate is None:
                # An unimplemented gate must NOT silently pass: a contract
                # naming it believes it is protected. Fail closed.
                results.append(GateResult(gate_id, False, 0.0,
                                          [f"gate '{gate_id}' is not implemented"],
                                          inconclusive=True))
                continue
            try:
                results.append(gate(output, contract))
            except Exception as exc:
                results.append(GateResult(gate_id, False, 0.0,
                                          [f"gate raised {type(exc).__name__}: {exc}"],
                                          inconclusive=True))

        score = weighted_score(results)
        conclusive = [r for r in results if not r.inconclusive]
        # Confidence here is how much we trust THIS VERDICT — the fraction of
        # gates that reached a conclusion — not the model's self-report.
        confidence = len(conclusive) / len(results) if results else 0.0

        verdict = self._decide(results, score, confidence, policy, attempt)
        findings = [f"{r.gate_id}: {f}" for r in results for f in r.findings
                    if not r.passed]
        return QualityReview(verdict, score, confidence, attempt, results, findings)

    def _decide(self, results, score, confidence, policy, attempt) -> Verdict:
        by_id = {r.gate_id: r for r in results}

        def failed(result) -> bool:
            return result is not None and not result.passed and not result.inconclusive

        # 1. A policy breach ESCALATES, never reworks. The agent just showed it
        #    will do the forbidden thing; retrying makes a breach into a loop.
        if failed(by_id.get("policy")):
            return Verdict.ESCALATE

        # 2. Structurally invalid on the final permitted attempt is unusable.
        if failed(by_id.get("schema")) and attempt > policy.max_rework_attempts:
            return Verdict.REJECT

        if score >= policy.min_score and all(
                r.passed for r in results if not r.inconclusive):
            # 3. Passing on the numbers with too little conclusive evidence
            #    means we do not actually know that it passed.
            if confidence < policy.min_confidence and policy.escalate_on_repeat_failure:
                return Verdict.ESCALATE
            return Verdict.PASS

        # 4. Rework while attempts remain, then escalate or reject.
        if attempt > policy.max_rework_attempts:
            return Verdict.ESCALATE if policy.escalate_on_repeat_failure else Verdict.REJECT
        return Verdict.REWORK


def weighted_score(results: list[GateResult]) -> float:
    """Inconclusive gates are excluded ENTIRELY.

    Scoring them at a neutral 0.5 would let output with no schema and no
    evidence drift upward toward passing — the score would be measuring the
    absence of checks rather than the quality of work.
    """
    conclusive = [r for r in results if not r.inconclusive]
    if not conclusive:
        return 0.0
    total_weight = sum(r.weight for r in conclusive) or 1.0
    return sum(r.score * r.weight for r in conclusive) / total_weight


# --------------------------------------------------------------------------
# Corrective and preventive action
# --------------------------------------------------------------------------
class CapaStatus(str, Enum):
    OPEN = "OPEN"
    ACTION_PROPOSED = "ACTION_PROPOSED"
    REEXECUTED = "REEXECUTED"
    VERIFIED = "VERIFIED"
    CLOSED = "CLOSED"


#: Only forward moves, and closure is reachable only through VERIFIED (except by
#: an explicit owner override). Without this constraint the process records
#: intentions rather than outcomes.
_ALLOWED: dict[CapaStatus, frozenset[CapaStatus]] = {
    CapaStatus.OPEN: frozenset({CapaStatus.ACTION_PROPOSED}),
    CapaStatus.ACTION_PROPOSED: frozenset({CapaStatus.REEXECUTED}),
    # A failed re-execution goes BACK to analysis: if the fix did not work, the
    # analysis was wrong.
    CapaStatus.REEXECUTED: frozenset({CapaStatus.VERIFIED, CapaStatus.ACTION_PROPOSED}),
    CapaStatus.VERIFIED: frozenset({CapaStatus.CLOSED}),
    CapaStatus.CLOSED: frozenset(),
}


@dataclass
class CapaRecord:
    id: str
    task_id: str
    issue: str
    status: CapaStatus = CapaStatus.OPEN
    root_cause: str | None = None
    corrective_action: str | None = None
    rework_task_id: str | None = None


class CapaEngine:
    def __init__(self) -> None:
        self.records: dict[str, CapaRecord] = {}
        self._seq = 0

    def open(self, task_id: str, issue: str) -> CapaRecord:
        self._seq += 1
        record = CapaRecord(id=f"capa_{self._seq:04d}", task_id=task_id, issue=issue)
        self.records[record.id] = record
        return record

    def record_analysis(self, capa_id: str, *, root_cause: str,
                        corrective_action: str) -> None:
        record = self.records[capa_id]
        # A minimum length is a crude proxy for rigour, but it reliably blocks
        # the one-word root cause that makes the whole record worthless.
        if len(root_cause.strip()) < 10:
            raise ValueError("root cause must be substantive")
        if len(corrective_action.strip()) < 10:
            raise ValueError("corrective action must be substantive")
        self._transition(record, CapaStatus.ACTION_PROPOSED)
        record.root_cause = root_cause
        record.corrective_action = corrective_action

    def record_reexecution(self, capa_id: str, rework_task_id: str) -> None:
        record = self.records[capa_id]
        self._transition(record, CapaStatus.REEXECUTED)
        record.rework_task_id = rework_task_id

    def verify(self, capa_id: str, *, passed: bool) -> CapaStatus:
        record = self.records[capa_id]
        target = CapaStatus.VERIFIED if passed else CapaStatus.ACTION_PROPOSED
        self._transition(record, target)
        return target

    def close(self, capa_id: str, *, owner_override: bool = False) -> None:
        """Requires VERIFIED. This guard is the point of the whole module."""
        record = self.records[capa_id]
        if record.status is not CapaStatus.VERIFIED and not owner_override:
            raise ValueError(
                f"CAPA '{capa_id}' is {record.status.value}; it cannot be closed "
                f"without a verified re-execution")
        record.status = CapaStatus.CLOSED

    def _transition(self, record: CapaRecord, target: CapaStatus) -> None:
        if target not in _ALLOWED[record.status]:
            raise ValueError(f"illegal CAPA transition "
                             f"{record.status.value} -> {target.value}")
        record.status = target


# --------------------------------------------------------------------------
if __name__ == "__main__":
    @dataclass
    class Contract:
        outputs: tuple = ("article",)
        output_schema: dict = field(default_factory=lambda: {"required": ["article"]})
        forbidden_actions: tuple = ("delete_production_database",)
        min_confidence: float = 0.6
        quality: QualityPolicy = field(default_factory=QualityPolicy)

    contract = Contract()
    engine = QualityEngine()

    print("1. Good output passes")
    review = engine.evaluate(output={"article": "text", "sources": ["a", "b"]},
                             contract=contract, attempt=1)
    print(f"   {review.verdict.value}  score={review.score:.2f} "
          f"confidence={review.confidence:.2f}\n")

    print("2. Schema failure reworks while attempts remain, then rejects")
    for attempt in (1, 3):
        r = engine.evaluate(output={"wrong": "shape"}, contract=contract, attempt=attempt)
        print(f"   attempt {attempt}: {r.verdict.value}  score={r.score:.2f}")
    print()

    print("3. A policy breach ESCALATES rather than reworking")
    r = engine.evaluate(
        output={"article": "next I will delete_production_database", "sources": ["x"]},
        contract=contract, attempt=1)
    print(f"   {r.verdict.value} (retrying an agent that just breached policy "
          f"would loop)\n")

    print("4. Inconclusive gates do not inflate the score")
    bare = Contract(output_schema={}, quality=QualityPolicy(gates=("schema", "evidence")))
    r = engine.evaluate(output={"article": "text"}, contract=bare, attempt=1)
    print(f"   no schema declared, no evidence -> score={r.score:.2f} "
          f"confidence={r.confidence:.2f} verdict={r.verdict.value}")
    print("   (had the inconclusive schema gate scored 0.5, this would average up)\n")

    print("5. An unimplemented gate fails closed")
    ghost = Contract(quality=QualityPolicy(gates=("schema", "telepathy")))
    r = engine.evaluate(output={"article": "t", "sources": ["a"]}, contract=ghost,
                        attempt=1)
    print(f"   {r.verdict.value}  findings={r.findings}\n")

    print("6. A corrective record cannot close without verification")
    capa = CapaEngine()
    record = capa.open("tsk_1", "schema validation failed repeatedly")
    try:
        capa.close(record.id)
    except ValueError as exc:
        print(f"   {exc}")
    try:
        capa.record_analysis(record.id, root_cause="bad", corrective_action="fix it")
    except ValueError as exc:
        print(f"   {exc}")
    capa.record_analysis(
        record.id,
        root_cause="the output schema omitted the required article field",
        corrective_action="add an explicit schema example to the agent context")
    capa.record_reexecution(record.id, "tsk_1_rework")
    print(f"   failed rework -> {capa.verify(record.id, passed=False).value} "
          f"(back to analysis, not closed)")
    capa.record_reexecution(record.id, "tsk_1_rework2")
    print(f"   passed rework -> {capa.verify(record.id, passed=True).value}")
    capa.close(record.id)
    print(f"   closed: {capa.records[record.id].status.value}")
