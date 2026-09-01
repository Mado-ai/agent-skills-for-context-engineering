"""Layered memory.

The mandate's instruction — "never blindly place all information into one vector
database" — is the design constraint. Different knowledge has different
retention, trust, scope and deletion rules, and flattening it into one store
loses exactly the distinctions that matter operationally.

Six layers:

===============  ========  ================  ==============  ====================
Layer            Scope     Default TTL       Default trust   Written by
===============  ========  ================  ==============  ====================
working          task      1 hour            unverified      any agent, freely
episodic         agent     30 days           derived         runtime, on completion
project          project   none              derived         agents with grant
authoritative    project   none              authoritative   OWNER ONLY (gated)
agent            template  90 days           derived         the agent itself
shared_org       global    none              verified+        OWNER ONLY (gated)
===============  ========  ================  ==============  ====================

The property that carries the most weight: **authoritative knowledge is
distinguishable from unverified generated information, and an agent cannot
promote its own output into it.** Writing ``authoritative`` or ``shared_org``
requires an owner-gated capability, so a model that becomes confidently wrong
cannot launder that into the fleet's ground truth.

Retrieval is exact/substring over an indexed key, not vector search. That is a
deliberate v0.4 scope decision (ADR-0006): a vector index is a swap behind
``search()``, and building the governance correctly matters more than building
retrieval cleverly. What is *not* deferred is the metadata every record carries,
because retrofitting provenance onto an existing corpus is far harder than
recording it from the start.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from af.clock import Clock, SystemClock
from af.errors import IsolationViolation, PermissionDenied, ValidationError
from af.governance.permissions import PermissionEngine, Principal, PrincipalKind
from af.ids import new_id
from af.store.sqlite_store import SqliteStore, dumps, loads
from af.telemetry.events import Event, EventType, Telemetry

__all__ = ["Layer", "Trust", "MemoryRecord", "MemoryStore", "LAYER_POLICY"]


class Layer(str, Enum):
    WORKING = "working"
    EPISODIC = "episodic"
    PROJECT = "project"
    AUTHORITATIVE = "authoritative"
    AGENT = "agent"
    SHARED_ORG = "shared_org"


class Trust(str, Enum):
    """Ordered. ``rank`` lets a contract demand a floor when retrieving."""

    AUTHORITATIVE = "authoritative"  # owner-approved ground truth
    VERIFIED = "verified"            # passed a quality gate / human-checked
    DERIVED = "derived"              # produced by a completed, gated execution
    UNVERIFIED = "unverified"        # raw model output; assume nothing

    @property
    def rank(self) -> int:
        return {"authoritative": 3, "verified": 2, "derived": 1, "unverified": 0}[self.value]


@dataclass(frozen=True, slots=True)
class LayerPolicy:
    default_ttl_seconds: float | None
    default_trust: Trust
    #: Owner-gated write. The capability required is checked in addition to the
    #: contract's own writable_layers list — both must allow it.
    write_capability: str | None
    project_scoped: bool
    max_trust_writable_by_agent: Trust


LAYER_POLICY: dict[Layer, LayerPolicy] = {
    Layer.WORKING: LayerPolicy(3600.0, Trust.UNVERIFIED, None, True, Trust.DERIVED),
    Layer.EPISODIC: LayerPolicy(30 * 86400.0, Trust.DERIVED, None, True, Trust.DERIVED),
    Layer.PROJECT: LayerPolicy(None, Trust.DERIVED, None, True, Trust.VERIFIED),
    Layer.AUTHORITATIVE: LayerPolicy(
        None, Trust.AUTHORITATIVE, "memory.authoritative.write", True, Trust.AUTHORITATIVE),
    Layer.AGENT: LayerPolicy(90 * 86400.0, Trust.DERIVED, None, True, Trust.DERIVED),
    # The only layer that is not project-scoped — that is its purpose, and why
    # writing it is owner-gated.
    Layer.SHARED_ORG: LayerPolicy(
        None, Trust.VERIFIED, "memory.shared_org.write", False, Trust.AUTHORITATIVE),
}


@dataclass(slots=True)
class MemoryRecord:
    id: str
    layer: Layer
    key: str
    content: str
    trust: Trust
    source: str
    project_id: str | None = None
    agent_id: str | None = None
    template_id: str | None = None
    task_id: str | None = None
    provenance: dict[str, Any] = field(default_factory=dict)
    version: int = 1
    supersedes: str | None = None
    tags: tuple[str, ...] = ()
    created_at: float = 0.0
    expires_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {f: getattr(self, f) for f in self.__slots__}
        d["layer"] = self.layer.value
        d["trust"] = self.trust.value
        d["tags"] = list(self.tags)
        return d


class MemoryStore:
    def __init__(self, store: SqliteStore, telemetry: Telemetry,
                 permissions: PermissionEngine, clock: Clock | None = None) -> None:
        self.store = store
        self.telemetry = telemetry
        self.permissions = permissions
        self.clock = clock or SystemClock()

    # -- write -------------------------------------------------------------
    def write(self, *, principal: Principal, layer: Layer, key: str, content: str,
              project_id: str | None = None, contract=None, trust: Trust | None = None,
              agent_id: str | None = None, template_id: str | None = None,
              task_id: str | None = None, provenance: dict[str, Any] | None = None,
              tags: tuple[str, ...] = (), ttl_seconds: float | None = None,
              supersedes: str | None = None) -> MemoryRecord:
        policy = LAYER_POLICY[layer]

        # 1. The contract must list the layer as writable.
        if contract is not None and layer.value not in contract.memory.writable_layers:
            raise PermissionDenied(
                f"contract does not permit writing to the '{layer.value}' layer",
                layer=layer.value, principal=principal.id)

        # 2. Governed layers additionally require an owner-gated capability.
        if policy.write_capability:
            self.permissions.check(principal, policy.write_capability, project_id=project_id)

        # 3. Project isolation.
        if policy.project_scoped:
            if not project_id:
                raise ValidationError(
                    f"layer '{layer.value}' is project-scoped and requires a project_id",
                    layer=layer.value)
            self.permissions.check_project(principal, project_id)

        # 4. Trust ceiling. An agent cannot self-declare its output as
        #    authoritative — the single most important rule in this module.
        requested = trust or policy.default_trust
        if principal.kind is PrincipalKind.AGENT and requested.rank > policy.max_trust_writable_by_agent.rank:
            self.telemetry.emit(Event(
                type=EventType.PERMISSION_DENIED, project_id=project_id, task_id=task_id,
                agent_id=principal.id, actor=principal.id, status="denied",
                error_code="permission_denied",
                payload={"reason": "attempted to write above its trust ceiling",
                         "layer": layer.value, "requested_trust": requested.value,
                         "ceiling": policy.max_trust_writable_by_agent.value}))
            raise PermissionDenied(
                f"an agent may not write '{requested.value}' trust into the "
                f"'{layer.value}' layer (ceiling: {policy.max_trust_writable_by_agent.value})",
                layer=layer.value, requested_trust=requested.value)

        now = self.clock.now()
        ttl = ttl_seconds if ttl_seconds is not None else policy.default_ttl_seconds
        version = 1
        if supersedes:
            # Versioning: superseding a record soft-deletes it and inherits its
            # version + 1, so history is preserved rather than overwritten.
            prev = self.store.one(
                "SELECT version FROM memory_records WHERE id = ?", (supersedes,))
            if prev:
                version = prev["version"] + 1
                self.store.execute(
                    "UPDATE memory_records SET deleted_at = ? WHERE id = ?", (now, supersedes))

        record = MemoryRecord(
            id=new_id("mem"), layer=layer, key=key, content=content, trust=requested,
            source=principal.id, project_id=project_id if policy.project_scoped else None,
            agent_id=agent_id or (principal.id if principal.kind is PrincipalKind.AGENT else None),
            template_id=template_id, task_id=task_id,
            provenance={**(provenance or {}),
                        "written_by": principal.id,
                        "principal_kind": principal.kind.value,
                        "written_at": now},
            version=version, supersedes=supersedes, tags=tags,
            created_at=now, expires_at=(now + ttl) if ttl else None)

        self.store.execute(
            """
            INSERT INTO memory_records (id, layer, project_id, agent_id, template_id, task_id,
                mkey, content, content_type, trust, source, provenance, version, supersedes,
                tags, created_at, expires_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (record.id, layer.value, record.project_id, record.agent_id, template_id, task_id,
             key, content, "text", requested.value, record.source, dumps(record.provenance),
             version, supersedes, dumps(list(tags)), now, record.expires_at))
        self.telemetry.emit(Event(
            type=EventType.MEMORY_WRITTEN, project_id=project_id, task_id=task_id,
            agent_id=record.agent_id, actor=principal.id,
            payload={"layer": layer.value, "key": key, "trust": requested.value,
                     "record_id": record.id, "bytes": len(content), "version": version}))
        return record

    # -- read ---------------------------------------------------------------
    def search(self, *, principal: Principal, query: str, layers: tuple[Layer, ...] | None = None,
               project_id: str | None = None, contract=None, limit: int = 20,
               min_trust: Trust | None = None, task_id: str | None = None) -> list[MemoryRecord]:
        """Retrieve, filtered by what this principal is allowed to see.

        The access filter is applied in SQL, not after fetching. Filtering in
        Python would mean the rows briefly existed in a process that was not
        entitled to them — a subtle leak that becomes a real one the first time
        someone logs the intermediate result.
        """
        allowed = self._readable_layers(contract, layers)
        if not allowed:
            return []

        # Project predicate: the principal's own scope, plus non-scoped layers.
        scope = principal.scope_projects()
        if principal.kind is PrincipalKind.OWNER or "project.cross_access" in principal.granted:
            project_clause, project_params = "", []
        elif scope:
            marks = ",".join("?" * len(scope))
            project_clause = f" AND (project_id IS NULL OR project_id IN ({marks}))"
            project_params = list(scope)
        else:
            project_clause, project_params = " AND project_id IS NULL", []

        if project_id:
            # Narrow further to the requested project, after verifying access.
            self.permissions.check_project(principal, project_id)
            project_clause += " AND (project_id = ? OR project_id IS NULL)"
            project_params.append(project_id)

        layer_marks = ",".join("?" * len(allowed))
        floor = min_trust or (Trust(contract.memory.min_trust_for_read) if contract else None)
        trust_clause, trust_params = "", []
        if floor is not None:
            permitted = [t.value for t in Trust if t.rank >= floor.rank]
            trust_clause = f" AND trust IN ({','.join('?' * len(permitted))})"
            trust_params = permitted

        now = self.clock.now()
        rows = self.store.all(
            f"""
            SELECT * FROM memory_records
             WHERE deleted_at IS NULL
               AND (expires_at IS NULL OR expires_at > ?)
               AND layer IN ({layer_marks})
               AND (mkey LIKE ? OR content LIKE ?)
               {project_clause}{trust_clause}
             ORDER BY CASE trust WHEN 'authoritative' THEN 0 WHEN 'verified' THEN 1
                                 WHEN 'derived' THEN 2 ELSE 3 END,
                      created_at DESC
             LIMIT ?
            """,
            [now] + [l.value for l in allowed] + [f"%{query}%", f"%{query}%"]
            + project_params + trust_params + [limit])

        self.telemetry.emit(Event(
            type=EventType.MEMORY_READ, project_id=project_id, task_id=task_id,
            agent_id=principal.id if principal.kind is PrincipalKind.AGENT else None,
            actor=principal.id,
            payload={"query": query[:100], "layers": [l.value for l in allowed],
                     "hits": len(rows), "min_trust": floor.value if floor else None}))
        return [_row_to_record(r) for r in rows]

    def get(self, record_id: str, *, principal: Principal) -> MemoryRecord | None:
        row = self.store.one(
            "SELECT * FROM memory_records WHERE id = ? AND deleted_at IS NULL", (record_id,))
        if row is None:
            return None
        if row["project_id"]:
            self.permissions.check_project(principal, row["project_id"])
        return _row_to_record(row)

    def _readable_layers(self, contract, requested) -> list[Layer]:
        if contract is None:
            allowed = set(Layer)
        else:
            allowed = {Layer(l) for l in contract.memory.readable_layers
                       if l in {x.value for x in Layer}}
            if not contract.knowledge.allow_org_shared:
                allowed.discard(Layer.SHARED_ORG)
        if requested:
            allowed &= set(requested)
        return sorted(allowed, key=lambda l: l.value)

    # -- lifecycle ---------------------------------------------------------------
    def delete(self, record_id: str, *, principal: Principal, reason: str = "") -> bool:
        """Soft delete. The row is retained (with ``deleted_at`` set) so the
        audit trail can still show that a record existed and was removed — a
        hard delete would make deletion itself untraceable. Hard erasure for a
        data-subject request is a separate, owner-driven operation."""
        row = self.store.one("SELECT * FROM memory_records WHERE id = ?", (record_id,))
        if row is None:
            return False
        self.permissions.check(principal, "memory.delete", project_id=row["project_id"])
        return self.store.execute(
            "UPDATE memory_records SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
            (self.clock.now(), record_id)) > 0

    def sweep_expired(self, limit: int = 5000) -> int:
        """Retention enforcement. Working memory in particular must not
        accumulate — it is the highest-volume, lowest-value layer."""
        now = self.clock.now()
        with self.store.write() as c:
            cur = c.execute(
                "UPDATE memory_records SET deleted_at = ? "
                "WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < ? "
                "AND id IN (SELECT id FROM memory_records WHERE deleted_at IS NULL "
                "           AND expires_at IS NOT NULL AND expires_at < ? LIMIT ?) "
                "RETURNING id", (now, now, now, limit))
            return len(cur.fetchall())

    def stats(self, project_id: str | None = None) -> dict[str, Any]:
        where, params = ("AND project_id = ?", (project_id,)) if project_id else ("", ())
        by_layer = {r["layer"]: r["n"] for r in self.store.all(
            f"SELECT layer, count(*) AS n FROM memory_records "
            f"WHERE deleted_at IS NULL {where} GROUP BY layer", params)}
        by_trust = {r["trust"]: r["n"] for r in self.store.all(
            f"SELECT trust, count(*) AS n FROM memory_records "
            f"WHERE deleted_at IS NULL {where} GROUP BY trust", params)}
        return {"by_layer": by_layer, "by_trust": by_trust,
                "total": sum(by_layer.values()),
                "deleted": self.store.scalar(
                    f"SELECT count(*) FROM memory_records WHERE deleted_at IS NOT NULL {where}",
                    params) or 0}


def _row_to_record(r) -> MemoryRecord:
    return MemoryRecord(
        id=r["id"], layer=Layer(r["layer"]), key=r["mkey"], content=r["content"],
        trust=Trust(r["trust"]), source=r["source"], project_id=r["project_id"],
        agent_id=r["agent_id"], template_id=r["template_id"], task_id=r["task_id"],
        provenance=loads(r["provenance"]) or {}, version=r["version"],
        supersedes=r["supersedes"], tags=tuple(loads(r["tags"]) or []),
        created_at=r["created_at"], expires_at=r["expires_at"])
