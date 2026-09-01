"""The v0.4 Definition of Done, executed.

Each test maps to a numbered criterion from the mandate's section 13. They are
written as one narrative flow because the criteria describe a single story —
the Chief noticing a gap, an agent being born, doing work, being judged, and the
whole thing being traceable and paid for.
"""

from __future__ import annotations

import pytest

from af.clock import ManualClock
from af.chief import ChiefAgentArchitect
from af.contracts.lifecycle import LifecycleState
from af.errors import IsolationViolation, PermissionDenied
from af.runtime import DeterministicBehaviour
from af.system import build_system
from af.workpacket import TaskStatus


@pytest.fixture()
def env():
    clock = ManualClock()
    system = build_system(":memory:", clock=clock, behaviour=DeterministicBehaviour())
    owner = system.owner()
    chief = ChiefAgentArchitect(system, clock=clock)
    chief.bootstrap(owner)
    project = system.factory.create_project("acme-marketing", principal=owner)
    return {"sys": system, "owner": owner, "chief": chief,
            "project": project, "clock": clock}


# --- 1. Chief can inspect the registry -------------------------------------
def test_01_chief_can_inspect_registry(env):
    view = env["chief"].inspect_registry()
    assert view["overview"]["active_contracts"] >= 1      # the Chief itself
    assert "capability_gap_analysis" in view["capabilities"]
    assert any(t["name"] == "chief-agent-architect" for t in view["templates"])


# --- 2. Chief can determine that a capability is missing --------------------
def test_02_chief_detects_missing_capability(env):
    gaps = env["chief"].analyse_capability_gaps(
        ["seo_article_writing", "capability_gap_analysis"], env["project"])
    by_name = {g.capability: g for g in gaps}
    assert by_name["seo_article_writing"].satisfied is False
    # ...and correctly identifies the one that already exists, so it reuses
    # rather than proposing a duplicate.
    assert by_name["capability_gap_analysis"].satisfied is True
    assert by_name["capability_gap_analysis"].matched_name == "chief-agent-architect"


# --- 3 & 4. Chief proposes a contract; validation occurs --------------------
def test_03_04_chief_proposes_and_contract_is_validated(env):
    contract = env["chief"].propose_specialist(
        capability="seo_article_writing", project_id=env["project"],
        outputs=("article",))
    # It reached APPROVAL, which is only possible via VALIDATION and TESTING.
    assert contract.state == LifecycleState.APPROVAL.value
    stored = env["sys"].store.one(
        "SELECT validation FROM agent_contracts WHERE id = ?", (contract.id,))
    assert '"ok":true' in stored["validation"].replace(" ", "")


def test_04b_invalid_contract_cannot_become_active(env):
    """The mandate's hard rule, tested from both directions."""
    from af.contracts.schema import AgentContract
    from af.errors import LifecycleError, ValidationError
    broken = AgentContract(name="broken", role="", mission="", project_id=env["project"])
    drafted = env["sys"].factory.draft_contract(broken, principal=env["chief"].principal)
    report = env["sys"].factory.validate(drafted.id, principal=env["chief"].principal)
    assert not report.ok
    # Still DRAFT, and every path onward is blocked.
    assert env["sys"].registry.get_contract(drafted.id).state == LifecycleState.DRAFT.value
    with pytest.raises((LifecycleError, ValidationError)):
        env["sys"].factory.activate(drafted.id, principal=env["owner"])


# --- 5. Agent can be instantiated under defined limits ----------------------
def test_05_activation_is_owner_gated_then_instantiable(env):
    chief, owner, system = env["chief"], env["owner"], env["sys"]
    contract = chief.propose_specialist(capability="seo_article_writing",
                                        project_id=env["project"], outputs=("article",))
    # The Chief cannot activate — this is the central governance guarantee.
    with pytest.raises(PermissionDenied):
        system.factory.activate(contract.id, principal=chief.principal)
    activated = system.factory.activate(contract.id, principal=owner)
    assert activated.state == LifecycleState.ACTIVE.value
    assert activated.approved_by == "owner"

    handle = system.factory.acquire_instance(
        contract.template_id, env["project"], principal=owner)
    assert handle.id.startswith("agi_")

    # Instance ceiling is enforced: fill every slot on every permitted instance,
    # then the next acquisition must be refused.
    from af.errors import SpawnLimitExceeded
    limit = activated.runtime.max_instances
    per = activated.runtime.concurrency_limit
    system.factory.reserve_instance(handle.id, per)
    for _ in range(limit * per):
        try:
            h = system.factory.acquire_instance(
                contract.template_id, env["project"], principal=owner)
            system.factory.reserve_instance(h.id, per)
        except SpawnLimitExceeded:
            break
    else:
        pytest.fail("instance ceiling was never enforced")


# --- 6..12. The full delegated execution loop -------------------------------
@pytest.fixture()
def active_specialist(env):
    contract = env["chief"].propose_specialist(
        capability="seo_article_writing", project_id=env["project"], outputs=("article",))
    return env["sys"].factory.activate(contract.id, principal=env["owner"])


def test_06_to_12_full_execution_loop(env, active_specialist):
    system, chief = env["sys"], env["chief"]

    # 6. Parent delegates a structured task.
    task_id = chief.assign(objective="Write a launch article about context engineering",
                           project_id=env["project"],
                           template_id=active_specialist.template_id)
    assert system.queue.get(task_id)["status"] == TaskStatus.READY.value

    # 7. The agent executes with scoped tools and context.
    claimed = system.queue.claim("w1", limit=1)
    assert len(claimed) == 1
    result = system.runtime.execute(claimed[0])

    # 8. Output passed through a quality gate.
    assert result.review is not None
    assert result.verdict == "PASS", result.review.findings

    # 10. Successful output returns to the parent (task COMPLETED with result).
    assert result.status == TaskStatus.COMPLETED.value
    task = system.queue.get(task_id)
    assert task["status"] == TaskStatus.COMPLETED.value
    assert task["result"] and "article" in task["result"]

    # 11. A complete trace exists and answers the forensic questions.
    trace = system.telemetry.explain_trace(claimed[0].packet.trace_id)
    assert trace["found"]
    assert "task.submitted" in trace["what_happened"]
    assert "task.completed" in trace["what_happened"]
    assert result.instance_id in trace["agents_involved"]

    # 12. Cost and resource telemetry exists.
    spend = system.budget.project_spend(env["project"])
    assert spend["executions"] >= 1
    ledger = system.store.one(
        "SELECT * FROM usage_ledger WHERE task_id = ?", (task_id,))
    assert ledger is not None
    assert ledger["duration_ms"] > 0


def test_09_failed_output_enters_rework(env):
    """A failing gate must produce REWORK, and the rework must be re-runnable."""
    from af.runtime import ExecutionContext

    class BadThenGood:
        """Fails the schema gate on attempt 1, succeeds on attempt 2."""

        def __call__(self, ctx: ExecutionContext):
            if ctx.attempt == 1:
                return {"wrong_field": "nope"}
            assert ctx.feedback, "rework must receive the previous findings"
            return {"article": "corrected", "sources": ["s"], "confidence": 0.9}

    system = env["sys"]
    system.runtime.behaviour = BadThenGood()
    contract = env["chief"].propose_specialist(
        capability="rework_demo", project_id=env["project"], outputs=("article",))
    active = system.factory.activate(contract.id, principal=env["owner"])
    task_id = env["chief"].assign(objective="produce an article", project_id=env["project"],
                                  template_id=active.template_id)

    first = system.runtime.execute(system.queue.claim("w1")[0])
    assert first.verdict == "REWORK"
    assert system.queue.get(task_id)["status"] == TaskStatus.READY.value  # requeued

    second = system.runtime.execute(system.queue.claim("w1")[0])
    assert second.verdict == "PASS"
    assert system.queue.get(task_id)["status"] == TaskStatus.COMPLETED.value

    reviews = system.quality.history(task_id)
    assert [r["verdict"] for r in reviews] == ["REWORK", "PASS"]


# --- 13. Permissions cannot be bypassed --------------------------------------
def test_13_permissions_cannot_be_bypassed(env, active_specialist):
    from af.governance.permissions import Principal, PrincipalKind
    from af.errors import ToolError

    system = env["sys"]
    specialist = Principal.from_contract("agi_test", active_specialist)

    # A tool the contract never granted.
    with pytest.raises(PermissionDenied):
        system.gateway.call(principal=specialist, tool_id="cms.publish",
                            params={"draft_id": "d1"}, project_id=env["project"],
                            granted_tools={t.tool_id: t for t in active_specialist.tools})

    # Claiming a capability it does not hold changes nothing, because authority
    # is read from the stored contract, not from what the caller asserts.
    liar = Principal(id="agi_test", kind=PrincipalKind.AGENT, level=5,
                     project_id=env["project"],
                     granted=frozenset({"agent.activate", "budget.raise"}))
    with pytest.raises(PermissionDenied):
        system.permissions.check(liar, "agent.activate", project_id=env["project"])
    with pytest.raises(PermissionDenied):
        system.permissions.check(liar, "budget.raise", project_id=env["project"])


# --- 14. Owner-gated actions remain protected --------------------------------
@pytest.mark.parametrize("capability", [
    "agent.activate", "agent.merge", "budget.raise", "quality.override",
    "memory.authoritative.write", "memory.shared_org.write",
])
def test_14_owner_gated_actions_protected(env, capability):
    """No agent principal, at any level, holding any grant, passes these."""
    from af.governance.permissions import Principal, PrincipalKind
    maximal = Principal(id="superagent", kind=PrincipalKind.AGENT, level=5,
                        project_id=env["project"],
                        granted=frozenset({capability}),
                        allowed_projects=frozenset({env["project"]}))
    with pytest.raises(PermissionDenied):
        env["sys"].permissions.check(maximal, capability, project_id=env["project"])
    # The owner, by contrast, passes.
    env["sys"].permissions.check(env["owner"], capability, project_id=env["project"])


# --- 15. Multiple projects remain isolated -------------------------------------
def test_15_projects_are_isolated(env, active_specialist):
    from af.governance.permissions import Principal
    from af.memory.layers import Layer, Trust

    system, owner = env["sys"], env["owner"]
    project_b = system.factory.create_project("beta-corp", principal=owner)

    system.memory.write(principal=owner, layer=Layer.AUTHORITATIVE,
                        key="secret-pricing", content="Project A pricing is 42",
                        project_id=env["project"])
    system.memory.write(principal=owner, layer=Layer.AUTHORITATIVE,
                        key="secret-pricing", content="Project B pricing is 99",
                        project_id=project_b)

    a_agent = Principal.from_contract("agi_a", active_specialist)   # scoped to project A
    hits = system.memory.search(principal=a_agent, query="pricing",
                                contract=active_specialist)
    contents = [h.content for h in hits]
    assert "Project A pricing is 42" in contents
    assert "Project B pricing is 99" not in contents

    with pytest.raises(IsolationViolation):
        system.memory.search(principal=a_agent, query="pricing", project_id=project_b,
                             contract=active_specialist)
    with pytest.raises(IsolationViolation):
        system.gateway.call(principal=a_agent, tool_id="kb.search",
                            params={"query": "x"}, project_id=project_b,
                            granted_tools={t.tool_id: t for t in active_specialist.tools})


# --- 20. No deployment has occurred ---------------------------------------------
def test_20_no_external_side_effects():
    """The reference tools are inert by construction.

    Guards the boundary the mandate draws: development and local testing are
    authorised, deployment and external action are not.
    """
    from af.tools.builtin import register_builtin_tools
    from af.tools.gateway import RiskLevel, ToolRegistry

    registry = register_builtin_tools(ToolRegistry())
    # Nothing that reaches infrastructure directly exists in the catalogue.
    assert registry.get("system.shell") is None
    assert registry.get("system.sql") is None
    # Every external-effect tool is R3 or above, so none can run without an
    # owner decision, and the R5 one cannot run at all.
    for tool_id in ("email.send", "cms.publish", "finance.transfer"):
        spec = registry.get(tool_id)
        assert spec.risk_level in (RiskLevel.R3, RiskLevel.R4, RiskLevel.R5)
        assert spec.risk_level.requires_approval
    assert registry.get("finance.transfer").risk_level.autonomous_forbidden
