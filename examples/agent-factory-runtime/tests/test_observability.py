"""Traceability (mandate §K).

The system must be able to answer nine forensic questions. These tests assert
that each is answerable *from a trace id alone* — which is all an incident
responder starts with.

Written after a real gap: tool calls and model calls were being emitted without
a `trace_id`, so they were invisible in `explain_trace` even though they were
audited. The audit row existed; the trace lied by omission.
"""

from __future__ import annotations

import pytest

from af.runtime import DeterministicBehaviour


@pytest.fixture()
def executed(system, chief, owner, project):
    """One task executed with tool calls and a model call in its history."""
    system.runtime.behaviour = DeterministicBehaviour(tool_calls=2, tool_id="kb.search")
    contract = chief.propose_specialist(capability="traced_work", project_id=project,
                                        outputs=("result",))
    active = system.factory.activate(contract.id, principal=owner)
    task_id = chief.assign(objective="traced objective", project_id=project,
                           template_id=active.template_id)
    claimed = system.queue.claim("w1", limit=1)[0]
    result = system.runtime.execute(claimed)
    return {"trace_id": claimed.packet.trace_id, "task_id": task_id,
            "result": result, "contract": active}


def test_what_exactly_happened(system, executed):
    trace = system.telemetry.explain_trace(executed["trace_id"])
    assert trace["found"]
    for expected in ("task.submitted", "task.claimed", "task.started",
                     "quality.evaluated", "task.completed"):
        assert expected in trace["what_happened"], trace["what_happened"]


def test_which_agent_did_it(system, executed):
    trace = system.telemetry.explain_trace(executed["trace_id"])
    assert executed["result"].instance_id in trace["agents_involved"]


def test_which_tool_was_called(system, executed):
    """Regression: tool events had no trace_id and vanished from traces."""
    trace = system.telemetry.explain_trace(executed["trace_id"])
    tools = [t["tool"] for t in trace["tools_called"]]
    assert tools == ["kb.search", "kb.search"], trace["tools_called"]
    assert all(t["status"] == "ok" for t in trace["tools_called"])


def test_model_calls_appear_in_the_trace(system, chief, owner, project):
    """Same regression class for the router."""
    from af.runtime import ModelBackedBehaviour
    system.runtime.behaviour = ModelBackedBehaviour()
    contract = chief.propose_specialist(capability="model_traced", project_id=project,
                                        outputs=("result",))
    active = system.factory.activate(contract.id, principal=owner)
    chief.assign(objective="use a model", project_id=project,
                 template_id=active.template_id)
    claimed = system.queue.claim("w1", limit=1)[0]
    system.runtime.execute(claimed)
    trace = system.telemetry.explain_trace(claimed.packet.trace_id)
    assert "model.routed" in trace["what_happened"]
    assert "model.called" in trace["what_happened"]


def test_what_did_it_cost(system, executed):
    spend = system.budget.project_spend(
        system.store.scalar("SELECT project_id FROM tasks WHERE id = ?",
                            (executed["task_id"],)))
    assert spend["executions"] >= 1
    ledger = system.store.one("SELECT * FROM usage_ledger WHERE task_id = ?",
                              (executed["task_id"],))
    assert ledger is not None and ledger["duration_ms"] > 0


def test_who_approved_it(system, project, chief):
    """Approvals are in the audit trail with the deciding actor named."""
    contract = chief.propose_specialist(capability="approval_traced",
                                        project_id=project, outputs=("result",))
    system.factory.activate(contract.id, principal=system.owner())
    audit = system.telemetry.audit_trail(project)
    approvals = [row for row in audit if row["type"] == "contract.approved"]
    assert approvals
    assert approvals[0]["actor"] == "owner"


def test_what_failed_and_why(system, chief, owner, project):
    class Failing:
        def __call__(self, ctx):
            return {"wrong": "shape"}

    system.runtime.behaviour = Failing()
    contract = chief.propose_specialist(capability="fail_traced", project_id=project,
                                        outputs=("result",))
    active = system.factory.activate(contract.id, principal=owner)
    chief.assign(objective="fail", project_id=project, template_id=active.template_id)
    claimed = system.queue.claim("w1", limit=1)[0]
    system.runtime.execute(claimed)
    events = system.telemetry.task_events(claimed.packet.id)
    quality = [e for e in events if e["type"] == "quality.evaluated"]
    assert quality and quality[0]["status"] in ("REWORK", "REJECT", "ESCALATE")


def test_which_information_did_it_use(system, executed, project):
    """Memory reads are recorded, so context provenance is answerable."""
    events = system.telemetry.task_events(executed["task_id"])
    assert any(e["type"] == "memory.read" for e in events)


def test_every_denial_appears_in_the_audit_trail(system, project, specialist):
    from af.errors import PermissionDenied
    from af.governance.permissions import Principal
    agent = Principal.from_contract("agi_probe", specialist)
    with pytest.raises(PermissionDenied):
        system.gateway.call(principal=agent, tool_id="cms.publish",
                            params={"draft_id": "d"}, project_id=project,
                            granted_tools={t.tool_id: t for t in specialist.tools})
    system.flush()
    blocked = system.store.all(
        "SELECT * FROM tool_calls WHERE status = 'blocked' AND tool_id = 'cms.publish'")
    assert blocked, "a blocked tool call must still be audited"
    assert blocked[0]["error_code"] == "permission_denied"
