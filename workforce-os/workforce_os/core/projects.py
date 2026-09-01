"""Projects: the isolation boundary. Every governed object belongs to exactly one."""

from __future__ import annotations

from ..errors import NotFoundError, ValidationError
from ..schemas import new_id, require, utcnow, _NAME_RE


class ProjectRegistry:
    def __init__(self, db, events):
        self.db = db
        self.events = events

    def create(self, name: str, description: str = "", *, actor_id: str = "owner") -> dict:
        name = (name or "").strip()
        require(bool(_NAME_RE.match(name)), "project name must be 2-64 valid characters", "name")
        if self.db.query_one("SELECT id FROM projects WHERE name = ?", (name,)):
            raise ValidationError(f"Project {name!r} already exists", details={"field": "name"})
        project = {"id": new_id("prj"), "name": name, "description": description or "",
                   "status": "active", "created_at": utcnow()}
        self.db.execute(
            "INSERT INTO projects (id, name, description, status, created_at) VALUES (?,?,?,?,?)",
            (project["id"], project["name"], project["description"], project["status"], project["created_at"]),
        )
        self.events.append("project.created", actor_type="owner", actor_id=actor_id,
                           project_id=project["id"], payload={"name": name})
        return project

    def get(self, project_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM projects WHERE id = ?", (project_id,))
        if not row:
            raise NotFoundError(f"Project {project_id} not found")
        return row

    def list(self) -> list[dict]:
        return self.db.query("SELECT * FROM projects ORDER BY created_at DESC")
