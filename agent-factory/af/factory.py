"""The Agent Factory.

This is the module that makes the mandate's central capability real: an agent
can create, assign, manage, review and improve other agents — *governably*.

The governance is structural, not procedural:

* Promotion follows the lifecycle state machine, and ACTIVE is reachable only
  through APPROVAL. There is no ``force_activate``.
* Every promotion step re-checks the capability of the caller. The Chief can
  drive DRAFT → VALIDATION → TESTING → APPROVAL on its own; the final step into
  ACTIVE requires an OWNER principal, because ``agent.activate`` is owner-gated.
* Contracts are immutable after DRAFT. Improving an agent creates a new version
  that re-enters the pipeline, so "what exactly was approved" stays answerable.
* Instantiation is bounded by the contract's own runtime policy and by the
  caller's remaining spawn budget.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from af.clock import Clock, SystemClock
from af.contracts.lifecycle import LifecycleState, assert_transition
from af.contracts.schema import AgentContract
from af.contracts.validation import ValidationReport, validate_contract
from af.errors import LifecycleError, NotFound, SpawnLimitExceeded, ValidationError
from af.governance.permissions import ALL_CAPABILITIES, PermissionEngine, Principal
from af.ids import new_id
from af.registry import AgentRegistry
from af.store.sqlite_store import SqliteStore, dumps, loads
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["AgentFactory", "InstanceHandle"]


@dataclass(slots=True)
class InstanceHandle:
    id: str
    template_id: str
    contract_id: str
    project_id: str
    contract: AgentContract
    depth: int
    reused: bool = False


class AgentFactory:
    def __init__(
        self,
        store: SqliteStore,
        registry: AgentRegistry,
        telemetry: Telemetry,
        permissions: PermissionEngine,
        clock: Clock | None = None,
        *,
        tool_ids: set[str] | None = None,
    ) -> None:
        self.store = store
        self.registry = registry
        self.telemetry = telemetry
        self.permissions = permissions
        self.clock = clock or SystemClock()
        #: Injected so contract validation can reject tools that do not exist in
        #: the gateway. Passed in rather than imported to keep the dependency
        #: pointing one way (factory -> gateway would be a cycle).
        self.tool_ids = tool_ids if tool_ids is not None else set()

    # -- projects --------------------------------------------------------
    def create_project(self, name: str, *, principal: Principal,
                       metadata: dict[str, Any] | None = None) -> str:
        project_id = new_id("prj")
        self.store.execute(
            "INSERT INTO projects (id, name, status, created_at, metadata) VALUES (?,?,?,?,?)",
            (project_id, name, "active", self.clock.now(), dumps(metadata or {})))
        self.telemetry.emit(Event(type="project.created", project_id=project_id,
                                  actor=principal.id, payload={"name": name}))
        return project_id

    # -- authoring --------------------------------------------------------
    def draft_contract(self, contract: AgentContract, *, principal: Principal,
                       template_id: str | None = None) -> AgentContract:
        """Create a DRAFT contract (a new template, or a new version of one).

        Requires ``agent.propose``. The Chief holds this; a specialist does not,
        which is what keeps agent creation a coordination-level act.
        """
        self.permissions.check(principal, "agent.propose", project_id=contract.project_id)
        now = self.clock.now()

        if template_id is None:
            existing = self.registry.find_template_by_name(contract.name, contract.project_id)
            if existing:
                template_id = existing["id"]
            else:
                template_id = new_id("tpl")
                self.store.execute(
                    "INSERT INTO agent_templates (id, project_id, name, role, level, "
                    "latest_version, created_by, created_at) VALUES (?,?,?,?,?,0,?,?)",
                    (template_id, contract.project_id, contract.name, contract.role,
                     contract.level, principal.id, now))

        version = (self.store.scalar(
            "SELECT latest_version FROM agent_templates WHERE id = ?", (template_id,)) or 0) + 1
        contract.template_id = template_id
        contract.version = version
        contract.state = LifecycleState.DRAFT.value
        contract.created_by = principal.id
        contract.created_at = now
        contract.updated_at = now
        contract.id = contract.id or new_id("ctr")

        with self.store.write() as c:
            c.execute(
                "INSERT INTO agent_contracts (id, template_id, version, project_id, state, "
                "spec, content_hash, validation, created_by, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (contract.id, template_id, version, contract.project_id,
                 contract.state, dumps(contract.to_dict()), contract.content_hash,
                 dumps({}), principal.id, now, now))
            c.execute("UPDATE agent_templates SET latest_version = ? WHERE id = ?",
                      (version, template_id))
            # Denormalised capability index. Written here and state-synced on
            # every lifecycle transition so a search never has to parse a spec.
            if contract.capabilities:
                c.executemany(
                    "INSERT OR REPLACE INTO agent_capabilities "
                    "(contract_id, template_id, project_id, capability, state) "
                    "VALUES (?,?,?,?,?)",
                    [(contract.id, template_id, contract.project_id,
                      cap.name.lower(), contract.state)
                     for cap in contract.capabilities if cap.name])

        self.telemetry.emit(Event(
            type=EventType.CONTRACT_CREATED, project_id=contract.project_id,
            agent_id=contract.id, actor=principal.id,
            payload={"template_id": template_id, "version": version,
                     "name": contract.name, "level": contract.level}))
        return contract

    # -- promotion pipeline ------------------------------------------------
    def validate(self, contract_id: str, *, principal: Principal) -> ValidationReport:
        """DRAFT → VALIDATION (on success) or back to DRAFT (on failure)."""
        contract = self._load(contract_id)
        self.permissions.check(principal, "agent.validate", project_id=contract.project_id)

        report = validate_contract(
            contract, known_tools=self.tool_ids, known_permissions=set(ALL_CAPABILITIES))
        target = LifecycleState.VALIDATION if report.ok else LifecycleState.DRAFT
        current = LifecycleState(contract.state)
        if current is not target:
            assert_transition(current, target)
        self.store.execute(
            "UPDATE agent_contracts SET state = ?, validation = ?, updated_at = ? WHERE id = ?",
            (target.value, dumps(report.to_dict()), self.clock.now(), contract_id))

        self.telemetry.emit(Event(
            type=EventType.CONTRACT_VALIDATED, project_id=contract.project_id,
            agent_id=contract_id, actor=principal.id,
            status="passed" if report.ok else "failed",
            payload={"errors": [f.code for f in report.errors],
                     "warnings": [f.code for f in report.warnings]}))
        return report

    def run_tests(self, contract_id: str, *, principal: Principal,
                  test_fn=None) -> dict[str, Any]:
        """VALIDATION → TESTING.

        ``test_fn`` is injected so the factory does not depend on the runtime
        (which depends on the factory). The default is a structural smoke test:
        it proves the contract can be loaded, a principal derived from it, and
        its declared tools resolved. That is genuinely weaker than executing the
        agent against golden tasks, and it is labelled as such in the result so
        nobody mistakes a passing smoke test for a behavioural guarantee.
        """
        contract = self._load(contract_id)
        self.permissions.check(principal, "agent.test", project_id=contract.project_id)
        assert_transition(LifecycleState(contract.state), LifecycleState.TESTING)

        if test_fn is not None:
            result = test_fn(contract)
        else:
            checks, failures = [], []
            try:
                Principal.from_contract("probe", contract)
                checks.append("principal_derivable")
            except Exception as exc:
                failures.append(f"principal_derivable: {exc}")
            missing = [t.tool_id for t in contract.tools if t.tool_id not in self.tool_ids]
            if missing:
                failures.append(f"unresolvable_tools: {missing}")
            else:
                checks.append("tools_resolvable")
            if contract.output_schema or not contract.model.requires_structured_output:
                checks.append("output_schema_present")
            else:
                failures.append("output_schema_missing")
            result = {"passed": not failures, "checks": checks, "failures": failures,
                      "depth": "smoke", "note": "structural smoke test only; "
                                                "not a behavioural evaluation"}

        passed = bool(result.get("passed"))
        target = LifecycleState.TESTING if passed else LifecycleState.DRAFT
        self.store.execute(
            "UPDATE agent_contracts SET state = ?, updated_at = ? WHERE id = ?",
            (target.value, self.clock.now(), contract_id))
        self.telemetry.emit(Event(
            type=EventType.CONTRACT_TESTED, project_id=contract.project_id,
            agent_id=contract_id, actor=principal.id,
            status="passed" if passed else "failed", payload=result))
        return result

    def submit_for_approval(self, contract_id: str, *, principal: Principal) -> None:
        """TESTING → APPROVAL. Re-validates first.

        The re-validation is not redundant: the tool registry or the capability
        vocabulary may have changed since the earlier pass, and a contract that
        was valid then may reference a tool that has since been withdrawn.
        """
        contract = self._load(contract_id)
        self.permissions.check(principal, "agent.propose", project_id=contract.project_id)
        report = validate_contract(
            contract, known_tools=self.tool_ids, known_permissions=set(ALL_CAPABILITIES))
        if not report.ok:
            raise ValidationError(
                "contract no longer validates; cannot be submitted for approval",
                errors=[f.code for f in report.errors])
        assert_transition(LifecycleState(contract.state), LifecycleState.APPROVAL)
        self.store.execute(
            "UPDATE agent_contracts SET state = ?, updated_at = ? WHERE id = ?",
            (LifecycleState.APPROVAL.value, self.clock.now(), contract_id))
        self.telemetry.emit(Event(
            type=EventType.CONTRACT_STATE_CHANGED, project_id=contract.project_id,
            agent_id=contract_id, actor=principal.id, status="APPROVAL",
            payload={"from": "TESTING", "to": "APPROVAL"}))

    def activate(self, contract_id: str, *, principal: Principal, note: str = "") -> AgentContract:
        """APPROVAL → ACTIVE. **Owner only.**

        Three independent guards, because this is the point of no return —
        after it, an autonomous worker exists and can consume budget:
          1. ``agent.activate`` is owner-gated, so no agent principal passes.
          2. The lifecycle machine forbids any edge into ACTIVE except from APPROVAL.
          3. Validation is re-run and must be clean.
        """
        contract = self._load(contract_id)
        self.permissions.check(principal, "agent.activate", project_id=contract.project_id)

        current = LifecycleState(contract.state)
        if current is not LifecycleState.APPROVAL:
            raise LifecycleError(
                f"contract must be in APPROVAL to activate, is {current.value}",
                contract_id=contract_id, state=current.value)
        assert_transition(current, LifecycleState.ACTIVE)

        report = validate_contract(
            contract, known_tools=self.tool_ids, known_permissions=set(ALL_CAPABILITIES))
        if not report.ok:
            # Belt and braces: an invalid contract must never become ACTIVE,
            # even if it somehow reached APPROVAL.
            self.telemetry.emit(Event(
                type=EventType.CONTRACT_REJECTED, project_id=contract.project_id,
                agent_id=contract_id, actor=principal.id, status="invalid",
                payload={"errors": [f.code for f in report.errors]}))
            raise ValidationError("cannot activate an invalid contract",
                                  errors=[f.code for f in report.errors])

        now = self.clock.now()
        with self.store.write() as c:
            c.execute(
                "UPDATE agent_contracts SET state = ?, approved_by = ?, approved_at = ?, "
                "updated_at = ? WHERE id = ?",
                (LifecycleState.ACTIVE.value, principal.id, now, now, contract_id))
            # Supersede the previously active version of this template: exactly
            # one contract is ACTIVE per template at a time.
            c.execute(
                "UPDATE agent_contracts SET state = 'RETIRED', updated_at = ? "
                "WHERE template_id = ? AND id != ? AND state IN ('ACTIVE','OBSERVATION')",
                (now, contract.template_id, contract_id))
            c.execute("UPDATE agent_templates SET active_contract_id = ? WHERE id = ?",
                      (contract_id, contract.template_id))
            c.execute("UPDATE agent_capabilities SET state = 'ACTIVE' WHERE contract_id = ?",
                      (contract_id,))
            c.execute(
                "UPDATE agent_capabilities SET state = 'RETIRED' "
                "WHERE template_id = ? AND contract_id != ?",
                (contract.template_id, contract_id))

        contract.state = LifecycleState.ACTIVE.value
        contract.approved_by = principal.id
        contract.approved_at = now
        self.telemetry.emit(Event(
            type=EventType.CONTRACT_APPROVED, project_id=contract.project_id,
            agent_id=contract_id, actor=principal.id,
            payload={"template_id": contract.template_id, "version": contract.version,
                     "note": note, "name": contract.name}))
        return contract

    def transition(self, contract_id: str, target: LifecycleState, *,
                   principal: Principal, reason: str = "") -> None:
        """Post-activation moves: OBSERVATION, IMPROVEMENT, PAUSED, RETIRED, MERGED."""
        capability = {
            LifecycleState.PAUSED: "agent.pause",
            LifecycleState.RETIRED: "agent.retire",
            LifecycleState.MERGED: "agent.merge",
        }.get(target, "agent.propose")
        contract = self._load(contract_id)
        self.permissions.check(principal, capability, project_id=contract.project_id)
        current = LifecycleState(contract.state)
        assert_transition(current, target)
        now = self.clock.now()
        with self.store.write() as c:
            c.execute("UPDATE agent_contracts SET state = ?, updated_at = ? WHERE id = ?",
                      (target.value, now, contract_id))
            # Retiring or merging a contract must take its live workers with it,
            # otherwise instances keep serving a definition that is no longer
            # sanctioned.
            c.execute("UPDATE agent_capabilities SET state = ? WHERE contract_id = ?",
                      (target.value, contract_id))
            if target in (LifecycleState.RETIRED, LifecycleState.MERGED, LifecycleState.PAUSED):
                new_state = "PAUSED" if target is LifecycleState.PAUSED else "RETIRED"
                c.execute(
                    "UPDATE agent_instances SET state = ?, retired_at = ? "
                    "WHERE contract_id = ? AND state = 'ACTIVE'", (new_state, now, contract_id))
        self.telemetry.emit(Event(
            type=EventType.CONTRACT_STATE_CHANGED, project_id=contract.project_id,
            agent_id=contract_id, actor=principal.id, status=target.value,
            payload={"from": current.value, "to": target.value, "reason": reason}))

    # -- instantiation (elastic) ---------------------------------------------
    def acquire_instance(self, template_id: str, project_id: str, *, principal: Principal,
                         parent_instance_id: str | None = None, depth: int = 0,
                         spawned_by: str | None = None,
                         allow_reuse: bool = True) -> InstanceHandle:
        """Get a live worker for a template, reusing an idle one when possible.

        Reuse-before-spawn is the elasticity policy: demand is met by the
        cheapest available capacity, and instances are reaped when idle (see
        ``retire_idle_instances``). "Number of agents" is therefore a *function
        of load*, not a configured constant.
        """
        contract = self.registry.active_contract_for(template_id)
        if contract is None:
            raise NotFound(f"template '{template_id}' has no ACTIVE contract",
                           template_id=template_id)
        self.permissions.check(principal, "agent.instantiate", project_id=project_id)

        rt = contract.runtime
        if depth > rt.max_spawn_depth:
            self._blocked("depth", principal, project_id, spawned_by,
                          f"spawn depth {depth} exceeds contract limit {rt.max_spawn_depth}")

        if allow_reuse:
            # Prefer an ACTIVE instance with spare concurrency. Ordering by
            # inflight then last_active keeps load even and keeps recently used
            # instances warm rather than round-robining across all of them.
            row = self.store.one(
                "SELECT * FROM agent_instances WHERE template_id = ? AND project_id = ? "
                "AND state = 'ACTIVE' AND inflight < ? ORDER BY inflight, last_active_at "
                "LIMIT 1", (template_id, project_id, rt.concurrency_limit))
            if row is not None:
                self.store.execute(
                    "UPDATE agent_instances SET last_active_at = ? WHERE id = ?",
                    (self.clock.now(), row["id"]))
                return InstanceHandle(
                    id=row["id"], template_id=template_id, contract_id=contract.id,
                    project_id=project_id, contract=contract, depth=row["depth"], reused=True)

        live = self.registry.live_instance_count(template_id, project_id)
        if live >= rt.max_instances:
            self._blocked("max_instances", principal, project_id, spawned_by,
                          f"template '{template_id}' already has {live} live instances "
                          f"(limit {rt.max_instances}) and none has spare concurrency")

        instance_id = new_id("agi")
        now = self.clock.now()
        self.store.execute(
            "INSERT INTO agent_instances (id, contract_id, template_id, project_id, state, "
            "parent_id, depth, spawned_by, created_at, last_active_at) "
            "VALUES (?,?,?,?,'ACTIVE',?,?,?,?,?)",
            (instance_id, contract.id, template_id, project_id, parent_instance_id,
             depth, spawned_by, now, now))
        self.telemetry.emit(Event(
            type=EventType.INSTANCE_SPAWNED, project_id=project_id, agent_id=instance_id,
            task_id=spawned_by, actor=principal.id,
            payload={"template_id": template_id, "contract_id": contract.id,
                     "depth": depth, "parent": parent_instance_id, "live_before": live}))
        return InstanceHandle(id=instance_id, template_id=template_id, contract_id=contract.id,
                              project_id=project_id, contract=contract, depth=depth)

    def _blocked(self, reason: str, principal: Principal, project_id: str | None,
                 task_id: str | None, message: str) -> None:
        self.telemetry.emit(Event(
            type=EventType.SPAWN_BLOCKED, project_id=project_id, task_id=task_id,
            actor=principal.id, status="blocked", error_code="spawn_limit_exceeded",
            payload={"reason": reason, "message": message}))
        raise SpawnLimitExceeded(message, reason=reason)

    def release_instance(self, instance_id: str, *, ok: bool = True) -> None:
        """Return capacity after a task finishes. ``inflight`` is floored at 0
        so a double-release (possible under at-least-once delivery) cannot drive
        the counter negative and silently grant extra concurrency."""
        self.store.execute(
            "UPDATE agent_instances SET inflight = MAX(0, inflight - 1), "
            "completed = completed + ?, failed = failed + ?, last_active_at = ? WHERE id = ?",
            (1 if ok else 0, 0 if ok else 1, self.clock.now(), instance_id))

    def reserve_instance(self, instance_id: str, concurrency_limit: int) -> bool:
        """Atomically take a concurrency slot. The guard is in the WHERE clause,
        so two concurrent reservations cannot both succeed past the limit."""
        return self.store.execute(
            "UPDATE agent_instances SET inflight = inflight + 1, last_active_at = ? "
            "WHERE id = ? AND state = 'ACTIVE' AND inflight < ?",
            (self.clock.now(), instance_id, concurrency_limit)) > 0

    def retire_idle_instances(self, *, idle_seconds: float | None = None,
                              limit: int = 1000) -> int:
        """Scale down. Only instances with nothing in flight are eligible.

        This is the other half of elasticity: without it the fleet ratchets up
        to peak concurrency and stays there.
        """
        now = self.clock.now()
        rows = self.store.all(
            """
            SELECT i.id, i.project_id, i.template_id, c.spec
              FROM agent_instances i JOIN agent_contracts c ON c.id = i.contract_id
             WHERE i.state = 'ACTIVE' AND i.inflight = 0
             LIMIT ?
            """, (limit,))
        stale = []
        for r in rows:
            threshold = idle_seconds
            if threshold is None:
                spec = loads(r["spec"])
                threshold = (spec.get("runtime") or {}).get("idle_retire_seconds", 900.0)
            last = self.store.scalar(
                "SELECT last_active_at FROM agent_instances WHERE id = ?", (r["id"],))
            if last is not None and (now - last) >= threshold:
                stale.append(r)
        for r in stale:
            self.store.execute(
                "UPDATE agent_instances SET state = 'RETIRED', retired_at = ? "
                "WHERE id = ? AND inflight = 0", (now, r["id"]))
            self.telemetry.emit(Event(
                type=EventType.INSTANCE_RETIRED, project_id=r["project_id"],
                agent_id=r["id"], payload={"reason": "idle", "template_id": r["template_id"]}))
        return len(stale)

    # -- helpers ---------------------------------------------------------------
    def _load(self, contract_id: str) -> AgentContract:
        contract = self.registry.get_contract(contract_id)
        if contract is None:
            raise NotFound(f"contract '{contract_id}' not found", contract_id=contract_id)
        return contract
