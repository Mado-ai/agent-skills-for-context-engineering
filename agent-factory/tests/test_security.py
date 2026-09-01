"""Security tests (mandate §8).

Written adversarially: each test is an attempt to get the system to do something
it must not, and passes only when the attempt is refused *and* recorded.
"""

from __future__ import annotations

import pytest

from af.errors import (IsolationViolation, PermissionDenied, TokenInvalid,
                       ValidationError)
from af.governance.permissions import (ALL_CAPABILITIES, CAPABILITIES, OWNER_GATED,
                                       Principal, PrincipalKind)
from af.memory.layers import Layer, Trust
from af.workpacket import WorkPacket


# --- least privilege ------------------------------------------------------
def test_agents_cannot_modify_their_own_permissions(system, project):
    """The rule that makes every other rule stick."""
    from af.contracts.validation import FORBIDDEN_PERMISSIONS
    assert "governance.permissions.write" in FORBIDDEN_PERMISSIONS
    assert "governance.contract.self_modify" in FORBIDDEN_PERMISSIONS
    # And they are not even in the capability vocabulary, so no check can pass one.
    for permission in FORBIDDEN_PERMISSIONS:
        assert permission not in ALL_CAPABILITIES


def test_agent_cannot_approve_its_own_request(system, project):
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=5, project_id=project,
                      granted=frozenset(ALL_CAPABILITIES))
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="self approval attempt", params={}, tool_id="email.send")
    with pytest.raises(PermissionDenied):
        system.approvals.decide(request.id, principal=agent, approve=True)


def test_a_maximally_privileged_agent_still_cannot_cross_the_owner_boundary(system, project):
    """An agent granted literally every capability, at the highest level."""
    superagent = Principal(id="super", kind=PrincipalKind.AGENT, level=5,
                           project_id=project, granted=frozenset(ALL_CAPABILITIES),
                           allowed_projects=frozenset({project}))
    for capability in sorted(OWNER_GATED):
        with pytest.raises(PermissionDenied):
            system.permissions.check(superagent, capability, project_id=project)


def test_system_principal_is_not_the_owner(system, project):
    """Internal machinery must not be a privilege backdoor."""
    machinery = Principal.system("scheduler")
    assert not (machinery.granted & OWNER_GATED)
    for capability in sorted(OWNER_GATED):
        with pytest.raises(PermissionDenied):
            system.permissions.check(machinery, capability, project_id=project)


# --- no raw infrastructure ---------------------------------------------------
def test_no_shell_or_sql_tool_exists(system):
    ids = system.tools.ids()
    for forbidden in ("system.shell", "system.sql", "shell.exec", "sql.execute", "eval"):
        assert forbidden not in ids
    # No tool's handler accepts something that smells like arbitrary code.
    for spec in system.tools.list():
        props = set((spec.input_schema or {}).get("properties", {}))
        assert not props & {"command", "cmd", "sql", "code", "script", "eval"}


def test_secrets_are_never_stored_in_source_or_prompts():
    """Static check over the runtime package."""
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parent.parent / "af"
    # Patterns for actual embedded credentials, not the words themselves.
    patterns = [
        re.compile(r"""(?i)(api[_-]?key|secret|password|token)\s*=\s*["'][A-Za-z0-9_\-]{16,}["']"""),
        re.compile(r"sk-[A-Za-z0-9]{20,}"),
    ]
    offenders = []
    for path in root.rglob("*.py"):
        text = path.read_text()
        for pattern in patterns:
            if pattern.search(text):
                offenders.append(str(path))
    assert not offenders, f"possible hard-coded secret in {offenders}"


# --- untrusted model output ---------------------------------------------------
def test_model_generated_tool_arguments_are_validated(system, project, specialist):
    """Tool arguments arrive from a model and must never be trusted."""
    agent = Principal.from_contract("agi_x", specialist)
    granted = {t.tool_id: t for t in specialist.tools}
    # Extra field (the injection shape).
    with pytest.raises(ValidationError):
        system.gateway.call(principal=agent, tool_id="kb.search",
                            params={"query": "x", "__proto__": "evil"},
                            project_id=project, granted_tools=granted)
    # Wrong type.
    with pytest.raises(ValidationError):
        system.gateway.call(principal=agent, tool_id="kb.search",
                            params={"query": 12345}, project_id=project,
                            granted_tools=granted)
    # Out-of-range value.
    with pytest.raises(ValidationError):
        system.gateway.call(principal=agent, tool_id="kb.search",
                            params={"query": "x", "limit": 10 ** 9},
                            project_id=project, granted_tools=granted)


def test_agent_cannot_launder_its_output_into_authoritative_knowledge(system, project,
                                                                      specialist):
    """The trust ceiling: a confidently wrong model must not become ground truth."""
    agent = Principal.from_contract("agi_x", specialist)
    with pytest.raises(PermissionDenied):
        system.memory.write(principal=agent, layer=Layer.AUTHORITATIVE,
                            key="policy", content="whatever I say is true",
                            project_id=project, contract=specialist)
    # Nor by writing an allowed layer while claiming authoritative trust.
    with pytest.raises(PermissionDenied):
        system.memory.write(principal=agent, layer=Layer.EPISODIC, key="k",
                            content="c", project_id=project, contract=specialist,
                            trust=Trust.AUTHORITATIVE)


def test_work_packet_cannot_widen_the_contracts_tool_grant(system, project, specialist,
                                                           chief, owner):
    """A packet naming extra tools must not grant them."""
    packet = WorkPacket(project_id=project, objective="try to widen",
                        receiver_template_id=specialist.template_id,
                        allowed_tools=("kb.search", "finance.transfer", "cms.publish"))
    system.queue.submit(packet)
    claimed = system.queue.claim("w")[0]
    # The runtime intersects packet tools with the contract's grants.
    contract_tools = {t.tool_id for t in specialist.tools}
    effective = set(claimed.packet.allowed_tools) & contract_tools
    assert "finance.transfer" not in effective
    assert "cms.publish" not in effective


# --- token security -------------------------------------------------------------
def test_token_secret_is_hashed_at_rest(system, project):
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=3, project_id=project,
                      granted=frozenset({"tool.call"}))
    params = {"to": "a@b.com", "subject": "s", "body": "b"}
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="r", params=params, tool_id="email.send")
    token = system.approvals.decide(request.id, principal=system.owner(), approve=True)
    stored = system.store.one("SELECT secret_hash FROM exec_tokens WHERE id = ?",
                              (token.id,))["secret_hash"]
    assert token.secret not in stored
    assert len(stored) == 64        # sha256 hex


@pytest.mark.parametrize("mutation,reason_fragment", [
    ({"to": "attacker@evil.com"}, "parameters differ"),
    ({"subject": "different"}, "parameters differ"),
])
def test_approved_parameters_cannot_be_substituted(system, project, mutation,
                                                   reason_fragment):
    """Approving 'email the accountant' must not authorise emailing anyone else."""
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=3, project_id=project,
                      granted=frozenset({"tool.call"}))
    approved = {"to": "accountant@corp.com", "subject": "invoice", "body": "b"}
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="r", params=approved, tool_id="email.send")
    token = system.approvals.decide(request.id, principal=system.owner(), approve=True)
    with pytest.raises(TokenInvalid) as exc:
        system.approvals.consume(token.bearer(), agent_id="a1", tool_id="email.send",
                                 params={**approved, **mutation})
    assert reason_fragment in exc.value.details["reason"]


def test_approval_does_not_permanently_elevate(system, project):
    """After using an approval, the agent's authority is exactly what it was."""
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=3, project_id=project,
                      granted=frozenset({"tool.call"}))
    before = set(agent.granted)
    params = {"to": "a@b.com", "subject": "s", "body": "b"}
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="r", params=params, tool_id="email.send")
    token = system.approvals.decide(request.id, principal=system.owner(), approve=True)
    system.approvals.consume(token.bearer(), agent_id="a1", tool_id="email.send",
                             params=params)
    assert set(agent.granted) == before
    # And the second attempt is refused: one approval, one action.
    with pytest.raises(TokenInvalid):
        system.approvals.consume(token.bearer(), agent_id="a1", tool_id="email.send",
                                 params=params)


def test_revoked_token_is_refused(system, project):
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=3, project_id=project,
                      granted=frozenset({"tool.call"}))
    params = {"to": "a@b.com", "subject": "s", "body": "b"}
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="r", params=params, tool_id="email.send")
    token = system.approvals.decide(request.id, principal=system.owner(), approve=True)
    system.approvals.revoke(token.id, principal=system.owner())
    with pytest.raises(TokenInvalid) as exc:
        system.approvals.consume(token.bearer(), agent_id="a1", tool_id="email.send",
                                 params=params)
    assert exc.value.details["reason"] == "token revoked"


# --- isolation -----------------------------------------------------------------
def test_project_a_agent_cannot_read_project_b(system, owner, specialist, project):
    project_b = system.factory.create_project("other-tenant", principal=owner)
    system.memory.write(principal=owner, layer=Layer.PROJECT, key="b-secret",
                        content="tenant B confidential", project_id=project_b)
    agent = Principal.from_contract("agi_a", specialist)
    hits = system.memory.search(principal=agent, query="confidential", contract=specialist)
    assert all(h.project_id != project_b for h in hits)
    with pytest.raises(IsolationViolation):
        system.memory.search(principal=agent, query="confidential",
                             project_id=project_b, contract=specialist)


def test_denials_are_always_audited(system, project, specialist):
    agent = Principal.from_contract("agi_x", specialist)
    before = len(system.telemetry.audit_trail())
    with pytest.raises(PermissionDenied):
        system.permissions.check(agent, "agent.activate", project_id=project)
    with pytest.raises(IsolationViolation):
        system.permissions.check_project(agent, "some-other-project")
    after = system.telemetry.audit_trail()
    assert len(after) >= before + 2
    kinds = {row["type"] for row in after}
    assert "permission.denied" in kinds
    assert "isolation.violation" in kinds


def test_every_capability_is_documented_and_bounded():
    """No capability may exist without a description and a level floor."""
    for name, capability in CAPABILITIES.items():
        assert capability.description, f"{name} has no description"
        assert capability.min_level >= 0
        assert capability.name == name
