"""End-to-end walkthrough of AI Agent Factory v0.4.

Runs the whole Definition-of-Done story in one pass, printing what happens at
each governance boundary:

    Chief inspects → finds a gap → proposes a specialist → validation →
    owner activates (Chief cannot) → delegation → scoped execution →
    quality gate → trace → cost → isolation proof

No network calls. No model spend. Run with:  python3 demo.py
"""

from __future__ import annotations

from af.chief import ChiefAgentArchitect
from af.errors import IsolationViolation, PermissionDenied
from af.governance.permissions import Principal
from af.memory.layers import Layer
from af.runtime import DeterministicBehaviour
from af.system import build_system


def rule(title: str) -> None:
    print(f"\n{'─' * 72}\n {title}\n{'─' * 72}")


def main() -> None:
    system = build_system(":memory:", behaviour=DeterministicBehaviour(tool_calls=1,
                                                                      tool_id="kb.search"))
    owner = system.owner()

    rule("1. Bootstrap the Chief (owner-activated, like every other agent)")
    chief = ChiefAgentArchitect(system)
    contract = chief.bootstrap(owner)
    print(f"   Chief active: {contract.name} L{contract.level}, approved by "
          f"'{contract.approved_by}'")
    print(f"   Chief holds {len(contract.permissions)} capabilities, "
          f"0 of them owner-gated")

    project = system.factory.create_project("acme-marketing", principal=owner)
    other = system.factory.create_project("beta-corp", principal=owner)
    print(f"   Projects: acme-marketing, beta-corp")

    rule("2. Owner states an objective; the Chief decomposes it")
    plan = chief.decompose(
        "Launch a content programme for the new product",
        project_id=project,
        required_capabilities=["seo_article_writing", "capability_gap_analysis"])
    print(f"   Reuse ({len(plan['reuse'])}):")
    for gap in plan["reuse"]:
        print(f"     • {gap['capability']} → {gap['recommendation']}")
    print(f"   Build ({len(plan['build'])}):")
    for gap in plan["build"]:
        print(f"     • {gap['capability']} → {gap['recommendation']}")
    print(f"   Reuse ratio: {plan['reuse_ratio']:.0%}   "
          f"Owner actions required: {plan['owner_actions_required']}")

    rule("3. Chief proposes a specialist — and cannot activate it")
    proposed = chief.propose_specialist(capability="seo_article_writing",
                                        project_id=project, outputs=("article",))
    print(f"   Drafted '{proposed.name}' → state after validation+testing: "
          f"{proposed.state}")
    try:
        system.factory.activate(proposed.id, principal=chief.principal)
        print("   *** SECURITY FAILURE: the Chief activated an agent")
    except PermissionDenied as exc:
        print(f"   Chief blocked: {exc.message}")

    request = chief.request_activation(proposed.id)
    print(f"   Chief raised approval request {request['approval_id'][:16]}… "
          f"(awaiting {request['awaiting']})")

    rule("4. Owner activates")
    active = system.factory.activate(proposed.id, principal=owner,
                                     note="approved for the launch programme")
    print(f"   '{active.name}' is now {active.state}, approved by "
          f"'{active.approved_by}'")

    rule("5. Chief delegates a structured WorkPacket")
    task_id = chief.assign(objective="Write the launch article",
                           project_id=project, template_id=active.template_id)
    task = system.queue.get(task_id)
    print(f"   Task {task_id[:16]}… status={task['status']} "
          f"priority={task['priority']}")

    rule("6. A worker claims and executes it under full governance")
    claimed = system.queue.claim("worker-1", limit=1)[0]
    result = system.runtime.execute(claimed)
    print(f"   status={result.status}  verdict={result.verdict}  "
          f"quality={result.review.score:.2f}")
    print(f"   instance={result.instance_id[:16]}…  "
          f"tokens={result.usage.total_tokens}  "
          f"cost={result.usage.total_cost_micros} micros")

    rule("7. Complete trace — the forensic questions, answered")
    trace = system.telemetry.explain_trace(claimed.packet.trace_id)
    print(f"   What happened : {' → '.join(trace['what_happened'])}")
    print(f"   Which agents  : {trace['agents_involved']}")
    print(f"   Which tools   : {[t['tool'] for t in trace['tools_called']]}")
    print(f"   What it cost  : {trace['total_cost_micros']} micros, "
          f"{trace['total_tokens']} tokens")
    print(f"   Spans         : {trace['span_count']}")

    rule("8. Project isolation")
    system.memory.write(principal=owner, layer=Layer.AUTHORITATIVE,
                        key="pricing", content="acme pricing is 42",
                        project_id=project)
    system.memory.write(principal=owner, layer=Layer.AUTHORITATIVE,
                        key="pricing", content="beta pricing is 99",
                        project_id=other)
    agent = Principal.from_contract(result.instance_id, active)
    visible = system.memory.search(principal=agent, query="pricing", contract=active)
    print(f"   acme agent sees: {[m.content for m in visible]}")
    try:
        system.memory.search(principal=agent, query="pricing", project_id=other,
                             contract=active)
        print("   *** ISOLATION FAILURE")
    except IsolationViolation as exc:
        print(f"   Cross-project read blocked: {exc.message[:60]}…")

    rule("9. R5 tools never execute autonomously")
    from af.contracts.schema import AgentToolPermission
    try:
        system.gateway.call(principal=Principal.from_contract("x", contract),
                            tool_id="finance.transfer",
                            params={"amount_micros": 1_000_000, "destination": "acct"},
                            project_id=project,
                            granted_tools={"finance.transfer":
                                           AgentToolPermission("finance.transfer")})
        print("   *** SECURITY FAILURE: R5 executed")
    except PermissionDenied as exc:
        print(f"   Blocked even for the L5 Chief: {exc.message}")

    rule("10. Control Center snapshot")
    centre = system.control_center(project)
    print(f"   Workforce : {centre['workforce']['active_contracts']} active "
          f"contracts, {centre['workforce']['live_instances']} live instances")
    print(f"   Queues    : {centre['queues']['completed']} completed, "
          f"{centre['queues']['depth']} in backlog")
    print(f"   Quality   : {centre['quality']}")
    print(f"   Approvals : {centre['approvals_pending']} pending")
    print(f"   Cost      : {centre['cost']['cost_usd']} USD over "
          f"{centre['cost']['executions']} executions")
    print(f"   Tools     : {len(centre['tools'])} registered  |  "
          f"Models: {len(centre['models'])} routable")
    print("\n   No deployment. No external action. No model spend.\n")


if __name__ == "__main__":
    main()
