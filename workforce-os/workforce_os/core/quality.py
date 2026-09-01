"""Quality control as part of execution, not an afterthought.

A deliverable is scored against the task's criteria by a designated evaluator agent.
A failing verdict opens a linked rework task automatically. Repeated failure past the
configured threshold opens a CAPA record (Corrective And Preventive Action) demanding a
root cause — and while that CAPA is open the task cannot be completed.
"""

from __future__ import annotations

import json

from ..errors import NotFoundError, PolicyDenied, ValidationError
from ..policy.authority import Principal, require_owner
from ..schemas import canonical_json, new_id, require, utcnow

DEFAULT_PASS_THRESHOLD = 0.7


class QualityService:
    def __init__(self, db, events, registry, tasks, config):
        self.db = db
        self.events = events
        self.registry = registry
        self.tasks = tasks
        self.config = config

    # ---------------------------------------------------------------- evaluation

    def evaluate(self, task_id: str, *, evaluator_agent_id: str, score: float,
                 findings: list[dict] | None = None, threshold: float | None = None,
                 verdict: str | None = None) -> dict:
        """Score a task's deliverable. Opens rework and CAPA as the outcome requires."""
        task = self.tasks.get(task_id)
        evaluator = self.registry.get(evaluator_agent_id)

        if evaluator["project_id"] != task["project_id"]:
            raise PolicyDenied("An evaluator cannot score a task in another project",
                               code="project_isolation")
        if evaluator["status"] != "active":
            raise PolicyDenied(f"Evaluator is {evaluator['status']!r}, not active",
                               code="agent_not_active")
        # Quality control is independent: an agent may not sign off on its own work.
        if task["assignee_agent_id"] == evaluator_agent_id:
            raise PolicyDenied(
                "An agent cannot evaluate its own deliverable",
                code="self_evaluation_denied",
                details={"task_id": task_id, "agent_id": evaluator_agent_id})

        require(isinstance(score, (int, float)) and 0.0 <= score <= 1.0,
                "score must be between 0 and 1", "score")
        threshold = DEFAULT_PASS_THRESHOLD if threshold is None else threshold
        require(isinstance(threshold, (int, float)) and 0.0 <= threshold <= 1.0,
                "threshold must be between 0 and 1", "threshold")

        findings = findings or []
        require(isinstance(findings, list), "findings must be a list", "findings")

        if verdict is None:
            verdict = "pass" if score >= threshold else "fail"
        require(verdict in ("pass", "fail"), "verdict must be 'pass' or 'fail'", "verdict")

        evaluation = {"id": new_id("evl"), "project_id": task["project_id"], "task_id": task_id,
                      "evaluator_agent_id": evaluator_agent_id, "verdict": verdict,
                      "score": float(score), "threshold": float(threshold),
                      "criteria": task["criteria"], "findings": canonical_json(findings),
                      "created_at": utcnow()}
        self.db.execute(
            """INSERT INTO evaluations (id, project_id, task_id, evaluator_agent_id, verdict,
                   score, threshold, criteria, findings, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            tuple(evaluation[k] for k in ("id", "project_id", "task_id", "evaluator_agent_id",
                                          "verdict", "score", "threshold", "criteria",
                                          "findings", "created_at")))
        self.events.append("quality.evaluated", actor_type="agent", actor_id=evaluator_agent_id,
                           project_id=task["project_id"],
                           payload={"evaluation_id": evaluation["id"], "task_id": task_id,
                                    "verdict": verdict, "score": float(score)})

        outcome = {"evaluation": self.hydrate_evaluation(evaluation),
                   "rework_task": None, "capa": None}
        if verdict == "fail":
            outcome.update(self._handle_failure(task, evaluation, findings))
        return outcome

    def _handle_failure(self, task: dict, evaluation: dict, findings: list) -> dict:
        """Open the rework task, and a CAPA once failures pass the threshold."""
        rework_count = self.tasks.increment_rework(task["id"])
        result: dict = {"rework_task": None, "capa": None}

        capa = None
        if rework_count >= self.config.rework_threshold:
            capa = self._open_capa(
                task, rework_count,
                trigger_reason=(f"{rework_count} failed evaluations against the "
                                f"{self.config.rework_threshold}-failure threshold"))
            result["capa"] = capa

        rework_task = self.tasks.create(
            task["project_id"],
            {"title": f"Rework: {task['title']}"[:200],
             "description": ("Rework opened by evaluation "
                             f"{evaluation['id']} (score {evaluation['score']:.2f} "
                             f"below {evaluation['threshold']:.2f}). "
                             f"Findings: {json.dumps(findings)[:1000]}"),
             "assignee_agent_id": task["assignee_agent_id"],
             "budget": json.loads(task["budget"]),
             "criteria": json.loads(task["criteria"]),
             "priority": max(1, task["priority"] - 1)},
            actor_id=evaluation["evaluator_agent_id"],
            rework_of_task_id=task["id"])
        result["rework_task"] = rework_task

        # Move the original task into rework if it is in a state that allows it.
        if task["status"] == "review":
            self.tasks.set_status(task["id"], "rework",
                                  actor_id=evaluation["evaluator_agent_id"])

        self.events.append("quality.rework_opened", actor_type="agent",
                           actor_id=evaluation["evaluator_agent_id"], project_id=task["project_id"],
                           payload={"task_id": task["id"], "rework_task_id": rework_task["id"],
                                    "rework_count": rework_count,
                                    "capa_id": capa["id"] if capa else None})
        return result

    # ---------------------------------------------------------------------- CAPA

    def _open_capa(self, task: dict, rework_count: int, *, trigger_reason: str) -> dict:
        existing = self.db.query_one(
            "SELECT * FROM capa_records WHERE task_id = ? AND status = 'open'", (task["id"],))
        if existing:
            return existing

        capa = {"id": new_id("capa"), "project_id": task["project_id"], "task_id": task["id"],
                "status": "open", "trigger_reason": trigger_reason, "rework_count": rework_count,
                "root_cause": None, "corrective_action": None, "preventive_action": None,
                "opened_at": utcnow(), "closed_at": None, "closed_by": None}
        self.db.execute(
            """INSERT INTO capa_records (id, project_id, task_id, status, trigger_reason,
                   rework_count, root_cause, corrective_action, preventive_action,
                   opened_at, closed_at, closed_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(capa[k] for k in ("id", "project_id", "task_id", "status", "trigger_reason",
                                    "rework_count", "root_cause", "corrective_action",
                                    "preventive_action", "opened_at", "closed_at", "closed_by")))
        self.events.append("capa.opened", actor_type="system", actor_id="quality",
                           project_id=task["project_id"],
                           payload={"capa_id": capa["id"], "task_id": task["id"],
                                    "rework_count": rework_count})
        return capa

    def close_capa(self, capa_id: str, *, principal: Principal, root_cause: str,
                   corrective_action: str, preventive_action: str = "") -> dict:
        """Closing a CAPA is an Owner decision and demands a documented root cause."""
        require_owner(principal, "close_capa")

        capa = self.get_capa(capa_id)
        if capa["status"] != "open":
            raise ValidationError(f"CAPA {capa_id} is already {capa['status']}",
                                  details={"field": "status"})
        require(isinstance(root_cause, str) and len(root_cause.strip()) >= 10,
                "root_cause must be at least 10 characters", "root_cause")
        require(isinstance(corrective_action, str) and len(corrective_action.strip()) >= 10,
                "corrective_action must be at least 10 characters", "corrective_action")

        self.db.execute(
            """UPDATE capa_records SET status = 'closed', root_cause = ?, corrective_action = ?,
                   preventive_action = ?, closed_at = ?, closed_by = ? WHERE id = ?""",
            (root_cause.strip(), corrective_action.strip(), (preventive_action or "").strip(),
             utcnow(), principal.id, capa_id))
        self.events.append("capa.closed", actor_type="owner", actor_id=principal.id,
                           project_id=capa["project_id"],
                           payload={"capa_id": capa_id, "task_id": capa["task_id"]})
        return self.get_capa(capa_id)

    # --------------------------------------------------------------------- reads

    def get_capa(self, capa_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM capa_records WHERE id = ?", (capa_id,))
        if not row:
            raise NotFoundError(f"CAPA record {capa_id} not found")
        return row

    def open_capas(self, *, project_id: str | None = None) -> list[dict]:
        if project_id:
            return self.db.query(
                "SELECT * FROM capa_records WHERE status = 'open' AND project_id = ? ORDER BY opened_at",
                (project_id,))
        return self.db.query("SELECT * FROM capa_records WHERE status = 'open' ORDER BY opened_at")

    def evaluations_for(self, task_id: str) -> list[dict]:
        return [self.hydrate_evaluation(row) for row in self.db.query(
            "SELECT * FROM evaluations WHERE task_id = ? ORDER BY created_at DESC", (task_id,))]

    @staticmethod
    def hydrate_evaluation(row: dict) -> dict:
        out = dict(row)
        for key in ("criteria", "findings"):
            if isinstance(out.get(key), str):
                out[key] = json.loads(out[key])
        return out
