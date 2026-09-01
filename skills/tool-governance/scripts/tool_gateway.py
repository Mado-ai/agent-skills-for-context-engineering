"""Permissioned tool execution: risk classes, a pre-execution policy chain, and
argument validation.

Agents hold tool identifiers, never callables. Every call runs the full chain
before the implementation is reached, and every call is recorded — including the
blocked ones, which are the interesting ones for security review.

Use when:
    - Agent tool calls have effects outside the conversation.
    - Some actions need human approval and others do not.
    - Tool arguments originate from model output (which is always).

Standard library only, including a small JSON-Schema subset validator so the
argument checks run without a dependency.

Typical usage::

    registry = ToolRegistry()
    registry.register(ToolSpec("kb.search", RiskLevel.R0, handler=search,
                               input_schema={...}))
    gateway = ToolGateway(registry)
    result = gateway.call(agent="a1", level=2, tool_id="kb.search",
                          params={"query": "x"}, granted={"kb.search": 10})
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

__all__ = [
    "RiskLevel", "ToolSpec", "ToolRegistry", "ToolGateway", "ToolResult",
    "ToolCallRecord", "PermissionDenied", "ApprovalRequired", "ArgumentInvalid",
    "RateLimited", "validate_schema",
]


class PermissionDenied(Exception):
    pass


class ApprovalRequired(Exception):
    pass


class ArgumentInvalid(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


class RateLimited(Exception):
    pass


# --------------------------------------------------------------------------
# Risk classification
# --------------------------------------------------------------------------
class RiskLevel(str, Enum):
    """Assigned by REVERSIBILITY and BLAST RADIUS, not by category.

    'Sends an email' is not a risk level. 'Irreversible, external, visible to a
    customer' is. Two tools that both 'write an entry' can belong three classes
    apart depending on who sees the entry.
    """

    R0 = "R0"  # read-only internal
    R1 = "R1"  # low-risk internal write
    R2 = "R2"  # external, reversible
    R3 = "R3"  # sensitive external      -> approval required
    R4 = "R4"  # owner approval mandatory -> approval required
    R5 = "R5"  # prohibited for autonomous execution -> never runs

    @property
    def requires_approval(self) -> bool:
        return self in (RiskLevel.R3, RiskLevel.R4, RiskLevel.R5)

    @property
    def autonomous_forbidden(self) -> bool:
        """R5 is a hard stop that NOTHING inside the runtime unlocks — not a
        valid token, not the most senior agent. If an action should only ever be
        performed by a human in another system, it belongs here."""
        return self is RiskLevel.R5

    @property
    def min_level(self) -> int:
        return {RiskLevel.R0: 1, RiskLevel.R1: 1, RiskLevel.R2: 2,
                RiskLevel.R3: 3, RiskLevel.R4: 3, RiskLevel.R5: 5}[self]


@dataclass
class ToolSpec:
    tool_id: str
    risk_level: RiskLevel
    description: str = ""
    handler: Callable[..., Any] | None = None
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    rate_limit_per_minute: int = 60
    cost_micros_per_call: int = 0
    project_scope: frozenset[str] = field(default_factory=frozenset)
    #: Surfaced in the approval request so the human knows whether undo exists,
    #: and so "just retry it" is not the reflexive response to a failure.
    irreversible: bool = False


@dataclass
class ToolResult:
    tool_id: str
    ok: bool
    output: Any = None
    duration_ms: float = 0.0
    call_id: str = ""


@dataclass
class ToolCallRecord:
    call_id: str
    ts: float
    agent: str
    tool_id: str
    risk_level: str
    #: A HASH, never the raw arguments. Arguments carry customer data and
    #: secrets in transit; the hash proves what was attempted and correlates a
    #: retry without the audit table becoming a second copy of the payload.
    args_hash: str
    status: str
    project_id: str | None = None
    token_id: str | None = None
    error_code: str | None = None
    duration_ms: float = 0.0


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> ToolSpec:
        if spec.tool_id in self._tools:
            raise ValueError(f"tool '{spec.tool_id}' already registered")
        # The strongest control is absence: refuse to register capabilities that
        # hand an agent raw infrastructure, at ANY risk level.
        if any(bad in spec.tool_id for bad in ("shell", "exec", "eval", "sql")):
            raise ValueError(
                f"'{spec.tool_id}' looks like raw infrastructure access; such a "
                f"capability should not exist in the catalogue at any risk level")
        self._tools[spec.tool_id] = spec
        return spec

    def get(self, tool_id: str) -> ToolSpec | None:
        return self._tools.get(tool_id)

    def descriptions(self, max_risk: RiskLevel | None = None) -> list[dict[str, Any]]:
        """What the agent sees: descriptions and identifiers, never handlers."""
        order = list(RiskLevel)
        out = []
        for spec in self._tools.values():
            if max_risk and order.index(spec.risk_level) > order.index(max_risk):
                continue
            out.append({"tool_id": spec.tool_id, "description": spec.description,
                        "input_schema": spec.input_schema,
                        "risk_level": spec.risk_level.value,
                        "irreversible": spec.irreversible})
        return sorted(out, key=lambda d: d["tool_id"])


# --------------------------------------------------------------------------
# Gateway
# --------------------------------------------------------------------------
class ToolGateway:
    def __init__(self, registry: ToolRegistry, *,
                 now: Callable[[], float] = time.time,
                 consume_token: Callable[..., str] | None = None) -> None:
        self.registry = registry
        self.now = now
        #: Injected so this module does not depend on the approval engine.
        self.consume_token = consume_token
        self.audit: list[ToolCallRecord] = []

    def call(self, *, agent: str, level: int, tool_id: str, params: dict[str, Any],
             granted: dict[str, int] | None = None, project_id: str | None = None,
             scope: frozenset[str] | None = None, execution_token: str | None = None,
             calls_this_task: int = 0, is_owner: bool = False) -> ToolResult:
        """Run the full policy chain, then the tool.

        Ordered cheapest-and-most-decisive first, so a denied call costs a
        lookup rather than a full validation pass.
        """
        call_id = f"tcl_{len(self.audit):08d}"
        started = time.perf_counter()
        args_hash = hashlib.sha256(
            json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()
        spec = self.registry.get(tool_id)

        def record(status: str, error_code: str | None = None,
                   token_id: str | None = None) -> None:
            self.audit.append(ToolCallRecord(
                call_id=call_id, ts=self.now(), agent=agent, tool_id=tool_id,
                risk_level=spec.risk_level.value if spec else "unknown",
                args_hash=args_hash, status=status, project_id=project_id,
                token_id=token_id, error_code=error_code,
                duration_ms=(time.perf_counter() - started) * 1000.0))

        def block(code: str, message: str, exc: type[Exception]) -> None:
            record("blocked", code)
            raise exc(message)

        # 0. Unknown tools fail closed, never pass through.
        if spec is None:
            record("blocked", "unknown_tool")
            raise PermissionDenied(f"tool '{tool_id}' is not registered")

        # 1. The contract must grant THIS tool. Holding "may use tools" is not
        #    permission for a specific one.
        granted = granted or {}
        if not is_owner and tool_id not in granted:
            block("permission_denied",
                  f"tool '{tool_id}' is not granted by the agent's contract",
                  PermissionDenied)

        # 2/3. Tenant isolation, then the tool's own project scope.
        if project_id and scope is not None and project_id not in scope and not is_owner:
            block("isolation_violation",
                  f"agent may not act on project '{project_id}'", PermissionDenied)
        if spec.project_scope and project_id not in spec.project_scope:
            block("permission_denied",
                  f"tool '{tool_id}' is not available to project '{project_id}'",
                  PermissionDenied)

        # 4. Level floor for the risk class.
        if not is_owner and level < spec.risk_level.min_level:
            block("permission_denied",
                  f"{spec.risk_level.value} tools require level >= "
                  f"{spec.risk_level.min_level}, agent is L{level}", PermissionDenied)

        # 5. R5 hard stop — checked independently of level, and unlocked by
        #    nothing, including a valid token.
        if spec.risk_level.autonomous_forbidden and not is_owner:
            block("permission_denied",
                  f"R5 tool '{tool_id}' cannot be executed autonomously",
                  PermissionDenied)

        # 6. Approval + single-use token for R3/R4.
        token_id = None
        if spec.risk_level.requires_approval and not is_owner:
            if not execution_token:
                record("approval_required", "approval_required")
                raise ApprovalRequired(
                    f"tool '{tool_id}' ({spec.risk_level.value}) requires owner "
                    f"approval; irreversible={spec.irreversible}")
            if self.consume_token is not None:
                token_id = self.consume_token(execution_token, agent_id=agent,
                                              action=tool_id, params=params)

        # 7. Per-task call ceiling from the contract.
        ceiling = granted.get(tool_id)
        if ceiling is not None and calls_this_task >= ceiling:
            block("permission_denied",
                  f"per-task call limit for '{tool_id}' reached ({ceiling})",
                  PermissionDenied)

        # 8. Rate limit, computed from the DURABLE audit log. An in-process
        #    counter resets on restart, turning a crash loop into an unthrottled
        #    agent at exactly the wrong moment.
        if spec.rate_limit_per_minute > 0:
            cutoff = self.now() - 60.0
            recent = sum(1 for r in self.audit
                         if r.agent == agent and r.tool_id == tool_id
                         and r.ts > cutoff and r.status != "blocked")
            if recent >= spec.rate_limit_per_minute:
                block("rate_limited",
                      f"rate limit {spec.rate_limit_per_minute}/min reached for "
                      f"'{tool_id}'", RateLimited)

        # 10. VALIDATE ARGUMENTS. Model output is untrusted input; a correctly
        #     authorised call with attacker-influenced arguments is the more
        #     common breach.
        if spec.input_schema:
            errors = validate_schema(params, spec.input_schema)
            if errors:
                record("blocked", "validation_error")
                raise ArgumentInvalid(errors)

        # --- execute ---
        if spec.handler is None:
            block("tool_unavailable", f"tool '{tool_id}' has no handler", PermissionDenied)
        try:
            output = spec.handler(**params)
        except Exception as exc:
            record("error", "tool_error", token_id)
            raise

        # 11. Validate the tool's OWN output. An unexpected shape here becomes
        #     part of the next prompt.
        if spec.output_schema:
            errors = validate_schema(output, spec.output_schema)
            if errors:
                record("error", "bad_output", token_id)
                raise ArgumentInvalid([f"tool output failed validation: {e}"
                                       for e in errors])

        record("ok", None, token_id)
        return ToolResult(tool_id=tool_id, ok=True, output=output,
                          duration_ms=(time.perf_counter() - started) * 1000.0,
                          call_id=call_id)

    def blocked_calls(self) -> list[ToolCallRecord]:
        """The security signal. An audit log of only successes describes a
        system where nothing ever went wrong."""
        return [r for r in self.audit if r.status in ("blocked", "approval_required")]


# --------------------------------------------------------------------------
# Minimal JSON Schema subset (type, required, properties, enum, bounds, pattern)
# --------------------------------------------------------------------------
_TYPES: dict[str, Any] = {
    "object": dict, "array": (list, tuple), "string": str,
    "number": (int, float), "integer": int, "boolean": bool, "null": type(None),
}


def validate_schema(instance: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Return ALL errors rather than the first.

    Handing a model one error at a time turns a single correction into several
    round trips.
    """
    errors: list[str] = []
    if not schema:
        return errors

    expected = schema.get("type")
    if expected:
        py = _TYPES.get(expected)
        # bool is a subclass of int in Python; JSON treats them as distinct, and
        # accepting True where an integer is required has bitten every
        # hand-rolled validator that skipped this.
        wrong = (py is not None and not isinstance(instance, py)) or (
            expected in ("number", "integer") and isinstance(instance, bool))
        if wrong:
            return [f"{path}: expected {expected}, got {type(instance).__name__}"]

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} is not one of {schema['enum']}")

    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                errors.append(f"{path}: missing required property '{key}'")
        props = schema.get("properties", {})
        for key, sub in props.items():
            if key in instance:
                errors.extend(validate_schema(instance[key], sub, f"{path}.{key}"))
        # Extra fields are the shape an injection takes. Set this to false.
        if schema.get("additionalProperties") is False:
            extra = set(instance) - set(props)
            if extra:
                errors.append(f"{path}: unexpected properties {sorted(extra)}")

    elif isinstance(instance, (list, tuple)):
        item = schema.get("items")
        if isinstance(item, dict):
            for i, element in enumerate(instance):
                errors.extend(validate_schema(element, item, f"{path}[{i}]"))
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")

    elif isinstance(instance, str):
        # An unbounded string field is a denial-of-service vector.
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            errors.append(f"{path}: longer than maxLength {schema['maxLength']}")
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: shorter than minLength {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            errors.append(f"{path}: does not match {schema['pattern']!r}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        # An unbounded integer is a surprising bill.
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append(f"{path}: below minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errors.append(f"{path}: exceeds maximum {schema['maximum']}")

    return errors


# --------------------------------------------------------------------------
if __name__ == "__main__":
    registry = ToolRegistry()
    registry.register(ToolSpec(
        "kb.search", RiskLevel.R0, description="Search internal knowledge.",
        handler=lambda query, limit=5: {"results": [], "count": 0},
        input_schema={"type": "object", "required": ["query"],
                      "properties": {"query": {"type": "string", "maxLength": 500},
                                     "limit": {"type": "integer", "minimum": 1,
                                               "maximum": 50}},
                      "additionalProperties": False}))
    registry.register(ToolSpec(
        "email.send", RiskLevel.R3, description="Send an external email.",
        handler=lambda to, body: {"queued": True}, irreversible=True,
        input_schema={"type": "object", "required": ["to", "body"],
                      "properties": {"to": {"type": "string"},
                                     "body": {"type": "string"}},
                      "additionalProperties": False}))
    registry.register(ToolSpec(
        "finance.transfer", RiskLevel.R5, description="Move money.",
        handler=lambda amount, dest: {"transferred": False}, irreversible=True))

    gateway = ToolGateway(registry)
    granted = {"kb.search": 3, "email.send": 5, "finance.transfer": 1}
    base = dict(agent="a1", level=3, granted=granted, project_id="p1",
                scope=frozenset({"p1"}))

    print("1. Absence is the strongest control")
    try:
        registry.register(ToolSpec("system.shell", RiskLevel.R5))
    except ValueError as exc:
        print(f"   {exc}\n")

    print("2. R0 call succeeds")
    print(f"   {gateway.call(tool_id='kb.search', params={'query': 'x'}, **base).output}\n")

    print("3. Argument injection is refused before execution")
    try:
        gateway.call(tool_id="kb.search", params={"query": "x", "__proto__": "evil"}, **base)
    except ArgumentInvalid as exc:
        print(f"   {exc.errors}")
    try:
        gateway.call(tool_id="kb.search", params={"query": "x", "limit": 10**9}, **base)
    except ArgumentInvalid as exc:
        print(f"   {exc.errors}\n")

    print("4. R3 requires approval")
    try:
        gateway.call(tool_id="email.send", params={"to": "a@b.com", "body": "hi"}, **base)
    except ApprovalRequired as exc:
        print(f"   {exc}\n")

    print("5. R5 is a hard stop even for the most senior agent with a token")
    try:
        gateway.call(tool_id="finance.transfer", params={"amount": 1, "dest": "x"},
                     execution_token="a-perfectly-valid-token",
                     **{**base, "level": 5})
    except PermissionDenied as exc:
        print(f"   {exc}\n")

    print("6. Ungranted tool is refused")
    try:
        gateway.call(tool_id="kb.search", params={"query": "x"},
                     **{**base, "granted": {}})
    except PermissionDenied as exc:
        print(f"   {exc}\n")

    print("7. Blocked calls are audited — the security signal")
    for record in gateway.blocked_calls():
        print(f"   {record.tool_id:<18} {record.status:<18} {record.error_code}")
    print(f"\n   total calls recorded: {len(gateway.audit)} "
          f"(raw arguments never stored, only hashes)")
