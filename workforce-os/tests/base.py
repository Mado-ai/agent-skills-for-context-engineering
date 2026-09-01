"""Shared test harness: an isolated on-disk runtime per test, plus fixture builders."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workforce_os.config import load_config          # noqa: E402
from workforce_os.runtime import Runtime             # noqa: E402

OWNER_TOKEN = "test-owner-token-not-a-real-secret"


class RuntimeTestCase(unittest.TestCase):
    """Each test gets a fresh temporary database — no shared state, no network."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = os.path.join(self._tmpdir.name, "test.db")
        config = load_config(database_path=db_path, owner_token=OWNER_TOKEN,
                             provider="local", provider_api_key="")
        self.rt = Runtime(config)
        self.project = self.rt.projects.create("Test Project", "fixture project")
        self.project_id = self.project["id"]

    def tearDown(self):
        self.rt.close()
        self._tmpdir.cleanup()

    # ------------------------------------------------------------------ helpers

    def make_agent(self, name="Worker", role="specialist", tools=("echo",),
                   domains=("public",), actions=("read",), budget=None,
                   project_id=None, activate=True, level=None, parent_agent_id=None,
                   prompt="A governed specialist agent for tests.", depth=None):
        spec = {
            "name": name, "role": role, "system_prompt": prompt,
            "allowed_tools": list(tools), "data_domains": list(domains),
            "action_types": list(actions),
            "budget": budget if budget is not None else {"max_usd": 10.0, "max_tool_calls": 100},
        }
        if level is not None:
            spec["level"] = level
        if depth is not None:
            spec["max_delegation_depth"] = depth
        agent = self.rt.agents.build(project_id or self.project_id, spec,
                                     actor_id="owner", parent_agent_id=parent_agent_id)
        if activate:
            agent = self.rt.agents.set_status(agent["id"], "active", actor_id="owner")
        return agent

    def make_task(self, title="Test task", assignee=None, budget=None, criteria=None,
                  project_id=None, actor_id="owner"):
        return self.rt.tasks.create(project_id or self.project_id, {
            "title": title,
            "assignee_agent_id": assignee,
            "budget": budget if budget is not None else {"max_usd": 5.0, "max_tool_calls": 50},
            "criteria": criteria or ["is correct"],
        }, actor_id=actor_id)

    WORK_REQUEST = {"objective": "Do the thing", "acceptance_criteria": ["it is done"]}
