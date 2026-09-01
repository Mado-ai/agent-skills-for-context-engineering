"""The Owner approval execution flow.

A high-risk action does not execute and then ask forgiveness. The gateway opens an
approval request and refuses the call; the Owner — and only the Owner — approves it,
which mints a token bound to that exact agent, tool and argument set. The token is
single-use and expires. Re-using it, or presenting it for different arguments, fails.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

from ..errors import NotFoundError, PolicyDenied, ValidationError
from ..policy.authority import Principal, require_owner
from ..redaction import redact
from ..schemas import canonical_json, new_id, require, utcnow

TOKEN_BYTES = 32


def _hash_token(raw_token: str) -> str:
    """Tokens are stored hashed — the plaintext exists only in the approval response."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


class ApprovalService:
    def __init__(self, db, events, config):
        self.db = db
        self.events = events
        self.config = config

    # ------------------------------------------------------------------ requests

    def open_request(self, *, project_id: str, agent_id: str, task_id: str | None,
                     tool_name: str, arguments: dict, arguments_hash: str,
                     risk_level: str, reason: str) -> dict:
        request = {"id": new_id("apr"), "project_id": project_id, "agent_id": agent_id,
                   "task_id": task_id, "tool_name": tool_name, "arguments_hash": arguments_hash,
                   "arguments_redacted": canonical_json(redact(arguments)),
                   "risk_level": risk_level, "reason": reason, "status": "pending",
                   "created_at": utcnow(), "decided_at": None, "decided_by": None,
                   "decision_note": None}
        self.db.execute(
            """INSERT INTO approval_requests (id, project_id, agent_id, task_id, tool_name,
                   arguments_hash, arguments_redacted, risk_level, reason, status,
                   created_at, decided_at, decided_by, decision_note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(request[k] for k in ("id", "project_id", "agent_id", "task_id", "tool_name",
                                       "arguments_hash", "arguments_redacted", "risk_level",
                                       "reason", "status", "created_at", "decided_at",
                                       "decided_by", "decision_note")))
        self.events.append("approval.requested", actor_type="agent", actor_id=agent_id,
                           project_id=project_id,
                           payload={"request_id": request["id"], "tool_name": tool_name,
                                    "risk_level": risk_level, "reason": reason})
        return self.get_request(request["id"])

    def approve(self, request_id: str, *, principal: Principal, note: str = "") -> dict:
        """Owner-only. Mints a single-use token bound to the request's exact arguments."""
        require_owner(principal, "approve_request")
        request = self.get_request(request_id)

        if request["status"] != "pending":
            raise ValidationError(f"Approval request is already {request['status']}",
                                  details={"field": "status"})
        # Defence in depth: the requesting agent must never be the approving principal.
        if principal.id == request["agent_id"]:
            raise PolicyDenied("The requesting agent cannot approve its own request",
                               code="self_approval_denied")

        raw_token = secrets.token_urlsafe(TOKEN_BYTES)
        issued_at = datetime.now(timezone.utc)
        expires_at = issued_at + timedelta(seconds=self.config.approval_token_ttl_seconds)
        token_id = new_id("atk")

        with self.db.transaction():
            self.db.connection.execute(
                """UPDATE approval_requests SET status = 'approved', decided_at = ?,
                       decided_by = ?, decision_note = ? WHERE id = ?""",
                (issued_at.isoformat(), principal.id, note or "", request_id))
            self.db.connection.execute(
                """INSERT INTO approval_tokens (id, request_id, token_hash, agent_id, tool_name,
                       arguments_hash, issued_at, expires_at, used_at, revoked_at)
                   VALUES (?,?,?,?,?,?,?,?,NULL,NULL)""",
                (token_id, request_id, _hash_token(raw_token), request["agent_id"],
                 request["tool_name"], request["arguments_hash"],
                 issued_at.isoformat(), expires_at.isoformat()))

        self.events.append("approval.granted", actor_type="owner", actor_id=principal.id,
                           project_id=request["project_id"],
                           payload={"request_id": request_id, "token_id": token_id,
                                    "tool_name": request["tool_name"],
                                    "expires_at": expires_at.isoformat()})
        # The plaintext token is returned exactly once and never persisted.
        return {"request": self.get_request(request_id), "token": raw_token,
                "token_id": token_id, "expires_at": expires_at.isoformat()}

    def reject(self, request_id: str, *, principal: Principal, note: str = "") -> dict:
        require_owner(principal, "reject_request")
        request = self.get_request(request_id)
        if request["status"] != "pending":
            raise ValidationError(f"Approval request is already {request['status']}",
                                  details={"field": "status"})
        self.db.execute(
            """UPDATE approval_requests SET status = 'rejected', decided_at = ?, decided_by = ?,
                   decision_note = ? WHERE id = ?""",
            (utcnow(), principal.id, note or "", request_id))
        self.events.append("approval.rejected", actor_type="owner", actor_id=principal.id,
                           project_id=request["project_id"],
                           payload={"request_id": request_id, "note": note or ""})
        return self.get_request(request_id)

    # -------------------------------------------------------------------- tokens

    def consume_token(self, raw_token: str, *, agent_id: str, tool_name: str,
                      arguments_hash: str) -> dict:
        """Validate and burn a token. Every binding must match or the call is refused."""
        require(isinstance(raw_token, str) and raw_token.strip(),
                "approval token must be a non-empty string", "approval_token")

        row = self.db.query_one("SELECT * FROM approval_tokens WHERE token_hash = ?",
                                (_hash_token(raw_token),))
        if not row:
            raise PolicyDenied("Approval token is not recognised", code="approval_token_invalid")
        if row["revoked_at"]:
            raise PolicyDenied("Approval token has been revoked", code="approval_token_revoked")
        if row["used_at"]:
            raise PolicyDenied("Approval token has already been used",
                               code="approval_token_already_used")

        now = datetime.now(timezone.utc)
        if now > datetime.fromisoformat(row["expires_at"]):
            raise PolicyDenied("Approval token has expired", code="approval_token_expired",
                               details={"expired_at": row["expires_at"]})

        # Bindings: the token authorises one agent, one tool, one argument set.
        if row["agent_id"] != agent_id:
            raise PolicyDenied("Approval token was issued to a different agent",
                               code="approval_token_agent_mismatch")
        if row["tool_name"] != tool_name:
            raise PolicyDenied("Approval token was issued for a different tool",
                               code="approval_token_tool_mismatch")
        if row["arguments_hash"] != arguments_hash:
            raise PolicyDenied("Approval token was issued for different arguments",
                               code="approval_token_arguments_mismatch")

        # Burn it. The conditional UPDATE makes concurrent reuse impossible.
        cursor = self.db.execute(
            "UPDATE approval_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL",
            (now.isoformat(), row["id"]))
        if cursor.rowcount != 1:
            raise PolicyDenied("Approval token has already been used",
                               code="approval_token_already_used")

        self.db.execute("UPDATE approval_requests SET status = 'consumed' WHERE id = ?",
                        (row["request_id"],))
        return row

    def revoke_token(self, token_id: str, *, principal: Principal) -> dict:
        require_owner(principal, "approve_request")
        self.db.execute("UPDATE approval_tokens SET revoked_at = ? WHERE id = ? AND used_at IS NULL",
                        (utcnow(), token_id))
        self.events.append("approval.token_revoked", actor_type="owner", actor_id=principal.id,
                           payload={"token_id": token_id})
        return {"token_id": token_id, "revoked": True}

    # --------------------------------------------------------------------- reads

    def get_request(self, request_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM approval_requests WHERE id = ?", (request_id,))
        if not row:
            raise NotFoundError(f"Approval request {request_id} not found")
        return row

    def hydrate(self, request: dict) -> dict:
        return {**request, "arguments_redacted": json.loads(request["arguments_redacted"])}

    def list_requests(self, *, project_id: str | None = None, status: str | None = "pending",
                      limit: int = 100) -> list[dict]:
        sql, params = "SELECT * FROM approval_requests WHERE 1=1", []
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        params.append(min(limit, 500))
        return self.db.query(sql + " ORDER BY created_at DESC LIMIT ?", tuple(params))
