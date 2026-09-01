"""Owner Approval Engine and single-use execution tokens.

The property that matters: **approving one action must not permanently elevate
an agent.** An approval therefore does not modify the agent's permissions at
all. It mints a token that is bound to:

  * one approval, one agent, one task, one tool
  * a hash of the exact parameters that were approved
  * a use count (1 by default) and an expiry

So an approved action is *that* action, once. If the agent re-runs the tool with
different arguments the parameter hash no longer matches and the token is
refused — which closes the substitution attack where an agent gets "send email
to accountant" approved and then sends to a different address.

The token secret is stored only as a SHA-256 hash, the same way a password
would be. A leaked database therefore does not yield usable tokens. The plaintext
is returned exactly once, at mint time.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Any

from af.clock import Clock, SystemClock
from af.errors import ApprovalExpired, PermissionDenied, TokenInvalid
from af.governance.permissions import PermissionEngine, Principal, PrincipalKind
from af.ids import new_id
from af.store.sqlite_store import SqliteStore, dumps
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["ApprovalEngine", "ApprovalRequest", "ExecutionToken", "params_hash"]

DEFAULT_TTL_SECONDS = 24 * 3600.0


def params_hash(tool_id: str, params: dict[str, Any]) -> str:
    """Bind a token to exactly the parameters that were shown to the owner.

    The tool id is folded in so an approval for one tool can never be replayed
    against another that happens to take the same arguments.
    """
    payload = dumps({"tool": tool_id, "params": params})
    return hashlib.sha256(payload.encode()).hexdigest()


@dataclass(slots=True)
class ApprovalRequest:
    id: str
    project_id: str
    task_id: str | None
    requesting_agent_id: str
    action: str
    tool_id: str | None
    risk_level: str
    reason: str
    params: dict[str, Any]
    status: str
    created_at: float
    expires_at: float
    decided_at: float | None = None
    decided_by: str | None = None
    decision_note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {f: getattr(self, f) for f in self.__slots__}


@dataclass(slots=True)
class ExecutionToken:
    """Returned once at mint time. ``secret`` is never persisted in plaintext."""

    id: str
    secret: str
    approval_id: str
    agent_id: str
    task_id: str | None
    tool_id: str
    params_hash: str
    expires_at: float
    max_uses: int = 1

    def bearer(self) -> str:
        """Opaque wire form: ``<token_id>.<secret>``."""
        return f"{self.id}.{self.secret}"


class ApprovalEngine:
    def __init__(self, store: SqliteStore, telemetry: Telemetry,
                 permissions: PermissionEngine, clock: Clock | None = None) -> None:
        self.store = store
        self.telemetry = telemetry
        self.permissions = permissions
        self.clock = clock or SystemClock()

    # -- request -----------------------------------------------------------
    def request(self, *, principal: Principal, project_id: str, action: str,
                risk_level: str, reason: str, params: dict[str, Any],
                tool_id: str | None = None, task_id: str | None = None,
                ttl_seconds: float = DEFAULT_TTL_SECONDS) -> ApprovalRequest:
        now = self.clock.now()
        req = ApprovalRequest(
            id=new_id("apr"), project_id=project_id, task_id=task_id,
            requesting_agent_id=principal.id, action=action, tool_id=tool_id,
            risk_level=risk_level, reason=reason, params=params,
            status="PENDING", created_at=now, expires_at=now + ttl_seconds)
        self.store.execute(
            """
            INSERT INTO approvals (id, project_id, task_id, requesting_agent_id, action,
                tool_id, risk_level, reason, params, params_hash, status, created_at, expires_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (req.id, project_id, task_id, principal.id, action, tool_id, risk_level,
             reason, dumps(params), params_hash(tool_id or action, params),
             "PENDING", now, req.expires_at))
        self.telemetry.emit(Event(
            type=EventType.APPROVAL_REQUESTED, project_id=project_id, task_id=task_id,
            agent_id=principal.id, actor=principal.id, tool=tool_id,
            payload={"approval_id": req.id, "action": action, "risk": risk_level,
                     "reason": reason[:300], "expires_at": req.expires_at}))
        return req

    # -- decision -----------------------------------------------------------
    def decide(self, approval_id: str, *, principal: Principal, approve: bool,
               note: str = "", token_ttl_seconds: float = 3600.0,
               max_uses: int = 1) -> ExecutionToken | None:
        """Owner decision. Returns a token only on approval.

        Two rules are enforced here rather than left to the caller:
          * only an OWNER principal may decide, and
          * an agent may never decide its own request (checked explicitly even
            though the owner check already implies it — defence in depth against
            a future change that widens who may decide).
        """
        row = self.store.one("SELECT * FROM approvals WHERE id = ?", (approval_id,))
        if row is None:
            raise TokenInvalid(f"approval '{approval_id}' not found", approval_id=approval_id)

        if principal.kind is not PrincipalKind.OWNER:
            self.telemetry.emit(Event(
                type=EventType.PERMISSION_DENIED, project_id=row["project_id"],
                agent_id=principal.id, actor=principal.id, status="denied",
                error_code="permission_denied",
                payload={"reason": "non-owner attempted to decide an approval",
                         "approval_id": approval_id}))
            raise PermissionDenied(
                "only the owner may decide an approval request",
                principal=principal.id, approval_id=approval_id)
        if principal.id == row["requesting_agent_id"]:
            raise PermissionDenied(
                "an agent may not approve its own request",
                principal=principal.id, approval_id=approval_id)

        now = self.clock.now()
        if row["status"] != "PENDING":
            raise TokenInvalid(f"approval already {row['status']}", approval_id=approval_id)
        if now > row["expires_at"]:
            self.store.execute(
                "UPDATE approvals SET status = 'EXPIRED', decided_at = ? WHERE id = ?",
                (now, approval_id))
            self.telemetry.emit(Event(
                type=EventType.APPROVAL_EXPIRED, project_id=row["project_id"],
                task_id=row["task_id"], agent_id=row["requesting_agent_id"],
                payload={"approval_id": approval_id}))
            raise ApprovalExpired("approval request has expired", approval_id=approval_id)

        status = "APPROVED" if approve else "DENIED"
        self.store.execute(
            "UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, "
            "decision_note = ? WHERE id = ?", (status, now, principal.id, note, approval_id))
        self.telemetry.emit(Event(
            type=EventType.APPROVAL_GRANTED if approve else EventType.APPROVAL_DENIED,
            project_id=row["project_id"], task_id=row["task_id"],
            agent_id=row["requesting_agent_id"], actor=principal.id, tool=row["tool_id"],
            payload={"approval_id": approval_id, "note": note[:300],
                     "action": row["action"], "risk": row["risk_level"]}))
        if not approve:
            return None
        return self._mint(row, token_ttl_seconds, max_uses)

    def _mint(self, approval_row, ttl: float, max_uses: int) -> ExecutionToken:
        now = self.clock.now()
        token_id = new_id("tok")
        secret = secrets.token_urlsafe(32)
        token = ExecutionToken(
            id=token_id, secret=secret, approval_id=approval_row["id"],
            agent_id=approval_row["requesting_agent_id"], task_id=approval_row["task_id"],
            tool_id=approval_row["tool_id"] or approval_row["action"],
            params_hash=approval_row["params_hash"], expires_at=now + ttl, max_uses=max_uses)
        self.store.execute(
            """
            INSERT INTO exec_tokens (id, approval_id, project_id, agent_id, task_id, tool_id,
                params_hash, secret_hash, max_uses, uses, created_at, expires_at)
            VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
            """,
            (token_id, approval_row["id"], approval_row["project_id"],
             token.agent_id, token.task_id, token.tool_id, token.params_hash,
             _hash_secret(secret), max_uses, now, token.expires_at))
        self.telemetry.emit(Event(
            type=EventType.TOKEN_ISSUED, project_id=approval_row["project_id"],
            task_id=token.task_id, agent_id=token.agent_id, tool=token.tool_id,
            payload={"token_id": token_id, "approval_id": approval_row["id"],
                     "max_uses": max_uses, "expires_at": token.expires_at}))
        return token

    # -- redemption ------------------------------------------------------------
    def consume(self, bearer: str, *, agent_id: str, tool_id: str,
                params: dict[str, Any], task_id: str | None = None) -> str:
        """Atomically redeem a token for one execution. Returns the token id.

        Every check that could reject is performed *before* the atomic
        increment, and the increment itself carries the ``uses < max_uses``
        guard in its WHERE clause. Two concurrent redemptions of a single-use
        token therefore cannot both succeed: exactly one UPDATE matches.
        """
        token_id, _, secret = bearer.partition(".")
        row = self.store.one("SELECT * FROM exec_tokens WHERE id = ?", (token_id,))
        now = self.clock.now()

        def reject(reason: str) -> None:
            self.telemetry.emit(Event(
                type=EventType.TOKEN_REJECTED, agent_id=agent_id, task_id=task_id,
                tool=tool_id, status="rejected", error_code="token_invalid",
                project_id=row["project_id"] if row else None,
                payload={"token_id": token_id, "reason": reason}))
            raise TokenInvalid(f"execution token rejected: {reason}",
                               token_id=token_id, reason=reason)

        if row is None:
            reject("unknown token")
        # Constant-time compare: a timing side channel on token verification is
        # cheap to avoid and expensive to discover later.
        if not hmac.compare_digest(row["secret_hash"], _hash_secret(secret)):
            reject("secret mismatch")
        if row["revoked_at"] is not None:
            reject("token revoked")
        if now > row["expires_at"]:
            reject("token expired")
        if row["uses"] >= row["max_uses"]:
            reject("token already consumed")
        # Binding checks — these are what stop a valid token being reused for a
        # different action, by a different agent, or with different parameters.
        if row["agent_id"] != agent_id:
            reject(f"token belongs to agent '{row['agent_id']}', presented by '{agent_id}'")
        if row["tool_id"] != tool_id:
            reject(f"token authorises tool '{row['tool_id']}', presented for '{tool_id}'")
        if row["task_id"] is not None and task_id is not None and row["task_id"] != task_id:
            reject(f"token is bound to task '{row['task_id']}'")
        if row["params_hash"] != params_hash(tool_id, params):
            reject("parameters differ from what was approved")

        n = self.store.execute(
            "UPDATE exec_tokens SET uses = uses + 1, consumed_at = ? "
            "WHERE id = ? AND uses < max_uses AND revoked_at IS NULL",
            (now, token_id))
        if n == 0:
            reject("token consumed concurrently")

        self.telemetry.emit(Event(
            type=EventType.TOKEN_CONSUMED, project_id=row["project_id"], task_id=task_id,
            agent_id=agent_id, tool=tool_id,
            payload={"token_id": token_id, "approval_id": row["approval_id"]}))
        return token_id

    def revoke(self, token_id: str, *, principal: Principal, reason: str = "") -> bool:
        if principal.kind is not PrincipalKind.OWNER:
            raise PermissionDenied("only the owner may revoke a token", principal=principal.id)
        return self.store.execute(
            "UPDATE exec_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
            (self.clock.now(), token_id)) > 0

    # -- maintenance ---------------------------------------------------------------
    def expire_stale(self) -> int:
        """Move lapsed requests to EXPIRED. Run periodically so the owner's
        pending queue reflects what is actually still actionable."""
        now = self.clock.now()
        with self.store.write() as c:
            rows = c.execute(
                "UPDATE approvals SET status = 'EXPIRED' "
                "WHERE status = 'PENDING' AND expires_at < ? RETURNING id, project_id",
                (now,)).fetchall()
        for r in rows:
            self.telemetry.emit(Event(
                type=EventType.APPROVAL_EXPIRED, project_id=r["project_id"],
                payload={"approval_id": r["id"]}))
        return len(rows)

    def pending(self, project_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        where, params = ("AND project_id = ?", [project_id]) if project_id else ("", [])
        params.append(limit)
        return [dict(r) for r in self.store.all(
            f"SELECT * FROM approvals WHERE status = 'PENDING' {where} "
            f"ORDER BY created_at LIMIT ?", params)]


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()
