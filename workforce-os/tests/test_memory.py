"""Acceptance: E1, E2, E4 — memory layers, provenance and task scoping."""

from base import RuntimeTestCase
from workforce_os.errors import PolicyDenied, ValidationError
from workforce_os.policy.authority import Principal, owner_principal


class TestMemory(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.agent = self.make_agent(name="Rememberer")
        self.task = self.make_task(assignee=self.agent["id"])
        self.principal = Principal(kind="agent", id=self.agent["id"],
                                   project_id=self.project_id, role="specialist", level=2)

    def _provenance(self, **kw):
        base = {"author_agent_id": self.agent["id"], "source": "unit test", "origin": "observation"}
        base.update(kw)
        return base

    def _write(self, layer, key="k", content="remembered content", **kw):
        return self.rt.memory.write(project_id=self.project_id, layer=layer, key=key,
                                    content=content, provenance=self._provenance(),
                                    agent_id=kw.pop("agent_id", self.agent["id"]),
                                    task_id=kw.pop("task_id", self.task["id"]), **kw)

    def test_layers_roundtrip(self):
        """E1: all three layers persist and are queryable by layer."""
        self._write("working", key="scratch")
        self._write("episodic", key="lesson")
        self._write("semantic", key="fact")

        semantic = self.rt.memory.read(self.principal, project_id=self.project_id, layer="semantic")
        self.assertEqual(len(semantic), 1)
        self.assertEqual(semantic[0]["key"], "fact")

        episodic = self.rt.memory.read(self.principal, project_id=self.project_id, layer="episodic")
        self.assertEqual(episodic[0]["key"], "lesson")

        working = self.rt.memory.read(self.principal, project_id=self.project_id,
                                      layer="working", task_id=self.task["id"])
        self.assertEqual(working[0]["key"], "scratch")

    def test_provenance_required(self):
        """E2: a row without complete, valid provenance is refused."""
        bad_provenances = [
            ({}, "provenance.author_agent_id"),
            ({"author_agent_id": "a"}, "provenance.source"),
            ({"author_agent_id": "a", "source": "s"}, "provenance.origin"),
            ({"author_agent_id": "a", "source": "s", "origin": "telepathy"}, "provenance.origin"),
            ({"author_agent_id": "a", "source": "s", "origin": "observation",
              "derived_from": "not-a-list"}, "provenance.derived_from"),
        ]
        for provenance, expected_field in bad_provenances:
            with self.subTest(field=expected_field):
                with self.assertRaises(ValidationError) as ctx:
                    self.rt.memory.write(project_id=self.project_id, layer="semantic",
                                         key="k", content="c", provenance=provenance)
                self.assertEqual(ctx.exception.details["field"], expected_field)

    def test_provenance_is_persisted_and_returned(self):
        record = self._write("semantic", key="traceable")
        stored = self.rt.memory.get(self.principal, record["id"])
        self.assertEqual(stored["provenance"]["author_agent_id"], self.agent["id"])
        self.assertEqual(stored["provenance"]["origin"], "observation")

    def test_working_memory_task_scoped(self):
        """E4: one task's scratch space is invisible to another task."""
        other_task = self.make_task(title="Other task", assignee=self.agent["id"])
        self._write("working", key="secret scratch")

        visible = self.rt.memory.read(self.principal, project_id=self.project_id,
                                      layer="working", task_id=other_task["id"])
        self.assertEqual(visible, [], "working memory must not leak between tasks")

        # And an unscoped read never returns working memory at all.
        unscoped = self.rt.memory.read(self.principal, project_id=self.project_id)
        self.assertNotIn("working", {r["layer"] for r in unscoped})

    def test_layer_scope_keys_required(self):
        with self.assertRaises(ValidationError):
            self.rt.memory.write(project_id=self.project_id, layer="working", key="k",
                                 content="c", provenance=self._provenance(), task_id=None)
        with self.assertRaises(ValidationError):
            self.rt.memory.write(project_id=self.project_id, layer="episodic", key="k",
                                 content="c", provenance=self._provenance(), agent_id=None)

    def test_working_memory_can_be_cleared(self):
        self._write("working", key="scratch")
        self._write("semantic", key="keeper")
        self.assertEqual(self.rt.memory.forget_working_memory(self.task["id"], actor_id="system"), 1)
        remaining = self.rt.memory.read(owner_principal(), project_id=self.project_id,
                                        task_id=self.task["id"])
        self.assertEqual({r["key"] for r in remaining}, {"keeper"})
