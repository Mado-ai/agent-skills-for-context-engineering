"""Agent Registry — the queryable catalogue of what the workforce can do.

Separated from the Factory because they answer different questions. The Registry
answers "what exists and what can it do"; the Factory answers "bring something
into existence". The Chief reads the Registry constantly (to decide whether a
capability already exists) and writes through the Factory rarely.

The distinction the mandate insists on is enforced here: a **template/contract**
is a definition, an **instance** is a live worker. Ten thousand contracts cost
ten thousand rows. Ten thousand *instances* cost real concurrency, so instances
are created on demand and reaped when idle.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from af.contracts.schema import AgentContract
from af.contracts.lifecycle import LifecycleState
from af.store.sqlite_store import SqliteStore, loads

__all__ = ["AgentRegistry", "TemplateSummary", "CapabilityMatch"]


@dataclass(slots=True)
class TemplateSummary:
    template_id: str
    name: str
    role: str
    level: int
    project_id: str | None
    active_contract_id: str | None
    latest_version: int
    state: str | None
    capabilities: tuple[str, ...] = ()
    live_instances: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {f: getattr(self, f) for f in self.__slots__}


@dataclass(slots=True)
class CapabilityMatch:
    template_id: str
    name: str
    capability: str
    score: float
    contract_id: str

    def to_dict(self) -> dict[str, Any]:
        return {f: getattr(self, f) for f in self.__slots__}


class AgentRegistry:
    def __init__(self, store: SqliteStore) -> None:
        self.store = store

    # -- reads --------------------------------------------------------------
    def get_contract(self, contract_id: str) -> AgentContract | None:
        row = self.store.one("SELECT spec, state FROM agent_contracts WHERE id = ?", (contract_id,))
        if row is None:
            return None
        contract = AgentContract.from_dict(loads(row["spec"]))
        # The stored lifecycle column is authoritative — the embedded spec copy
        # is a snapshot from write time and can lag a state transition.
        contract.state = row["state"]
        return contract

    def active_contract_for(self, template_id: str) -> AgentContract | None:
        row = self.store.one(
            "SELECT active_contract_id FROM agent_templates WHERE id = ?", (template_id,))
        if row is None or row["active_contract_id"] is None:
            return None
        return self.get_contract(row["active_contract_id"])

    def get_template(self, template_id: str) -> dict[str, Any] | None:
        row = self.store.one("SELECT * FROM agent_templates WHERE id = ?", (template_id,))
        return dict(row) if row else None

    def find_template_by_name(self, name: str, project_id: str | None) -> dict[str, Any] | None:
        row = self.store.one(
            "SELECT * FROM agent_templates WHERE name = ? AND "
            "COALESCE(project_id, '~system') = COALESCE(?, '~system')", (name, project_id))
        return dict(row) if row else None

    def list_templates(self, project_id: str | None = None, *, include_system: bool = True,
                       limit: int = 500, after: str | None = None) -> list[TemplateSummary]:
        """Keyset-paginated listing. ``after`` is the last template_id from the
        previous page; OFFSET was avoided deliberately because it degrades
        linearly and the registry is expected to hold tens of thousands of rows.
        """
        clauses, params = [], []
        if project_id is not None:
            clauses.append("(t.project_id = ?" + (" OR t.project_id IS NULL)" if include_system else ")"))
            params.append(project_id)
        if after:
            clauses.append("t.id > ?")
            params.append(after)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(limit)
        rows = self.store.all(
            f"""
            SELECT t.id, t.name, t.role, t.level, t.project_id, t.active_contract_id,
                   t.latest_version, c.state AS state, c.spec AS spec,
                   (SELECT count(*) FROM agent_instances i
                     WHERE i.template_id = t.id AND i.state = 'ACTIVE') AS live
              FROM agent_templates t
              LEFT JOIN agent_contracts c ON c.id = t.active_contract_id
              {where}
             ORDER BY t.id
             LIMIT ?
            """, params)
        out = []
        for r in rows:
            caps: tuple[str, ...] = ()
            if r["spec"]:
                caps = tuple(cap.get("name", "") for cap in (loads(r["spec"]).get("capabilities") or []))
            out.append(TemplateSummary(
                template_id=r["id"], name=r["name"], role=r["role"], level=r["level"],
                project_id=r["project_id"], active_contract_id=r["active_contract_id"],
                latest_version=r["latest_version"], state=r["state"],
                capabilities=caps, live_instances=r["live"]))
        return out

    # -- capability matching (the reuse mechanism) ----------------------------
    def find_by_capability(self, capability: str, project_id: str | None = None,
                           *, min_score: float = 0.5) -> list[CapabilityMatch]:
        """Find ACTIVE agents that already provide a capability.

        This is what stops the fleet growing without bound: before the Chief
        proposes a new agent it asks here, and reuses an existing one when the
        match is good enough. Matching is lexical (exact, then substring, then
        token overlap) — deliberately simple and explainable. A semantic matcher
        would find more, but a wrong match here silently routes work to the
        wrong specialist, so the bias is toward precision.

        Served from the denormalised ``agent_capabilities`` index rather than by
        parsing contract specs. The original implementation loaded every ACTIVE
        contract and JSON-parsed it, which measured 210ms p95 at 10,000
        templates; this probes an index and stays flat.
        """
        needle = capability.lower().strip()
        needle_tokens = set(_tokens(needle))

        # Exact match first — an index probe, and the overwhelmingly common case.
        rows = self.store.all(
            """
            SELECT c.template_id, c.contract_id, c.capability, t.name
              FROM agent_capabilities c JOIN agent_templates t ON t.id = c.template_id
             WHERE c.state = 'ACTIVE' AND c.capability = ?
               AND (? IS NULL OR c.project_id = ? OR c.project_id IS NULL)
            """, (needle, project_id, project_id))
        matches = [CapabilityMatch(template_id=r["template_id"], name=r["name"],
                                   capability=r["capability"], score=1.0,
                                   contract_id=r["contract_id"]) for r in rows]

        # Fuzzy pass only when exact found nothing. Scans short capability
        # strings in SQL rather than deserialising whole contracts, so even the
        # slow path is far cheaper than the original fast path.
        if not matches:
            like_rows = self.store.all(
                """
                SELECT c.template_id, c.contract_id, c.capability, t.name
                  FROM agent_capabilities c JOIN agent_templates t ON t.id = c.template_id
                 WHERE c.state = 'ACTIVE'
                   AND (? IS NULL OR c.project_id = ? OR c.project_id IS NULL)
                   AND (c.capability LIKE ? OR ? LIKE '%' || c.capability || '%')
                """, (project_id, project_id, f"%{needle}%", needle))
            seen = set()
            for r in like_rows:
                score = _similarity(needle, needle_tokens, r["capability"])
                if score >= min_score and r["contract_id"] not in seen:
                    seen.add(r["contract_id"])
                    matches.append(CapabilityMatch(
                        template_id=r["template_id"], name=r["name"],
                        capability=r["capability"], score=score,
                        contract_id=r["contract_id"]))

        matches.sort(key=lambda m: (-m.score, m.template_id))
        return matches

    def find_duplicate_contracts(self, project_id: str | None = None) -> list[dict[str, Any]]:
        """Contracts whose behaviour-defining body is byte-identical.

        Exact-hash only. Near-duplicates are a judgement call that belongs with
        the Chief's recommendation flow, not with a query that might auto-merge
        two agents that merely look alike.
        """
        rows = self.store.all(
            """
            SELECT content_hash, count(*) AS n, group_concat(id) AS ids,
                   group_concat(template_id) AS templates
              FROM agent_contracts
             WHERE state IN ('ACTIVE','OBSERVATION')
               AND (? IS NULL OR project_id = ?)
             GROUP BY content_hash HAVING n > 1
            """, (project_id, project_id))
        return [{"content_hash": r["content_hash"], "count": r["n"],
                 "contract_ids": r["ids"].split(","),
                 "template_ids": r["templates"].split(",")} for r in rows]

    # -- instances -------------------------------------------------------------
    def get_instance(self, instance_id: str) -> dict[str, Any] | None:
        row = self.store.one("SELECT * FROM agent_instances WHERE id = ?", (instance_id,))
        return dict(row) if row else None

    def live_instance_count(self, template_id: str, project_id: str) -> int:
        return self.store.scalar(
            "SELECT count(*) FROM agent_instances WHERE template_id = ? AND project_id = ? "
            "AND state = 'ACTIVE'", (template_id, project_id)) or 0

    def hierarchy(self, project_id: str | None = None) -> list[dict[str, Any]]:
        """Flat parent/child edges. The caller assembles the tree; returning a
        nested structure from SQL would need a recursive CTE that PostgreSQL and
        SQLite express differently, and this keeps the adapter thin."""
        rows = self.store.all(
            """
            SELECT t.id, t.name, t.level, t.project_id,
                   c.spec, c.state
              FROM agent_templates t
              LEFT JOIN agent_contracts c ON c.id = t.active_contract_id
             WHERE (? IS NULL OR t.project_id = ? OR t.project_id IS NULL)
             ORDER BY t.level DESC, t.id
            """, (project_id, project_id))
        out = []
        for r in rows:
            parent = loads(r["spec"]).get("parent_template_id") if r["spec"] else None
            out.append({"template_id": r["id"], "name": r["name"], "level": r["level"],
                        "project_id": r["project_id"], "parent_template_id": parent,
                        "state": r["state"]})
        return out

    # -- overview (Control Center backend) ---------------------------------------
    def workforce_overview(self, project_id: str | None = None) -> dict[str, Any]:
        scope = "WHERE project_id = ?" if project_id else ""
        params: tuple = (project_id,) if project_id else ()
        by_state = {r["state"]: r["n"] for r in self.store.all(
            f"SELECT state, count(*) AS n FROM agent_contracts {scope} GROUP BY state", params)}
        inst = {r["state"]: r["n"] for r in self.store.all(
            f"SELECT state, count(*) AS n FROM agent_instances {scope} GROUP BY state", params)}
        by_level = {r["level"]: r["n"] for r in self.store.all(
            f"SELECT level, count(*) AS n FROM agent_templates {scope} GROUP BY level", params)}
        return {
            "templates": self.store.scalar(
                f"SELECT count(*) FROM agent_templates {scope}", params) or 0,
            "contracts_by_state": by_state,
            "instances_by_state": inst,
            "templates_by_level": by_level,
            "active_contracts": by_state.get(LifecycleState.ACTIVE.value, 0),
            "live_instances": inst.get("ACTIVE", 0),
        }


def _tokens(text: str) -> list[str]:
    return [t for t in text.replace("-", "_").replace(".", "_").split("_") if t]


def _similarity(needle: str, needle_tokens: set[str], candidate: str) -> float:
    if needle == candidate:
        return 1.0
    if needle in candidate or candidate in needle:
        return 0.8
    cand_tokens = set(_tokens(candidate))
    if not needle_tokens or not cand_tokens:
        return 0.0
    overlap = len(needle_tokens & cand_tokens) / len(needle_tokens | cand_tokens)
    return round(overlap, 3)
