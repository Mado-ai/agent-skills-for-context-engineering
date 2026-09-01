"""The Tool Gateway — the only path from an agent to the outside world.

An agent never holds a callable. It holds a *tool id* and must ask the gateway,
which then runs the full chain before the implementation is reached:

    contract grant → capability → project scope → risk policy →
    approval/token → rate limit → budget → argument validation → execute →
    output validation → audit

Every one of those can refuse, and refusal is recorded. The ordering is
deliberate: the cheapest and most decisive checks run first, so a denied call
costs a permission lookup rather than a rate-limit query and a schema pass.

**Model output is untrusted input.** Tool arguments arrive from a language model
and are validated against the tool's declared input schema before execution.
That is the single most important line of defence here — a tool whose arguments
are taken on faith is an injection vector regardless of how well the permission
model is designed.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from af.clock import Clock, SystemClock
from af.errors import (ApprovalRequired, BudgetExceeded, PermissionDenied,
                       ToolError, ToolUnavailable, ValidationError)
from af.governance.approvals import ApprovalEngine
from af.governance.permissions import PermissionEngine, Principal, PrincipalKind
from af.ids import new_id
from af.jsonschema import validate as schema_validate
from af.store.sqlite_store import SqliteStore, dumps
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["RiskLevel", "ToolSpec", "ToolRegistry", "ToolGateway", "ToolResult"]


class RiskLevel(str, Enum):
    """Risk classes from the mandate, with the policy each implies.

    The class determines the *default* policy. A contract can tighten it (a tool
    may be granted with ``requires_approval_override=True``) but never loosen
    it — loosening is an owner decision expressed by approving a request, not a
    property an agent's own contract can assert.
    """

    R0 = "R0"  # read-only internal
    R1 = "R1"  # low-risk internal write
    R2 = "R2"  # external, reversible
    R3 = "R3"  # sensitive external action  -> approval required
    R4 = "R4"  # owner approval mandatory   -> approval required
    R5 = "R5"  # prohibited for autonomous execution -> never runs for an agent

    @property
    def requires_approval(self) -> bool:
        return self in (RiskLevel.R3, RiskLevel.R4, RiskLevel.R5)

    @property
    def autonomous_forbidden(self) -> bool:
        return self is RiskLevel.R5

    @property
    def min_level(self) -> int:
        return {RiskLevel.R0: 1, RiskLevel.R1: 1, RiskLevel.R2: 2,
                RiskLevel.R3: 3, RiskLevel.R4: 3, RiskLevel.R5: 5}[self]


@dataclass(slots=True)
class ToolSpec:
    tool_id: str
    category: str
    risk_level: RiskLevel
    description: str = ""
    required_permission: str = "tool.call"
    #: Empty means available to any project. A non-empty set restricts the tool
    #: to those projects — the mechanism for project-specific integrations.
    project_scope: frozenset[str] = field(default_factory=frozenset)
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    rate_limit_per_minute: int = 60
    cost_micros_per_call: int = 0
    timeout_seconds: float = 30.0
    handler: Callable[..., Any] | None = None
    #: Set when the tool's effect cannot be undone. Surfaced in the approval
    #: request so the owner sees it, and blocks the "just retry it" path.
    irreversible: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {"tool_id": self.tool_id, "category": self.category,
                "risk_level": self.risk_level.value, "description": self.description,
                "required_permission": self.required_permission,
                "project_scope": sorted(self.project_scope),
                "input_schema": self.input_schema, "output_schema": self.output_schema,
                "rate_limit_per_minute": self.rate_limit_per_minute,
                "cost_micros_per_call": self.cost_micros_per_call,
                "irreversible": self.irreversible}


@dataclass(slots=True)
class ToolResult:
    tool_id: str
    ok: bool
    output: Any = None
    error: str | None = None
    error_code: str | None = None
    duration_ms: float = 0.0
    cost_micros: int = 0
    call_id: str = ""


class ToolRegistry:
    """In-memory catalogue of tool definitions."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> ToolSpec:
        if spec.tool_id in self._tools:
            raise ValueError(f"tool '{spec.tool_id}' already registered")
        self._tools[spec.tool_id] = spec
        return spec

    def get(self, tool_id: str) -> ToolSpec | None:
        return self._tools.get(tool_id)

    def ids(self) -> set[str]:
        return set(self._tools)

    def list(self, *, project_id: str | None = None,
             max_risk: RiskLevel | None = None) -> list[ToolSpec]:
        out = []
        order = list(RiskLevel)
        for spec in self._tools.values():
            if spec.project_scope and project_id not in spec.project_scope:
                continue
            if max_risk is not None and order.index(spec.risk_level) > order.index(max_risk):
                continue
            out.append(spec)
        return sorted(out, key=lambda s: s.tool_id)


class ToolGateway:
    _INSERT_CALL = (
        "INSERT INTO tool_calls (id, ts, task_id, agent_id, project_id, tool_id, "
        "risk_level, args_hash, status, token_id, duration_ms, cost_micros, error_code) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")

    def __init__(self, store: SqliteStore, registry: ToolRegistry, telemetry: Telemetry,
                 permissions: PermissionEngine, approvals: ApprovalEngine,
                 budget=None, clock: Clock | None = None, batcher=None) -> None:
        self.store = store
        self.registry = registry
        self.telemetry = telemetry
        self.permissions = permissions
        self.approvals = approvals
        self.budget = budget
        self.clock = clock or SystemClock()
        #: tool_calls is an append-only audit table; batching it removes a write
        #: transaction per tool call. The *decision* to allow the call is
        #: already made synchronously above, so nothing security-relevant is
        #: deferred except the record of it.
        self.batcher = batcher

    def call(self, *, principal: Principal, tool_id: str, params: dict[str, Any],
             project_id: str, task_id: str | None = None,
             granted_tools: dict[str, Any] | None = None,
             execution_token: str | None = None,
             calls_this_task: int = 0,
             trace_id: str | None = None) -> ToolResult:
        """Run the full policy chain, then the tool."""
        call_id = new_id("tcl")
        started = time.perf_counter()
        args_hash = hashlib.sha256(dumps(params).encode()).hexdigest()

        def blocked(code: str, message: str, exc: Exception) -> None:
            self._record(call_id, task_id, principal.id, project_id, tool_id,
                         spec.risk_level.value if spec else "unknown", args_hash,
                         "blocked", None, (time.perf_counter() - started) * 1000, 0, code)
            self.telemetry.emit(Event(
                type=EventType.TOOL_BLOCKED, trace_id=trace_id, project_id=project_id,
                task_id=task_id, agent_id=principal.id, tool=tool_id, status="blocked",
                error_code=code, payload={"reason": message, "call_id": call_id}))
            raise exc

        spec = self.registry.get(tool_id)
        if spec is None:
            self.telemetry.emit(Event(
                type=EventType.TOOL_BLOCKED, trace_id=trace_id, project_id=project_id,
                task_id=task_id, agent_id=principal.id, tool=tool_id, status="blocked",
                error_code="tool_unavailable", payload={"reason": "unregistered tool"}))
            raise ToolUnavailable(f"tool '{tool_id}' is not registered", tool_id=tool_id)

        # 1. The contract must grant this specific tool. Holding 'tool.call'
        #    grants the *ability to use tools*, never a particular tool.
        if granted_tools is not None and tool_id not in granted_tools:
            blocked("permission_denied",
                    f"tool '{tool_id}' is not granted by the agent's contract",
                    PermissionDenied(f"tool '{tool_id}' not granted by contract",
                                     tool_id=tool_id, principal=principal.id))

        # 2. Capability + project isolation.
        try:
            self.permissions.check(principal, spec.required_permission,
                                   project_id=project_id, task_id=task_id)
        except PermissionDenied as exc:
            blocked(exc.code, str(exc), exc)

        # 3. Tool-level project scope.
        if spec.project_scope and project_id not in spec.project_scope:
            blocked("permission_denied",
                    f"tool '{tool_id}' is not available to project '{project_id}'",
                    PermissionDenied(f"tool '{tool_id}' out of project scope",
                                     tool_id=tool_id, project_id=project_id))

        # 4. Level floor for the risk class.
        if principal.kind is PrincipalKind.AGENT and principal.level < spec.risk_level.min_level:
            blocked("permission_denied",
                    f"{spec.risk_level.value} tools require level >= "
                    f"{spec.risk_level.min_level}, principal is L{principal.level}",
                    PermissionDenied(f"insufficient level for {spec.risk_level.value} tool",
                                     tool_id=tool_id, level=principal.level))

        # 5. R5 is never executed autonomously, token or not. This is the one
        #    class an approval cannot unlock from inside the runtime.
        if spec.risk_level.autonomous_forbidden and principal.kind is not PrincipalKind.OWNER:
            blocked("permission_denied",
                    f"tool '{tool_id}' is R5 (prohibited for autonomous execution)",
                    PermissionDenied(f"R5 tool '{tool_id}' cannot be executed autonomously",
                                     tool_id=tool_id))

        # 6. Approval + single-use token for R3/R4 (and anything the contract
        #    chose to escalate).
        grant = (granted_tools or {}).get(tool_id)
        needs_approval = spec.risk_level.requires_approval or bool(
            getattr(grant, "requires_approval_override", False))
        if needs_approval and principal.kind is not PrincipalKind.OWNER:
            if not execution_token:
                self.telemetry.emit(Event(
                    type=EventType.TOOL_BLOCKED, trace_id=trace_id, project_id=project_id,
                    task_id=task_id, agent_id=principal.id, tool=tool_id,
                    status="approval_required",
                    error_code="approval_required",
                    payload={"risk": spec.risk_level.value, "call_id": call_id,
                             "irreversible": spec.irreversible}))
                raise ApprovalRequired(
                    f"tool '{tool_id}' ({spec.risk_level.value}) requires owner approval",
                    tool_id=tool_id, risk_level=spec.risk_level.value,
                    params=params, irreversible=spec.irreversible)
            # Token consumption re-checks agent, tool and parameter binding.
            self.approvals.consume(execution_token, agent_id=principal.id,
                                   tool_id=tool_id, params=params, task_id=task_id)

        # 7. Per-task call ceiling from the contract.
        max_calls = getattr(grant, "max_calls_per_task", None)
        if max_calls is not None and calls_this_task >= max_calls:
            blocked("permission_denied",
                    f"per-task call limit for '{tool_id}' reached ({max_calls})",
                    PermissionDenied(f"tool call limit reached for '{tool_id}'",
                                     tool_id=tool_id, limit=max_calls))

        # 8. Rate limit — a sliding window over the audited call log, so it
        #    survives a process restart (an in-memory counter would not).
        if spec.rate_limit_per_minute > 0:
            recent = self.store.scalar(
                "SELECT count(*) FROM tool_calls WHERE agent_id = ? AND tool_id = ? "
                "AND ts > ? AND status != 'blocked'",
                (principal.id, tool_id, self.clock.now() - 60.0)) or 0
            if recent >= spec.rate_limit_per_minute:
                blocked("rate_limited",
                        f"rate limit {spec.rate_limit_per_minute}/min reached for '{tool_id}'",
                        ToolUnavailable(f"rate limit exceeded for '{tool_id}'",
                                        tool_id=tool_id, limit=spec.rate_limit_per_minute))

        # 9. Budget pre-flight for tools that cost money.
        if self.budget is not None and spec.cost_micros_per_call > 0:
            try:
                self.budget.check([("agent", principal.id), ("project", project_id)],
                                  cost_micros=spec.cost_micros_per_call,
                                  project_id=project_id, task_id=task_id,
                                  agent_id=principal.id)
            except BudgetExceeded as exc:
                blocked("budget_exceeded", str(exc), exc)

        # 10. Validate model-generated arguments. Never trust them.
        if spec.input_schema:
            errors = schema_validate(params, spec.input_schema)
            if errors:
                blocked("validation_error",
                        f"invalid tool arguments: {errors}",
                        ValidationError(f"tool '{tool_id}' arguments failed validation",
                                        tool_id=tool_id, errors=errors))

        # --- execute ---------------------------------------------------------
        if spec.handler is None:
            blocked("tool_unavailable", f"tool '{tool_id}' has no handler",
                    ToolUnavailable(f"tool '{tool_id}' has no handler", tool_id=tool_id))
        try:
            output = spec.handler(**params)
            ok, error, error_code = True, None, None
        except Exception as exc:
            output, ok = None, False
            error, error_code = str(exc), getattr(exc, "code", "tool_error")

        duration_ms = (time.perf_counter() - started) * 1000.0

        # 11. Validate the tool's own output too. A tool that returns something
        #     unexpected would otherwise put malformed data into agent context.
        if ok and spec.output_schema:
            out_errors = schema_validate(output, spec.output_schema)
            if out_errors:
                ok, error, error_code = False, f"tool output failed validation: {out_errors}", "tool_error"

        self._record(call_id, task_id, principal.id, project_id, tool_id,
                     spec.risk_level.value, args_hash, "ok" if ok else "error",
                     execution_token.split(".")[0] if execution_token else None,
                     duration_ms, spec.cost_micros_per_call if ok else 0, error_code)
        self.telemetry.emit(Event(
            type=EventType.TOOL_CALLED, trace_id=trace_id, project_id=project_id,
            task_id=task_id, agent_id=principal.id, tool=tool_id,
            status="ok" if ok else "error",
            duration_ms=duration_ms, cost_micros=spec.cost_micros_per_call if ok else 0,
            error_code=error_code,
            payload={"call_id": call_id, "risk": spec.risk_level.value,
                     "args_hash": args_hash[:16]}))
        if not ok:
            raise ToolError(error or "tool execution failed", tool_id=tool_id,
                            call_id=call_id, error_code=error_code)
        return ToolResult(tool_id=tool_id, ok=True, output=output,
                          duration_ms=duration_ms,
                          cost_micros=spec.cost_micros_per_call, call_id=call_id)

    def _record(self, call_id, task_id, agent_id, project_id, tool_id, risk,
                args_hash, status, token_id, duration_ms, cost, error_code) -> None:
        """Audit row for every call, including blocked ones.

        Blocked calls are the interesting ones for security review, so they are
        recorded with the same fidelity as successful ones. Only a hash of the
        arguments is stored — arguments can carry sensitive payloads, and the
        hash is enough to prove what was attempted and to correlate a retry.
        """
        row = (call_id, self.clock.now(), task_id, agent_id, project_id, tool_id, risk,
               args_hash, status, token_id, duration_ms, cost, error_code)
        if self.batcher is not None:
            self.batcher.add(self._INSERT_CALL, row)
        else:
            self.store.execute(self._INSERT_CALL, row)
