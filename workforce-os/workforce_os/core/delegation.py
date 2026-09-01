"""The parent/child delegation graph.

Four invariants, all enforced server-side before any edge is written:

  1. Same project        — delegation never crosses a project boundary.
  2. Downward only       — a parent may only delegate to a strictly lower level.
  3. Attenuation         — the child's effective scope is the intersection of parent
                           and requested scope, so authority can only ever shrink.
  4. Acyclic and bounded — no cycles, and depth is capped by the parent's contract.
"""

from __future__ import annotations

from ..errors import PolicyDenied, ValidationError
from ..policy.authority import can_delegate_to
from ..policy.scopes import attenuate
from ..schemas import Scope, new_id, utcnow


class DelegationService:
    def __init__(self, db, events, registry, tasks, packets, config):
        self.db = db
        self.events = events
        self.registry = registry
        self.tasks = tasks
        self.packets = packets
        self.config = config

    # ------------------------------------------------------------------- checks

    def effective_child_scope(self, parent_contract, requested: Scope) -> Scope:
        """The scope a child may hold, given what its parent holds and what was asked for."""
        return attenuate(parent_contract.scope, requested)

    def _assert_no_cycle(self, parent_agent_id: str, child_agent_id: str) -> None:
        """Refuse an edge that would make the delegation graph cyclic."""
        if parent_agent_id == child_agent_id:
            raise PolicyDenied("An agent cannot delegate to itself",
                               code="delegation_cycle",
                               details={"agent_id": parent_agent_id})

        # Walk everything reachable from the prospective child; reaching the parent
        # means this edge would close a loop.
        seen, frontier = set(), [child_agent_id]
        while frontier:
            current = frontier.pop()
            if current in seen:
                continue
            seen.add(current)
            for row in self.db.query(
                    "SELECT DISTINCT child_agent_id FROM delegations WHERE parent_agent_id = ?", (current,)):
                nxt = row["child_agent_id"]
                if nxt == parent_agent_id:
                    raise PolicyDenied(
                        "Delegation would create a cycle in the delegation graph",
                        code="delegation_cycle",
                        details={"parent_agent_id": parent_agent_id, "child_agent_id": child_agent_id})
                frontier.append(nxt)

    def _current_depth(self, parent_task_id: str) -> int:
        return self.tasks.get(parent_task_id)["depth"]

    def _effective_depth_cap(self, parent_agent_id: str, parent_task_id: str) -> tuple[int, str]:
        """The tightest depth cap binding this chain.

        A cap set on a senior agent must bind everything below it, otherwise a junior
        could escape its lead's limit simply by delegating onward. So the effective cap
        is the minimum over the global config, the delegating agent's contract, and the
        contracts of every ancestor that delegated into this chain.
        """
        cap, binding = self.config.max_delegation_depth, "config"
        try:
            own = self.registry.get_contract(parent_agent_id).max_delegation_depth
        except Exception:  # pragma: no cover - contract always exists for an active agent
            own = cap
        if own < cap:
            cap, binding = own, parent_agent_id

        # Walk the task ancestry, tightening the cap at every ancestor delegator.
        seen, current = set(), parent_task_id
        while current and current not in seen:
            seen.add(current)
            edge = self.db.query_one(
                "SELECT parent_agent_id, parent_task_id FROM delegations WHERE child_task_id = ?",
                (current,))
            if not edge:
                break
            ancestor_cap = self.registry.get_contract(edge["parent_agent_id"]).max_delegation_depth
            if ancestor_cap < cap:
                cap, binding = ancestor_cap, edge["parent_agent_id"]
            current = edge["parent_task_id"]
        return cap, binding

    # ----------------------------------------------------------------- delegate

    def delegate(self, *, parent_agent_id: str, child_agent_id: str, parent_task_id: str,
                 packet_kind: str, packet_payload: dict, packet_schema_version: int = 1,
                 subtask: dict | None = None, actor_id: str | None = None) -> dict:
        """Create a child task, hand over a typed packet, and record the graph edge."""
        actor_id = actor_id or parent_agent_id
        parent_agent = self.registry.get(parent_agent_id)
        child_agent = self.registry.get(child_agent_id)
        parent_task = self.tasks.get(parent_task_id)

        # 1. project isolation
        projects = {parent_agent["project_id"], child_agent["project_id"], parent_task["project_id"]}
        if len(projects) != 1:
            raise PolicyDenied(
                "Delegation across projects is denied",
                code="project_isolation",
                details={"parent_project": parent_agent["project_id"],
                         "child_project": child_agent["project_id"]})
        project_id = parent_agent["project_id"]

        if parent_agent["status"] != "active":
            raise PolicyDenied(f"Delegating agent is {parent_agent['status']!r}, not active",
                               code="agent_not_active")
        if child_agent["status"] != "active":
            raise PolicyDenied(f"Receiving agent is {child_agent['status']!r}, not active",
                               code="agent_not_active")

        # 2. downward only
        if not can_delegate_to(parent_agent["level"], child_agent["level"]):
            raise PolicyDenied(
                f"An L{parent_agent['level']} agent may not delegate to an L{child_agent['level']} agent",
                code="delegation_upward_denied",
                details={"parent_level": parent_agent["level"], "child_level": child_agent["level"]})

        # 3. attenuation — the child must already hold no more than its parent
        parent_contract = self.registry.get_contract(parent_agent_id)
        child_contract = self.registry.get_contract(child_agent_id)
        if not child_contract.scope.is_subset_of(parent_contract.scope):
            excess = {
                "tools": sorted(set(child_contract.scope.allowed_tools) - set(parent_contract.scope.allowed_tools)),
                "data_domains": sorted(set(child_contract.scope.data_domains) - set(parent_contract.scope.data_domains)),
                "action_types": sorted(set(child_contract.scope.action_types) - set(parent_contract.scope.action_types)),
            }
            raise PolicyDenied(
                "Child scope exceeds the delegating agent's scope",
                code="scope_escalation_denied",
                details={"excess": {k: v for k, v in excess.items() if v}})

        # 4. depth and acyclicity
        depth = self._current_depth(parent_task_id) + 1
        cap, binding_agent = self._effective_depth_cap(parent_agent_id, parent_task_id)
        if depth > cap:
            raise PolicyDenied(
                f"Delegation depth {depth} exceeds the cap of {cap}",
                code="delegation_depth_exceeded",
                details={"depth": depth, "cap": cap, "bound_by": binding_agent})
        self._assert_no_cycle(parent_agent_id, child_agent_id)

        # All gates passed — write the child task, packet and edge atomically.
        subtask_spec = dict(subtask or {})
        subtask_spec.setdefault("title", f"Delegated: {parent_task['title']}"[:200])
        subtask_spec.setdefault("assignee_agent_id", child_agent_id)

        child_task = self.tasks.create(project_id, subtask_spec, actor_id=actor_id,
                                       parent_task_id=parent_task_id)
        packet = self.packets.create(
            project_id=project_id, kind=packet_kind, schema_version=packet_schema_version,
            payload=packet_payload, from_agent_id=parent_agent_id,
            to_agent_id=child_agent_id, task_id=child_task["id"])

        edge = {"id": new_id("dlg"), "project_id": project_id, "parent_agent_id": parent_agent_id,
                "child_agent_id": child_agent_id, "parent_task_id": parent_task_id,
                "child_task_id": child_task["id"], "packet_id": packet["id"], "depth": depth,
                "created_at": utcnow()}
        self.db.execute(
            """INSERT INTO delegations (id, project_id, parent_agent_id, child_agent_id,
                   parent_task_id, child_task_id, packet_id, depth, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            tuple(edge[k] for k in ("id", "project_id", "parent_agent_id", "child_agent_id",
                                    "parent_task_id", "child_task_id", "packet_id", "depth", "created_at")))
        self.events.append("delegation.created", actor_type="agent", actor_id=actor_id,
                           project_id=project_id,
                           payload={"delegation_id": edge["id"], "parent_agent_id": parent_agent_id,
                                    "child_agent_id": child_agent_id, "depth": depth,
                                    "child_task_id": child_task["id"]})
        return {"delegation": edge, "task": child_task, "packet": packet}

    # --------------------------------------------------------------------- graph

    def graph(self, project_id: str) -> dict:
        """The delegation graph for a project: agent nodes plus delegation edges."""
        nodes = self.db.query(
            "SELECT id, name, role, level, status, parent_agent_id FROM agents WHERE project_id = ?",
            (project_id,))
        edges = self.db.query(
            """SELECT parent_agent_id, child_agent_id, COUNT(*) AS delegations, MIN(depth) AS depth
               FROM delegations WHERE project_id = ?
               GROUP BY parent_agent_id, child_agent_id""", (project_id,))
        return {"nodes": nodes, "edges": edges}

    def for_task(self, task_id: str) -> list[dict]:
        return self.db.query(
            "SELECT * FROM delegations WHERE parent_task_id = ? ORDER BY created_at", (task_id,))
