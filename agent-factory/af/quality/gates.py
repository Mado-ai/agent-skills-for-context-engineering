"""Quality Gates.

Quality is treated as infrastructure, not as a prompt asking the model to be
careful. Each gate is a deterministic function of (output, packet, contract)
returning a score and findings; the engine combines them into one of four
verdicts.

Verdict semantics — the distinction that makes the loop work:

* ``PASS``     — meets policy; result returns to the parent.
* ``REWORK``   — wrong but plausibly fixable by the same agent with feedback.
* ``ESCALATE`` — the agent is unlikely to fix it alone (repeat failure, low
                 confidence, or a policy breach); a higher level decides.
* ``REJECT``   — unusable and not worth reworking (e.g. schema-invalid on the
                 final attempt, or a forbidden action attempted).

The ordering matters: a policy violation escalates rather than reworks, because
asking an agent that just breached policy to try again is how a breach becomes a
loop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from af.clock import Clock, SystemClock
from af.ids import new_id
from af.jsonschema import validate as schema_validate
from af.store.sqlite_store import SqliteStore, dumps
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["Verdict", "GateResult", "QualityReview", "QualityEngine", "Gate"]


class Verdict(str, Enum):
    PASS = "PASS"
    REWORK = "REWORK"
    ESCALATE = "ESCALATE"
    REJECT = "REJECT"


@dataclass(slots=True)
class GateResult:
    gate_id: str
    passed: bool
    score: float                      # 0..1
    findings: list[str] = field(default_factory=list)
    #: A gate that cannot reach a conclusion says so rather than guessing.
    #: Inconclusive gates push toward ESCALATE, never toward PASS.
    inconclusive: bool = False
    weight: float = 1.0


@dataclass(slots=True)
class QualityReview:
    id: str
    task_id: str
    verdict: Verdict
    score: float
    confidence: float
    gate_results: list[GateResult]
    reviewer_type: str
    attempt: int
    findings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "task_id": self.task_id, "verdict": self.verdict.value,
                "score": round(self.score, 4), "confidence": round(self.confidence, 4),
                "reviewer_type": self.reviewer_type, "attempt": self.attempt,
                "findings": self.findings,
                "gates": [{"gate": g.gate_id, "passed": g.passed,
                           "score": round(g.score, 4), "findings": g.findings,
                           "inconclusive": g.inconclusive} for g in self.gate_results]}


Gate = Callable[[Any, Any, Any], GateResult]


# --- built-in gates ------------------------------------------------------
def schema_gate(output: Any, packet, contract) -> GateResult:
    """Structural validity against the declared output schema."""
    schema = packet.required_output_schema or contract.output_schema
    if not schema:
        return GateResult("schema", True, 1.0, ["no schema declared"], inconclusive=True)
    errors = schema_validate(output, schema)
    return GateResult("schema", not errors, 1.0 if not errors else 0.0, errors, weight=2.0)


def policy_gate(output: Any, packet, contract) -> GateResult:
    """Forbidden-action check over the produced output.

    Scans for any forbidden action the contract names appearing in the output.
    This is a coarse lexical check and is documented as such — it catches an
    agent describing or attempting a forbidden action, not a cleverly obfuscated
    one. The real enforcement is the gateway; this gate is defence in depth.
    """
    findings = []
    text = str(output).lower()
    for forbidden in contract.forbidden_actions:
        if forbidden.lower() in text:
            findings.append(f"output references forbidden action '{forbidden}'")
    return GateResult("policy", not findings, 1.0 if not findings else 0.0,
                      findings, weight=2.0)


def evidence_gate(output: Any, packet, contract) -> GateResult:
    """Require claims to be traceable to sources.

    Looks for a non-empty ``evidence``/``sources``/``citations`` field. Unverified
    model assertions are exactly what the memory layer's trust levels exist to
    keep out of authoritative knowledge, and this is where that starts.
    """
    if not isinstance(output, dict):
        return GateResult("evidence", False, 0.0,
                          ["output is not structured; evidence cannot be checked"])
    for key in ("evidence", "sources", "citations"):
        value = output.get(key)
        if value:
            n = len(value) if isinstance(value, (list, tuple)) else 1
            return GateResult("evidence", True, min(1.0, 0.5 + 0.25 * n),
                              [f"{n} evidence item(s)"])
    return GateResult("evidence", False, 0.0, ["no evidence, sources or citations provided"])


def confidence_gate(output: Any, packet, contract) -> GateResult:
    """Self-reported confidence, treated with suspicion.

    A model's own confidence is weak evidence, so this gate is weighted low and
    a *missing* confidence is inconclusive rather than a failure. Its real value
    is catching the case where the agent itself says it is unsure — which is a
    reliable signal worth escalating on.
    """
    if not isinstance(output, dict) or "confidence" not in output:
        return GateResult("confidence", True, 0.5, ["no self-reported confidence"],
                          inconclusive=True, weight=0.5)
    try:
        value = float(output["confidence"])
    except (TypeError, ValueError):
        return GateResult("confidence", False, 0.0, ["confidence is not a number"], weight=0.5)
    threshold = contract.quality.min_confidence
    return GateResult("confidence", value >= threshold, max(0.0, min(1.0, value)),
                      [] if value >= threshold else [f"confidence {value:.2f} < {threshold:.2f}"],
                      weight=0.5)


def completeness_gate(output: Any, packet, contract) -> GateResult:
    """Every declared output must actually be present and non-empty."""
    if not isinstance(output, dict):
        return GateResult("completeness", False, 0.0, ["output is not an object"])
    missing = [name for name in contract.outputs
               if name not in output or output[name] in (None, "", [], {})]
    score = 1.0 - (len(missing) / max(1, len(contract.outputs)))
    return GateResult("completeness", not missing, score,
                      [f"missing or empty output '{m}'" for m in missing])


BUILTIN_GATES: dict[str, Gate] = {
    "schema": schema_gate,
    "policy": policy_gate,
    "evidence": evidence_gate,
    "confidence": confidence_gate,
    "completeness": completeness_gate,
}


class QualityEngine:
    def __init__(self, store: SqliteStore, telemetry: Telemetry,
                 clock: Clock | None = None,
                 gates: dict[str, Gate] | None = None, batcher=None) -> None:
        self.store = store
        self.telemetry = telemetry
        self.clock = clock or SystemClock()
        #: Optional write-behind batcher. Reviews are an append-only record, so
        #: batching them costs nothing correctness-wise and removes one write
        #: transaction from every task.
        self.batcher = batcher
        self.gates = dict(BUILTIN_GATES)
        if gates:
            self.gates.update(gates)

    def evaluate(self, *, output: Any, packet, contract, attempt: int = 1,
                 reviewer_type: str | None = None) -> QualityReview:
        results: list[GateResult] = []
        for gate_id in contract.quality.gates:
            gate = self.gates.get(gate_id)
            if gate is None:
                # An unknown gate must not silently pass. Contract validation
                # should have caught this, so treat reaching here as a defect
                # in configuration and escalate rather than ignore.
                results.append(GateResult(gate_id, False, 0.0,
                                          [f"gate '{gate_id}' is not implemented"],
                                          inconclusive=True))
                continue
            try:
                results.append(gate(output, packet, contract))
            except Exception as exc:
                results.append(GateResult(gate_id, False, 0.0,
                                          [f"gate raised {type(exc).__name__}: {exc}"],
                                          inconclusive=True))

        score = _weighted_score(results)
        # Confidence here means "how much do we trust this verdict", which falls
        # as gates become inconclusive — not the agent's self-report.
        conclusive = [r for r in results if not r.inconclusive]
        confidence = len(conclusive) / len(results) if results else 0.0

        verdict = self._decide(results, score, confidence, contract, attempt)
        findings = [f"{r.gate_id}: {f}" for r in results for f in r.findings if not r.passed]

        review = QualityReview(
            id=new_id("qrv"), task_id=packet.id, verdict=verdict, score=score,
            confidence=confidence, gate_results=results,
            reviewer_type=reviewer_type or contract.quality.reviewer_type,
            attempt=attempt, findings=findings)
        self._persist(review, packet)
        return review

    def _decide(self, results, score, confidence, contract, attempt) -> Verdict:
        """Verdict policy. Order encodes severity: hard failures first."""
        policy = contract.quality
        by_id = {r.gate_id: r for r in results}

        # A policy breach is never a rework — the agent just demonstrated it
        # will do the forbidden thing. A human or a higher level decides.
        pol = by_id.get("policy")
        if pol is not None and not pol.passed and not pol.inconclusive:
            return Verdict.ESCALATE

        # Structurally invalid output on the final permitted attempt is
        # unusable; further rework has already been tried.
        sch = by_id.get("schema")
        schema_failed = sch is not None and not sch.passed and not sch.inconclusive
        if schema_failed and attempt > policy.max_rework_attempts:
            return Verdict.REJECT

        if score >= policy.min_score and all(
                r.passed for r in results if not r.inconclusive):
            # Passing on the numbers but with too little conclusive evidence
            # means we do not actually know it passed.
            if confidence < policy.min_confidence and policy.escalate_on_repeat_failure:
                return Verdict.ESCALATE
            return Verdict.PASS

        if attempt > policy.max_rework_attempts:
            # Out of rework budget. Escalate if configured to, otherwise reject.
            return Verdict.ESCALATE if policy.escalate_on_repeat_failure else Verdict.REJECT
        return Verdict.REWORK

    _INSERT_REVIEW = (
        "INSERT INTO quality_reviews (id, task_id, project_id, gate_id, verdict, score, "
        "confidence, reviewer_type, reviewer_id, findings, attempt, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")

    def _persist(self, review: QualityReview, packet) -> None:
        row = (review.id, review.task_id, packet.project_id,
                ",".join(g.gate_id for g in review.gate_results), review.verdict.value,
               review.score, review.confidence, review.reviewer_type, None,
               dumps(review.findings), review.attempt, self.clock.now())
        if self.batcher is not None:
            self.batcher.add(self._INSERT_REVIEW, row)
        else:
            self.store.execute(self._INSERT_REVIEW, row)
        self.telemetry.emit(Event(
            type=EventType.QUALITY_EVALUATED, task_id=review.task_id,
            trace_id=packet.trace_id, project_id=packet.project_id,
            status=review.verdict.value,
            payload={"score": round(review.score, 4),
                     "confidence": round(review.confidence, 4),
                     "attempt": review.attempt, "findings": review.findings[:10],
                     "gates": {g.gate_id: g.passed for g in review.gate_results}}))

    def history(self, task_id: str) -> list[dict[str, Any]]:
        # Reviews may be sitting in the write-behind buffer.
        if self.batcher is not None:
            self.batcher.flush()
        return [dict(r) for r in self.store.all(
            "SELECT * FROM quality_reviews WHERE task_id = ? ORDER BY created_at", (task_id,))]


def _weighted_score(results: list[GateResult]) -> float:
    """Inconclusive gates are excluded from the score entirely.

    Letting an inconclusive gate contribute its nominal 0.5 would let a task
    with no schema and no evidence drift to a passing average. Excluding them
    keeps the score honest and pushes the uncertainty into ``confidence``,
    where the verdict logic can act on it.
    """
    conclusive = [r for r in results if not r.inconclusive]
    if not conclusive:
        return 0.0
    total_weight = sum(r.weight for r in conclusive) or 1.0
    return sum(r.score * r.weight for r in conclusive) / total_weight
