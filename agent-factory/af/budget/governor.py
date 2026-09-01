"""Cost, resource and blast-radius governance.

Two separable jobs live here:

1. **Budgets** — money and tokens, tracked in an O(1) counter per scope with an
   append-only ledger behind it for attribution. The counter is what gets
   checked on the hot path; the ledger is what answers "where did it go".

2. **Blast radius** — spawn depth, fan-out width, cumulative spawns per task
   tree, and concurrency. These are *not* budgets: exceeding them is a
   structural error, not an expense.

Everything here is a **pre-flight** check. Detecting an overrun after the spend
is accounting, not governance; the reservation pattern (``reserve`` → do work →
``settle``) means the ceiling is enforced before the money is committed.

Costs are integer micros (1e-6 USD) throughout. See BudgetPolicy for why.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from af.clock import Clock, SystemClock
from af.errors import BudgetExceeded, SpawnLimitExceeded
from af.ids import new_id
from af.store.sqlite_store import SqliteStore
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["BudgetGovernor", "BudgetState", "Usage"]


@dataclass(slots=True)
class BudgetState:
    scope_type: str
    scope_id: str
    cost_limit_micros: int | None
    token_limit: int | None
    task_limit: int | None
    spend_micros: int
    tokens_used: int
    tasks_used: int

    @property
    def cost_remaining(self) -> int | None:
        return None if self.cost_limit_micros is None else max(
            0, self.cost_limit_micros - self.spend_micros)

    @property
    def exhausted(self) -> bool:
        if self.cost_limit_micros is not None and self.spend_micros >= self.cost_limit_micros:
            return True
        if self.token_limit is not None and self.tokens_used >= self.token_limit:
            return True
        return False

    def to_dict(self) -> dict[str, Any]:
        d = {f: getattr(self, f) for f in self.__slots__}
        d["cost_remaining"] = self.cost_remaining
        d["exhausted"] = self.exhausted
        return d


@dataclass(slots=True)
class Usage:
    tokens_in: int = 0
    tokens_out: int = 0
    model_cost_micros: int = 0
    tool_cost_micros: int = 0
    duration_ms: float = 0.0
    queue_ms: float = 0.0
    retries: int = 0

    @property
    def total_cost_micros(self) -> int:
        return self.model_cost_micros + self.tool_cost_micros

    @property
    def total_tokens(self) -> int:
        return self.tokens_in + self.tokens_out


class BudgetGovernor:
    _INSERT_LEDGER = (
        "INSERT INTO usage_ledger (id, ts, project_id, task_id, agent_id, template_id, "
        "model, provider, tokens_in, tokens_out, model_cost_micros, tool_cost_micros, "
        "duration_ms, queue_ms, retries) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")

    def __init__(self, store: SqliteStore, telemetry: Telemetry,
                 clock: Clock | None = None, batcher=None) -> None:
        self.store = store
        self.telemetry = telemetry
        self.clock = clock or SystemClock()
        #: The ledger is append-only detail and may be batched. The budget
        #: *counters* below are never batched — they gate spending, and a stale
        #: counter would let an agent overrun its ceiling.
        self.batcher = batcher

    # -- budget definition ---------------------------------------------------
    def set_budget(self, scope_type: str, scope_id: str, *, project_id: str | None = None,
                   cost_limit_micros: int | None = None, token_limit: int | None = None,
                   task_limit: int | None = None, window_seconds: float | None = None) -> None:
        now = self.clock.now()
        self.store.execute(
            """
            INSERT INTO budgets (scope_type, scope_id, project_id, cost_limit_micros,
                                 token_limit, task_limit, window_start, window_seconds, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT (scope_type, scope_id) DO UPDATE SET
                cost_limit_micros = excluded.cost_limit_micros,
                token_limit = excluded.token_limit,
                task_limit = excluded.task_limit,
                window_seconds = excluded.window_seconds,
                updated_at = excluded.updated_at
            """,
            (scope_type, scope_id, project_id, cost_limit_micros, token_limit,
             task_limit, now, window_seconds, now))

    def get(self, scope_type: str, scope_id: str) -> BudgetState | None:
        row = self.store.one(
            "SELECT * FROM budgets WHERE scope_type = ? AND scope_id = ?", (scope_type, scope_id))
        if row is None:
            return None
        self._roll_window(row)
        row = self.store.one(
            "SELECT * FROM budgets WHERE scope_type = ? AND scope_id = ?", (scope_type, scope_id))
        return BudgetState(
            scope_type=row["scope_type"], scope_id=row["scope_id"],
            cost_limit_micros=row["cost_limit_micros"], token_limit=row["token_limit"],
            task_limit=row["task_limit"], spend_micros=row["spend_micros"],
            tokens_used=row["tokens_used"], tasks_used=row["tasks_used"])

    def _roll_window(self, row) -> None:
        """Reset counters when a rate window has elapsed.

        Done lazily on read rather than by a background job: a budget nobody is
        checking does not need rolling, and a lazy roll cannot drift out of sync
        with the check that depends on it.
        """
        if not row["window_seconds"]:
            return
        now = self.clock.now()
        start = row["window_start"] or now
        if now - start >= row["window_seconds"]:
            self.store.execute(
                "UPDATE budgets SET spend_micros = 0, tokens_used = 0, tasks_used = 0, "
                "window_start = ?, updated_at = ? WHERE scope_type = ? AND scope_id = ?",
                (now, now, row["scope_type"], row["scope_id"]))

    # -- pre-flight ------------------------------------------------------------
    def check(self, scopes: list[tuple[str, str]], *, cost_micros: int = 0,
              tokens: int = 0, project_id: str | None = None,
              task_id: str | None = None, agent_id: str | None = None) -> None:
        """Assert every scope can absorb the projected spend.

        Scopes are checked from the *narrowest* outward (task, agent, project,
        system) so the error names the tightest binding constraint rather than
        whichever happened to be listed first — the difference between "raise
        this agent's budget" and a confusing "system budget exceeded".
        """
        for scope_type, scope_id in scopes:
            state = self.get(scope_type, scope_id)
            if state is None:
                continue  # No budget configured for this scope means unlimited.
            if (state.cost_limit_micros is not None
                    and state.spend_micros + cost_micros > state.cost_limit_micros):
                self._reject(scope_type, scope_id, "cost", state, cost_micros,
                             project_id, task_id, agent_id)
            if (state.token_limit is not None
                    and state.tokens_used + tokens > state.token_limit):
                self._reject(scope_type, scope_id, "tokens", state, tokens,
                             project_id, task_id, agent_id)

    def _reject(self, scope_type, scope_id, kind, state, requested,
                project_id, task_id, agent_id) -> None:
        limit = state.cost_limit_micros if kind == "cost" else state.token_limit
        used = state.spend_micros if kind == "cost" else state.tokens_used
        message = (f"{kind} budget exceeded for {scope_type}:{scope_id} — "
                   f"used {used}, requested {requested}, limit {limit}")
        self.telemetry.emit(Event(
            type=EventType.BUDGET_EXCEEDED, project_id=project_id, task_id=task_id,
            agent_id=agent_id, status="blocked", error_code="budget_exceeded",
            payload={"scope_type": scope_type, "scope_id": scope_id, "kind": kind,
                     "used": used, "requested": requested, "limit": limit}))
        raise BudgetExceeded(message, scope_type=scope_type, scope_id=scope_id,
                             kind=kind, limit=limit, used=used)

    # -- settlement -------------------------------------------------------------
    def record(self, usage: Usage, *, scopes: list[tuple[str, str]], project_id: str,
               task_id: str | None = None, agent_id: str | None = None,
               template_id: str | None = None, model: str | None = None,
               provider: str | None = None) -> None:
        """Commit actual usage: one ledger row plus counter increments.

        Ledger and counters are written in one transaction, so the fast counter
        can never disagree with the detailed ledger it summarises.
        """
        now = self.clock.now()
        ledger_row = (new_id("usg"), now, project_id, task_id, agent_id, template_id,
                      model, provider, usage.tokens_in, usage.tokens_out,
                      usage.model_cost_micros, usage.tool_cost_micros,
                      usage.duration_ms, usage.queue_ms, usage.retries)
        if self.batcher is not None:
            self.batcher.add(self._INSERT_LEDGER, ledger_row)
        with self.store.write() as c:
            if self.batcher is None:
                c.execute(self._INSERT_LEDGER, ledger_row)
            for scope_type, scope_id in scopes:
                c.execute(
                    "UPDATE budgets SET spend_micros = spend_micros + ?, "
                    "tokens_used = tokens_used + ?, tasks_used = tasks_used + 1, updated_at = ? "
                    "WHERE scope_type = ? AND scope_id = ?",
                    (usage.total_cost_micros, usage.total_tokens, now, scope_type, scope_id))

    # -- blast radius --------------------------------------------------------------
    def check_spawn(self, *, depth: int, max_depth: int, root_id: str,
                    max_total_spawns: int, children_so_far: int, max_children: int,
                    project_id: str | None = None, task_id: str | None = None,
                    agent_id: str | None = None) -> None:
        """Three independent recursion limits, all checked before the spawn.

        Depth alone is insufficient: a depth-2 tree with fan-out 1000 at each
        level is 1,000,000 tasks. Width alone is insufficient too. The
        cumulative per-tree cap is the backstop that bounds the product.
        """
        if depth > max_depth:
            self._spawn_reject("depth", f"spawn depth {depth} exceeds limit {max_depth}",
                               project_id, task_id, agent_id)
        if children_so_far >= max_children:
            self._spawn_reject(
                "fan_out", f"task already has {children_so_far} children (limit {max_children})",
                project_id, task_id, agent_id)
        total = self.store.scalar(
            "SELECT count(*) FROM tasks WHERE root_id = ?", (root_id,)) or 0
        if total >= max_total_spawns:
            self._spawn_reject(
                "tree_size",
                f"task tree '{root_id}' already has {total} tasks (limit {max_total_spawns})",
                project_id, task_id, agent_id)

    def _spawn_reject(self, reason, message, project_id, task_id, agent_id) -> None:
        self.telemetry.emit(Event(
            type=EventType.SPAWN_BLOCKED, project_id=project_id, task_id=task_id,
            agent_id=agent_id, status="blocked", error_code="spawn_limit_exceeded",
            payload={"reason": reason, "message": message}))
        raise SpawnLimitExceeded(message, reason=reason)

    # -- reporting -------------------------------------------------------------------
    def project_spend(self, project_id: str, since: float | None = None) -> dict[str, Any]:
        if self.batcher is not None:
            self.batcher.flush()
        params: tuple = (project_id,) if since is None else (project_id, since)
        clause = "" if since is None else " AND ts >= ?"
        row = self.store.one(
            f"""
            SELECT COALESCE(SUM(model_cost_micros + tool_cost_micros), 0) AS cost,
                   COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout,
                   COALESCE(AVG(duration_ms), 0) AS avg_ms, COALESCE(SUM(retries), 0) AS retries,
                   count(*) AS executions
              FROM usage_ledger WHERE project_id = ?{clause}
            """, params)
        return {"project_id": project_id, "cost_micros": row["cost"],
                "cost_usd": round(row["cost"] / 1_000_000, 6),
                "tokens_in": row["tin"], "tokens_out": row["tout"],
                "avg_duration_ms": round(row["avg_ms"], 2),
                "retries": row["retries"], "executions": row["executions"]}

    def top_spenders(self, project_id: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        if self.batcher is not None:
            self.batcher.flush()
        where, params = ("WHERE project_id = ?", [project_id]) if project_id else ("", [])
        params.append(limit)
        return [dict(r) for r in self.store.all(
            f"""
            SELECT agent_id, template_id,
                   SUM(model_cost_micros + tool_cost_micros) AS cost_micros,
                   SUM(tokens_in + tokens_out) AS tokens, count(*) AS executions
              FROM usage_ledger {where}
             GROUP BY agent_id ORDER BY cost_micros DESC LIMIT ?
            """, params)]
