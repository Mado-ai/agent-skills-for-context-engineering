"""Nested budgets, pre-flight reservation, cost attribution, and blast-radius
limits for agent systems.

Two distinct concerns, deliberately not conflated:
  * BUDGETS bound money and tokens. Exceeding one is an expected condition.
  * BLAST-RADIUS limits bound structure (depth, fan-out, tree size). Exceeding
    one is a structural error — the agent is malfunctioning, not merely busy.

Both are enforced BEFORE the work happens. A check that runs afterwards is
accounting, not governance.

Use when:
    - Agents can spend money without a human in the loop.
    - Agents can spawn sub-agents that spawn sub-agents.
    - Cost must be attributed to a customer, project, or team.

Standard library only. Costs are integer micros (1e-6 USD) throughout.

Typical usage::

    gov = BudgetGovernor()
    gov.set_budget("project", "acme", cost_limit_micros=1_000_000)
    gov.check([("agent", "a1"), ("project", "acme")], cost_micros=500)
    gov.record(Usage(model_cost_micros=480), scopes=[...], project_id="acme")
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

__all__ = [
    "Usage", "BudgetState", "BudgetGovernor", "BudgetExceeded",
    "SpawnLimitExceeded", "SpawnPolicy",
]


class BudgetExceeded(Exception):
    def __init__(self, message: str, **details: Any) -> None:
        super().__init__(message)
        self.details = details


class SpawnLimitExceeded(Exception):
    """A STRUCTURAL error, not an exhausted budget. The response is to stop and
    report, not to wait for more allowance."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass
class Usage:
    tokens_in: int = 0
    tokens_out: int = 0
    model_cost_micros: int = 0
    #: Charged to the SAME scopes as model cost. Otherwise an agent with a cheap
    #: model and an expensive tool appears free in every per-agent report.
    tool_cost_micros: int = 0
    duration_ms: float = 0.0
    queue_ms: float = 0.0
    #: Counted separately: a retry storm and a traffic increase produce
    #: identical cost curves unless retries are visible.
    retries: int = 0

    @property
    def total_cost_micros(self) -> int:
        return self.model_cost_micros + self.tool_cost_micros

    @property
    def total_tokens(self) -> int:
        return self.tokens_in + self.tokens_out


@dataclass
class BudgetState:
    scope_type: str
    scope_id: str
    cost_limit_micros: int | None = None
    token_limit: int | None = None
    spend_micros: int = 0
    tokens_used: int = 0
    executions: int = 0
    window_start: float = 0.0
    window_seconds: float | None = None

    @property
    def cost_remaining(self) -> int | None:
        if self.cost_limit_micros is None:
            return None
        return max(0, self.cost_limit_micros - self.spend_micros)

    @property
    def exhausted(self) -> bool:
        if self.cost_limit_micros is not None and self.spend_micros >= self.cost_limit_micros:
            return True
        if self.token_limit is not None and self.tokens_used >= self.token_limit:
            return True
        return False


@dataclass(frozen=True)
class SpawnPolicy:
    max_depth: int = 3
    max_children_per_task: int = 8
    max_total_spawns: int = 200


class BudgetGovernor:
    def __init__(self, now: Callable[[], float] = time.time) -> None:
        self.now = now
        #: O(1) counters for the hot-path check.
        self._budgets: dict[tuple[str, str], BudgetState] = {}
        #: Append-only detail for attribution. Counters answer "how much";
        #: only the ledger answers "why".
        self.ledger: list[dict[str, Any]] = []

    # -- definition ---------------------------------------------------------
    def set_budget(self, scope_type: str, scope_id: str, *,
                   cost_limit_micros: int | None = None,
                   token_limit: int | None = None,
                   window_seconds: float | None = None) -> BudgetState:
        state = BudgetState(scope_type, scope_id, cost_limit_micros, token_limit,
                            window_start=self.now(), window_seconds=window_seconds)
        self._budgets[(scope_type, scope_id)] = state
        return state

    def get(self, scope_type: str, scope_id: str) -> BudgetState | None:
        state = self._budgets.get((scope_type, scope_id))
        if state is None:
            return None
        self._roll_window(state)
        return state

    def _roll_window(self, state: BudgetState) -> None:
        """Reset lazily on read rather than from a background job.

        A budget nobody is checking does not need rolling, and a lazy reset
        cannot drift out of sync with the check that depends on it. A background
        resetter that fails silently leaves every budget permanently exhausted —
        which presents as "all agents stopped" with no obvious cause.
        """
        if not state.window_seconds:
            return
        if self.now() - state.window_start >= state.window_seconds:
            state.spend_micros = 0
            state.tokens_used = 0
            state.executions = 0
            state.window_start = self.now()

    # -- pre-flight ----------------------------------------------------------
    def check(self, scopes: list[tuple[str, str]], *, cost_micros: int = 0,
              tokens: int = 0) -> None:
        """Assert every scope can absorb the projected spend.

        Scopes must be ordered NARROWEST FIRST (task, agent, project, system) so
        the error names the tightest binding constraint. Reporting the widest
        violated ceiling sends people to the wrong fix.
        """
        for scope_type, scope_id in scopes:
            state = self.get(scope_type, scope_id)
            # An unconfigured scope means unlimited, deliberately: requiring a
            # budget everywhere means the first unbudgeted scope blocks all work,
            # and the pressure that creates is to set every limit absurdly high.
            if state is None:
                continue
            if (state.cost_limit_micros is not None
                    and state.spend_micros + cost_micros > state.cost_limit_micros):
                raise BudgetExceeded(
                    f"cost budget exceeded for {scope_type}:{scope_id} — "
                    f"used {state.spend_micros}, requested {cost_micros}, "
                    f"limit {state.cost_limit_micros}",
                    scope_type=scope_type, scope_id=scope_id, kind="cost",
                    used=state.spend_micros, limit=state.cost_limit_micros)
            if (state.token_limit is not None
                    and state.tokens_used + tokens > state.token_limit):
                raise BudgetExceeded(
                    f"token budget exceeded for {scope_type}:{scope_id} — "
                    f"used {state.tokens_used}, requested {tokens}, "
                    f"limit {state.token_limit}",
                    scope_type=scope_type, scope_id=scope_id, kind="tokens",
                    used=state.tokens_used, limit=state.token_limit)

    def guard_in_flight(self, used_tokens: int, ceiling: int) -> None:
        """Enforce DURING execution, not only before it.

        The pre-flight check uses an estimate. An agent making many model calls
        can blow past its allowance after that check passed, so the ceiling is
        re-tested as the work happens.
        """
        if used_tokens > ceiling:
            raise BudgetExceeded(
                f"task token budget exhausted ({used_tokens} > {ceiling})",
                kind="tokens", used=used_tokens, limit=ceiling)

    # -- settlement -----------------------------------------------------------
    def record(self, usage: Usage, *, scopes: list[tuple[str, str]], project_id: str,
               task_id: str | None = None, agent_id: str | None = None,
               template_id: str | None = None, model: str | None = None) -> None:
        """Commit actual usage: one ledger row plus counter increments.

        In a database these belong in ONE transaction, so the fast counter can
        never disagree with the ledger it summarises.
        """
        self.ledger.append({
            "ts": self.now(), "project_id": project_id, "task_id": task_id,
            "agent_id": agent_id, "template_id": template_id, "model": model,
            "tokens_in": usage.tokens_in, "tokens_out": usage.tokens_out,
            "model_cost_micros": usage.model_cost_micros,
            "tool_cost_micros": usage.tool_cost_micros,
            "duration_ms": usage.duration_ms, "queue_ms": usage.queue_ms,
            "retries": usage.retries})
        for scope_type, scope_id in scopes:
            state = self.get(scope_type, scope_id)
            if state is None:
                continue
            state.spend_micros += usage.total_cost_micros
            state.tokens_used += usage.total_tokens
            state.executions += 1

    # -- blast radius -----------------------------------------------------------
    def check_spawn(self, *, depth: int, siblings: int, tree_size: int,
                    policy: SpawnPolicy) -> None:
        """Three independent limits. Depth alone bounds nothing useful: depth 2
        with fan-out 1,000 is a million tasks, and width 5 at depth 10 is ~10
        million. The per-tree cap is the backstop for the product."""
        if depth > policy.max_depth:
            raise SpawnLimitExceeded(
                "depth", f"spawn depth {depth} exceeds limit {policy.max_depth}")
        if siblings >= policy.max_children_per_task:
            raise SpawnLimitExceeded(
                "fan_out",
                f"task already has {siblings} children "
                f"(limit {policy.max_children_per_task})")
        if tree_size >= policy.max_total_spawns:
            raise SpawnLimitExceeded(
                "tree_size",
                f"task tree already holds {tree_size} tasks "
                f"(limit {policy.max_total_spawns})")

    # -- attribution ---------------------------------------------------------------
    def project_spend(self, project_id: str) -> dict[str, Any]:
        rows = [r for r in self.ledger if r["project_id"] == project_id]
        cost = sum(r["model_cost_micros"] + r["tool_cost_micros"] for r in rows)
        return {"project_id": project_id, "cost_micros": cost,
                "cost_usd": round(cost / 1_000_000, 6),
                "tokens": sum(r["tokens_in"] + r["tokens_out"] for r in rows),
                "executions": len(rows),
                "retries": sum(r["retries"] for r in rows)}

    def top_spenders(self, key: str = "template_id", limit: int = 5) -> list[dict[str, Any]]:
        """Group by template by default.

        'Which KIND of agent costs the most' leads to a fix; 'which instance'
        usually just names whichever one ran most recently.
        """
        totals: dict[Any, dict[str, Any]] = {}
        for row in self.ledger:
            bucket = totals.setdefault(row.get(key), {key: row.get(key),
                                                     "cost_micros": 0,
                                                     "executions": 0, "retries": 0})
            bucket["cost_micros"] += row["model_cost_micros"] + row["tool_cost_micros"]
            bucket["executions"] += 1
            bucket["retries"] += row["retries"]
        return sorted(totals.values(), key=lambda b: -b["cost_micros"])[:limit]


# --------------------------------------------------------------------------
if __name__ == "__main__":
    clock = {"t": 1_000_000.0}
    gov = BudgetGovernor(now=lambda: clock["t"])

    print("1. The narrowest scope names the real constraint")
    gov.set_budget("project", "acme", cost_limit_micros=100_000)
    gov.set_budget("agent", "a1", cost_limit_micros=300)
    scopes = [("agent", "a1"), ("project", "acme")]     # narrowest first
    gov.check(scopes, cost_micros=200)
    gov.record(Usage(tokens_in=100, tokens_out=50, model_cost_micros=200),
               scopes=scopes, project_id="acme", agent_id="a1", template_id="writer")
    try:
        gov.check(scopes, cost_micros=200)
    except BudgetExceeded as exc:
        print(f"   {exc.details['scope_type']}:{exc.details['scope_id']} bound first")
        print(f"   {exc}\n")

    print("2. The refusal itself cost nothing")
    print(f"   spend unchanged at {gov.get('agent', 'a1').spend_micros} micros "
          f"(the 200 already recorded); the refused check added nothing\n")

    print("3. Enforcement during execution, not only before it")
    used = 0
    try:
        for _ in range(100):
            used += 800                    # a multi-call agent running away
            gov.guard_in_flight(used, ceiling=5_000)
    except BudgetExceeded as exc:
        print(f"   stopped mid-flight: {exc}\n")

    print("4. Blast-radius limits are structural errors, not expenses")
    policy = SpawnPolicy(max_depth=3, max_children_per_task=8, max_total_spawns=200)
    for kwargs in (dict(depth=9, siblings=0, tree_size=0),
                   dict(depth=1, siblings=8, tree_size=0),
                   dict(depth=1, siblings=0, tree_size=200)):
        try:
            gov.check_spawn(policy=policy, **kwargs)
        except SpawnLimitExceeded as exc:
            print(f"   {exc.reason:<10} {exc}")
    print()

    print("5. Rolling windows reset lazily on read")
    gov.set_budget("agent", "a2", cost_limit_micros=100, window_seconds=60)
    gov.record(Usage(model_cost_micros=100), scopes=[("agent", "a2")],
               project_id="acme", agent_id="a2")
    print(f"   exhausted:          {gov.get('agent', 'a2').exhausted}")
    clock["t"] += 61
    print(f"   after window rolls: {gov.get('agent', 'a2').exhausted}\n")

    print("6. Attribution answers 'why was the bill this size'")
    gov.record(Usage(model_cost_micros=5_000, tool_cost_micros=500, retries=3),
               scopes=[], project_id="acme", agent_id="a3", template_id="researcher")
    print(f"   {gov.project_spend('acme')}")
    for row in gov.top_spenders():
        print(f"   {row}")
