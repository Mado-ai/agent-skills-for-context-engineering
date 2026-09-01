"""Agent contract schema, validation, and lifecycle state machine.

Provides the three pieces an Agent Factory needs to create agents governably:
a contract structure, a validator that acts as a gate rather than a lint, and a
transition table in which the ACTIVE state is reachable only through APPROVAL.

Use when:
    - Building a system in which agents create, version, or retire other agents.
    - Enforcing that an invalid agent definition can never reach production.
    - Detecting duplicate agent definitions across a large population.

Standard library only. Adapt the field set to the domain; keep the shape.

Typical usage::

    contract = AgentContract(name="seo-writer", role="writer", ...)
    report = validate_contract(contract, known_tools={"kb.search"})
    if report.ok:
        assert_transition(LifecycleState.DRAFT, LifecycleState.VALIDATION)
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

__all__ = [
    "LifecycleState", "TRANSITIONS", "can_transition", "assert_transition",
    "AgentLevel", "BudgetPolicy", "RuntimePolicy", "QualityPolicy", "AgentCapability",
    "AgentContract", "Finding", "ValidationReport", "validate_contract",
    "SYSTEM_CAPS", "FORBIDDEN_PERMISSIONS",
]


# --------------------------------------------------------------------------
# Lifecycle
# --------------------------------------------------------------------------
class LifecycleState(str, Enum):
    DRAFT = "DRAFT"
    VALIDATION = "VALIDATION"
    TESTING = "TESTING"
    APPROVAL = "APPROVAL"
    ACTIVE = "ACTIVE"
    OBSERVATION = "OBSERVATION"
    IMPROVEMENT = "IMPROVEMENT"
    PAUSED = "PAUSED"
    RETIRED = "RETIRED"
    MERGED = "MERGED"


S = LifecycleState

#: Adjacency list. Anything absent is rejected. Note that ACTIVE has exactly one
#: predecessor reachable from DRAFT (APPROVAL) — that is what makes "an invalid
#: contract can never activate" a property of the graph rather than a convention.
TRANSITIONS: dict[LifecycleState, frozenset[LifecycleState]] = {
    S.DRAFT: frozenset({S.VALIDATION, S.RETIRED}),
    S.VALIDATION: frozenset({S.TESTING, S.DRAFT, S.RETIRED}),
    S.TESTING: frozenset({S.APPROVAL, S.DRAFT, S.RETIRED}),
    S.APPROVAL: frozenset({S.ACTIVE, S.DRAFT, S.RETIRED}),
    S.ACTIVE: frozenset({S.OBSERVATION, S.IMPROVEMENT, S.PAUSED, S.RETIRED, S.MERGED}),
    S.OBSERVATION: frozenset({S.ACTIVE, S.IMPROVEMENT, S.PAUSED, S.RETIRED, S.MERGED}),
    # A revised contract re-enters at VALIDATION. It is a new contract.
    S.IMPROVEMENT: frozenset({S.VALIDATION, S.ACTIVE, S.PAUSED, S.RETIRED, S.MERGED}),
    S.PAUSED: frozenset({S.ACTIVE, S.RETIRED, S.MERGED}),
    S.RETIRED: frozenset(),
    S.MERGED: frozenset(),
}


class LifecycleError(Exception):
    pass


def can_transition(src: LifecycleState, dst: LifecycleState) -> bool:
    return dst in TRANSITIONS.get(src, frozenset())


def assert_transition(src: LifecycleState, dst: LifecycleState) -> None:
    if not can_transition(src, dst):
        allowed = sorted(s.value for s in TRANSITIONS.get(src, frozenset()))
        raise LifecycleError(f"illegal transition {src.value} -> {dst.value}; allowed: {allowed}")


# --------------------------------------------------------------------------
# Contract
# --------------------------------------------------------------------------
class AgentLevel(int, Enum):
    """Level is reach, not authority. It widens what an agent can see and
    coordinate; it grants nothing. See the agent-permissions skill."""

    SYSTEM = 0        # owner/system boundary; never assignable to an agent
    RESTRICTED = 1
    SPECIALIST = 2
    SENIOR = 3
    MASTER = 4
    CHIEF = 5


#: Ceilings no contract may exceed. Deliberately NOT contract-configurable — a
#: ceiling an agent can raise is a suggestion.
SYSTEM_CAPS: dict[str, Any] = {
    "max_concurrency": 64,
    "max_instances": 500,
    "max_spawn_depth": 6,
    "max_children_per_task": 64,
    "max_cost_micros": 100_000_000,
}

#: Permissions that may never be granted. Absent from the vocabulary entirely so
#: that a typo cannot conjure one into existence.
FORBIDDEN_PERMISSIONS = frozenset({
    "governance.permissions.write",
    "governance.contract.self_modify",
    "governance.approval.self_approve",
    "governance.budget.self_raise",
    "system.sql.execute",
    "system.shell.execute",
    "system.secrets.read",
})


@dataclass(frozen=True)
class BudgetPolicy:
    #: Integer micros (1e-6 USD). Floats drift when accumulated over millions
    #: of calls; integers are exact at ample resolution.
    total_cost_micros: int = 1_000_000
    per_task_cost_micros: int = 100_000
    total_tokens: int = 1_000_000
    per_task_tokens: int = 100_000


@dataclass(frozen=True)
class RuntimePolicy:
    """Blast-radius controls. Defaults are the SAFE values, not the typical
    ones: an untuned contract must not be able to build a subtree."""

    concurrency_limit: int = 4
    max_instances: int = 10
    max_spawn_depth: int = 1
    max_children_per_task: int = 8
    task_timeout_seconds: float = 120.0
    idle_retire_seconds: float = 900.0


@dataclass(frozen=True)
class QualityPolicy:
    gates: tuple[str, ...] = ("schema", "policy")
    min_score: float = 0.7
    max_rework_attempts: int = 2


@dataclass(frozen=True)
class AgentCapability:
    """A named thing this agent provides. Planners match against these when
    deciding whether a new agent is needed — the mechanism that stops an agent
    population growing without bound."""

    name: str
    description: str = ""


@dataclass
class AgentContract:
    name: str = ""
    role: str = ""
    level: int = int(AgentLevel.SPECIALIST)
    project_id: str | None = None
    parent_template_id: str | None = None

    mission: str = ""
    responsibilities: tuple[str, ...] = ()
    outputs: tuple[str, ...] = ()
    output_schema: dict[str, Any] = field(default_factory=dict)
    capabilities: tuple[AgentCapability, ...] = ()

    tools: tuple[str, ...] = ()
    permissions: tuple[str, ...] = ()
    forbidden_actions: tuple[str, ...] = ()

    budget: BudgetPolicy = field(default_factory=BudgetPolicy)
    runtime: RuntimePolicy = field(default_factory=RuntimePolicy)
    quality: QualityPolicy = field(default_factory=QualityPolicy)

    # Audit metadata — deliberately excluded from the behaviour hash.
    version: int = 1
    state: str = LifecycleState.DRAFT.value
    created_by: str = ""
    approved_by: str | None = None

    def behaviour_spec(self) -> dict[str, Any]:
        """The behaviour-defining subset.

        Excluding identity and audit fields means two contracts describing the
        same behaviour hash identically regardless of author or timestamp —
        which turns duplicate detection into an equality check.
        """
        data = asdict(self)
        for volatile in ("version", "state", "created_by", "approved_by"):
            data.pop(volatile, None)
        return data

    @property
    def content_hash(self) -> str:
        payload = json.dumps(self.behaviour_spec(), sort_keys=True,
                             separators=(",", ":"), default=str)
        return hashlib.sha256(payload.encode()).hexdigest()


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Finding:
    code: str
    field: str
    message: str
    severity: str = "error"

    def __str__(self) -> str:
        return f"[{self.severity}] {self.code} @ {self.field}: {self.message}"


@dataclass
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


def validate_contract(contract: AgentContract, *, known_tools: set[str] | None = None,
                      known_permissions: set[str] | None = None) -> ValidationReport:
    """Gate a contract. Errors block promotion; warnings are recorded only.

    The split matters: a validator that blocks on style creates pressure to
    bypass validation, and a bypassed validator protects nothing.
    """
    r = ValidationReport()

    # --- purpose: an agent with no stated purpose cannot be reviewed ---
    if not contract.name.strip():
        r.error("missing_name", "name", "name is required")
    if not contract.mission.strip():
        r.error("missing_mission", "mission", "mission is required")
    if not contract.responsibilities:
        r.error("missing_responsibilities", "responsibilities", "at least one is required")
    if not contract.outputs:
        r.error("missing_outputs", "outputs", "at least one declared output is required")
    if not contract.capabilities:
        r.warn("no_capabilities", "capabilities",
               "no declared capabilities; planners cannot match this agent for reuse")

    # --- authority ---
    for permission in contract.permissions:
        if permission in FORBIDDEN_PERMISSIONS:
            r.error("forbidden_permission", "permissions",
                    f"'{permission}' may never be granted to an agent")
        elif known_permissions is not None and permission not in known_permissions:
            # Typos fail closed rather than being interpreted loosely later.
            r.error("unknown_permission", "permissions", f"unknown permission '{permission}'")

    conflict = set(contract.permissions) & set(contract.forbidden_actions)
    if conflict:
        r.error("permission_conflict", "forbidden_actions",
                f"granted and forbidden simultaneously: {sorted(conflict)}")

    if known_tools is not None:
        for tool in contract.tools:
            if tool not in known_tools:
                r.error("unknown_tool", "tools", f"tool '{tool}' is not registered")

    # --- level discipline ---
    if contract.level == int(AgentLevel.SYSTEM):
        r.error("l0_not_assignable", "level", "L0 (SYSTEM) cannot be assigned to an agent")
    if (contract.level <= int(AgentLevel.SPECIALIST)
            and contract.runtime.max_spawn_depth > 1):
        # Specialists do the work; coordinators build subtrees.
        r.error("low_level_deep_spawn", "runtime.max_spawn_depth",
                f"L{contract.level} may not spawn deeper than 1")

    # --- budget arithmetic ---
    b = contract.budget
    if b.total_cost_micros <= 0:
        r.error("bad_budget", "budget.total_cost_micros", "must be positive")
    if b.total_cost_micros > SYSTEM_CAPS["max_cost_micros"]:
        r.error("budget_over_cap", "budget.total_cost_micros", "exceeds system cap")
    if b.per_task_cost_micros > b.total_cost_micros:
        # Otherwise the lifetime budget is decorative: one task could spend it all.
        r.error("task_budget_exceeds_total", "budget.per_task_cost_micros",
                "per-task cost limit exceeds the agent's total")
    if b.per_task_tokens > b.total_tokens:
        r.error("task_tokens_exceed_total", "budget.per_task_tokens",
                "per-task token limit exceeds the agent's total")

    # --- system caps ---
    for attr, cap in (("concurrency_limit", "max_concurrency"),
                      ("max_instances", "max_instances"),
                      ("max_spawn_depth", "max_spawn_depth"),
                      ("max_children_per_task", "max_children_per_task")):
        value = getattr(contract.runtime, attr)
        if value <= 0:
            r.error("bad_runtime_limit", f"runtime.{attr}", "must be positive")
        elif value > SYSTEM_CAPS[cap]:
            r.error("runtime_over_cap", f"runtime.{attr}",
                    f"{value} exceeds system cap {SYSTEM_CAPS[cap]}")

    # --- quality ---
    if not contract.quality.gates:
        r.error("no_gates", "quality.gates", "at least one quality gate is required")
    if "schema" in contract.quality.gates and not contract.output_schema:
        r.error("schema_gate_without_schema", "output_schema",
                "the schema gate needs an output_schema to validate against")
    if contract.quality.max_rework_attempts > 5:
        r.error("rework_unbounded", "quality.max_rework_attempts",
                "more than 5 rework cycles indicates a contract problem, not a task problem")

    return r


# --------------------------------------------------------------------------
if __name__ == "__main__":
    print("1. A default-constructed contract must satisfy its own validator")
    print("   (a default that cannot pass makes every untuned contract unusable)")
    minimal = AgentContract(
        name="seo-writer", role="writer",
        mission="Write evidence-backed articles to the project standard.",
        responsibilities=("draft articles",), outputs=("article",),
        output_schema={"type": "object", "required": ["article"]},
        capabilities=(AgentCapability(name="write_article"),))
    report = validate_contract(minimal)
    print(f"   ok={report.ok}  warnings={[f.code for f in report.warnings]}\n")

    print("2. Privilege escalation is rejected at draft time")
    evil = AgentContract(**{**minimal.__dict__,
                            "permissions": ("governance.permissions.write",)})
    for finding in validate_contract(evil).errors:
        print(f"   {finding}")
    print()

    print("3. ACTIVE is unreachable if APPROVAL is removed from the graph")
    reachable, frontier = {S.DRAFT}, [S.DRAFT]
    while frontier:
        for nxt in TRANSITIONS[frontier.pop()]:
            if nxt is not S.APPROVAL and nxt not in reachable:
                reachable.add(nxt)
                frontier.append(nxt)
    print(f"   ACTIVE reachable without APPROVAL: {S.ACTIVE in reachable}\n")

    print("4. Duplicate detection by behaviour hash")
    twin = AgentContract(**{**minimal.__dict__, "created_by": "someone-else",
                            "version": 7})
    print(f"   identical behaviour, different audit fields -> same hash: "
          f"{minimal.content_hash == twin.content_hash}")
    changed = AgentContract(**{**minimal.__dict__, "responsibilities": ("edit articles",)})
    print(f"   changed behaviour -> different hash: "
          f"{minimal.content_hash != changed.content_hash}")
