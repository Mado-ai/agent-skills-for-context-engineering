"""The hardened Tool Gateway — the single choke point for agent action.

Every call runs the same ordered pipeline, and *every* outcome is recorded:

    1. resolve agent and its verified contract
    2. scope gates          (active → project → known tool → tool → action → domain)
    3. budget pre-flight    (agent and task, before anything executes)
    4. risk classification
    5. approval token       (required for high risk; single-use and bound)
    6. execute
    7. charge, meter, audit

A denial at any step writes a tool-call record with a reason code and executes nothing.
"""

from __future__ import annotations

import json
import time

from ..core.budgets import Spend
from ..errors import ApprovalRequired, PolicyDenied, ValidationError, WorkforceError
from ..policy import risk as risk_policy
from ..policy.scopes import check as scope_check
from ..redaction import redact
from ..schemas import canonical_json, hash_arguments, new_id, utcnow
from .tools import ToolRegistry, ToolResult


class ToolGateway:
    def __init__(self, db, events, registry, tasks, budgets, approvals, telemetry, config,
                 tools: ToolRegistry | None = None):
        self.db = db
        self.events = events
        self.registry = registry
        self.tasks = tasks
        self.budgets = budgets
        self.approvals = approvals
        self.telemetry = telemetry
        self.config = config
        self.tools = tools or ToolRegistry()

    # ------------------------------------------------------------------ auditing

    def _record(self, *, project_id: str, agent_id: str, task_id: str | None, tool_name: str,
                arguments: dict, decision: str, reason_code: str, status: str,
                confirmed: bool = False, result: dict | None = None, error: str | None = None,
                cost_usd: float = 0.0, latency_ms: float = 0.0,
                approval_token_id: str | None = None) -> dict:
        """Write the tool-call record. Called on every path — allowed and denied alike."""
        call_id = new_id("tcl")
        self.db.execute(
            """INSERT INTO tool_calls (id, project_id, agent_id, task_id, tool_name,
                   arguments_redacted, decision, reason_code, status, confirmed,
                   result_redacted, error, cost_usd, latency_ms, approval_token_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (call_id, project_id, agent_id, task_id, tool_name,
             canonical_json(redact(arguments)), decision, reason_code, status,
             1 if confirmed else 0,
             canonical_json(redact(result)) if result is not None else None,
             error, float(cost_usd), float(latency_ms), approval_token_id, utcnow()))
        self.events.append(f"tool.{decision}", actor_type="agent", actor_id=agent_id,
                           project_id=project_id,
                           payload={"tool_call_id": call_id, "tool_name": tool_name,
                                    "reason_code": reason_code, "status": status,
                                    "confirmed": confirmed})
        return {"id": call_id, "decision": decision, "reason_code": reason_code,
                "status": status, "confirmed": confirmed}

    # --------------------------------------------------------------------- call

    def call(self, *, agent_id: str, tool_name: str, arguments: dict,
             task_id: str | None = None, approval_token: str | None = None) -> dict:
        """Execute a tool on behalf of an agent, or refuse and say exactly why."""
        if not isinstance(arguments, dict):
            raise ValidationError("arguments must be an object", details={"field": "arguments"})

        agent = self.registry.get(agent_id)          # raises NotFoundError
        project_id = agent["project_id"]
        contract = self.registry.get_contract(agent_id)   # verifies checksum

        if task_id:
            task = self.tasks.get(task_id)
            if task["project_id"] != project_id:
                self._record(project_id=project_id, agent_id=agent_id, task_id=None,
                             tool_name=tool_name, arguments=arguments, decision="denied",
                             reason_code="project_isolation", status="denied",
                             error="Task belongs to a different project")
                raise PolicyDenied("Task belongs to a different project", code="project_isolation")

        spec = self.tools.get(tool_name)
        # The tool's *declared* requirements are what get checked — never the arguments.
        action_type = spec.action_type if spec else "read"
        data_domains = list(spec.data_domains) if spec else []

        # ---------------------------------------------------------- 2. scope gates
        decision = scope_check(agent_row=agent, contract=contract, project_id=project_id,
                               tool_name=tool_name, action_type=action_type,
                               data_domains=data_domains, known_tools=self.tools.names())
        if not decision.allowed:
            self._record(project_id=project_id, agent_id=agent_id, task_id=task_id,
                         tool_name=tool_name, arguments=arguments, decision="denied",
                         reason_code=decision.reason_code, status="denied",
                         error=decision.message)
            raise PolicyDenied(decision.message, code=decision.reason_code,
                               details={"tool": tool_name, "agent_id": agent_id})

        # ------------------------------------------------------ 3. budget pre-flight
        estimated = Spend(usd=spec.estimated_cost_usd, tokens=0, calls=1)
        try:
            self.budgets.check_affordable(agent_id=agent_id, contract_budget=contract.budget,
                                          task_id=task_id, spend=estimated)
        except WorkforceError as exc:
            self._record(project_id=project_id, agent_id=agent_id, task_id=task_id,
                         tool_name=tool_name, arguments=arguments, decision="denied",
                         reason_code="budget_exceeded", status="denied", error=exc.message)
            raise

        # ------------------------------------------------- 4/5. risk and approval
        risk_level, risk_reason = risk_policy.classify(
            tool_name=tool_name, action_type=action_type, data_domains=data_domains,
            tool_declared_risk=spec.declared_risk, estimated_cost_usd=spec.estimated_cost_usd)

        arguments_hash = hash_arguments(arguments)
        token_row = None

        if risk_policy.requires_approval(risk_level):
            if not approval_token:
                request = self.approvals.open_request(
                    project_id=project_id, agent_id=agent_id, task_id=task_id,
                    tool_name=tool_name, arguments=arguments, arguments_hash=arguments_hash,
                    risk_level=risk_level, reason=risk_reason)
                self._record(project_id=project_id, agent_id=agent_id, task_id=task_id,
                             tool_name=tool_name, arguments=arguments, decision="denied",
                             reason_code="approval_required", status="denied",
                             error=f"Owner approval required: {risk_reason}")
                raise ApprovalRequired(
                    f"This action requires explicit Owner approval ({risk_reason})",
                    request_id=request["id"],
                    details={"tool": tool_name, "risk_level": risk_level})
            try:
                token_row = self.approvals.consume_token(
                    approval_token, agent_id=agent_id, tool_name=tool_name,
                    arguments_hash=arguments_hash)
            except WorkforceError as exc:
                self._record(project_id=project_id, agent_id=agent_id, task_id=task_id,
                             tool_name=tool_name, arguments=arguments, decision="denied",
                             reason_code=exc.code, status="denied", error=exc.message)
                raise

        # ---------------------------------------------------------------- 6. execute
        started = time.perf_counter()
        try:
            result: ToolResult = spec.handler(arguments, {"agent_id": agent_id,
                                                          "task_id": task_id,
                                                          "project_id": project_id})
        except WorkforceError as exc:
            latency = (time.perf_counter() - started) * 1000
            self._record(project_id=project_id, agent_id=agent_id, task_id=task_id,
                         tool_name=tool_name, arguments=arguments, decision="allowed",
                         reason_code="tool_input_invalid", status="attempted", confirmed=False,
                         error=exc.message, latency_ms=latency,
                         approval_token_id=token_row["id"] if token_row else None)
            raise
        except Exception as exc:  # a tool bug must not take the runtime down
            latency = (time.perf_counter() - started) * 1000
            self._record(project_id=project_id, agent_id=agent_id, task_id=task_id,
                         tool_name=tool_name, arguments=arguments, decision="allowed",
                         reason_code="tool_execution_failed", status="attempted", confirmed=False,
                         error=str(exc)[:500], latency_ms=latency,
                         approval_token_id=token_row["id"] if token_row else None)
            raise PolicyDenied(f"Tool {tool_name!r} failed during execution",
                               code="tool_execution_failed", details={"error": str(exc)[:200]})

        latency_ms = (time.perf_counter() - started) * 1000

        # ------------------------------------------------- 7. charge, meter, audit
        actual = Spend(usd=result.cost_usd, tokens=result.tokens, calls=1)
        self.budgets.charge(project_id=project_id, agent_id=agent_id, task_id=task_id,
                            kind="tool_call", spend=actual, ref_id=tool_name)
        self.telemetry.record_call(project_id=project_id, agent_id=agent_id, task_id=task_id,
                                   source="tool_call", cost_usd=result.cost_usd,
                                   latency_ms=latency_ms, tokens=result.tokens)

        # `confirmed` comes solely from the tool. An unconfirmed call is reported as
        # attempted — the runtime never claims an action that was not confirmed.
        record = self._record(
            project_id=project_id, agent_id=agent_id, task_id=task_id, tool_name=tool_name,
            arguments=arguments, decision="allowed", reason_code="executed",
            status="executed" if result.confirmed else "attempted", confirmed=result.confirmed,
            result=result.output, cost_usd=result.cost_usd, latency_ms=latency_ms,
            approval_token_id=token_row["id"] if token_row else None)

        return {"tool_call_id": record["id"], "tool": tool_name, "status": record["status"],
                "confirmed": result.confirmed, "output": result.output, "note": result.note,
                "risk_level": risk_level, "cost_usd": result.cost_usd,
                "latency_ms": round(latency_ms, 3)}

    # --------------------------------------------------------------------- reads

    def calls_for(self, *, agent_id: str | None = None, task_id: str | None = None,
                  project_id: str | None = None, limit: int = 100) -> list[dict]:
        sql, params = "SELECT * FROM tool_calls WHERE 1=1", []
        for column, value in (("agent_id", agent_id), ("task_id", task_id),
                              ("project_id", project_id)):
            if value:
                sql += f" AND {column} = ?"
                params.append(value)
        params.append(min(limit, 500))
        rows = self.db.query(sql + " ORDER BY created_at DESC LIMIT ?", tuple(params))
        for row in rows:
            row["arguments_redacted"] = json.loads(row["arguments_redacted"])
            if row["result_redacted"]:
                row["result_redacted"] = json.loads(row["result_redacted"])
            row["confirmed"] = bool(row["confirmed"])
        return rows
