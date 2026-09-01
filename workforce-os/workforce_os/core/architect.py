"""The Chief Agent Architect — the Owner's single primary AI interface.

This is the only surface with system-wide visibility. It answers questions about the
whole runtime and proposes plans, but it holds no special execution power: anything it
does goes through the same gateway, budgets and approval flow as any other agent.
"""

from __future__ import annotations

from ..errors import NotFoundError, PolicyDenied
from .budgets import Spend
from ..policy.authority import Principal, require_owner
from ..schemas import CHIEF_ARCHITECT_ROLE


class ChiefArchitect:
    def __init__(self, runtime):
        self.rt = runtime

    # ------------------------------------------------------------------ identity

    def current(self) -> dict | None:
        row = self.rt.db.query_one(
            "SELECT * FROM agents WHERE role = ? AND status = 'active'", (CHIEF_ARCHITECT_ROLE,))
        return row

    def require_current(self) -> dict:
        agent = self.current()
        if not agent:
            raise NotFoundError(
                "No active Chief Agent Architect. Build one and activate it to use this endpoint.")
        return agent

    # ------------------------------------------------------------- system picture

    def system_view(self, principal: Principal) -> dict:
        """The whole-system picture. Owner-only: it deliberately crosses every project."""
        require_owner(principal, "read_across_projects")

        db = self.rt.db
        projects = []
        for project in self.rt.projects.list():
            pid = project["id"]
            projects.append({
                **project,
                "agents": db.query_one(
                    "SELECT COUNT(*) AS n FROM agents WHERE project_id = ?", (pid,))["n"],
                "active_agents": db.query_one(
                    "SELECT COUNT(*) AS n FROM agents WHERE project_id = ? AND status = 'active'",
                    (pid,))["n"],
                "open_tasks": db.query_one(
                    "SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? "
                    "AND status NOT IN ('completed','cancelled')", (pid,))["n"],
                "open_capas": db.query_one(
                    "SELECT COUNT(*) AS n FROM capa_records WHERE project_id = ? AND status = 'open'",
                    (pid,))["n"],
                "pending_approvals": db.query_one(
                    "SELECT COUNT(*) AS n FROM approval_requests WHERE project_id = ? "
                    "AND status = 'pending'", (pid,))["n"],
                "spend": self.rt.telemetry.summary(project_id=pid)["totals"],
            })

        chief = self.current()
        return {
            "chief_architect": ({"id": chief["id"], "name": chief["name"], "level": chief["level"]}
                                if chief else None),
            "projects": projects,
            "totals": {
                "projects": len(projects),
                "agents": db.query_one("SELECT COUNT(*) AS n FROM agents")["n"],
                "active_agents": db.query_one(
                    "SELECT COUNT(*) AS n FROM agents WHERE status = 'active'")["n"],
                "open_tasks": db.query_one(
                    "SELECT COUNT(*) AS n FROM tasks WHERE status NOT IN ('completed','cancelled')")["n"],
                "pending_approvals": db.query_one(
                    "SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'")["n"],
                "open_capas": db.query_one(
                    "SELECT COUNT(*) AS n FROM capa_records WHERE status = 'open'")["n"],
                "tool_calls": db.query_one("SELECT COUNT(*) AS n FROM tool_calls")["n"],
                "events": db.query_one("SELECT COUNT(*) AS n FROM events")["n"],
            },
            "spend": self.rt.telemetry.summary()["totals"],
            "attention_required": self._attention_required(),
        }

    def _attention_required(self) -> list[dict]:
        """What the Owner actually needs to look at, newest first."""
        items = []
        for request in self.rt.approvals.list_requests(status="pending", limit=25):
            items.append({"kind": "approval", "id": request["id"],
                          "project_id": request["project_id"],
                          "summary": f"{request['tool_name']} needs Owner approval "
                                     f"({request['risk_level']} risk): {request['reason']}",
                          "created_at": request["created_at"]})
        for capa in self.rt.quality.open_capas():
            items.append({"kind": "capa", "id": capa["id"], "project_id": capa["project_id"],
                          "summary": f"Open CAPA after {capa['rework_count']} failed evaluations: "
                                     f"{capa['trigger_reason']}",
                          "created_at": capa["opened_at"]})
        return sorted(items, key=lambda i: i["created_at"], reverse=True)

    # --------------------------------------------------------------------- brief

    def brief(self, principal: Principal, question: str) -> dict:
        """Answer an Owner question against the live system picture.

        The provider is given only the assembled system view — never credentials, and
        never another project's raw contents beyond the counts shown here.
        """
        require_owner(principal, "read_across_projects")
        chief = self.require_current()
        contract = self.rt.agents.get_contract(chief["id"])
        view = self.system_view(principal)

        context = (
            f"System view: {view['totals']}. "
            f"Spend to date: {view['spend']}. "
            f"Items awaiting the Owner: {len(view['attention_required'])}."
        )
        completion = self.rt.provider.complete(
            system_prompt=contract.system_prompt,
            messages=[{"role": "user", "content": f"{context}\n\nOwner asks: {question}"}],
            model=contract.provider_model)

        self.rt.telemetry.record_call(
            project_id=chief["project_id"], agent_id=chief["id"], task_id=None,
            source="provider_call", cost_usd=completion.cost_usd,
            latency_ms=completion.latency_ms, tokens=completion.total_tokens)
        self.rt.budgets.charge(project_id=chief["project_id"], agent_id=chief["id"], task_id=None,
                               kind="provider_call",
                               spend=Spend(usd=completion.cost_usd,
                                           tokens=completion.total_tokens, calls=1),
                               ref_id="architect_brief")
        self.rt.events.append("architect.briefed", actor_type="owner", actor_id=principal.id,
                              project_id=chief["project_id"],
                              payload={"question": question[:500],
                                       "confirmed": completion.confirmed})

        return {"question": question, "answer": completion.text,
                "confirmed": completion.confirmed, "model": completion.model,
                "offline": self.rt.config.offline, "system_view": view}
