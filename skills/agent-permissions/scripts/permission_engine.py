"""Capability-based permissions, owner gating, tenant isolation, and single-use
execution tokens for agent systems.

Enforces one rule: authority is read from stored records and checked by code the
agent cannot reach. Nothing a model emits is ever an input to an authority
decision.

Use when:
    - Agents can take actions with consequences outside the conversation.
    - A human must approve some agent actions but not others.
    - Multiple tenants or projects share one agent system.
    - An agent can create, configure, or delegate to other agents.

Standard library only. Storage is in-memory here for clarity; the shape of the
checks is what transfers, not the persistence.

Typical usage::

    engine = PermissionEngine()
    engine.check(agent_principal, "tool.call", project_id="proj-a")
    approval = engine.request_approval(agent, action="email.send", params={...})
    token = engine.decide(approval.id, principal=owner, approve=True)
    engine.consume(token.bearer(), agent_id=agent.id, action="email.send", params={...})
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

__all__ = [
    "PrincipalKind", "Principal", "Capability", "CAPABILITIES", "OWNER_GATED",
    "PermissionEngine", "PermissionDenied", "IsolationViolation", "TokenInvalid",
    "ApprovalRequest", "ExecutionToken",
]


class PermissionDenied(Exception):
    pass


class IsolationViolation(PermissionDenied):
    pass


class TokenInvalid(Exception):
    pass


# --------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Capability:
    name: str
    description: str
    min_level: int = 1
    #: Unsatisfiable for any principal of kind AGENT, at any level, holding any
    #: grant. This is a structural property, not a carefully-checked rule.
    owner_gated: bool = False
    #: When true, holding it in one project never implies it in another.
    project_scoped: bool = True


def _c(name, desc, level=1, *, owner=False, scoped=True):
    return Capability(name, desc, level, owner, scoped)


#: The complete vocabulary. A capability absent from this table is rejected, so
#: typos fail closed instead of being interpreted loosely later.
CAPABILITIES: dict[str, Capability] = {c.name: c for c in [
    _c("task.execute", "Execute an assigned unit of work", 1),
    _c("task.delegate", "Delegate a sub-task to another agent", 3),
    _c("tool.call", "Invoke a tool the contract grants", 1),
    _c("memory.read", "Read permitted knowledge layers", 1),
    _c("memory.write", "Write permitted knowledge layers", 1),
    _c("agent.inspect", "Read the agent registry", 2),
    _c("agent.propose", "Draft a new agent contract", 4),
    _c("quality.review", "Review another agent's output", 3),
    _c("workforce.observe", "Read system-wide metrics", 4, scoped=False),
    _c("project.cross_access", "Operate across project boundaries", 5, scoped=False),
    # --- owner-gated: each CREATES authority or REDEFINES a limit ---
    _c("agent.activate", "Promote a contract to ACTIVE", 5, owner=True),
    _c("agent.merge", "Merge duplicate agents", 5, owner=True),
    _c("budget.raise", "Increase a spending ceiling", 5, owner=True),
    _c("quality.override", "Override a quality verdict", 5, owner=True),
    _c("memory.authoritative.write", "Define system ground truth", 4, owner=True),
]}

ALL_CAPABILITIES = frozenset(CAPABILITIES)
OWNER_GATED = frozenset(n for n, c in CAPABILITIES.items() if c.owner_gated)


class PrincipalKind(str, Enum):
    OWNER = "owner"
    AGENT = "agent"
    SYSTEM = "system"


@dataclass(frozen=True)
class Principal:
    id: str
    kind: PrincipalKind
    level: int = 1
    project_id: str | None = None
    granted: frozenset[str] = field(default_factory=frozenset)
    allowed_projects: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def owner(cls, owner_id: str = "owner") -> "Principal":
        return cls(owner_id, PrincipalKind.OWNER, 0, granted=frozenset(ALL_CAPABILITIES))

    @classmethod
    def system(cls, name: str = "system") -> "Principal":
        """Internal machinery. Holds everything EXCEPT the owner-gated set.

        Making this omnipotent is the most common way this model leaks: anything
        that can induce the runtime to act on an agent's behalf would then
        inherit human authority.
        """
        return cls(name, PrincipalKind.SYSTEM, 0,
                   granted=frozenset(ALL_CAPABILITIES - OWNER_GATED))

    @classmethod
    def from_contract(cls, instance_id: str, contract: Any) -> "Principal":
        """Build from the STORED contract — never from model output."""
        return cls(instance_id, PrincipalKind.AGENT, contract.level,
                   contract.project_id, frozenset(contract.permissions),
                   frozenset(getattr(contract, "allowed_projects", ()) or ()))

    def scope(self) -> frozenset[str]:
        base = set(self.allowed_projects)
        if self.project_id:
            base.add(self.project_id)
        return frozenset(base)


# --------------------------------------------------------------------------
# Approvals
# --------------------------------------------------------------------------
def params_hash(action: str, params: dict[str, Any]) -> str:
    """Bind a token to exactly the parameters shown to the human.

    The action is folded in so an approval for one action cannot be replayed
    against another that happens to take the same arguments.
    """
    payload = json.dumps({"action": action, "params": params},
                         sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


@dataclass
class ApprovalRequest:
    id: str
    agent_id: str
    project_id: str
    action: str
    reason: str
    params: dict[str, Any]
    status: str = "PENDING"
    expires_at: float = 0.0


@dataclass
class ExecutionToken:
    """Returned once at mint time. The secret is never persisted in plaintext."""

    id: str
    secret: str
    agent_id: str
    action: str
    params_hash: str
    expires_at: float
    max_uses: int = 1

    def bearer(self) -> str:
        return f"{self.id}.{self.secret}"


@dataclass
class _StoredToken:
    id: str
    agent_id: str
    action: str
    params_hash: str
    secret_hash: str
    expires_at: float
    max_uses: int = 1
    uses: int = 0
    revoked: bool = False


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------
class PermissionEngine:
    def __init__(self, audit: Callable[[dict], None] | None = None,
                 now: Callable[[], float] = time.time) -> None:
        #: Every denial is recorded BEFORE the exception is raised. A control
        #: nobody can observe cannot be verified.
        self.audit = audit or (lambda record: None)
        self.now = now
        self._approvals: dict[str, ApprovalRequest] = {}
        self._tokens: dict[str, _StoredToken] = {}

    # -- authority ---------------------------------------------------------
    def check(self, principal: Principal, capability: str, *,
              project_id: str | None = None) -> None:
        cap = CAPABILITIES.get(capability)
        if cap is None:
            self._deny(principal, capability, project_id, f"unknown capability '{capability}'")

        # 1. Owner gate FIRST: no combination of level and grants reaches past it.
        if cap.owner_gated and principal.kind is not PrincipalKind.OWNER:
            self._deny(principal, capability, project_id,
                       f"'{capability}' is owner-gated and cannot be exercised by "
                       f"a principal of kind '{principal.kind.value}'")

        # 2. Grant.
        if principal.kind is not PrincipalKind.OWNER and capability not in principal.granted:
            self._deny(principal, capability, project_id, "not granted by contract")

        # 3. Level floor. Reach must be sufficient; it is never sufficient alone.
        if principal.kind is PrincipalKind.AGENT and principal.level < cap.min_level:
            self._deny(principal, capability, project_id,
                       f"requires level >= {cap.min_level}, principal is L{principal.level}")

        # 4. Project scope, against the resource's project.
        if project_id is not None and cap.project_scoped:
            self.check_project(principal, project_id, capability)

    def allows(self, principal: Principal, capability: str, *,
               project_id: str | None = None) -> bool:
        """Non-raising variant, for planning rather than enforcement."""
        try:
            self.check(principal, capability, project_id=project_id)
            return True
        except PermissionDenied:
            return False

    def check_project(self, principal: Principal, project_id: str,
                      capability: str | None = None) -> None:
        if principal.kind is PrincipalKind.OWNER:
            return
        if project_id in principal.scope():
            return
        # Cross-project reach is itself a capability, and it is NOT
        # project-scoped — checking it per project would be circular.
        if "project.cross_access" in principal.granted:
            return
        message = (f"principal '{principal.id}' (scope={sorted(principal.scope())}) "
                   f"may not act on project '{project_id}'")
        self.audit({"event": "isolation.violation", "principal": principal.id,
                    "project_id": project_id, "capability": capability,
                    "reason": message, "ts": self.now()})
        raise IsolationViolation(message)

    def _deny(self, principal, capability, project_id, message) -> None:
        self.audit({"event": "permission.denied", "principal": principal.id,
                    "kind": principal.kind.value, "level": principal.level,
                    "capability": capability, "project_id": project_id,
                    "reason": message, "ts": self.now()})
        raise PermissionDenied(message)

    # -- approvals ----------------------------------------------------------
    def request_approval(self, principal: Principal, *, action: str, project_id: str,
                         reason: str, params: dict[str, Any],
                         ttl_seconds: float = 86400.0) -> ApprovalRequest:
        request = ApprovalRequest(
            id=f"apr_{secrets.token_hex(8)}", agent_id=principal.id,
            project_id=project_id, action=action, reason=reason, params=params,
            expires_at=self.now() + ttl_seconds)
        self._approvals[request.id] = request
        self.audit({"event": "approval.requested", "approval_id": request.id,
                    "agent": principal.id, "action": action, "reason": reason,
                    "ts": self.now()})
        return request

    def decide(self, approval_id: str, *, principal: Principal, approve: bool,
               note: str = "", token_ttl_seconds: float = 3600.0,
               max_uses: int = 1) -> ExecutionToken | None:
        request = self._approvals.get(approval_id)
        if request is None:
            raise TokenInvalid(f"approval '{approval_id}' not found")

        if principal.kind is not PrincipalKind.OWNER:
            self._deny(principal, "approval.decide", request.project_id,
                       "only the owner may decide an approval request")
        # Explicit, even though the owner check implies it: this survives a
        # future change that widens who may decide.
        if principal.id == request.agent_id:
            self._deny(principal, "approval.decide", request.project_id,
                       "an agent may not approve its own request")
        if request.status != "PENDING":
            raise TokenInvalid(f"approval already {request.status}")
        if self.now() > request.expires_at:
            request.status = "EXPIRED"
            raise TokenInvalid("approval request has expired")

        request.status = "APPROVED" if approve else "DENIED"
        self.audit({"event": f"approval.{request.status.lower()}",
                    "approval_id": approval_id, "actor": principal.id,
                    "note": note, "ts": self.now()})
        if not approve:
            return None

        secret = secrets.token_urlsafe(32)
        token = ExecutionToken(
            id=f"tok_{secrets.token_hex(8)}", secret=secret, agent_id=request.agent_id,
            action=request.action, params_hash=params_hash(request.action, request.params),
            expires_at=self.now() + token_ttl_seconds, max_uses=max_uses)
        self._tokens[token.id] = _StoredToken(
            id=token.id, agent_id=token.agent_id, action=token.action,
            params_hash=token.params_hash, secret_hash=_sha(secret),
            expires_at=token.expires_at, max_uses=max_uses)
        self.audit({"event": "token.issued", "token_id": token.id,
                    "approval_id": approval_id, "ts": self.now()})
        return token

    def consume(self, bearer: str, *, agent_id: str, action: str,
                params: dict[str, Any]) -> str:
        """Atomically redeem a token for exactly one execution."""
        token_id, _, secret = bearer.partition(".")
        stored = self._tokens.get(token_id)

        def reject(reason: str) -> None:
            self.audit({"event": "token.rejected", "token_id": token_id,
                        "agent": agent_id, "reason": reason, "ts": self.now()})
            raise TokenInvalid(f"execution token rejected: {reason}")

        if stored is None:
            reject("unknown token")
        # Constant-time: a timing side channel here is cheap to avoid and
        # expensive to discover later.
        if not hmac.compare_digest(stored.secret_hash, _sha(secret)):
            reject("secret mismatch")
        if stored.revoked:
            reject("token revoked")
        if self.now() > stored.expires_at:
            reject("token expired")
        if stored.uses >= stored.max_uses:
            reject("token already consumed")
        if stored.agent_id != agent_id:
            reject(f"token belongs to agent '{stored.agent_id}'")
        if stored.action != action:
            reject(f"token authorises action '{stored.action}'")
        # The binding that closes the substitution attack.
        if stored.params_hash != params_hash(action, params):
            reject("parameters differ from what was approved")

        stored.uses += 1
        self.audit({"event": "token.consumed", "token_id": token_id,
                    "agent": agent_id, "action": action, "ts": self.now()})
        return token_id

    def revoke(self, token_id: str, *, principal: Principal) -> bool:
        if principal.kind is not PrincipalKind.OWNER:
            raise PermissionDenied("only the owner may revoke a token")
        stored = self._tokens.get(token_id)
        if stored is None or stored.revoked:
            return False
        stored.revoked = True
        return True

    # -- filtering ------------------------------------------------------------
    def visible_projects(self, principal: Principal, all_projects) -> list[str]:
        if principal.kind is PrincipalKind.OWNER or "project.cross_access" in principal.granted:
            return list(all_projects)
        scope = principal.scope()
        return [p for p in all_projects if p in scope]


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# --------------------------------------------------------------------------
if __name__ == "__main__":
    log: list[dict] = []
    engine = PermissionEngine(audit=log.append)
    owner = Principal.owner()

    print("1. A MAXIMALLY privileged agent still cannot cross the owner boundary")
    superagent = Principal("super", PrincipalKind.AGENT, level=5, project_id="proj-a",
                           granted=frozenset(ALL_CAPABILITIES))
    for capability in sorted(OWNER_GATED):
        try:
            engine.check(superagent, capability, project_id="proj-a")
            print(f"   *** FAILURE: {capability} allowed")
        except PermissionDenied:
            print(f"   blocked: {capability}")
    print()

    print("2. The system principal is not the owner")
    machinery = Principal.system("scheduler")
    print(f"   system holds owner-gated capabilities: "
          f"{bool(machinery.granted & OWNER_GATED)}\n")

    print("3. Tenant isolation is per-resource")
    worker = Principal("w1", PrincipalKind.AGENT, level=2, project_id="proj-a",
                       granted=frozenset({"task.execute", "tool.call"}))
    engine.check(worker, "task.execute", project_id="proj-a")
    print("   own project: allowed")
    try:
        engine.check(worker, "task.execute", project_id="proj-b")
    except IsolationViolation as exc:
        print(f"   other project: {exc}\n")

    print("4. An approval is a token, not a promotion")
    approved = {"to": "accountant@corp.com", "subject": "invoice"}
    before = set(worker.granted)
    request = engine.request_approval(worker, action="email.send", project_id="proj-a",
                                      reason="send the monthly invoice", params=approved)
    token = engine.decide(request.id, principal=owner, approve=True)

    try:
        engine.consume(token.bearer(), agent_id="w1", action="email.send",
                       params={**approved, "to": "attacker@evil.com"})
    except TokenInvalid as exc:
        print(f"   parameter substitution: {exc}")

    engine.consume(token.bearer(), agent_id="w1", action="email.send", params=approved)
    print("   correct use: allowed once")
    try:
        engine.consume(token.bearer(), agent_id="w1", action="email.send", params=approved)
    except TokenInvalid as exc:
        print(f"   replay: {exc}")
    print(f"   permissions unchanged afterwards: {set(worker.granted) == before}\n")

    print("5. Every denial was audited")
    for record in log:
        if record["event"] in ("permission.denied", "isolation.violation", "token.rejected"):
            print(f"   {record['event']}: {record.get('capability') or record.get('reason')[:52]}")
