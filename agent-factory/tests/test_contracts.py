"""Contract schema, validation and lifecycle."""

from __future__ import annotations

import pytest

from af.contracts.lifecycle import (TRANSITIONS, LifecycleState, assert_transition,
                                    can_transition)
from af.contracts.schema import (AgentCapability, AgentContract, AgentRuntimePolicy,
                                 AgentToolPermission, BudgetPolicy, EscalationRule, KPI,
                                 MemoryPolicy, ModelPolicy, QualityPolicy)
from af.contracts.validation import (FORBIDDEN_PERMISSIONS, SYSTEM_CAPS, VALID_GATES,
                                     validate_contract)
from af.errors import LifecycleError
from af.quality.gates import BUILTIN_GATES


def base(**kw) -> AgentContract:
    d = dict(
        name="unit-agent", role="tester",
        mission="Exercise the contract validator with a realistic, complete definition.",
        responsibilities=("do the thing",), outputs=("result",), project_id="p1",
        output_schema={"type": "object", "required": ["result"]},
        capabilities=(AgentCapability(name="do_thing"),),
        kpis=(KPI(name="q", metric="quality_score", target=0.8),),
        escalation=(EscalationRule(condition="quality_failed", action="escalate_parent"),))
    d.update(kw)
    return AgentContract(**d)


# --- lifecycle -------------------------------------------------------------
def test_active_is_only_reachable_through_approval():
    """The mandate's hard rule, proved over the whole graph.

    Every path from DRAFT to ACTIVE must pass through APPROVAL. Proved by
    removing APPROVAL from the graph and showing ACTIVE becomes unreachable.
    """
    reachable, frontier = {LifecycleState.DRAFT}, [LifecycleState.DRAFT]
    while frontier:
        state = frontier.pop()
        for nxt in TRANSITIONS[state]:
            if nxt is LifecycleState.APPROVAL or nxt in reachable:
                continue    # pretend APPROVAL does not exist
            reachable.add(nxt)
            frontier.append(nxt)
    assert LifecycleState.ACTIVE not in reachable


def test_terminal_states_are_terminal():
    for state in (LifecycleState.RETIRED, LifecycleState.MERGED):
        assert TRANSITIONS[state] == frozenset()
        with pytest.raises(LifecycleError):
            assert_transition(state, LifecycleState.ACTIVE)


def test_improvement_re_enters_validation():
    """A revised contract is re-validated, never promoted straight back."""
    assert can_transition(LifecycleState.IMPROVEMENT, LifecycleState.VALIDATION)


# --- validation ------------------------------------------------------------
def test_valid_contract_passes_cleanly():
    report = validate_contract(base())
    assert report.ok
    assert not report.warnings


def test_defaults_satisfy_their_own_validator():
    """A contract nobody tuned must be safe, not merely present.

    This caught a real defect: the default spawn depth was 3, which every
    default L2 specialist would have failed on.
    """
    report = validate_contract(base())
    assert report.ok, [str(f) for f in report.errors]
    assert AgentRuntimePolicy().max_spawn_depth == 1


@pytest.mark.parametrize("permission", sorted(FORBIDDEN_PERMISSIONS))
def test_forbidden_permissions_always_rejected(permission):
    report = validate_contract(base(permissions=(permission,)))
    assert any(f.code == "forbidden_permission" for f in report.errors)


def test_gate_vocabulary_cannot_drift_from_the_engine():
    """Guards the drift bug found during Phase 2.

    The validator's accepted gates and the engine's implemented gates must be
    the same set, or contracts get rejected for using gates that work (or
    accepted for gates that do not exist).
    """
    assert set(VALID_GATES) == set(BUILTIN_GATES)


def test_capability_vocabulary_cannot_drift_from_the_engine():
    """Same class of bug for permissions: every capability the Chief grants
    itself must exist in the permission engine."""
    from af.chief import CHIEF_PERMISSIONS
    from af.governance.permissions import ALL_CAPABILITIES
    assert set(CHIEF_PERMISSIONS) <= set(ALL_CAPABILITIES)


def test_chief_holds_no_owner_gated_capability():
    """The Chief's authority ceiling, asserted directly."""
    from af.chief import CHIEF_PERMISSIONS
    from af.governance.permissions import OWNER_GATED
    assert not (set(CHIEF_PERMISSIONS) & set(OWNER_GATED))


@pytest.mark.parametrize("field,value,code", [
    ("runtime", AgentRuntimePolicy(concurrency_limit=999), "runtime_over_cap"),
    ("runtime", AgentRuntimePolicy(max_spawn_depth=99), "runtime_over_cap"),
    ("budget", BudgetPolicy(cost_limit_micros=10**12), "budget_over_cap"),
    ("budget", BudgetPolicy(cost_limit_micros=100, per_task_cost_limit_micros=10_000),
     "task_budget_exceeds_total"),
    ("quality", QualityPolicy(gates=("nonexistent",)), "unknown_gate"),
    ("quality", QualityPolicy(max_rework_attempts=99), "rework_unbounded"),
    ("model", ModelPolicy(tier="magical"), "bad_tier"),
    ("model", ModelPolicy(preferred_providers=("a",), forbidden_providers=("a",)),
     "provider_conflict"),
])
def test_dangerous_configurations_rejected(field, value, code):
    report = validate_contract(base(**{field: value}))
    assert any(f.code == code for f in report.errors), [str(f) for f in report.errors]


def test_l0_cannot_be_assigned():
    assert any(f.code == "l0_not_assignable" for f in validate_contract(base(level=0)).errors)


def test_specialist_cannot_spawn_deeply():
    report = validate_contract(base(level=2, runtime=AgentRuntimePolicy(max_spawn_depth=3)))
    assert any(f.code == "low_level_deep_spawn" for f in report.errors)


def test_cross_project_access_requires_permission():
    from af.contracts.schema import AgentKnowledgeScope
    report = validate_contract(base(knowledge=AgentKnowledgeScope(projects=("p1", "p2"))))
    assert any(f.code == "cross_project_without_permission" for f in report.errors)
    ok = validate_contract(base(
        knowledge=AgentKnowledgeScope(projects=("p1", "p2")),
        permissions=("project.cross_access",), level=5, parent_template_id=None))
    assert not any(f.code == "cross_project_without_permission" for f in ok.errors)


def test_authoritative_write_requires_explicit_permission():
    report = validate_contract(base(memory=MemoryPolicy(
        readable_layers=("working", "authoritative"),
        writable_layers=("working", "authoritative"))))
    assert any(f.code == "ungoverned_authoritative_write" for f in report.errors)


def test_contract_cannot_waive_its_own_approval_requirement():
    report = validate_contract(base(tools=(
        AgentToolPermission(tool_id="email.send", requires_approval_override=False),)))
    assert any(f.code == "approval_downgrade" for f in report.errors)


def test_unknown_tool_rejected_when_registry_supplied():
    report = validate_contract(base(tools=(AgentToolPermission(tool_id="nope.fake"),)),
                               known_tools={"kb.search"})
    assert any(f.code == "unknown_tool" for f in report.errors)


# --- hashing / versioning ----------------------------------------------------
def test_content_hash_ignores_audit_fields_but_not_behaviour():
    a = base()
    assert a.content_hash == base(created_by="someone", notes="x").content_hash
    assert a.content_hash != base(responsibilities=("something else",)).content_hash
    assert a.content_hash != base(tools=(AgentToolPermission(tool_id="kb.search"),)).content_hash


def test_contract_roundtrips_through_json():
    a = base(tools=(AgentToolPermission(tool_id="kb.search"),))
    assert AgentContract.from_dict(a.to_dict()).content_hash == a.content_hash


def test_system_caps_are_not_contract_configurable():
    """A contract must not be able to raise the ceilings that bound it."""
    assert "max_spawn_depth" in SYSTEM_CAPS
    fields = set(AgentContract.__dataclass_fields__)
    assert "system_caps" not in fields
