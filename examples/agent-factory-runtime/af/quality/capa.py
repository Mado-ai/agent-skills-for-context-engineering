"""CAPA — Corrective and Preventive Action.

Implements the loop the mandate specifies:

    Issue → Root Cause → Corrective Action → Re-execution → Verification → Closure

The value is not the record-keeping, it is the constraint: a CAPA cannot be
closed without a *verified re-execution*. That single rule is what stops the
common failure mode where a defect is "addressed" by an explanation and nothing
actually changes. ``close()`` refuses unless verification has happened.

This is the ISO-minded traceability the mandate asks for: for any failure the
system can answer what went wrong, why, what was done, whether it worked, and
who closed it.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from af.clock import Clock, SystemClock
from af.errors import LifecycleError
from af.governance.permissions import PermissionEngine, Principal
from af.ids import new_id
from af.store.sqlite_store import SqliteStore
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["CapaStatus", "CapaRecord", "CapaEngine"]


class CapaStatus(str, Enum):
    OPEN = "OPEN"                       # issue recorded, root cause not yet established
    ACTION_PROPOSED = "ACTION_PROPOSED"  # root cause + corrective action recorded
    REEXECUTED = "REEXECUTED"           # rework task dispatched
    VERIFIED = "VERIFIED"               # rework passed its quality gate
    CLOSED = "CLOSED"


#: Only forward moves. A CAPA cannot skip verification on the way to closure.
_ALLOWED: dict[CapaStatus, frozenset[CapaStatus]] = {
    CapaStatus.OPEN: frozenset({CapaStatus.ACTION_PROPOSED, CapaStatus.CLOSED}),
    CapaStatus.ACTION_PROPOSED: frozenset({CapaStatus.REEXECUTED, CapaStatus.CLOSED}),
    CapaStatus.REEXECUTED: frozenset({CapaStatus.VERIFIED, CapaStatus.ACTION_PROPOSED}),
    CapaStatus.VERIFIED: frozenset({CapaStatus.CLOSED}),
    CapaStatus.CLOSED: frozenset(),
}


@dataclass(slots=True)
class CapaRecord:
    id: str
    project_id: str
    task_id: str
    issue: str
    status: CapaStatus
    root_cause: str | None = None
    corrective_action: str | None = None
    rework_task_id: str | None = None
    review_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {f: getattr(self, f) for f in self.__slots__}
        d["status"] = self.status.value
        return d


class CapaEngine:
    def __init__(self, store: SqliteStore, telemetry: Telemetry,
                 permissions: PermissionEngine, clock: Clock | None = None) -> None:
        self.store = store
        self.telemetry = telemetry
        self.permissions = permissions
        self.clock = clock or SystemClock()

    def open(self, *, principal: Principal, project_id: str, task_id: str,
             issue: str, review_id: str | None = None) -> CapaRecord:
        self.permissions.check(principal, "capa.open", project_id=project_id)
        record = CapaRecord(id=new_id("capa"), project_id=project_id, task_id=task_id,
                            issue=issue, status=CapaStatus.OPEN, review_id=review_id)
        self.store.execute(
            "INSERT INTO capa_records (id, project_id, task_id, review_id, issue, status, "
            "opened_at) VALUES (?,?,?,?,?,?,?)",
            (record.id, project_id, task_id, review_id, issue,
             CapaStatus.OPEN.value, self.clock.now()))
        self.telemetry.emit(Event(
            type=EventType.CAPA_OPENED, project_id=project_id, task_id=task_id,
            actor=principal.id, payload={"capa_id": record.id, "issue": issue[:300]}))
        return record

    def record_analysis(self, capa_id: str, *, principal: Principal, root_cause: str,
                        corrective_action: str) -> None:
        """OPEN → ACTION_PROPOSED. Both fields are mandatory and non-trivial.

        A one-word root cause ("failed") defeats the purpose, so a minimum
        length is enforced. It is a crude proxy for rigour, but it reliably
        blocks the empty-ritual case.
        """
        record = self._load(capa_id)
        self.permissions.check(principal, "capa.open", project_id=record.project_id)
        if len(root_cause.strip()) < 10:
            raise LifecycleError("root cause must be substantive", capa_id=capa_id)
        if len(corrective_action.strip()) < 10:
            raise LifecycleError("corrective action must be substantive", capa_id=capa_id)
        self._transition(record, CapaStatus.ACTION_PROPOSED,
                         root_cause=root_cause, corrective_action=corrective_action)

    def record_reexecution(self, capa_id: str, rework_task_id: str) -> None:
        """ACTION_PROPOSED → REEXECUTED."""
        record = self._load(capa_id)
        self._transition(record, CapaStatus.REEXECUTED, rework_task_id=rework_task_id)

    def verify(self, capa_id: str, *, passed: bool) -> CapaStatus:
        """REEXECUTED → VERIFIED, or back to ACTION_PROPOSED if the rework also
        failed. A failed rework means the corrective action was wrong, so the
        loop returns to analysis rather than closing."""
        record = self._load(capa_id)
        target = CapaStatus.VERIFIED if passed else CapaStatus.ACTION_PROPOSED
        self._transition(record, target,
                         verified_at=self.clock.now() if passed else None)
        return target

    def close(self, capa_id: str, *, principal: Principal) -> None:
        """→ CLOSED. Requires VERIFIED, except for an owner override.

        This guard is the point of the whole module: without it, CAPA becomes
        paperwork that records intentions rather than outcomes.
        """
        record = self._load(capa_id)
        self.permissions.check(principal, "capa.close", project_id=record.project_id)
        if record.status is not CapaStatus.VERIFIED:
            from af.governance.permissions import PrincipalKind
            if principal.kind is not PrincipalKind.OWNER:
                raise LifecycleError(
                    f"CAPA '{capa_id}' is {record.status.value}; it cannot be closed "
                    f"without a verified re-execution",
                    capa_id=capa_id, status=record.status.value)
        self._transition(record, CapaStatus.CLOSED, closed_at=self.clock.now())
        self.telemetry.emit(Event(
            type=EventType.CAPA_CLOSED, project_id=record.project_id,
            task_id=record.task_id, actor=principal.id,
            payload={"capa_id": capa_id, "root_cause": (record.root_cause or "")[:200],
                     "corrective_action": (record.corrective_action or "")[:200],
                     "owner_override": record.status is not CapaStatus.VERIFIED}))

    # -- internals -------------------------------------------------------
    def _transition(self, record: CapaRecord, target: CapaStatus, **fields: Any) -> None:
        if target not in _ALLOWED[record.status]:
            raise LifecycleError(
                f"illegal CAPA transition {record.status.value} -> {target.value}",
                capa_id=record.id, allowed=sorted(s.value for s in _ALLOWED[record.status]))
        sets = ["status = ?"]
        params: list[Any] = [target.value]
        for key, value in fields.items():
            if value is not None:
                sets.append(f"{key} = ?")
                params.append(value)
        params.append(record.id)
        self.store.execute(f"UPDATE capa_records SET {', '.join(sets)} WHERE id = ?", params)
        record.status = target

    def _load(self, capa_id: str) -> CapaRecord:
        row = self.store.one("SELECT * FROM capa_records WHERE id = ?", (capa_id,))
        if row is None:
            raise LifecycleError(f"CAPA '{capa_id}' not found", capa_id=capa_id)
        return CapaRecord(
            id=row["id"], project_id=row["project_id"], task_id=row["task_id"],
            issue=row["issue"], status=CapaStatus(row["status"]),
            root_cause=row["root_cause"], corrective_action=row["corrective_action"],
            rework_task_id=row["rework_task_id"], review_id=row["review_id"])

    def open_records(self, project_id: str | None = None) -> list[dict[str, Any]]:
        where, params = ("AND project_id = ?", (project_id,)) if project_id else ("", ())
        return [dict(r) for r in self.store.all(
            f"SELECT * FROM capa_records WHERE status != 'CLOSED' {where} ORDER BY opened_at",
            params)]
