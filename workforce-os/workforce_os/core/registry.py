"""Agent registry: versioned contracts, the Agent Builder, and lifecycle control.

Contracts are append-only. Editing an agent writes a new version; the agent row simply
points at whichever version is active, so rollback is a pointer move and every prior
version stays readable and verifiable.
"""

from __future__ import annotations

import json

from ..errors import IntegrityError, LifecycleError, NotFoundError, ValidationError
from ..schemas import (
    AgentContract, Budget, CHIEF_ARCHITECT_ROLE, Scope, canonical_json, new_id,
    utcnow, validate_contract_input,
)

# draft → active ⇄ paused → retired. Retired is terminal.
_ALLOWED_TRANSITIONS = {
    "draft": {"active", "retired"},
    "active": {"paused", "retired"},
    "paused": {"active", "retired"},
    "retired": set(),
}


class AgentRegistry:
    def __init__(self, db, events, config):
        self.db = db
        self.events = events
        self.config = config

    # ------------------------------------------------------------------ building

    def build(self, project_id: str, spec: dict, *, actor_id: str,
              parent_agent_id: str | None = None) -> dict:
        """Agent Builder: validate a spec into version 1 of a contract, in `draft`."""
        if not self.db.query_one("SELECT id FROM projects WHERE id = ?", (project_id,)):
            raise NotFoundError(f"Project {project_id} not found")

        agent_id = new_id("agt")
        contract = validate_contract_input(
            spec, project_id=project_id, agent_id=agent_id, version=1,
            created_by=actor_id, max_depth_cap=self.config.max_delegation_depth,
        )

        if self.db.query_one("SELECT id FROM agents WHERE project_id = ? AND name = ?",
                             (project_id, contract.name)):
            raise ValidationError(
                f"An agent named {contract.name!r} already exists in this project",
                details={"field": "name"},
            )
        if parent_agent_id and not self.db.query_one("SELECT id FROM agents WHERE id = ?", (parent_agent_id,)):
            raise NotFoundError(f"Parent agent {parent_agent_id} not found")

        with self.db.transaction():
            now = utcnow()
            self.db.connection.execute(
                """INSERT INTO agents (id, project_id, name, role, level, status, active_version,
                                       parent_agent_id, template_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,'draft',NULL,?,?,?,?)""",
                (agent_id, project_id, contract.name, contract.role, contract.level,
                 parent_agent_id, contract.template_id, now, now),
            )
            self._insert_contract(contract)
            self.db.connection.execute(
                "UPDATE agents SET active_version = 1, updated_at = ? WHERE id = ?", (now, agent_id))

        self.events.append("agent.built", actor_type="agent", actor_id=actor_id,
                           project_id=project_id,
                           payload={"agent_id": agent_id, "name": contract.name,
                                    "role": contract.role, "level": contract.level,
                                    "checksum": contract.checksum})
        return self.get(agent_id)

    def revise(self, agent_id: str, spec: dict, *, actor_id: str) -> dict:
        """Write a new contract version. The previous version remains readable."""
        agent = self.get(agent_id)
        if agent["status"] == "retired":
            raise LifecycleError("A retired agent cannot be revised")

        next_version = self.db.query_one(
            "SELECT MAX(version) AS v FROM agent_contracts WHERE agent_id = ?", (agent_id,))["v"] + 1
        contract = validate_contract_input(
            spec, project_id=agent["project_id"], agent_id=agent_id, version=next_version,
            created_by=actor_id, max_depth_cap=self.config.max_delegation_depth,
        )
        if contract.role == CHIEF_ARCHITECT_ROLE and agent["role"] != CHIEF_ARCHITECT_ROLE:
            self._assert_no_other_active_chief(exclude_agent_id=agent_id)

        with self.db.transaction():
            self._insert_contract(contract)
            self.db.connection.execute(
                "UPDATE agents SET active_version = ?, name = ?, role = ?, level = ?, updated_at = ? WHERE id = ?",
                (next_version, contract.name, contract.role, contract.level, utcnow(), agent_id),
            )
        self.events.append("agent.revised", actor_type="agent", actor_id=actor_id,
                           project_id=agent["project_id"],
                           payload={"agent_id": agent_id, "version": next_version,
                                    "checksum": contract.checksum})
        return self.get(agent_id)

    def rollback(self, agent_id: str, version: int, *, actor_id: str) -> dict:
        """Re-point an agent at an earlier contract version."""
        agent = self.get(agent_id)
        contract = self.get_contract(agent_id, version)  # verifies checksum
        if agent["status"] == "retired":
            raise LifecycleError("A retired agent cannot be rolled back")
        self.db.execute(
            "UPDATE agents SET active_version = ?, name = ?, role = ?, level = ?, updated_at = ? WHERE id = ?",
            (version, contract.name, contract.role, contract.level, utcnow(), agent_id),
        )
        self.events.append("agent.rolled_back", actor_type="owner", actor_id=actor_id,
                           project_id=agent["project_id"],
                           payload={"agent_id": agent_id, "to_version": version})
        return self.get(agent_id)

    def _insert_contract(self, c: AgentContract) -> None:
        self.db.connection.execute(
            """INSERT INTO agent_contracts (id, agent_id, version, project_id, name, role, level,
                   system_prompt, allowed_tools, data_domains, action_types, budget,
                   provider_model, max_delegation_depth, template_id, checksum, created_at, created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (c.id, c.agent_id, c.version, c.project_id, c.name, c.role, c.level, c.system_prompt,
             canonical_json(list(c.scope.allowed_tools)), canonical_json(list(c.scope.data_domains)),
             canonical_json(list(c.scope.action_types)), canonical_json(c.budget.to_dict()),
             c.provider_model, c.max_delegation_depth, c.template_id, c.checksum,
             c.created_at, c.created_by),
        )

    # ----------------------------------------------------------------- lifecycle

    def set_status(self, agent_id: str, new_status: str, *, actor_id: str,
                   actor_type: str = "owner") -> dict:
        agent = self.get(agent_id)
        current = agent["status"]
        if new_status not in _ALLOWED_TRANSITIONS:
            raise ValidationError(f"Unknown status {new_status!r}", details={"field": "status"})
        if new_status not in _ALLOWED_TRANSITIONS[current]:
            raise LifecycleError(
                f"Cannot move agent from {current!r} to {new_status!r}",
                details={"from": current, "to": new_status,
                         "allowed": sorted(_ALLOWED_TRANSITIONS[current])},
            )
        if new_status == "active" and agent["role"] == CHIEF_ARCHITECT_ROLE:
            self._assert_no_other_active_chief(exclude_agent_id=agent_id)

        now = utcnow()
        if new_status == "retired":
            self.db.execute("UPDATE agents SET status = ?, updated_at = ?, retired_at = ? WHERE id = ?",
                            (new_status, now, now, agent_id))
        else:
            self.db.execute("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?",
                            (new_status, now, agent_id))
        self.events.append(f"agent.{new_status}", actor_type=actor_type, actor_id=actor_id,
                           project_id=agent["project_id"],
                           payload={"agent_id": agent_id, "from": current, "to": new_status})
        return self.get(agent_id)

    def _assert_no_other_active_chief(self, *, exclude_agent_id: str | None = None) -> None:
        """The Owner's single primary AI interface: at most one active chief architect."""
        sql = "SELECT id FROM agents WHERE role = ? AND status = 'active'"
        params = [CHIEF_ARCHITECT_ROLE]
        if exclude_agent_id:
            sql += " AND id != ?"
            params.append(exclude_agent_id)
        existing = self.db.query_one(sql, tuple(params))
        if existing:
            raise LifecycleError(
                "An active Chief Agent Architect already exists; pause or retire it first",
                details={"existing_agent_id": existing["id"]},
            )

    # -------------------------------------------------------------------- reads

    def get(self, agent_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM agents WHERE id = ?", (agent_id,))
        if not row:
            raise NotFoundError(f"Agent {agent_id} not found")
        return row

    def get_contract(self, agent_id: str, version: int | None = None) -> AgentContract:
        """Load a contract and verify its checksum before returning it."""
        if version is None:
            agent = self.get(agent_id)
            version = agent["active_version"]
            if version is None:
                raise NotFoundError(f"Agent {agent_id} has no active contract version")
        row = self.db.query_one(
            "SELECT * FROM agent_contracts WHERE agent_id = ? AND version = ?", (agent_id, version))
        if not row:
            raise NotFoundError(f"Contract version {version} for agent {agent_id} not found")

        contract = AgentContract(
            id=row["id"], agent_id=row["agent_id"], version=row["version"], project_id=row["project_id"],
            name=row["name"], role=row["role"], level=row["level"], system_prompt=row["system_prompt"],
            scope=Scope(tuple(json.loads(row["allowed_tools"])), tuple(json.loads(row["data_domains"])),
                        tuple(json.loads(row["action_types"]))),
            budget=Budget.parse(json.loads(row["budget"])), provider_model=row["provider_model"],
            max_delegation_depth=row["max_delegation_depth"], template_id=row["template_id"],
            created_at=row["created_at"], created_by=row["created_by"], checksum=row["checksum"],
        )
        if contract.compute_checksum() != row["checksum"]:
            raise IntegrityError(
                f"Contract {row['id']} failed checksum verification — the row has been tampered with",
                details={"agent_id": agent_id, "version": version},
            )
        return contract

    def contract_versions(self, agent_id: str) -> list[dict]:
        return self.db.query(
            """SELECT version, checksum, created_at, created_by, name, role, level
               FROM agent_contracts WHERE agent_id = ? ORDER BY version ASC""", (agent_id,))

    def list(self, *, project_id: str | None = None, status: str | None = None) -> list[dict]:
        sql, params = "SELECT * FROM agents WHERE 1=1", []
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        return self.db.query(sql + " ORDER BY created_at DESC", tuple(params))

    def children_of(self, agent_id: str) -> list[dict]:
        return self.db.query("SELECT * FROM agents WHERE parent_agent_id = ?", (agent_id,))
