"""Write-behind batching contract.

Batching traded durability of *observations* for throughput. These tests pin the
boundary of that trade, because the failure mode is silent: a batched row that a
reader misses looks like data that was never written.
"""

from __future__ import annotations

import pytest

from af.store.batch import WriteBatcher
from af.workpacket import WorkPacket


def test_batcher_coalesces_into_one_transaction(system):
    batcher = WriteBatcher(system.store, max_batch=1000)
    sql = "INSERT INTO events (id, ts, type, payload) VALUES (?,?,?,?)"
    for i in range(50):
        batcher.add(sql, (f"b{i}", 1.0, "t", "{}"))
    assert batcher.depth == 50
    assert system.store.scalar("SELECT count(*) FROM events WHERE id LIKE 'b%'") == 0
    assert batcher.flush() == 50
    assert system.store.scalar("SELECT count(*) FROM events WHERE id LIKE 'b%'") == 50


def test_batcher_auto_flushes_at_threshold(system):
    batcher = WriteBatcher(system.store, max_batch=10)
    sql = "INSERT INTO events (id, ts, type, payload) VALUES (?,?,?,?)"
    for i in range(10):
        batcher.add(sql, (f"c{i}", 1.0, "t", "{}"))
    assert batcher.depth == 0
    assert system.store.scalar("SELECT count(*) FROM events WHERE id LIKE 'c%'") == 10


def test_budget_counters_are_never_batched(system, project):
    """Counters gate spending, so they must be durable immediately.

    If these were batched, an agent could overrun its ceiling in the window
    before the flush.
    """
    from af.budget.governor import Usage
    system.budget.set_budget("project", project, cost_limit_micros=10_000)
    system.budget.record(Usage(model_cost_micros=500), scopes=[("project", project)],
                         project_id=project)
    # Read straight from the table without flushing.
    spend = system.store.scalar(
        "SELECT spend_micros FROM budgets WHERE scope_type='project' AND scope_id=?",
        (project,))
    assert spend == 500


def test_task_status_is_never_batched(system, project):
    """Queue control state must be immediately visible or work is delivered twice."""
    task = WorkPacket(project_id=project, objective="control state")
    system.queue.submit(task)
    assert system.queue.get(task.id)["status"] == "READY"
    system.queue.claim("w")
    assert system.queue.get(task.id)["status"] == "RUNNING"


def test_audit_events_are_flushed_synchronously(system, project, specialist):
    """A record of who was denied what must survive a crash."""
    from af.errors import PermissionDenied
    from af.governance.permissions import Principal
    agent = Principal.from_contract("agi_x", specialist)
    with pytest.raises(PermissionDenied):
        system.permissions.check(agent, "agent.activate", project_id=project)
    # No flush call — audit events bypass the buffer.
    assert system.store.scalar(
        "SELECT count(*) FROM events WHERE category='audit' AND type='permission.denied'") >= 1


def test_rework_feedback_survives_batching(system, chief, owner, project):
    """Regression: batching silently emptied rework feedback.

    The rework still ran, but without the findings that would let it succeed —
    the worst kind of bug, because everything looked fine.
    """
    from af.runtime import ExecutionContext
    seen: list[list[str]] = []

    class Recorder:
        def __call__(self, ctx: ExecutionContext):
            seen.append(list(ctx.feedback))
            if ctx.attempt == 1:
                return {"wrong": "shape"}
            return {"result": "fixed", "sources": ["s"], "confidence": 0.9}

    system.runtime.behaviour = Recorder()
    contract = chief.propose_specialist(capability="feedback_demo", project_id=project,
                                        outputs=("result",))
    active = system.factory.activate(contract.id, principal=owner)
    chief.assign(objective="go", project_id=project, template_id=active.template_id)
    system.runtime.execute(system.queue.claim("w")[0])
    system.runtime.execute(system.queue.claim("w")[0])
    assert seen[0] == []                       # first attempt has no history
    assert seen[1], "rework ran without the previous findings"
    assert any("missing required property" in f for f in seen[1])


def test_system_flush_drains_every_buffer(system, chief, owner, project, specialist):
    chief.assign(objective="work", project_id=project, template_id=specialist.template_id)
    system.runtime.execute(system.queue.claim("w")[0])
    system.flush()
    assert system.batcher.depth == 0
    assert system.store.scalar("SELECT count(*) FROM quality_reviews") >= 1
    assert system.store.scalar("SELECT count(*) FROM usage_ledger") >= 1
