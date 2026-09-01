"""Contract validation.

Errors block promotion; warnings are recorded and surfaced but do not block.
The distinction is deliberate: a validator that blocks on style produces
pressure to bypass validation, and a bypassed validator protects nothing.

The rules below are grouped by what they actually defend against, because a
validator whose rules aren't traceable to a threat degenerates into a schema
check that agrees with itself.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from af.contracts.schema import AgentContract, AgentLevel
from af.quality.gates import BUILTIN_GATES

__all__ = ["ValidationReport", "Finding", "validate_contract", "SYSTEM_CAPS"]


#: Absolute ceilings no contract may exceed regardless of who authors it.
#: These exist so that a compromised or confused Chief cannot mint an agent
#: with unbounded blast radius. They are deliberately *not* configurable from
#: within a contract — only from system configuration.
SYSTEM_CAPS: dict[str, Any] = {
    "max_concurrency_limit": 64,
    "max_instances": 500,
    "max_spawn_depth": 6,
    "max_children_per_task": 64,
    "max_total_spawns": 2_000,
    "max_cost_limit_micros": 100_000_000,     # $100 per agent
    "max_token_limit": 100_000_000,
    "max_task_timeout_seconds": 3_600.0,
    "max_tool_calls_per_task": 200,
    "max_context_tokens": 2_000_000,
}

#: Permissions an agent may never hold, at any level. Granting any of these
#: would let an agent rewrite the rules that constrain it, which collapses the
#: entire governance model. Checked here *and* re-checked at grant time.
FORBIDDEN_PERMISSIONS = frozenset({
    "governance.permissions.write",
    "governance.contract.self_modify",
    "governance.approval.self_approve",
    "governance.budget.self_raise",
    "system.sql.execute",
    "system.shell.execute",
    "system.secrets.read",
})

VALID_ESCALATION_ACTIONS = frozenset({
    "escalate_parent", "escalate_chief", "owner_approval", "abort", "retry", "reassign",
})

#: Derived from the quality engine's actual gate registry rather than restated.
#: These two lists were originally maintained separately and immediately drifted
#: ('completeness' was implemented but not accepted), silently blocking every
#: contract that used it. A validator that can disagree with the thing it
#: validates is worse than no validator, so there is now one source of truth.
VALID_GATES = frozenset(BUILTIN_GATES)

#: Who performs review when gates are inconclusive. Distinct from `gates`:
#: a reviewer is not a gate, and conflating them let contracts configure
#: 'peer'/'owner' as gates that the engine could never execute.
VALID_REVIEWER_TYPES = frozenset({"automated", "peer", "master", "chief", "owner"})
VALID_TRUST = frozenset({"authoritative", "verified", "derived", "unverified"})
KNOWN_LAYERS = frozenset({"working", "episodic", "project", "authoritative", "agent", "shared_org"})
#: Writing here changes what the whole fleet treats as ground truth, so it
#: requires an explicit capability rather than coming with the layer grant.
GOVERNED_WRITE_LAYERS = frozenset({"authoritative", "shared_org"})


@dataclass(frozen=True, slots=True)
class Finding:
    code: str
    field: str
    message: str
    severity: str = "error"          # error|warning

    def __str__(self) -> str:
        return f"[{self.severity}] {self.code} @ {self.field}: {self.message}"


@dataclass(slots=True)
class ValidationReport:
    findings: list[Finding] = field(default_factory=list)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def error(self, code: str, fld: str, msg: str) -> None:
        self.findings.append(Finding(code, fld, msg, "error"))

    def warn(self, code: str, fld: str, msg: str) -> None:
        self.findings.append(Finding(code, fld, msg, "warning"))

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            # asdict, not __dict__: Finding uses slots=True and therefore has
            # no instance __dict__.
            "errors": [asdict(f) for f in self.errors],
            "warnings": [asdict(f) for f in self.warnings],
        }


def validate_contract(
    c: AgentContract,
    *,
    known_tools: set[str] | None = None,
    known_permissions: set[str] | None = None,
) -> ValidationReport:
    """Full validation. ``known_tools``/``known_permissions`` come from the live
    registries; when omitted those cross-reference checks are skipped (used in
    unit tests of the contract shape alone)."""
    r = ValidationReport()

    # --- identity & purpose: an agent with no stated purpose cannot be
    # reviewed, and an unreviewable agent cannot be governed.
    if not c.name or not c.name.strip():
        r.error("missing_name", "name", "name is required")
    elif not _is_slug(c.name):
        r.error("bad_name", "name", "name must be lowercase alphanumeric with hyphens")
    if not c.role.strip():
        r.error("missing_role", "role", "role is required")
    if not c.mission.strip():
        r.error("missing_mission", "mission", "mission is required")
    elif len(c.mission.strip()) < 20:
        r.warn("thin_mission", "mission", "mission is very short; delegation quality depends on it")
    if not c.responsibilities:
        r.error("missing_responsibilities", "responsibilities", "at least one responsibility is required")
    if not c.outputs:
        r.error("missing_outputs", "outputs", "at least one declared output is required")
    if not c.capabilities:
        r.warn("no_capabilities", "capabilities",
               "no declared capabilities; the Chief cannot match this agent for reuse")

    # --- level ---------------------------------------------------------
    try:
        level = AgentLevel(c.level)
    except ValueError:
        r.error("bad_level", "level", f"level {c.level} is not a valid AgentLevel")
        level = None
    if level is AgentLevel.SYSTEM:
        # L0 is the owner/system boundary. An agent holding it would be
        # indistinguishable from the owner in every downstream check.
        r.error("l0_not_assignable", "level", "L0 (SYSTEM) cannot be assigned to an agent")
    if level is AgentLevel.CHIEF and c.parent_template_id:
        r.error("chief_has_parent", "parent_template_id", "L5 Chief must be the hierarchy root")
    if level and level.value <= AgentLevel.SPECIALIST.value and c.runtime.max_spawn_depth > 1:
        # A specialist that can build deep subtrees is how uncontrolled fan-out
        # starts. Team leads and above coordinate; specialists do the work.
        r.error("low_level_deep_spawn", "runtime.max_spawn_depth",
                f"L{level.value} may not spawn deeper than 1 (got {c.runtime.max_spawn_depth})")

    # --- permissions: the core escalation defence ----------------------
    for p in c.permissions:
        if p in FORBIDDEN_PERMISSIONS:
            r.error("forbidden_permission", "permissions",
                    f"'{p}' may never be granted to an agent")
        if known_permissions is not None and p not in known_permissions and p not in FORBIDDEN_PERMISSIONS:
            r.error("unknown_permission", "permissions", f"unknown permission '{p}'")
    # A contract that both grants and forbids the same action is ambiguous, and
    # ambiguity in a security decision resolves badly under pressure.
    overlap = set(c.permissions) & set(c.forbidden_actions)
    if overlap:
        r.error("permission_conflict", "forbidden_actions",
                f"granted and forbidden simultaneously: {sorted(overlap)}")

    # --- tools ---------------------------------------------------------
    seen_tools: set[str] = set()
    for t in c.tools:
        if t.tool_id in seen_tools:
            r.error("duplicate_tool", "tools", f"tool '{t.tool_id}' listed twice")
        seen_tools.add(t.tool_id)
        if known_tools is not None and t.tool_id not in known_tools:
            r.error("unknown_tool", "tools", f"tool '{t.tool_id}' is not registered in the gateway")
        if t.max_calls_per_task < 1:
            r.error("bad_tool_limit", "tools", f"tool '{t.tool_id}' max_calls_per_task must be >= 1")
        if t.requires_approval_override is False:
            # Relaxing approval is an owner decision, never a contract-author one.
            r.error("approval_downgrade", "tools",
                    f"tool '{t.tool_id}' attempts to waive approval; only the owner may do that")
    if seen_tools & set(c.forbidden_actions):
        r.error("tool_forbidden_conflict", "tools",
                f"tools granted that are also forbidden: {sorted(seen_tools & set(c.forbidden_actions))}")

    # --- memory --------------------------------------------------------
    for layer in c.memory.readable_layers:
        if layer not in KNOWN_LAYERS:
            r.error("unknown_layer", "memory.readable_layers", f"unknown memory layer '{layer}'")
    for layer in c.memory.writable_layers:
        if layer not in KNOWN_LAYERS:
            r.error("unknown_layer", "memory.writable_layers", f"unknown memory layer '{layer}'")
        if layer not in c.memory.readable_layers:
            r.warn("write_without_read", "memory.writable_layers",
                   f"writable but not readable: '{layer}'")
        if layer in GOVERNED_WRITE_LAYERS and f"memory.{layer}.write" not in c.permissions:
            r.error("ungoverned_authoritative_write", "memory.writable_layers",
                    f"writing '{layer}' requires the 'memory.{layer}.write' permission")
    if c.memory.min_trust_for_read not in VALID_TRUST:
        r.error("bad_trust", "memory.min_trust_for_read",
                f"'{c.memory.min_trust_for_read}' is not a valid trust level")
    if c.memory.share_to_org and not c.knowledge.allow_org_shared:
        r.error("share_scope_conflict", "memory.share_to_org",
                "share_to_org requires knowledge.allow_org_shared")

    # --- project isolation ---------------------------------------------
    extra_projects = [p for p in c.knowledge.projects if p != c.project_id]
    if extra_projects and "project.cross_access" not in c.permissions:
        r.error("cross_project_without_permission", "knowledge.projects",
                f"access to {extra_projects} requires the 'project.cross_access' permission")
    if c.project_id is None and level and level.value < AgentLevel.CHIEF.value:
        r.error("unscoped_agent", "project_id",
                "only the L5 Chief may exist without a project scope")

    # --- budgets --------------------------------------------------------
    b = c.budget
    if b.cost_limit_micros <= 0:
        r.error("bad_budget", "budget.cost_limit_micros", "must be positive")
    if b.cost_limit_micros > SYSTEM_CAPS["max_cost_limit_micros"]:
        r.error("budget_over_cap", "budget.cost_limit_micros",
                f"exceeds system cap {SYSTEM_CAPS['max_cost_limit_micros']}")
    if b.token_limit > SYSTEM_CAPS["max_token_limit"]:
        r.error("tokens_over_cap", "budget.token_limit", "exceeds system token cap")
    # A per-task budget above the lifetime budget means the lifetime budget is
    # decorative — the first task could consume it entirely.
    if b.per_task_cost_limit_micros > b.cost_limit_micros:
        r.error("task_budget_exceeds_total", "budget.per_task_cost_limit_micros",
                "per-task cost limit exceeds the agent's total cost limit")
    if b.per_task_token_limit > b.token_limit:
        r.error("task_tokens_exceed_total", "budget.per_task_token_limit",
                "per-task token limit exceeds the agent's total token limit")
    if b.per_task_token_limit > c.context.max_context_tokens * 4:
        r.warn("token_budget_loose", "budget.per_task_token_limit",
               "per-task token limit allows many full-context calls; check this is intended")

    # --- runtime limits -------------------------------------------------
    rt = c.runtime
    for attr, cap_key in (
        ("concurrency_limit", "max_concurrency_limit"),
        ("max_instances", "max_instances"),
        ("max_spawn_depth", "max_spawn_depth"),
        ("max_children_per_task", "max_children_per_task"),
        ("max_total_spawns", "max_total_spawns"),
        ("task_timeout_seconds", "max_task_timeout_seconds"),
        ("max_tool_calls_per_task", "max_tool_calls_per_task"),
    ):
        value = getattr(rt, attr)
        if value <= 0:
            r.error("bad_runtime_limit", f"runtime.{attr}", "must be positive")
        elif value > SYSTEM_CAPS[cap_key]:
            r.error("runtime_over_cap", f"runtime.{attr}",
                    f"{value} exceeds system cap {SYSTEM_CAPS[cap_key]}")
    if rt.task_timeout_seconds * 1000 < b.latency_target_ms:
        r.error("timeout_below_target", "runtime.task_timeout_seconds",
                "task timeout is below the stated latency target; tasks would be killed before succeeding")

    # --- context ---------------------------------------------------------
    if c.context.max_context_tokens > SYSTEM_CAPS["max_context_tokens"]:
        r.error("context_over_cap", "context.max_context_tokens", "exceeds system cap")
    if not 0.0 < c.context.compaction_threshold <= 1.0:
        r.error("bad_threshold", "context.compaction_threshold", "must be in (0, 1]")
    if c.context.max_context_tokens > c.model.max_context_tokens:
        r.error("context_exceeds_model", "context.max_context_tokens",
                "context budget exceeds what the model policy guarantees")

    # --- model ----------------------------------------------------------
    if c.model.tier not in {"cheap", "standard", "frontier"}:
        r.error("bad_tier", "model.tier", f"unknown tier '{c.model.tier}'")
    if c.model.min_reasoning not in {"basic", "intermediate", "advanced"}:
        r.error("bad_reasoning", "model.min_reasoning", f"unknown level '{c.model.min_reasoning}'")
    if c.model.privacy_class not in {"standard", "sensitive", "restricted"}:
        r.error("bad_privacy", "model.privacy_class", f"unknown privacy class '{c.model.privacy_class}'")
    conflict = set(c.model.preferred_providers) & set(c.model.forbidden_providers)
    if conflict:
        r.error("provider_conflict", "model.forbidden_providers",
                f"provider both preferred and forbidden: {sorted(conflict)}")
    if c.model.max_latency_ms > b.latency_target_ms:
        r.warn("latency_mismatch", "model.max_latency_ms",
               "a single model call may exceed the agent's whole latency target")

    # --- retry -----------------------------------------------------------
    if c.retry.max_attempts < 1:
        r.error("bad_attempts", "retry.max_attempts", "must be >= 1")
    if c.retry.max_attempts > 10:
        r.error("too_many_attempts", "retry.max_attempts",
                "more than 10 attempts risks a retry storm and burns budget")
    if not 0.0 <= c.retry.jitter <= 1.0:
        r.error("bad_jitter", "retry.jitter", "must be in [0, 1]")
    if c.retry.backoff_multiplier < 1.0:
        r.error("bad_multiplier", "retry.backoff_multiplier", "must be >= 1.0")

    # --- quality ----------------------------------------------------------
    if not c.quality.gates:
        r.error("no_gates", "quality.gates", "at least one quality gate is required")
    for g in c.quality.gates:
        if g not in VALID_GATES:
            r.error("unknown_gate", "quality.gates",
                    f"unknown gate '{g}'; available: {sorted(VALID_GATES)}")
    if c.quality.reviewer_type not in VALID_REVIEWER_TYPES:
        r.error("unknown_reviewer", "quality.reviewer_type",
                f"unknown reviewer type '{c.quality.reviewer_type}'; "
                f"available: {sorted(VALID_REVIEWER_TYPES)}")
    if not 0.0 <= c.quality.min_score <= 1.0:
        r.error("bad_min_score", "quality.min_score", "must be in [0, 1]")
    if c.quality.max_rework_attempts > 5:
        r.error("rework_unbounded", "quality.max_rework_attempts",
                "more than 5 rework cycles indicates a contract problem, not a task problem")
    if c.quality.require_evidence and "evidence" not in c.quality.gates:
        r.warn("evidence_not_gated", "quality.gates",
               "require_evidence is set but the evidence gate is not enabled")
    if "schema" in c.quality.gates and c.model.requires_structured_output and not c.output_schema:
        r.error("schema_gate_without_schema", "output_schema",
                "the schema gate needs an output_schema to validate against")

    # --- escalation --------------------------------------------------------
    for rule in c.escalation:
        if rule.action not in VALID_ESCALATION_ACTIONS:
            r.error("bad_escalation_action", "escalation", f"unknown action '{rule.action}'")
    if not c.escalation:
        r.warn("no_escalation", "escalation",
               "no escalation rules; failures will follow defaults only")
    else:
        actions = {rule.condition: rule.action for rule in c.escalation}
        if actions.get("quality_failed") == "abort" and c.quality.max_rework_attempts > 0:
            r.warn("escalation_contradiction", "escalation",
                   "quality failure aborts immediately, so the configured rework attempts are unreachable")

    # --- KPIs ---------------------------------------------------------------
    for k in c.kpis:
        if k.direction not in {"gte", "lte"}:
            r.error("bad_kpi_direction", "kpis", f"KPI '{k.name}' direction must be gte or lte")
    if not c.kpis:
        r.warn("no_kpis", "kpis", "no KPIs; the improvement loop has nothing to measure against")

    return r


def _is_slug(value: str) -> bool:
    return all(ch.islower() or ch.isdigit() or ch == "-" for ch in value) and not value.startswith("-")
