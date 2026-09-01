"""Risk classification. Decides which actions need explicit Owner approval.

Classification is a policy concern and deliberately conservative: an action is high risk
unless it is known to be safe.
"""

from __future__ import annotations

# Action types that change state outside the runtime or move value.
HIGH_RISK_ACTION_TYPES = frozenset({"transact", "admin"})
MEDIUM_RISK_ACTION_TYPES = frozenset({"write", "communicate"})

# Data domains whose contents warrant Owner sign-off regardless of the action.
SENSITIVE_DATA_DOMAINS = frozenset({"financial", "customer_pii", "credentials", "legal"})


def classify(*, tool_name: str, action_type: str, data_domains: list[str],
             tool_declared_risk: str | None = None, estimated_cost_usd: float = 0.0,
             high_cost_threshold_usd: float = 1.0) -> tuple[str, str]:
    """Return `(risk_level, reason)`.

    A tool may declare its own risk; the classifier takes the *higher* of the declared
    and the derived level so a tool can never talk its way down.
    """
    derived, reason = "low", "read-only action on non-sensitive data"

    if action_type in MEDIUM_RISK_ACTION_TYPES:
        derived, reason = "medium", f"action type {action_type!r} changes state"

    sensitive = sorted(set(data_domains) & SENSITIVE_DATA_DOMAINS)
    if sensitive:
        derived, reason = "high", f"touches sensitive data domain(s): {', '.join(sensitive)}"

    if action_type in HIGH_RISK_ACTION_TYPES:
        derived, reason = "high", f"action type {action_type!r} is externally consequential"

    if estimated_cost_usd >= high_cost_threshold_usd:
        derived, reason = "high", f"estimated cost ${estimated_cost_usd:.2f} meets the approval threshold"

    order = {"low": 0, "medium": 1, "high": 2}
    if tool_declared_risk and order.get(tool_declared_risk, 0) > order[derived]:
        return tool_declared_risk, f"tool {tool_name!r} declares itself {tool_declared_risk} risk"
    return derived, reason


def requires_approval(risk_level: str) -> bool:
    return risk_level == "high"
