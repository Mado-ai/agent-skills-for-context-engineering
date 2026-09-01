"""Typed runtime objects and their validation.

Every object that crosses a boundary — API input, database row, inter-agent packet —
is built through one of these schemas. Validation raises `ValidationError` carrying
field-level detail; nothing is silently coerced or dropped.
"""

import hashlib
import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from .errors import ValidationError

# --------------------------------------------------------------------------- vocab

ROLES = ("chief_architect", "project_lead", "specialist", "evaluator", "operator")
CHIEF_ARCHITECT_ROLE = "chief_architect"

# Level governs visibility and orchestration breadth only — never tool scope.
LEVELS = (1, 2, 3, 4, 5)
LEVEL_FOR_ROLE = {
    "chief_architect": 5,
    "project_lead": 4,
    "evaluator": 3,
    "specialist": 2,
    "operator": 1,
}

ACTION_TYPES = ("read", "write", "analyze", "communicate", "transact", "admin")
MEMORY_LAYERS = ("working", "episodic", "semantic")
AGENT_STATUSES = ("draft", "active", "paused", "retired")
TASK_STATUSES = ("open", "in_progress", "blocked", "review", "rework", "completed", "cancelled")
RISK_LEVELS = ("low", "medium", "high")

_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9 _\-\.]{1,63}$")
_IDENT_RE = re.compile(r"^[a-z0-9][a-z0-9_\-\.]{0,63}$")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value) -> str:
    """Stable JSON for hashing and content addressing."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_arguments(arguments: dict) -> str:
    return hashlib.sha256(canonical_json(arguments).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------- validators


def require(condition: bool, message: str, field_name: str) -> None:
    if not condition:
        raise ValidationError(message, details={"field": field_name})


def _validate_str_list(value, field_name: str, vocabulary: tuple | None = None) -> list[str]:
    require(isinstance(value, (list, tuple)), f"{field_name} must be a list", field_name)
    items = []
    for item in value:
        require(isinstance(item, str), f"{field_name} entries must be strings", field_name)
        item = item.strip()
        require(bool(_IDENT_RE.match(item)), f"{field_name} entry {item!r} is not a valid identifier", field_name)
        if vocabulary is not None:
            require(item in vocabulary, f"{field_name} entry {item!r} is not one of {vocabulary}", field_name)
        items.append(item)
    # Deterministic order keeps contract checksums stable regardless of input ordering.
    return sorted(set(items))


# -------------------------------------------------------------------------- budget


@dataclass(frozen=True)
class Budget:
    """A spend ceiling. `None` on a dimension means that dimension is unlimited."""

    max_usd: float | None = None
    max_tokens: int | None = None
    max_tool_calls: int | None = None

    @staticmethod
    def parse(value, field_name: str = "budget") -> "Budget":
        if value is None:
            return Budget()
        if isinstance(value, Budget):
            return value
        require(isinstance(value, dict), f"{field_name} must be an object", field_name)
        unknown = set(value) - {"max_usd", "max_tokens", "max_tool_calls"}
        require(not unknown, f"{field_name} has unknown keys: {sorted(unknown)}", field_name)

        def _num(key, cast):
            raw = value.get(key)
            if raw is None:
                return None
            require(isinstance(raw, (int, float)) and not isinstance(raw, bool),
                    f"{field_name}.{key} must be a number", f"{field_name}.{key}")
            require(raw >= 0, f"{field_name}.{key} must not be negative", f"{field_name}.{key}")
            return cast(raw)

        return Budget(_num("max_usd", float), _num("max_tokens", int), _num("max_tool_calls", int))

    def to_dict(self) -> dict:
        return {"max_usd": self.max_usd, "max_tokens": self.max_tokens, "max_tool_calls": self.max_tool_calls}

    def intersect(self, other: "Budget") -> "Budget":
        """The tighter of two budgets on every dimension — used for scope attenuation."""

        def tighter(a, b):
            if a is None:
                return b
            if b is None:
                return a
            return min(a, b)

        return Budget(
            tighter(self.max_usd, other.max_usd),
            tighter(self.max_tokens, other.max_tokens),
            tighter(self.max_tool_calls, other.max_tool_calls),
        )


# --------------------------------------------------------------------------- scope


@dataclass(frozen=True)
class Scope:
    """What an agent may touch. Deny by default: empty means nothing is permitted."""

    allowed_tools: tuple[str, ...] = ()
    data_domains: tuple[str, ...] = ()
    action_types: tuple[str, ...] = ()

    @staticmethod
    def parse(tools, domains, actions) -> "Scope":
        return Scope(
            tuple(_validate_str_list(tools or [], "allowed_tools")),
            tuple(_validate_str_list(domains or [], "data_domains")),
            tuple(_validate_str_list(actions or [], "action_types", ACTION_TYPES)),
        )

    def intersect(self, other: "Scope") -> "Scope":
        """Attenuation: a delegated scope can only ever shrink."""
        return Scope(
            tuple(sorted(set(self.allowed_tools) & set(other.allowed_tools))),
            tuple(sorted(set(self.data_domains) & set(other.data_domains))),
            tuple(sorted(set(self.action_types) & set(other.action_types))),
        )

    def is_subset_of(self, other: "Scope") -> bool:
        return (
            set(self.allowed_tools) <= set(other.allowed_tools)
            and set(self.data_domains) <= set(other.data_domains)
            and set(self.action_types) <= set(other.action_types)
        )

    def to_dict(self) -> dict:
        return {
            "allowed_tools": list(self.allowed_tools),
            "data_domains": list(self.data_domains),
            "action_types": list(self.action_types),
        }


# ---------------------------------------------------------------- agent contract


@dataclass(frozen=True)
class AgentContract:
    """The governed identity of an agent. Immutable and content-addressed."""

    id: str
    agent_id: str
    version: int
    project_id: str
    name: str
    role: str
    level: int
    system_prompt: str
    scope: Scope
    budget: Budget
    provider_model: str
    max_delegation_depth: int
    template_id: str | None
    created_at: str
    created_by: str
    checksum: str = ""

    def content(self) -> dict:
        """The checksummed portion: everything that defines behaviour and authority."""
        return {
            "agent_id": self.agent_id,
            "version": self.version,
            "project_id": self.project_id,
            "name": self.name,
            "role": self.role,
            "level": self.level,
            "system_prompt": self.system_prompt,
            "scope": self.scope.to_dict(),
            "budget": self.budget.to_dict(),
            "provider_model": self.provider_model,
            "max_delegation_depth": self.max_delegation_depth,
            "template_id": self.template_id,
        }

    def compute_checksum(self) -> str:
        return hashlib.sha256(canonical_json(self.content()).encode("utf-8")).hexdigest()

    def to_dict(self) -> dict:
        data = self.content()
        data.update({"id": self.id, "created_at": self.created_at,
                     "created_by": self.created_by, "checksum": self.checksum})
        return data


def validate_contract_input(data: dict, *, project_id: str, agent_id: str, version: int,
                            created_by: str, max_depth_cap: int) -> AgentContract:
    """Validate untrusted Agent Builder input into a contract. Raises ValidationError."""
    require(isinstance(data, dict), "contract must be an object", "contract")

    name = (data.get("name") or "").strip()
    require(bool(_NAME_RE.match(name)), "name must be 2-64 chars of letters, digits, space, _ - .", "name")

    role = (data.get("role") or "").strip()
    require(role in ROLES, f"role must be one of {ROLES}", "role")

    level = data.get("level", LEVEL_FOR_ROLE[role])
    require(isinstance(level, int) and not isinstance(level, bool), "level must be an integer", "level")
    require(level in LEVELS, f"level must be one of {LEVELS}", "level")
    # The chief architect role is the only L5; nothing else may claim system-wide visibility.
    if role == CHIEF_ARCHITECT_ROLE:
        require(level == 5, "chief_architect must be level 5", "level")
    else:
        require(level < 5, "only chief_architect may hold level 5", "level")

    system_prompt = (data.get("system_prompt") or "").strip()
    require(len(system_prompt) >= 10, "system_prompt must be at least 10 characters", "system_prompt")
    require(len(system_prompt) <= 20000, "system_prompt exceeds 20000 characters", "system_prompt")

    scope = Scope.parse(data.get("allowed_tools"), data.get("data_domains"), data.get("action_types"))
    budget = Budget.parse(data.get("budget"))

    provider_model = (data.get("provider_model") or "local-echo").strip()
    require(bool(provider_model), "provider_model must not be empty", "provider_model")

    depth = data.get("max_delegation_depth", max_depth_cap)
    require(isinstance(depth, int) and not isinstance(depth, bool), "max_delegation_depth must be an integer", "max_delegation_depth")
    require(0 <= depth <= max_depth_cap, f"max_delegation_depth must be between 0 and {max_depth_cap}", "max_delegation_depth")

    template_id = data.get("template_id")
    require(template_id is None or isinstance(template_id, str), "template_id must be a string", "template_id")

    contract = AgentContract(
        id=new_id("con"), agent_id=agent_id, version=version, project_id=project_id,
        name=name, role=role, level=level, system_prompt=system_prompt, scope=scope,
        budget=budget, provider_model=provider_model, max_delegation_depth=depth,
        template_id=template_id, created_at=utcnow(), created_by=created_by,
    )
    return AgentContract(**{**asdict_shallow(contract), "checksum": contract.compute_checksum()})


def asdict_shallow(contract: AgentContract) -> dict:
    """dataclasses.asdict would flatten Scope/Budget; keep them as objects."""
    return {f: getattr(contract, f) for f in contract.__dataclass_fields__}
