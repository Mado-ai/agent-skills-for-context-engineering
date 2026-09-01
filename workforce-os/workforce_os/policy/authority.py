"""The authority model. Policy only — it holds no business logic and touches no tables.

The Owner is the final authority. The Chief Agent Architect is the Owner's single
primary AI interface and the only agent with system-wide visibility. Level conveys
visibility and orchestration breadth; it never conveys tool scope.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from ..errors import AuthenticationError, PolicyDenied
from ..schemas import CHIEF_ARCHITECT_ROLE

OWNER = "owner"
AGENT = "agent"
SYSTEM = "system"

# Actions only the human Owner may ever perform.
OWNER_ONLY_ACTIONS = frozenset({
    "approve_request",
    "reject_request",
    "retire_agent",
    "raise_agent_level",
    "close_capa",
    "read_across_projects",
    "delete_project",
})


@dataclass(frozen=True)
class Principal:
    """Who is acting. Built at the boundary; never taken from request-body claims."""

    kind: str                      # owner | agent | system
    id: str
    project_id: str | None = None
    role: str | None = None
    level: int = 0

    @property
    def is_owner(self) -> bool:
        return self.kind == OWNER

    @property
    def is_chief_architect(self) -> bool:
        return self.kind == AGENT and self.role == CHIEF_ARCHITECT_ROLE and self.level == 5

    def describe(self) -> dict:
        return {"kind": self.kind, "id": self.id, "role": self.role,
                "level": self.level, "project_id": self.project_id}


def owner_principal(actor_id: str = "owner") -> Principal:
    return Principal(kind=OWNER, id=actor_id, level=5)


def system_principal() -> Principal:
    return Principal(kind=SYSTEM, id="system", level=0)


def authenticate_owner(presented_token: str | None, configured_token: str) -> Principal:
    """Constant-time owner authentication. An unset owner token denies everything."""
    if not configured_token:
        raise AuthenticationError(
            "No Owner token is configured; set WORKFORCE_OS_OWNER_TOKEN to enable Owner actions")
    if not presented_token or not hmac.compare_digest(presented_token, configured_token):
        raise AuthenticationError("Invalid Owner credentials")
    return owner_principal()


def require_owner(principal: Principal, action: str) -> None:
    """Gate an Owner-only action. No agent level, L5 included, satisfies this."""
    if not principal.is_owner:
        raise PolicyDenied(
            f"Action {action!r} requires the human Owner",
            code="owner_authority_required",
            details={"action": action, "principal": principal.describe()},
        )


def can_view_project(principal: Principal, project_id: str) -> bool:
    """Project isolation. Only the Owner reads across projects."""
    if principal.is_owner:
        return True
    return principal.project_id == project_id


def assert_can_view_project(principal: Principal, project_id: str) -> None:
    if not can_view_project(principal, project_id):
        raise PolicyDenied(
            "Cross-project access is denied",
            code="project_isolation",
            details={"principal_project": principal.project_id, "requested_project": project_id},
        )


def can_delegate_to(parent_level: int, child_level: int) -> bool:
    """Delegation flows strictly downward."""
    return child_level < parent_level
