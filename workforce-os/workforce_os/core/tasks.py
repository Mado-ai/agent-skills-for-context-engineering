"""Task lifecycle. A task is the unit of work, scoped to a project and a budget."""

from __future__ import annotations

import json

from ..errors import LifecycleError, NotFoundError, PolicyDenied, ValidationError
from ..schemas import Budget, TASK_STATUSES, canonical_json, new_id, require, utcnow

_ALLOWED_TRANSITIONS = {
    "open": {"in_progress", "blocked", "cancelled"},
    "in_progress": {"review", "blocked", "cancelled"},
    "blocked": {"in_progress", "cancelled"},
    "review": {"completed", "rework", "cancelled"},
    "rework": {"in_progress", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


class TaskService:
    def __init__(self, db, events, registry, config):
        self.db = db
        self.events = events
        self.registry = registry
        self.config = config

    def create(self, project_id: str, data: dict, *, actor_id: str,
               parent_task_id: str | None = None, rework_of_task_id: str | None = None) -> dict:
        title = (data.get("title") or "").strip()
        require(2 <= len(title) <= 200, "title must be 2-200 characters", "title")
        description = (data.get("description") or "").strip()

        criteria = data.get("criteria") or []
        require(isinstance(criteria, list), "criteria must be a list", "criteria")
        for item in criteria:
            require(isinstance(item, str) and item.strip(), "criteria entries must be non-empty strings", "criteria")

        priority = data.get("priority", 3)
        require(isinstance(priority, int) and 1 <= priority <= 5, "priority must be 1-5", "priority")

        budget = Budget.parse(data.get("budget") or {"max_usd": self.config.default_task_budget_usd})

        assignee = data.get("assignee_agent_id")
        depth = 0
        if parent_task_id:
            parent = self.get(parent_task_id)
            if parent["project_id"] != project_id:
                raise PolicyDenied("A subtask must belong to its parent's project",
                                   code="project_isolation")
            depth = parent["depth"] + 1

        if assignee:
            agent = self.registry.get(assignee)
            if agent["project_id"] != project_id:
                raise PolicyDenied("Cannot assign a task to an agent in another project",
                                   code="project_isolation")
            if agent["status"] != "active":
                raise ValidationError(f"Agent {assignee} is {agent['status']!r}, not active",
                                      details={"field": "assignee_agent_id"})

        now = utcnow()
        task = {"id": new_id("tsk"), "project_id": project_id, "title": title,
                "description": description, "assignee_agent_id": assignee, "created_by": actor_id,
                "status": "open", "priority": priority, "budget": canonical_json(budget.to_dict()),
                "criteria": canonical_json(criteria), "result": None,
                "parent_task_id": parent_task_id, "rework_of_task_id": rework_of_task_id,
                "rework_count": 0, "depth": depth, "created_at": now, "updated_at": now,
                "completed_at": None}
        self.db.execute(
            """INSERT INTO tasks (id, project_id, title, description, assignee_agent_id, created_by,
                   status, priority, budget, criteria, result, parent_task_id, rework_of_task_id,
                   rework_count, depth, created_at, updated_at, completed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(task[k] for k in ("id", "project_id", "title", "description", "assignee_agent_id",
                                    "created_by", "status", "priority", "budget", "criteria", "result",
                                    "parent_task_id", "rework_of_task_id", "rework_count", "depth",
                                    "created_at", "updated_at", "completed_at")))
        self.events.append("task.created", actor_type="agent", actor_id=actor_id,
                           project_id=project_id,
                           payload={"task_id": task["id"], "title": title, "assignee": assignee,
                                    "parent_task_id": parent_task_id})
        return self.get(task["id"])

    def set_status(self, task_id: str, new_status: str, *, actor_id: str,
                   result: dict | None = None) -> dict:
        task = self.get(task_id)
        require(new_status in TASK_STATUSES, f"status must be one of {TASK_STATUSES}", "status")
        if new_status not in _ALLOWED_TRANSITIONS[task["status"]]:
            raise LifecycleError(
                f"Cannot move task from {task['status']!r} to {new_status!r}",
                details={"from": task["status"], "to": new_status,
                         "allowed": sorted(_ALLOWED_TRANSITIONS[task["status"]])})

        # A task carrying an open CAPA cannot be closed until the CAPA is resolved.
        if new_status == "completed":
            open_capa = self.db.query_one(
                "SELECT id FROM capa_records WHERE task_id = ? AND status = 'open'", (task_id,))
            if open_capa:
                raise PolicyDenied(
                    "Task has an open CAPA record and cannot be completed",
                    code="open_capa_blocks_completion",
                    details={"capa_id": open_capa["id"]})

        now = utcnow()
        completed_at = now if new_status == "completed" else task["completed_at"]
        self.db.execute(
            "UPDATE tasks SET status = ?, updated_at = ?, completed_at = ?, result = COALESCE(?, result) WHERE id = ?",
            (new_status, now, completed_at, canonical_json(result) if result is not None else None, task_id))
        self.events.append(f"task.{new_status}", actor_type="agent", actor_id=actor_id,
                           project_id=task["project_id"],
                           payload={"task_id": task_id, "from": task["status"], "to": new_status})
        return self.get(task_id)

    def assign(self, task_id: str, agent_id: str, *, actor_id: str) -> dict:
        task = self.get(task_id)
        agent = self.registry.get(agent_id)
        if agent["project_id"] != task["project_id"]:
            raise PolicyDenied("Cannot assign across projects", code="project_isolation")
        if agent["status"] != "active":
            raise ValidationError(f"Agent {agent_id} is not active", details={"field": "agent_id"})
        self.db.execute("UPDATE tasks SET assignee_agent_id = ?, updated_at = ? WHERE id = ?",
                        (agent_id, utcnow(), task_id))
        self.events.append("task.assigned", actor_type="agent", actor_id=actor_id,
                           project_id=task["project_id"],
                           payload={"task_id": task_id, "agent_id": agent_id})
        return self.get(task_id)

    def increment_rework(self, task_id: str) -> int:
        self.db.execute("UPDATE tasks SET rework_count = rework_count + 1, updated_at = ? WHERE id = ?",
                        (utcnow(), task_id))
        return self.get(task_id)["rework_count"]

    def get(self, task_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
        if not row:
            raise NotFoundError(f"Task {task_id} not found")
        return row

    def hydrate(self, task: dict) -> dict:
        """Decode JSON columns for API responses."""
        out = dict(task)
        out["budget"] = json.loads(task["budget"])
        out["criteria"] = json.loads(task["criteria"])
        out["result"] = json.loads(task["result"]) if task["result"] else None
        return out

    def list(self, *, project_id: str | None = None, status: str | None = None,
             assignee_agent_id: str | None = None, limit: int = 100) -> list[dict]:
        sql, params = "SELECT * FROM tasks WHERE 1=1", []
        for column, value in (("project_id", project_id), ("status", status),
                              ("assignee_agent_id", assignee_agent_id)):
            if value:
                sql += f" AND {column} = ?"
                params.append(value)
        params.append(min(limit, 1000))
        return self.db.query(sql + " ORDER BY created_at DESC LIMIT ?", tuple(params))
