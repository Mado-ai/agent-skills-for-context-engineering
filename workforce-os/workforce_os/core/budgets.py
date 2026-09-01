"""Per-agent and per-task budgets.

Enforcement is pre-flight: `check_affordable` runs *before* an action executes, so an
over-budget call is never performed and then billed. Spend is recorded only after the
action actually happens, and every charge writes a ledger row that reconciles exactly
with the aggregate.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..errors import BudgetExceeded, NotFoundError
from ..schemas import Budget, new_id, utcnow


@dataclass(frozen=True)
class Spend:
    usd: float = 0.0
    tokens: int = 0
    calls: int = 1


@dataclass(frozen=True)
class BudgetStatus:
    scope: str            # agent | task
    scope_id: str
    budget: Budget
    spent_usd: float
    spent_tokens: int
    spent_calls: int

    def remaining(self) -> dict:
        def left(cap, used):
            return None if cap is None else max(cap - used, 0)
        return {"usd": left(self.budget.max_usd, self.spent_usd),
                "tokens": left(self.budget.max_tokens, self.spent_tokens),
                "calls": left(self.budget.max_tool_calls, self.spent_calls)}

    def to_dict(self) -> dict:
        return {"scope": self.scope, "scope_id": self.scope_id, "budget": self.budget.to_dict(),
                "spent": {"usd": round(self.spent_usd, 6), "tokens": self.spent_tokens,
                          "calls": self.spent_calls},
                "remaining": self.remaining()}


class BudgetLedger:
    def __init__(self, db, events):
        self.db = db
        self.events = events

    # ------------------------------------------------------------------- totals

    def _totals(self, column: str, scope_id: str) -> tuple[float, int, int]:
        row = self.db.query_one(
            f"""SELECT COALESCE(SUM(amount_usd),0) AS usd,
                       COALESCE(SUM(tokens),0)     AS tokens,
                       COALESCE(SUM(calls),0)      AS calls
                FROM budget_ledger WHERE {column} = ?""", (scope_id,))
        return float(row["usd"]), int(row["tokens"]), int(row["calls"])

    def agent_status(self, agent_id: str, contract_budget: Budget) -> BudgetStatus:
        usd, tokens, calls = self._totals("agent_id", agent_id)
        return BudgetStatus("agent", agent_id, contract_budget, usd, tokens, calls)

    def task_status(self, task_id: str) -> BudgetStatus:
        row = self.db.query_one("SELECT budget FROM tasks WHERE id = ?", (task_id,))
        if not row:
            raise NotFoundError(f"Task {task_id} not found")
        usd, tokens, calls = self._totals("task_id", task_id)
        return BudgetStatus("task", task_id, Budget.parse(json.loads(row["budget"])), usd, tokens, calls)

    # ---------------------------------------------------------------- pre-flight

    @staticmethod
    def _would_exceed(status: BudgetStatus, spend: Spend) -> tuple[str, float, float] | None:
        checks = (
            ("usd", status.budget.max_usd, status.spent_usd + spend.usd),
            ("tokens", status.budget.max_tokens, status.spent_tokens + spend.tokens),
            ("calls", status.budget.max_tool_calls, status.spent_calls + spend.calls),
        )
        for dimension, cap, projected in checks:
            if cap is not None and projected > cap:
                return dimension, cap, projected
        return None

    def check_affordable(self, *, agent_id: str, contract_budget: Budget,
                         task_id: str | None, spend: Spend) -> None:
        """Raise BudgetExceeded if this spend would breach the agent or task budget.

        Agent and task budgets are enforced independently — passing one does not excuse
        the other.
        """
        statuses = [self.agent_status(agent_id, contract_budget)]
        if task_id:
            statuses.append(self.task_status(task_id))

        for status in statuses:
            breach = self._would_exceed(status, spend)
            if breach:
                dimension, cap, projected = breach
                raise BudgetExceeded(
                    f"{status.scope} budget exhausted: {dimension} would reach "
                    f"{projected:g} against a cap of {cap:g}",
                    details={"scope": status.scope, "scope_id": status.scope_id,
                             "dimension": dimension, "cap": cap, "projected": projected,
                             "spent": status.to_dict()["spent"]},
                )

    # -------------------------------------------------------------------- charge

    def charge(self, *, project_id: str, agent_id: str, task_id: str | None, kind: str,
               spend: Spend, ref_id: str | None = None) -> dict:
        """Record actual spend. Called only after an action has really occurred."""
        entry = {"id": new_id("led"), "project_id": project_id, "agent_id": agent_id,
                 "task_id": task_id, "kind": kind, "amount_usd": round(spend.usd, 6),
                 "tokens": spend.tokens, "calls": spend.calls, "ref_id": ref_id,
                 "created_at": utcnow()}
        self.db.execute(
            """INSERT INTO budget_ledger (id, project_id, agent_id, task_id, kind,
                                          amount_usd, tokens, calls, ref_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            tuple(entry[k] for k in ("id", "project_id", "agent_id", "task_id", "kind",
                                     "amount_usd", "tokens", "calls", "ref_id", "created_at")))
        return entry

    def entries(self, *, agent_id: str | None = None, task_id: str | None = None,
                limit: int = 200) -> list[dict]:
        sql, params = "SELECT * FROM budget_ledger WHERE 1=1", []
        if agent_id:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        if task_id:
            sql += " AND task_id = ?"
            params.append(task_id)
        params.append(min(limit, 1000))
        return self.db.query(sql + " ORDER BY created_at DESC LIMIT ?", tuple(params))
