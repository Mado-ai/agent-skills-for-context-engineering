"""Acceptance: B1-B5, A8 — Agent Builder, contract versioning, lifecycle."""

from base import RuntimeTestCase
from workforce_os.errors import IntegrityError, LifecycleError, ValidationError


class TestAgentBuilder(RuntimeTestCase):
    def test_builder_rejects_invalid_contract(self):
        """B1: invalid specs are refused with the offending field named."""
        bad_specs = [
            ({"name": "", "role": "specialist", "system_prompt": "long enough prompt"}, "name"),
            ({"name": "Ok", "role": "wizard", "system_prompt": "long enough prompt"}, "role"),
            ({"name": "Ok", "role": "specialist", "system_prompt": "short"}, "system_prompt"),
            ({"name": "Ok", "role": "specialist", "system_prompt": "long enough prompt",
              "action_types": ["teleport"]}, "action_types"),
            ({"name": "Ok", "role": "specialist", "system_prompt": "long enough prompt",
              "budget": {"max_usd": -1}}, "budget.max_usd"),
            ({"name": "Ok", "role": "specialist", "system_prompt": "long enough prompt",
              "level": 5}, "level"),
        ]
        for spec, expected_field in bad_specs:
            with self.subTest(field=expected_field):
                with self.assertRaises(ValidationError) as ctx:
                    self.rt.agents.build(self.project_id, spec, actor_id="owner")
                self.assertEqual(ctx.exception.details.get("field"), expected_field)

    def test_contract_versioning(self):
        """B2: revising writes a new version and leaves the old one readable."""
        agent = self.make_agent(name="Analyst")
        v1 = self.rt.agents.get_contract(agent["id"], 1)

        self.rt.agents.revise(agent["id"], {
            "name": "Analyst", "role": "specialist",
            "system_prompt": "A revised prompt with more detail.",
            "allowed_tools": ["echo", "summarize"], "data_domains": ["public"],
            "action_types": ["read", "analyze"], "budget": {"max_usd": 20.0},
        }, actor_id="owner")

        self.assertEqual(self.rt.agents.get(agent["id"])["active_version"], 2)
        self.assertEqual(len(self.rt.agents.contract_versions(agent["id"])), 2)

        # v1 is unchanged and still verifiable.
        v1_again = self.rt.agents.get_contract(agent["id"], 1)
        self.assertEqual(v1.checksum, v1_again.checksum)
        self.assertEqual(v1_again.scope.allowed_tools, ("echo",))
        self.assertEqual(self.rt.agents.get_contract(agent["id"], 2).scope.allowed_tools,
                         ("echo", "summarize"))

    def test_contract_rows_are_append_only(self):
        """B3: the database itself refuses to mutate or delete a contract."""
        agent = self.make_agent(name="Immutable")
        contract = self.rt.agents.get_contract(agent["id"])
        for sql, params in [
            ("UPDATE agent_contracts SET system_prompt = 'x' WHERE id = ?", (contract.id,)),
            ("DELETE FROM agent_contracts WHERE id = ?", (contract.id,)),
        ]:
            with self.subTest(sql=sql.split()[0]):
                with self.assertRaises(Exception) as ctx:
                    self.rt.db.execute(sql, params)
                self.assertIn("append-only", str(ctx.exception))

    def test_contract_tamper_detected(self):
        """B3: a row edited around the trigger fails checksum verification on read."""
        agent = self.make_agent(name="Tampered")
        # Drop the guard trigger to simulate an attacker with direct database access.
        self.rt.db.execute("DROP TRIGGER agent_contracts_immutable_update")
        self.rt.db.execute(
            "UPDATE agent_contracts SET allowed_tools = ? WHERE agent_id = ? AND version = 1",
            ('["echo","transfer_funds"]', agent["id"]))
        with self.assertRaises(IntegrityError):
            self.rt.agents.get_contract(agent["id"], 1)

    def test_contract_rollback(self):
        """B4: rollback re-points the agent at an earlier version."""
        agent = self.make_agent(name="Rollback", tools=("echo",))
        self.rt.agents.revise(agent["id"], {
            "name": "Rollback", "role": "specialist",
            "system_prompt": "Version two of this prompt.",
            "allowed_tools": ["echo", "summarize"], "data_domains": ["public"],
            "action_types": ["read"],
        }, actor_id="owner")
        self.assertEqual(self.rt.agents.get_contract(agent["id"]).version, 2)

        self.rt.agents.rollback(agent["id"], 1, actor_id="owner")
        active = self.rt.agents.get_contract(agent["id"])
        self.assertEqual(active.version, 1)
        self.assertEqual(active.scope.allowed_tools, ("echo",))


class TestLifecycle(RuntimeTestCase):
    def test_lifecycle_transitions(self):
        """B5: only declared transitions are permitted; retired is terminal."""
        agent = self.rt.agents.build(self.project_id, {
            "name": "Lifecycle", "role": "specialist",
            "system_prompt": "An agent used to exercise lifecycle rules.",
            "allowed_tools": ["echo"], "data_domains": ["public"], "action_types": ["read"],
        }, actor_id="owner")
        self.assertEqual(agent["status"], "draft")

        # draft cannot jump straight to paused
        with self.assertRaises(LifecycleError):
            self.rt.agents.set_status(agent["id"], "paused", actor_id="owner")

        for target in ("active", "paused", "active", "retired"):
            self.assertEqual(
                self.rt.agents.set_status(agent["id"], target, actor_id="owner")["status"], target)

        # retired is terminal in every direction
        for target in ("active", "paused", "draft"):
            with self.subTest(target=target):
                with self.assertRaises(LifecycleError):
                    self.rt.agents.set_status(agent["id"], target, actor_id="owner")

    def test_single_active_chief_architect(self):
        """A8: the Owner has exactly one primary AI interface."""
        chief_spec = {
            "name": "Chief Architect", "role": "chief_architect",
            "system_prompt": "The Owner's single primary interface with system-wide visibility.",
            "allowed_tools": [], "data_domains": [], "action_types": [],
        }
        first = self.rt.agents.build(self.project_id, chief_spec, actor_id="owner")
        self.rt.agents.set_status(first["id"], "active", actor_id="owner")

        second = self.rt.agents.build(self.project_id, {**chief_spec, "name": "Chief Architect Two"},
                                      actor_id="owner")
        with self.assertRaises(LifecycleError):
            self.rt.agents.set_status(second["id"], "active", actor_id="owner")

        # Freed up once the incumbent steps aside.
        self.rt.agents.set_status(first["id"], "retired", actor_id="owner")
        self.assertEqual(
            self.rt.agents.set_status(second["id"], "active", actor_id="owner")["status"], "active")

    def test_duplicate_agent_name_in_project_rejected(self):
        self.make_agent(name="Unique")
        with self.assertRaises(ValidationError):
            self.make_agent(name="Unique")
