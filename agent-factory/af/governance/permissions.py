"""Capability-based permissions and project isolation.

Two rules carry the whole model:

1. **Level is reach; capability is authority.** An L5 Chief with system-wide
   visibility still cannot execute an owner-gated action, because the capability
   for it is not grantable to a principal of kind ``agent`` at any level. Level
   checks and capability checks are separate code paths and both must pass.

2. **Project scope is checked on every authority check, not at login.** A
   capability grant is always evaluated against the project of the *resource*
   being touched. This is what makes "access to project A does not imply access
   to project B" true by construction rather than by discipline.

Enforcement lives here and is called from the runtime. It is never expressed as
an instruction in a prompt, because a prompt is a suggestion to a model and this
is a decision about authority.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable

from af.errors import IsolationViolation, PermissionDenied

__all__ = [
    "Capability", "PrincipalKind", "Principal", "PermissionEngine",
    "CAPABILITIES", "OWNER_GATED", "ALL_CAPABILITIES",
]


class PrincipalKind(str, Enum):
    OWNER = "owner"      # the human. The only holder of owner-gated capabilities.
    AGENT = "agent"      # any AI agent, Chief included.
    SYSTEM = "system"    # internal runtime machinery (schedulers, reapers).


@dataclass(frozen=True, slots=True)
class Capability:
    name: str
    description: str
    min_level: int = 1
    #: If true, an ``agent`` principal can never hold this, regardless of level
    #: or of what a contract claims. Only OWNER (or a single-use execution token
    #: minted from an owner approval) satisfies it.
    owner_gated: bool = False
    #: If true, holding it in one project never implies it in another.
    project_scoped: bool = True


def _c(name: str, desc: str, level: int = 1, *, owner: bool = False, scoped: bool = True) -> Capability:
    return Capability(name, desc, level, owner, scoped)


#: The complete capability vocabulary. A permission string not in this table is
#: rejected by contract validation, so typos fail closed rather than silently
#: granting nothing (or, worse, being interpreted loosely later).
CAPABILITIES: dict[str, Capability] = {c.name: c for c in [
    # --- work ---------------------------------------------------------
    _c("task.execute", "Execute an assigned work packet", 1),
    _c("task.delegate", "Delegate a sub-task to another agent", 3),
    _c("task.cancel", "Cancel a task in its own subtree", 3),
    _c("task.reassign", "Move a task to a different agent", 4),
    # --- agent lifecycle ----------------------------------------------
    _c("agent.inspect", "Read the agent registry", 2),
    _c("agent.propose", "Create a DRAFT agent contract", 4),
    _c("agent.validate", "Run contract validation", 4),
    _c("agent.test", "Run a contract's test suite", 4),
    # Activation is owner-gated: bringing a new autonomous worker into
    # existence is the decision that compounds, so it never happens without a
    # human. The Chief proposes; the owner activates.
    _c("agent.activate", "Promote an approved contract to ACTIVE", 5, owner=True),
    _c("agent.instantiate", "Create a live instance of an ACTIVE contract", 3),
    _c("agent.pause", "Pause an agent", 4),
    _c("agent.retire", "Retire an agent", 4),
    _c("agent.merge", "Merge duplicate agents", 5, owner=True),
    # --- tools ---------------------------------------------------------
    _c("tool.call", "Invoke a tool the contract grants", 1),
    # --- memory ---------------------------------------------------------
    _c("memory.read", "Read permitted memory layers", 1),
    _c("memory.write", "Write permitted memory layers", 1),
    _c("memory.authoritative.write", "Promote a record to authoritative knowledge", 4, owner=True),
    _c("memory.shared_org.write", "Publish knowledge across projects", 4, owner=True),
    _c("memory.delete", "Delete memory records", 4),
    # --- quality ---------------------------------------------------------
    _c("quality.review", "Review another agent's output", 3),
    _c("quality.override", "Override a quality gate verdict", 5, owner=True),
    _c("capa.open", "Open a corrective action record", 3),
    _c("capa.close", "Close a corrective action record", 4),
    # --- visibility -------------------------------------------------------
    _c("workforce.observe", "Read system-wide metrics and health", 4, scoped=False),
    _c("project.cross_access", "Operate across project boundaries", 5, scoped=False),
    _c("audit.read", "Read the audit trail", 4),
    # --- budget -----------------------------------------------------------
    _c("budget.read", "Read budget state", 2),
    _c("budget.allocate", "Allocate budget to a sub-scope from own budget", 4),
    _c("budget.raise", "Increase a budget ceiling", 5, owner=True),
]}

ALL_CAPABILITIES = frozenset(CAPABILITIES)
OWNER_GATED = frozenset(n for n, c in CAPABILITIES.items() if c.owner_gated)


@dataclass(frozen=True, slots=True)
class Principal:
    """Who is acting. Constructed by the runtime from the stored contract —
    never from anything a model produced."""

    id: str
    kind: PrincipalKind
    level: int = 1
    project_id: str | None = None
    granted: frozenset[str] = field(default_factory=frozenset)
    #: Additional projects this principal may touch. Only meaningful alongside
    #: the ``project.cross_access`` capability.
    allowed_projects: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def owner(cls, owner_id: str = "owner") -> "Principal":
        return cls(id=owner_id, kind=PrincipalKind.OWNER, level=0,
                   granted=frozenset(ALL_CAPABILITIES))

    @classmethod
    def system(cls, name: str = "system") -> "Principal":
        """Internal machinery: schedulers, lease reapers, retention sweeps.
        Holds no owner-gated capability — the runtime is not the owner."""
        return cls(id=name, kind=PrincipalKind.SYSTEM, level=0,
                   granted=frozenset(ALL_CAPABILITIES - OWNER_GATED))

    @classmethod
    def from_contract(cls, instance_id: str, contract) -> "Principal":
        return cls(
            id=instance_id,
            kind=PrincipalKind.AGENT,
            level=contract.level,
            project_id=contract.project_id,
            granted=frozenset(contract.permissions),
            allowed_projects=frozenset(contract.knowledge.projects),
        )

    def scope_projects(self) -> frozenset[str]:
        base = set(self.allowed_projects)
        if self.project_id:
            base.add(self.project_id)
        return frozenset(base)


class PermissionEngine:
    """Stateless authority checks. Emits an audit event on every denial via the
    optional telemetry hook, because a denial nobody can see is a security
    control nobody can verify."""

    def __init__(self, telemetry=None) -> None:
        self.telemetry = telemetry

    # -- core check -------------------------------------------------------
    def check(
        self,
        principal: Principal,
        capability: str,
        *,
        project_id: str | None = None,
        task_id: str | None = None,
    ) -> None:
        """Raise if ``principal`` may not exercise ``capability`` on ``project_id``."""
        cap = CAPABILITIES.get(capability)
        if cap is None:
            self._deny(principal, capability, project_id, task_id,
                       f"unknown capability '{capability}'")

        # 1. Owner gate. Checked before everything else so that no combination
        #    of level and grants can reach an owner-only action.
        if cap.owner_gated and principal.kind is not PrincipalKind.OWNER:
            self._deny(principal, capability, project_id, task_id,
                       f"'{capability}' is owner-gated and cannot be exercised by "
                       f"a principal of kind '{principal.kind.value}'")

        # 2. Grant. The owner implicitly holds everything; everyone else must
        #    have it written in their contract.
        if principal.kind is not PrincipalKind.OWNER and capability not in principal.granted:
            self._deny(principal, capability, project_id, task_id,
                       f"'{capability}' not granted by contract")

        # 3. Level. Reach must be sufficient. The owner and system principals
        #    sit at level 0, which is the L0 system boundary, so they bypass.
        if principal.kind is PrincipalKind.AGENT and principal.level < cap.min_level:
            self._deny(principal, capability, project_id, task_id,
                       f"'{capability}' requires level >= {cap.min_level}, "
                       f"principal is L{principal.level}")

        # 4. Project isolation.
        if project_id is not None and cap.project_scoped:
            self.check_project(principal, project_id, capability=capability, task_id=task_id)

    def allows(self, principal: Principal, capability: str, *, project_id: str | None = None) -> bool:
        """Non-raising variant, for planning ("what could this agent do?")
        rather than enforcement."""
        try:
            self.check(principal, capability, project_id=project_id)
            return True
        except PermissionDenied:
            return False

    # -- isolation ---------------------------------------------------------
    def check_project(
        self,
        principal: Principal,
        project_id: str,
        *,
        capability: str | None = None,
        task_id: str | None = None,
    ) -> None:
        if principal.kind is PrincipalKind.OWNER:
            return
        if project_id in principal.scope_projects():
            return
        # Cross-project reach is itself a capability, and it is not
        # project-scoped (checking it per project would be circular).
        if "project.cross_access" in principal.granted:
            return
        self._raise_isolation(principal, project_id, capability, task_id)

    def visible_projects(self, principal: Principal, all_projects: Iterable[str]) -> list[str]:
        if principal.kind is PrincipalKind.OWNER or "project.cross_access" in principal.granted:
            return list(all_projects)
        scope = principal.scope_projects()
        return [p for p in all_projects if p in scope]

    # -- denial paths -------------------------------------------------------
    def _deny(self, principal, capability, project_id, task_id, message) -> None:
        self._audit("permission.denied", principal, capability, project_id, task_id, message)
        raise PermissionDenied(
            message, principal=principal.id, capability=capability, project_id=project_id)

    def _raise_isolation(self, principal, project_id, capability, task_id) -> None:
        message = (f"principal '{principal.id}' (scope={sorted(principal.scope_projects())}) "
                   f"may not act on project '{project_id}'")
        self._audit("isolation.violation", principal, capability, project_id, task_id, message)
        raise IsolationViolation(
            message, principal=principal.id, project_id=project_id, capability=capability)

    def _audit(self, event_type, principal, capability, project_id, task_id, message) -> None:
        if self.telemetry is None:
            return
        from af.telemetry.events import Event
        self.telemetry.emit(Event(
            type=event_type, actor=principal.id, agent_id=principal.id,
            project_id=project_id, task_id=task_id, status="denied",
            error_code="permission_denied", tool=None,
            payload={"capability": capability, "reason": message,
                     "principal_kind": principal.kind.value, "level": principal.level},
        ))
