"""The Agent Contract.

The contract is the single source of truth about what an agent *is* and what it
is *allowed to do*. Everything the runtime enforces — tools, budgets,
concurrency, memory scope, escalation — is read from here, never from the
agent's prompt. That separation is the whole security model: an agent can say
anything it likes about its own authority and it changes nothing, because the
enforcement path reads the stored contract.

Contracts are immutable once they leave DRAFT. A change produces a new
*version* with a new content hash, which re-enters validation and approval. That
is what makes "who approved this exact behaviour" answerable months later.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

from af.contracts.lifecycle import LifecycleState
from af.ids import new_id

__all__ = [
    "AgentLevel", "MemoryPolicy", "ContextPolicy", "ModelPolicy", "RetryPolicy",
    "BudgetPolicy", "QualityPolicy", "EscalationRule", "KPI", "AgentCapability",
    "AgentToolPermission", "AgentKnowledgeScope", "AgentRuntimePolicy",
    "AgentContract", "canonical_hash",
]


class AgentLevel(int, Enum):
    """Level is *reach*, not authority.

    A high level widens what an agent can see and coordinate. It never grants
    the right to perform an action — that always comes from an explicit
    capability grant plus, for high-risk actions, an owner approval. L5 (Chief)
    deliberately holds no owner-gated execution rights; see SECURITY_MODEL.md.
    """

    SYSTEM = 0        # L0 — owner/system protected operations. Not assignable to agents.
    RESTRICTED = 1    # L1 — restricted worker, narrow single-purpose
    SPECIALIST = 2    # L2 — specialist
    SENIOR = 3        # L3 — senior specialist / team lead
    MASTER = 4        # L4 — master / domain agent
    CHIEF = 5         # L5 — Chief Agent Architect


class TrustLevel(str, Enum):
    AUTHORITATIVE = "authoritative"
    VERIFIED = "verified"
    DERIVED = "derived"
    UNVERIFIED = "unverified"


@dataclass(frozen=True, slots=True)
class MemoryPolicy:
    """Which memory layers this agent may read and write, and for how long.

    Write access is separate from read access on purpose: most agents should be
    able to *read* authoritative knowledge and unable to *write* it. Promotion
    into the authoritative layer is a governed action, not a side effect of a
    specialist finishing a task.
    """

    readable_layers: tuple[str, ...] = ("working", "episodic", "project", "authoritative")
    writable_layers: tuple[str, ...] = ("working", "episodic")
    working_ttl_seconds: float = 3600.0
    episodic_ttl_seconds: float = 30 * 86400.0
    max_records_per_task: int = 200
    # Minimum trust an agent will accept when retrieving. A compliance agent can
    # demand 'authoritative' and never see model-generated speculation.
    min_trust_for_read: str = TrustLevel.UNVERIFIED.value
    share_to_org: bool = False


@dataclass(frozen=True, slots=True)
class ContextPolicy:
    """Attention budget. These are the levers from the context-engineering
    skills applied as enforced runtime limits rather than advice."""

    max_context_tokens: int = 100_000
    max_history_messages: int = 40
    compaction_threshold: float = 0.75      # fraction of budget before compaction
    max_retrieved_records: int = 20
    include_parent_summary: bool = True
    # Offload large tool outputs to memory and pass a reference instead of
    # inlining them. The filesystem-context pattern, enforced.
    offload_outputs_over_bytes: int = 8_192


@dataclass(frozen=True, slots=True)
class ModelPolicy:
    """Provider-independent model requirements.

    Deliberately expressed as *requirements*, not as a provider and model name.
    The router resolves these to a concrete provider at call time, so a contract
    stays valid across provider changes and outages. Hard-coding a provider here
    would push a migration into every contract in the fleet.
    """

    tier: str = "standard"                   # cheap|standard|frontier
    min_reasoning: str = "basic"             # basic|intermediate|advanced
    max_latency_ms: int = 30_000
    max_context_tokens: int = 100_000
    requires_tool_use: bool = True
    requires_structured_output: bool = True
    privacy_class: str = "standard"          # standard|sensitive|restricted
    # Explicit escape hatches. Empty means "router decides".
    preferred_providers: tuple[str, ...] = ()
    forbidden_providers: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_attempts: int = 3
    backoff_seconds: float = 1.0
    backoff_multiplier: float = 2.0
    max_backoff_seconds: float = 60.0
    jitter: float = 0.2                      # fraction; avoids retry storms
    retry_on: tuple[str, ...] = ("provider_error", "provider_timeout", "tool_unavailable")

    def delay_for(self, attempt: int) -> float:
        """Exponential backoff, capped. Jitter is applied by the scheduler so
        that this stays a pure function and remains testable."""
        raw = self.backoff_seconds * (self.backoff_multiplier ** max(0, attempt - 1))
        return min(raw, self.max_backoff_seconds)


@dataclass(frozen=True, slots=True)
class BudgetPolicy:
    """Costs are in micros (1e-6 USD) as integers.

    Floats are wrong for money: accumulating float cents across millions of
    calls drifts. Integer micros give exact arithmetic with ample resolution
    for per-token pricing.
    """

    cost_limit_micros: int = 1_000_000       # $1.00 per agent by default
    token_limit: int = 1_000_000
    per_task_cost_limit_micros: int = 100_000
    per_task_token_limit: int = 100_000
    latency_target_ms: int = 30_000


@dataclass(frozen=True, slots=True)
class AgentRuntimePolicy:
    """Blast-radius controls. Every one of these is a hard stop enforced before
    execution, because after-the-fact detection of a runaway spawn tree is not a
    control."""

    concurrency_limit: int = 4               # simultaneous tasks per instance
    max_instances: int = 10                  # instances per template per project
    # Defaults are the *safe* values, not the typical ones: a contract that
    # nobody tuned must not be able to spawn a subtree. Coordinating agents
    # (L3+) raise this explicitly, and the validator holds L1/L2 to depth 1.
    max_spawn_depth: int = 1                 # how deep this agent's subtree may go
    max_children_per_task: int = 8           # fan-out width
    max_total_spawns: int = 50               # cumulative, per root task
    task_timeout_seconds: float = 120.0
    idle_retire_seconds: float = 900.0       # elastic scale-down
    max_tool_calls_per_task: int = 25


@dataclass(frozen=True, slots=True)
class QualityPolicy:
    gates: tuple[str, ...] = ("schema", "policy", "evidence")
    min_score: float = 0.7
    min_confidence: float = 0.6
    max_rework_attempts: int = 2
    # Who reviews when automated gates are inconclusive.
    reviewer_type: str = "automated"         # automated|peer|master|chief|owner
    escalate_on_repeat_failure: bool = True
    require_evidence: bool = True


@dataclass(frozen=True, slots=True)
class EscalationRule:
    condition: str                            # e.g. "quality_failed", "budget_exceeded"
    action: str                               # "escalate_parent"|"escalate_chief"|"owner_approval"|"abort"
    threshold: float = 1.0


@dataclass(frozen=True, slots=True)
class KPI:
    name: str
    metric: str                               # e.g. "quality_score", "p95_latency_ms"
    target: float
    direction: str = "gte"                    # gte|lte
    window_seconds: float = 7 * 86400.0


@dataclass(frozen=True, slots=True)
class AgentCapability:
    """A named capability the agent provides. The Chief matches *required*
    capabilities against these when deciding whether a new agent is needed —
    this is the reuse mechanism that stops the fleet growing without bound."""

    name: str
    description: str = ""
    inputs: tuple[str, ...] = ()
    outputs: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AgentToolPermission:
    tool_id: str
    max_calls_per_task: int = 10
    # An agent may be granted a tool but still require approval per use, which
    # is how R3+ tools are handed out without granting standing authority.
    requires_approval_override: bool | None = None


@dataclass(frozen=True, slots=True)
class AgentKnowledgeScope:
    domains: tuple[str, ...] = ()
    # Projects this agent may touch. Empty means "its own project only" — the
    # safe default. Cross-project access must be spelled out.
    projects: tuple[str, ...] = ()
    allow_org_shared: bool = False


@dataclass(slots=True)
class AgentContract:
    """The full contract. Mutable only while in DRAFT."""

    # --- identity -----------------------------------------------------
    id: str = field(default_factory=lambda: new_id("ctr"))
    template_id: str = ""
    version: int = 1
    name: str = ""
    role: str = ""
    level: int = int(AgentLevel.SPECIALIST)
    parent_template_id: str | None = None

    # --- purpose ------------------------------------------------------
    mission: str = ""
    responsibilities: tuple[str, ...] = ()
    workflow_loops: tuple[str, ...] = ()      # named loops this agent owns
    inputs: tuple[str, ...] = ()
    outputs: tuple[str, ...] = ()
    output_schema: dict[str, Any] = field(default_factory=dict)
    capabilities: tuple[AgentCapability, ...] = ()

    # --- scope & authority --------------------------------------------
    project_id: str | None = None
    knowledge: AgentKnowledgeScope = field(default_factory=AgentKnowledgeScope)
    tools: tuple[AgentToolPermission, ...] = ()
    permissions: tuple[str, ...] = ()         # capability strings, see governance.permissions
    forbidden_actions: tuple[str, ...] = ()

    # --- policies -----------------------------------------------------
    memory: MemoryPolicy = field(default_factory=MemoryPolicy)
    context: ContextPolicy = field(default_factory=ContextPolicy)
    model: ModelPolicy = field(default_factory=ModelPolicy)
    budget: BudgetPolicy = field(default_factory=BudgetPolicy)
    runtime: AgentRuntimePolicy = field(default_factory=AgentRuntimePolicy)
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    quality: QualityPolicy = field(default_factory=QualityPolicy)
    escalation: tuple[EscalationRule, ...] = ()
    kpis: tuple[KPI, ...] = ()

    # --- governance / audit -------------------------------------------
    state: str = LifecycleState.DRAFT.value
    created_by: str = ""
    approved_by: str | None = None
    approved_at: float | None = None
    created_at: float = 0.0
    updated_at: float = 0.0
    notes: str = ""

    # ------------------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def spec_for_hash(self) -> dict[str, Any]:
        """The behaviour-defining subset.

        Audit and identity fields are excluded so that two contracts describing
        identical behaviour hash identically — that is what lets the Chief
        detect duplicate agents (§B "identify duplicated agents") by hash
        instead of by fuzzy comparison.
        """
        d = self.to_dict()
        for volatile in ("id", "version", "state", "created_by", "approved_by",
                         "approved_at", "created_at", "updated_at", "notes",
                         "template_id"):
            d.pop(volatile, None)
        return d

    @property
    def content_hash(self) -> str:
        return canonical_hash(self.spec_for_hash())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentContract":
        """Rebuild from stored JSON, restoring nested dataclasses and tuples."""
        d = dict(data)

        def _mk(klass, value, many=False):
            if value is None:
                return () if many else klass()
            if many:
                return tuple(klass(**v) if isinstance(v, dict) else v for v in value)
            return klass(**value) if isinstance(value, dict) else value

        d["knowledge"] = _mk(AgentKnowledgeScope, d.get("knowledge"))
        d["memory"] = _mk(MemoryPolicy, d.get("memory"))
        d["context"] = _mk(ContextPolicy, d.get("context"))
        d["model"] = _mk(ModelPolicy, d.get("model"))
        d["budget"] = _mk(BudgetPolicy, d.get("budget"))
        d["runtime"] = _mk(AgentRuntimePolicy, d.get("runtime"))
        d["retry"] = _mk(RetryPolicy, d.get("retry"))
        d["quality"] = _mk(QualityPolicy, d.get("quality"))
        d["capabilities"] = _mk(AgentCapability, d.get("capabilities"), many=True)
        d["tools"] = _mk(AgentToolPermission, d.get("tools"), many=True)
        d["escalation"] = _mk(EscalationRule, d.get("escalation"), many=True)
        d["kpis"] = _mk(KPI, d.get("kpis"), many=True)
        for tuple_field in ("responsibilities", "workflow_loops", "inputs", "outputs",
                            "permissions", "forbidden_actions"):
            if d.get(tuple_field) is not None:
                d[tuple_field] = tuple(d[tuple_field])
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})


def _normalise(obj: Any) -> Any:
    """Tuples and lists must hash the same; nested dataclasses become dicts."""
    if isinstance(obj, dict):
        return {k: _normalise(v) for k, v in sorted(obj.items())}
    if isinstance(obj, (list, tuple)):
        return [_normalise(v) for v in obj]
    if isinstance(obj, Enum):
        return obj.value
    return obj


def canonical_hash(spec: dict[str, Any]) -> str:
    payload = json.dumps(_normalise(spec), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()
