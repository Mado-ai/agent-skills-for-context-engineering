"""Deny-by-default scope checking.

Six independent gates, evaluated in a fixed order so the returned reason code always
names the *first* thing that failed. Every gate must pass; none of them is implied by
an agent's authority level.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..schemas import AgentContract, Scope


@dataclass(frozen=True)
class ScopeDecision:
    allowed: bool
    reason_code: str
    message: str

    @staticmethod
    def allow() -> "ScopeDecision":
        return ScopeDecision(True, "allowed", "All scope gates passed")

    @staticmethod
    def deny(code: str, message: str) -> "ScopeDecision":
        return ScopeDecision(False, code, message)


def check(*, agent_row: dict, contract: AgentContract, project_id: str, tool_name: str,
          action_type: str, data_domains: list[str], known_tools: set[str]) -> ScopeDecision:
    """Evaluate every scope gate for one intended action."""

    if agent_row["status"] != "active":
        return ScopeDecision.deny(
            "agent_not_active", f"Agent is {agent_row['status']!r}; only active agents may act")

    if agent_row["project_id"] != project_id or contract.project_id != project_id:
        return ScopeDecision.deny(
            "project_isolation", "Agent belongs to a different project")

    if tool_name not in known_tools:
        return ScopeDecision.deny("unknown_tool", f"Tool {tool_name!r} is not registered")

    # Authority level is deliberately not consulted here: L5 grants visibility, not scope.
    if tool_name not in contract.scope.allowed_tools:
        return ScopeDecision.deny(
            "tool_not_in_contract", f"Tool {tool_name!r} is not in this agent's contract")

    if action_type not in contract.scope.action_types:
        return ScopeDecision.deny(
            "action_type_denied", f"Action type {action_type!r} is not permitted by this contract")

    missing = sorted(set(data_domains) - set(contract.scope.data_domains))
    if missing:
        return ScopeDecision.deny(
            "data_domain_denied", f"Data domain(s) not permitted: {', '.join(missing)}")

    return ScopeDecision.allow()


def attenuate(parent: Scope, requested: Scope) -> Scope:
    """A delegated scope is the intersection — a child can never exceed its parent."""
    return parent.intersect(requested)
