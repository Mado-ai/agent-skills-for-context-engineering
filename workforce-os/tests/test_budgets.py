"""Acceptance: D1-D3 — pre-flight budget enforcement and a reconciling ledger."""

from base import RuntimeTestCase
from workforce_os.core.budgets import Spend
from workforce_os.errors import BudgetExceeded


class TestBudgets(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.agent = self.make_agent(name="Spender", budget={"max_usd": 1.0, "max_tool_calls": 3})
        self.contract = self.rt.agents.get_contract(self.agent["id"])
        self.task = self.make_task(assignee=self.agent["id"], budget={"max_usd": 0.50})

    def _charge(self, usd, task_id=None, tokens=0, calls=1):
        self.rt.budgets.charge(project_id=self.project_id, agent_id=self.agent["id"],
                               task_id=task_id, kind="tool_call",
                               spend=Spend(usd=usd, tokens=tokens, calls=calls))

    def test_preflight_denial_does_not_execute(self):
        """D1: an over-budget call is refused before it runs, and nothing is charged."""
        self._charge(0.90)
        before = self.rt.budgets.agent_status(self.agent["id"], self.contract.budget)

        with self.assertRaises(BudgetExceeded) as ctx:
            self.rt.budgets.check_affordable(agent_id=self.agent["id"],
                                             contract_budget=self.contract.budget,
                                             task_id=None, spend=Spend(usd=0.50))
        self.assertEqual(ctx.exception.details["dimension"], "usd")
        self.assertEqual(ctx.exception.details["scope"], "agent")

        after = self.rt.budgets.agent_status(self.agent["id"], self.contract.budget)
        self.assertEqual(before.spent_usd, after.spent_usd, "a denied call must not be billed")

    def test_task_and_agent_budgets_independent(self):
        """D2: passing the agent budget does not excuse the task budget."""
        # Comfortably inside the agent's $1.00 cap, but past the task's $0.50 cap.
        with self.assertRaises(BudgetExceeded) as ctx:
            self.rt.budgets.check_affordable(agent_id=self.agent["id"],
                                             contract_budget=self.contract.budget,
                                             task_id=self.task["id"], spend=Spend(usd=0.80))
        self.assertEqual(ctx.exception.details["scope"], "task")

        # And the same spend is fine when it is not charged against that task.
        self.rt.budgets.check_affordable(agent_id=self.agent["id"],
                                         contract_budget=self.contract.budget,
                                         task_id=None, spend=Spend(usd=0.80))

    def test_call_count_limit_enforced(self):
        for _ in range(3):
            self.rt.budgets.check_affordable(agent_id=self.agent["id"],
                                             contract_budget=self.contract.budget,
                                             task_id=None, spend=Spend(usd=0.01))
            self._charge(0.01)
        with self.assertRaises(BudgetExceeded) as ctx:
            self.rt.budgets.check_affordable(agent_id=self.agent["id"],
                                             contract_budget=self.contract.budget,
                                             task_id=None, spend=Spend(usd=0.01))
        self.assertEqual(ctx.exception.details["dimension"], "calls")

    def test_ledger_reconciles(self):
        """D3: every charge is a ledger row, and the rows sum to the aggregate."""
        amounts = [0.10, 0.05, 0.20]
        for amount in amounts:
            self._charge(amount, task_id=self.task["id"], tokens=100)

        entries = self.rt.budgets.entries(task_id=self.task["id"])
        self.assertEqual(len(entries), len(amounts))
        self.assertAlmostEqual(sum(e["amount_usd"] for e in entries), sum(amounts), places=6)

        status = self.rt.budgets.task_status(self.task["id"])
        self.assertAlmostEqual(status.spent_usd, sum(amounts), places=6)
        self.assertEqual(status.spent_tokens, 300)
        self.assertEqual(status.spent_calls, 3)
        self.assertAlmostEqual(status.remaining()["usd"], 0.50 - sum(amounts), places=6)

    def test_unlimited_dimension_never_blocks(self):
        unlimited = self.make_agent(name="Unlimited", budget={})
        contract = self.rt.agents.get_contract(unlimited["id"])
        self.rt.budgets.check_affordable(agent_id=unlimited["id"],
                                         contract_budget=contract.budget,
                                         task_id=None, spend=Spend(usd=10_000.0))
