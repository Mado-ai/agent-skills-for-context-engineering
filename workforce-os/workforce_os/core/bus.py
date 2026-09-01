"""Scheduler and event bus abstractions.

Both are interfaces first and in-process implementations second, so a distributed
queue can replace them without touching orchestration. Events are durable (they go
through the audit log); subscriptions are in-process and best-effort — a subscriber
that raises never breaks the publisher.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Callable

from ..errors import NotFoundError, ValidationError
from ..schemas import canonical_json, new_id, require, utcnow


class EventBus:
    """Publish/subscribe over the durable audit log.

    Publishing always persists. Delivery to in-process subscribers is a convenience on
    top; the log, not the subscriber, is the source of truth.
    """

    def __init__(self, events):
        self.events = events
        self._subscribers: dict[str, list[Callable]] = {}

    def subscribe(self, event_type: str, handler: Callable[[dict], None]) -> Callable[[], None]:
        self._subscribers.setdefault(event_type, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._subscribers.get(event_type, [])
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    def publish(self, event_type: str, *, actor_type: str, actor_id: str,
                project_id: str | None = None, payload: dict | None = None) -> dict:
        event = self.events.append(event_type, actor_type=actor_type, actor_id=actor_id,
                                   project_id=project_id, payload=payload or {})
        errors = []
        for handler in list(self._subscribers.get(event_type, [])) + list(self._subscribers.get("*", [])):
            try:
                handler(event)
            except Exception as exc:  # a bad subscriber must not break the publisher
                errors.append(str(exc)[:200])
        if errors:
            event = {**event, "subscriber_errors": errors}
        return event


class Scheduler:
    """Durable job queue with exactly-once claiming.

    `claim_due` uses a conditional UPDATE, so two workers racing for the same job can
    never both win it.
    """

    def __init__(self, db, bus):
        self.db = db
        self.bus = bus

    def schedule(self, *, kind: str, run_at: str | None = None, delay_seconds: int = 0,
                 payload: dict | None = None, project_id: str | None = None) -> dict:
        require(isinstance(kind, str) and kind.strip(), "kind must be a non-empty string", "kind")
        if run_at is None:
            run_at = (datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)).isoformat()
        else:
            try:
                datetime.fromisoformat(run_at)
            except ValueError as exc:
                raise ValidationError("run_at must be an ISO-8601 timestamp",
                                      details={"field": "run_at"}) from exc

        job = {"id": new_id("job"), "project_id": project_id, "kind": kind, "run_at": run_at,
               "payload": canonical_json(payload or {}), "status": "pending", "attempts": 0,
               "claimed_at": None, "claimed_by": None, "last_error": None,
               "created_at": utcnow()}
        self.db.execute(
            """INSERT INTO scheduler_jobs (id, project_id, kind, run_at, payload, status,
                   attempts, claimed_at, claimed_by, last_error, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(job[k] for k in ("id", "project_id", "kind", "run_at", "payload", "status",
                                   "attempts", "claimed_at", "claimed_by", "last_error",
                                   "created_at")))
        return self.get(job["id"])

    def claim_due(self, *, worker_id: str, limit: int = 10, now: str | None = None) -> list[dict]:
        """Claim jobs whose time has come. Each job is claimed by exactly one worker."""
        now = now or utcnow()
        candidates = self.db.query(
            "SELECT id FROM scheduler_jobs WHERE status = 'pending' AND run_at <= ? "
            "ORDER BY run_at LIMIT ?", (now, min(limit, 100)))

        claimed = []
        for row in candidates:
            cursor = self.db.execute(
                """UPDATE scheduler_jobs SET status = 'claimed', claimed_at = ?, claimed_by = ?,
                       attempts = attempts + 1 WHERE id = ? AND status = 'pending'""",
                (now, worker_id, row["id"]))
            if cursor.rowcount == 1:
                claimed.append(self.get(row["id"]))
        return claimed

    def complete(self, job_id: str, *, error: str | None = None) -> dict:
        job = self.get(job_id)
        status = "failed" if error else "done"
        self.db.execute("UPDATE scheduler_jobs SET status = ?, last_error = ? WHERE id = ?",
                        (status, (error or "")[:500] or None, job_id))
        self.bus.publish(f"job.{status}", actor_type="system", actor_id="scheduler",
                         project_id=job["project_id"],
                         payload={"job_id": job_id, "kind": job["kind"]})
        return self.get(job_id)

    def get(self, job_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM scheduler_jobs WHERE id = ?", (job_id,))
        if not row:
            raise NotFoundError(f"Job {job_id} not found")
        return {**row, "payload": json.loads(row["payload"])}

    def pending(self, *, project_id: str | None = None, limit: int = 100) -> list[dict]:
        sql, params = "SELECT * FROM scheduler_jobs WHERE status = 'pending'", []
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        params.append(min(limit, 500))
        return self.db.query(sql + " ORDER BY run_at LIMIT ?", tuple(params))
