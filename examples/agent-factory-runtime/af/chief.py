"""Chief Agent Architect — the highest orchestration layer.

The Chief has **system-wide visibility and governed execution authority**. It
can see everything, plan everything, and propose anything; it cannot activate an
agent, approve a high-risk action, raise a budget, or write authoritative
knowledge. Those are owner-gated, and the Chief holds none of them (see
SECURITY_MODEL.md).

That asymmetry is the design. The Chief is the most capable planner in the
system and therefore the most dangerous single point of failure, so its output
is *proposals* that a human converts into authority. Everything here returns a
recommendation or a DRAFT; nothing here crosses the owner boundary.

The Chief is an ordinary L5 agent with a contract, not a privileged subsystem —
it runs under the same permission engine as every other agent, and its denials
land in the same audit trail.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from af.clock import Clock, SystemClock
from af.contracts.schema import (AgentCapability, AgentContract, AgentKnowledgeScope,
                                 AgentLevel, AgentRuntimePolicy, AgentToolPermission,
                                 BudgetPolicy, ContextPolicy, EscalationRule, KPI,
                                 MemoryPolicy, ModelPolicy, QualityPolicy)
from af.errors import NotFound
from af.governance.permissions import Principal, PrincipalKind
from af.system import AgentFactorySystem
from af.workpacket import Priority, WorkPacket

__all__ = ["ChiefAgentArchitect", "CapabilityGap", "WorkforceRecommendation",
           "chief_contract"]

#: The Chief's own permission set. Note what is *not* here: agent.activate,
#: agent.merge, budget.raise, quality.override, memory.authoritative.write.
#: The Chief proposes; the owner disposes.
CHIEF_PERMISSIONS = (
    "agent.inspect", "agent.propose", "agent.validate", "agent.test",
    "agent.instantiate", "agent.pause", "agent.retire",
    "task.execute", "task.delegate", "task.cancel", "task.reassign",
    "quality.review", "capa.open", "capa.close",
    "workforce.observe", "project.cross_access", "audit.read",
    "budget.read", "budget.allocate",
    "memory.read", "memory.write", "tool.call",
)


def chief_contract(*, name: str = "chief-agent-architect") -> AgentContract:
    """The Chief's contract. Passes the same validator as every other agent."""
    return AgentContract(
        name=name, role="chief agent architect", level=int(AgentLevel.CHIEF),
        project_id=None, parent_template_id=None,
        mission=("Translate owner objectives into a governed workforce: decompose goals, "
                 "reuse existing capability, propose new specialists, delegate work, "
                 "and continuously optimise quality, cost and reliability."),
        responsibilities=(
            "decompose owner objectives into workflow loops",
            "inspect the registry and reuse existing capability before proposing new agents",
            "draft agent contracts for missing capability and submit them for owner approval",
            "delegate structured work packets and monitor outcomes",
            "identify duplicate, idle, underperforming and overspending agents",
            "escalate uncertainty to the owner rather than acting unilaterally",
        ),
        workflow_loops=("capability-gap-analysis", "workforce-optimisation", "delegation"),
        inputs=("owner_objective", "workforce_state"),
        outputs=("plan", "recommendations"),
        output_schema={"type": "object", "required": ["plan"],
                       "properties": {"plan": {"type": "string"},
                                      "recommendations": {"type": "array"}}},
        capabilities=(
            AgentCapability(name="decompose_objective",
                            description="Break an owner objective into delegable work"),
            AgentCapability(name="capability_gap_analysis",
                            description="Decide reuse vs. build for a required capability"),
            AgentCapability(name="workforce_optimisation",
                            description="Recommend merges, retirements and rebalancing"),
        ),
        permissions=CHIEF_PERMISSIONS,
        forbidden_actions=("self_approve", "raise_own_budget", "modify_own_permissions"),
        knowledge=AgentKnowledgeScope(domains=("workforce", "governance"),
                                      projects=(), allow_org_shared=True),
        tools=(AgentToolPermission(tool_id="kb.search", max_calls_per_task=20),),
        memory=MemoryPolicy(
            readable_layers=("working", "episodic", "project", "authoritative",
                             "agent", "shared_org"),
            writable_layers=("working", "episodic", "agent"),
            share_to_org=False),
        context=ContextPolicy(max_context_tokens=180_000, max_retrieved_records=40),
        model=ModelPolicy(tier="frontier", min_reasoning="advanced",
                          max_latency_ms=60_000, max_context_tokens=180_000),
        budget=BudgetPolicy(cost_limit_micros=10_000_000, token_limit=20_000_000,
                            per_task_cost_limit_micros=500_000,
                            per_task_token_limit=180_000, latency_target_ms=60_000),
        runtime=AgentRuntimePolicy(concurrency_limit=8, max_instances=2,
                                   max_spawn_depth=5, max_children_per_task=32,
                                   max_total_spawns=500, task_timeout_seconds=600.0),
        quality=QualityPolicy(gates=("schema", "policy"), min_score=0.7,
                              reviewer_type="owner", max_rework_attempts=1),
        escalation=(
            EscalationRule(condition="quality_failed", action="owner_approval"),
            EscalationRule(condition="budget_exceeded", action="owner_approval"),
            EscalationRule(condition="capability_missing", action="owner_approval"),
        ),
        kpis=(
            KPI(name="delegation_success", metric="quality_score", target=0.85),
            KPI(name="reuse_rate", metric="capability_reuse_ratio", target=0.6),
            KPI(name="cost_per_task", metric="cost_micros", target=250_000, direction="lte"),
        ),
    )


@dataclass(slots=True)
class CapabilityGap:
    capability: str
    satisfied: bool
    #: Populated when an existing agent already covers it — the reuse path.
    matched_template_id: str | None = None
    matched_name: str | None = None
    match_score: float = 0.0
    recommendation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {f: getattr(self, f) for f in self.__slots__}


@dataclass(slots=True)
class WorkforceRecommendation:
    kind: str                  # merge|retire|scale_down|scale_up|cost|quality
    severity: str              # info|warning|critical
    subject: str
    detail: str
    evidence: dict[str, Any] = field(default_factory=dict)
    #: True when acting on this requires the owner (merge, activation, budget).
    requires_owner: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {f: getattr(self, f) for f in self.__slots__}


class ChiefAgentArchitect:
    def __init__(self, system: AgentFactorySystem, *, instance_id: str = "chief",
                 clock: Clock | None = None) -> None:
        self.sys = system
        self.clock = clock or system.clock
        self.instance_id = instance_id
        self._contract: AgentContract | None = None
        self._principal: Principal | None = None

    # -- bootstrap ----------------------------------------------------------
    def bootstrap(self, owner: Principal) -> AgentContract:
        """Create and activate the Chief itself.

        Even the Chief goes through the full pipeline and needs owner activation.
        There is no bootstrap shortcut, because a shortcut here would be a
        permanent hole in the one guarantee the system makes about agent
        creation.
        """
        contract = self.sys.factory.draft_contract(chief_contract(), principal=owner)
        report = self.sys.factory.validate(contract.id, principal=owner)
        if not report.ok:
            raise ValueError(f"chief contract is invalid: {[f.code for f in report.errors]}")
        self.sys.factory.run_tests(contract.id, principal=owner)
        self.sys.factory.submit_for_approval(contract.id, principal=owner)
        active = self.sys.factory.activate(contract.id, principal=owner,
                                           note="chief bootstrap")
        self._contract = active
        self._principal = Principal(
            id=self.instance_id, kind=PrincipalKind.AGENT, level=int(AgentLevel.CHIEF),
            project_id=None, granted=frozenset(active.permissions),
            allowed_projects=frozenset())
        return active

    @property
    def principal(self) -> Principal:
        if self._principal is None:
            raise NotFound("chief has not been bootstrapped; call bootstrap(owner) first")
        return self._principal

    # -- 1. inspect ---------------------------------------------------------
    def inspect_registry(self, project_id: str | None = None) -> dict[str, Any]:
        self.sys.permissions.check(self.principal, "agent.inspect", project_id=project_id)
        templates = self.sys.registry.list_templates(project_id)
        return {
            "overview": self.sys.registry.workforce_overview(project_id),
            "templates": [t.to_dict() for t in templates],
            "hierarchy": self.sys.registry.hierarchy(project_id),
            "capabilities": sorted({c for t in templates for c in t.capabilities if c}),
        }

    # -- 2. decompose + gap analysis ----------------------------------------
    def analyse_capability_gaps(self, required: list[str],
                                project_id: str) -> list[CapabilityGap]:
        """Decide, per capability, whether to reuse or build.

        Reuse is checked first and preferred. This is the mechanism that keeps
        the fleet's size a function of distinct capability rather than of how
        many objectives have been submitted — the difference between a workforce
        and an accumulation of agents.
        """
        self.sys.permissions.check(self.principal, "agent.inspect", project_id=project_id)
        gaps: list[CapabilityGap] = []
        for capability in required:
            matches = self.sys.registry.find_by_capability(capability, project_id,
                                                           min_score=0.5)
            if matches:
                best = matches[0]
                gaps.append(CapabilityGap(
                    capability=capability, satisfied=True,
                    matched_template_id=best.template_id, matched_name=best.name,
                    match_score=best.score,
                    recommendation=(f"reuse '{best.name}' (match {best.score:.2f} on "
                                    f"'{best.capability}')")))
            else:
                gaps.append(CapabilityGap(
                    capability=capability, satisfied=False,
                    recommendation=f"no existing agent provides '{capability}'; "
                                   f"propose a new specialist"))
        return gaps

    def decompose(self, objective: str, *, project_id: str,
                  required_capabilities: list[str]) -> dict[str, Any]:
        """Turn an owner objective into a concrete plan.

        Returns a plan, never an action. Anything requiring owner authority is
        collected into ``owner_actions_required`` so the human sees the whole
        ask at once rather than being interrupted per item.
        """
        gaps = self.analyse_capability_gaps(required_capabilities, project_id)
        reusable = [g for g in gaps if g.satisfied]
        missing = [g for g in gaps if not g.satisfied]
        return {
            "objective": objective,
            "project_id": project_id,
            "reuse": [g.to_dict() for g in reusable],
            "build": [g.to_dict() for g in missing],
            "reuse_ratio": round(len(reusable) / len(gaps), 3) if gaps else 0.0,
            "owner_actions_required": (
                [f"activate a new specialist for '{g.capability}'" for g in missing]),
            "workflow_loops": [f"loop:{c}" for c in required_capabilities],
        }

    # -- 3. propose ----------------------------------------------------------
    def propose_specialist(self, *, capability: str, project_id: str, role: str = "",
                           mission: str = "", tools: tuple[str, ...] = ("kb.search",),
                           level: AgentLevel = AgentLevel.SPECIALIST,
                           parent_template_id: str | None = None,
                           outputs: tuple[str, ...] = ("result",),
                           cost_limit_micros: int = 500_000) -> AgentContract:
        """Draft a specialist contract and drive it to APPROVAL.

        Stops at APPROVAL. The Chief physically cannot take the last step — the
        capability is owner-gated — so this returns a contract awaiting a human.
        """
        name = capability.lower().replace("_", "-").replace(" ", "-")
        contract = AgentContract(
            name=name, role=role or f"{capability} specialist", level=int(level),
            project_id=project_id, parent_template_id=parent_template_id,
            mission=mission or (f"Perform '{capability}' work to the project's quality "
                                f"standard, with evidence for every claim."),
            responsibilities=(f"execute {capability} tasks",
                              "return structured, evidence-backed output"),
            workflow_loops=(f"loop:{capability}",),
            inputs=("objective", "context"), outputs=outputs,
            output_schema={
                "type": "object", "required": list(outputs),
                "properties": {o: {"type": "string"} for o in outputs}},
            capabilities=(AgentCapability(
                name=capability, description=f"Provides {capability}."),),
            tools=tuple(AgentToolPermission(tool_id=t, max_calls_per_task=10) for t in tools),
            permissions=("task.execute", "tool.call", "memory.read", "memory.write"),
            knowledge=AgentKnowledgeScope(domains=(capability,), projects=(project_id,)),
            memory=MemoryPolicy(
                readable_layers=("working", "episodic", "project", "authoritative"),
                writable_layers=("working", "episodic")),
            budget=BudgetPolicy(cost_limit_micros=cost_limit_micros,
                                token_limit=2_000_000,
                                per_task_cost_limit_micros=min(50_000, cost_limit_micros),
                                per_task_token_limit=100_000),
            quality=QualityPolicy(gates=("schema", "policy", "evidence", "completeness"),
                                  min_score=0.7, max_rework_attempts=2),
            escalation=(EscalationRule(condition="quality_failed", action="escalate_parent"),
                        EscalationRule(condition="budget_exceeded", action="escalate_chief")),
            kpis=(KPI(name="quality", metric="quality_score", target=0.8),
                  KPI(name="cost", metric="cost_micros", target=50_000, direction="lte")),
        )
        drafted = self.sys.factory.draft_contract(contract, principal=self.principal)
        report = self.sys.factory.validate(drafted.id, principal=self.principal)
        if not report.ok:
            # Return the DRAFT with its findings rather than raising: a rejected
            # proposal is information the Chief should act on, not an exception.
            return self.sys.registry.get_contract(drafted.id)
        self.sys.factory.run_tests(drafted.id, principal=self.principal)
        self.sys.factory.submit_for_approval(drafted.id, principal=self.principal)
        return self.sys.registry.get_contract(drafted.id)

    def request_activation(self, contract_id: str) -> dict[str, Any]:
        """Ask the owner to activate. Produces an approval request, not an action."""
        contract = self.sys.registry.get_contract(contract_id)
        if contract is None:
            raise NotFound(f"contract '{contract_id}' not found")
        request = self.sys.approvals.request(
            principal=self.principal, project_id=contract.project_id or "system",
            action="agent.activate", risk_level="R4",
            reason=(f"Activate '{contract.name}' (L{contract.level}) to provide "
                    f"{[c.name for c in contract.capabilities]}."),
            params={"contract_id": contract_id, "name": contract.name,
                    "level": contract.level},
            task_id=None)
        return {"approval_id": request.id, "contract_id": contract_id,
                "state": contract.state, "awaiting": "owner"}

    # -- 4. delegate ---------------------------------------------------------
    def assign(self, *, objective: str, project_id: str, template_id: str,
               inputs: dict[str, Any] | None = None,
               priority: Priority = Priority.NORMAL,
               budget_micros: int = 50_000, token_budget: int = 100_000,
               depends_on: tuple[str, ...] = (),
               idempotency_key: str | None = None) -> str:
        """Delegate structured work. Never free-form chat — always a WorkPacket."""
        self.sys.permissions.check(self.principal, "task.delegate", project_id=project_id)
        contract = self.sys.registry.active_contract_for(template_id)
        if contract is None:
            raise NotFound(f"template '{template_id}' has no ACTIVE contract",
                           template_id=template_id)
        packet = WorkPacket(
            project_id=project_id, objective=objective,
            sender_agent_id=self.instance_id, receiver_template_id=template_id,
            inputs=inputs or {}, priority=int(priority),
            allowed_tools=tuple(t.tool_id for t in contract.tools),
            required_output_schema=contract.output_schema,
            budget_micros=budget_micros, token_budget=token_budget,
            spawn_budget=contract.runtime.max_children_per_task,
            idempotency_key=idempotency_key,
            quality_policy={"min_score": contract.quality.min_score},
            escalation_policy={r.condition: r.action for r in contract.escalation})
        return self.sys.queue.submit(packet, depends_on=depends_on)

    def create_team(self, *, objective: str, project_id: str,
                    members: list[tuple[str, str]],
                    join_template_id: str | None = None) -> dict[str, Any]:
        """Fan out to several specialists, optionally fanning back in.

        ``members`` is a list of (template_id, sub-objective). When
        ``join_template_id`` is given, a join task is submitted that depends on
        every member — real fan-out/fan-in rather than a loop of sequential calls.
        """
        member_ids = [self.assign(objective=sub, project_id=project_id, template_id=tid)
                      for tid, sub in members]
        join_id = None
        if join_template_id:
            join_id = self.assign(
                objective=f"Synthesise team results for: {objective}",
                project_id=project_id, template_id=join_template_id,
                depends_on=tuple(member_ids), priority=Priority.HIGH)
        return {"objective": objective, "member_task_ids": member_ids,
                "join_task_id": join_id}

    # -- 5. monitor + optimise ------------------------------------------------
    def workforce_health(self, project_id: str | None = None) -> dict[str, Any]:
        self.sys.permissions.check(self.principal, "workforce.observe")
        return self.sys.control_center(project_id)

    def recommend_optimisations(self, project_id: str | None = None
                                ) -> list[WorkforceRecommendation]:
        """Concrete, evidence-backed recommendations.

        Every recommendation carries the evidence that produced it, and those
        needing owner authority are flagged. A recommendation without evidence
        is an opinion, and the owner should not have to trust one.
        """
        self.sys.permissions.check(self.principal, "workforce.observe")
        out: list[WorkforceRecommendation] = []

        # Duplicates: byte-identical behaviour under two names.
        for dup in self.sys.registry.find_duplicate_contracts(project_id):
            out.append(WorkforceRecommendation(
                kind="merge", severity="warning",
                subject=",".join(dup["template_ids"]),
                detail=(f"{dup['count']} ACTIVE contracts share an identical behaviour "
                        f"hash; they are the same agent under different names."),
                evidence=dup, requires_owner=True))

        # Idle capacity: templates with live instances but no recent work.
        idle = self.sys.store.all(
            """
            SELECT t.id, t.name, count(i.id) AS live
              FROM agent_templates t JOIN agent_instances i ON i.template_id = t.id
             WHERE i.state = 'ACTIVE' AND i.inflight = 0
               AND (? IS NULL OR t.project_id = ?)
             GROUP BY t.id HAVING live > 1
            """, (project_id, project_id))
        for row in idle:
            out.append(WorkforceRecommendation(
                kind="scale_down", severity="info", subject=row["id"],
                detail=(f"'{row['name']}' holds {row['live']} idle instances; "
                        f"the idle reaper will retire them, or reduce max_instances."),
                evidence={"live_idle": row["live"]}))

        # Quality: templates whose recent work fails gates disproportionately.
        poor = self.sys.store.all(
            """
            SELECT u.template_id, AVG(q.score) AS avg_score, count(*) AS n
              FROM quality_reviews q JOIN usage_ledger u ON u.task_id = q.task_id
             WHERE (? IS NULL OR q.project_id = ?)
             GROUP BY u.template_id HAVING n >= 3 AND avg_score < 0.7
            """, (project_id, project_id))
        for row in poor:
            out.append(WorkforceRecommendation(
                kind="quality", severity="critical", subject=row["template_id"] or "unknown",
                detail=(f"average quality {row['avg_score']:.2f} over {row['n']} reviews is "
                        f"below the 0.70 gate; move the contract to IMPROVEMENT and "
                        f"revise its context or model policy."),
                evidence={"avg_score": round(row["avg_score"], 3), "reviews": row["n"]}))

        # Cost outliers.
        for spender in self.sys.budget.top_spenders(project_id, limit=3):
            if (spender["cost_micros"] or 0) > 1_000_000:
                out.append(WorkforceRecommendation(
                    kind="cost", severity="warning", subject=spender["agent_id"] or "unknown",
                    detail=(f"spent {spender['cost_micros'] / 1e6:.2f} USD over "
                            f"{spender['executions']} executions; consider a cheaper model "
                            f"tier or a tighter per-task budget."),
                    evidence=spender, requires_owner=False))

        # Dead letters: work nobody will pick up again.
        dlq = self.sys.store.scalar(
            "SELECT count(*) FROM tasks WHERE status = 'DEAD_LETTER'"
            + (" AND project_id = ?" if project_id else ""),
            (project_id,) if project_id else ()) or 0
        if dlq:
            out.append(WorkforceRecommendation(
                kind="quality", severity="critical", subject="dead_letter_queue",
                detail=f"{dlq} task(s) are dead-lettered and will not retry; "
                       f"each needs a root cause or an explicit write-off.",
                evidence={"count": dlq}))
        return out

    def escalate_to_owner(self, *, reason: str, project_id: str,
                          detail: dict[str, Any]) -> str:
        """The Chief's response to uncertainty: ask, never assume."""
        request = self.sys.approvals.request(
            principal=self.principal, project_id=project_id, action="chief.escalation",
            risk_level="R4", reason=reason, params=detail)
        return request.id
