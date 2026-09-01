"""Multi-layer memory with mandatory provenance.

Three layers, each with a different lifetime and audience:

  working   — task-scoped scratch space, visible only within its own task
  episodic  — agent-scoped experience, what one agent has learned across tasks
  semantic  — project-scoped durable knowledge, shared inside a project

Nothing is stored without provenance: who wrote it, from which task, derived from what,
and with what confidence. Reads are project-isolated; only the Owner reads across
projects, and no agent level unlocks that.
"""

from __future__ import annotations

import json

from ..errors import NotFoundError, PolicyDenied, ValidationError
from ..policy.authority import Principal, assert_can_view_project
from ..redaction import redact
from ..schemas import MEMORY_LAYERS, canonical_json, new_id, require, utcnow

REQUIRED_PROVENANCE_FIELDS = ("author_agent_id", "source", "origin")
VALID_ORIGINS = ("observation", "tool_result", "delegation", "evaluation", "owner_input", "derived")
MAX_CONTENT_CHARS = 100_000


def validate_provenance(provenance: dict) -> dict:
    require(isinstance(provenance, dict), "provenance must be an object", "provenance")
    for field in REQUIRED_PROVENANCE_FIELDS:
        value = provenance.get(field)
        require(isinstance(value, str) and value.strip(),
                f"provenance.{field} is required", f"provenance.{field}")
    origin = provenance["origin"]
    require(origin in VALID_ORIGINS, f"provenance.origin must be one of {VALID_ORIGINS}",
            "provenance.origin")
    derived_from = provenance.get("derived_from", [])
    require(isinstance(derived_from, list) and all(isinstance(x, str) for x in derived_from),
            "provenance.derived_from must be a list of record ids", "provenance.derived_from")
    return {"author_agent_id": provenance["author_agent_id"], "source": provenance["source"],
            "origin": origin, "derived_from": derived_from,
            "note": provenance.get("note", "")}


class MemoryStore:
    def __init__(self, db, events, registry):
        self.db = db
        self.events = events
        self.registry = registry

    # -------------------------------------------------------------------- writes

    def write(self, *, project_id: str, layer: str, key: str, content: str,
              provenance: dict, agent_id: str | None = None, task_id: str | None = None,
              tags: list[str] | None = None, confidence: float = 1.0) -> dict:
        require(layer in MEMORY_LAYERS, f"layer must be one of {MEMORY_LAYERS}", "layer")
        require(isinstance(key, str) and 1 <= len(key.strip()) <= 200,
                "key must be 1-200 characters", "key")
        require(isinstance(content, str) and content.strip(), "content must be a non-empty string",
                "content")
        require(len(content) <= MAX_CONTENT_CHARS,
                f"content exceeds {MAX_CONTENT_CHARS} characters", "content")
        require(isinstance(confidence, (int, float)) and 0.0 <= confidence <= 1.0,
                "confidence must be between 0 and 1", "confidence")

        # Each layer has a scope key it cannot exist without.
        if layer == "working":
            require(bool(task_id), "working memory requires a task_id", "task_id")
        if layer == "episodic":
            require(bool(agent_id), "episodic memory requires an agent_id", "agent_id")

        clean_provenance = validate_provenance(provenance)

        if agent_id:
            agent = self.registry.get(agent_id)
            if agent["project_id"] != project_id:
                raise PolicyDenied("Cannot write memory for an agent in another project",
                                   code="project_isolation")
        if task_id:
            task = self.db.query_one("SELECT project_id FROM tasks WHERE id = ?", (task_id,))
            if not task:
                raise NotFoundError(f"Task {task_id} not found")
            if task["project_id"] != project_id:
                raise PolicyDenied("Cannot write memory against a task in another project",
                                   code="project_isolation")

        record = {"id": new_id("mem"), "project_id": project_id, "layer": layer,
                  "agent_id": agent_id, "task_id": task_id, "key": key.strip(),
                  # Secrets never reach the memory layer.
                  "content": redact(content), "tags": canonical_json(tags or []),
                  "provenance": canonical_json(redact(clean_provenance)),
                  "confidence": float(confidence), "created_at": utcnow()}
        self.db.execute(
            """INSERT INTO memory_records (id, project_id, layer, agent_id, task_id, key,
                   content, tags, provenance, confidence, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(record[k] for k in ("id", "project_id", "layer", "agent_id", "task_id", "key",
                                      "content", "tags", "provenance", "confidence", "created_at")))
        self.events.append("memory.written", actor_type="agent",
                           actor_id=clean_provenance["author_agent_id"], project_id=project_id,
                           payload={"record_id": record["id"], "layer": layer, "key": record["key"]})
        return self.hydrate(record)

    # --------------------------------------------------------------------- reads

    def read(self, principal: Principal, *, project_id: str, layer: str | None = None,
             agent_id: str | None = None, task_id: str | None = None,
             key: str | None = None, limit: int = 100) -> list[dict]:
        """Project-isolated read. Level grants no cross-project access — only the Owner does."""
        assert_can_view_project(principal, project_id)

        sql = "SELECT * FROM memory_records WHERE project_id = ?"
        params: list = [project_id]
        if layer:
            require(layer in MEMORY_LAYERS, f"layer must be one of {MEMORY_LAYERS}", "layer")
            sql += " AND layer = ?"
            params.append(layer)
        if agent_id:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        if key:
            sql += " AND key = ?"
            params.append(key)

        # Working memory is private to its task: never surface another task's scratch space.
        if task_id:
            sql += " AND (task_id = ? OR layer != 'working')"
            params.append(task_id)
        else:
            sql += " AND layer != 'working'"

        params.append(min(limit, 500))
        rows = self.db.query(sql + " ORDER BY created_at DESC LIMIT ?", tuple(params))
        return [self.hydrate(row) for row in rows]

    def get(self, principal: Principal, record_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM memory_records WHERE id = ?", (record_id,))
        if not row:
            raise NotFoundError(f"Memory record {record_id} not found")
        assert_can_view_project(principal, row["project_id"])
        return self.hydrate(row)

    def hydrate(self, row: dict) -> dict:
        out = dict(row)
        out["tags"] = json.loads(row["tags"]) if isinstance(row["tags"], str) else row["tags"]
        out["provenance"] = (json.loads(row["provenance"]) if isinstance(row["provenance"], str)
                             else row["provenance"])
        return out

    def forget_working_memory(self, task_id: str, *, actor_id: str) -> int:
        """Clear a task's scratch space once the task is closed."""
        rows = self.db.query(
            "SELECT id, project_id FROM memory_records WHERE task_id = ? AND layer = 'working'",
            (task_id,))
        if rows:
            self.db.execute("DELETE FROM memory_records WHERE task_id = ? AND layer = 'working'",
                            (task_id,))
            self.events.append("memory.working_cleared", actor_type="system", actor_id=actor_id,
                               project_id=rows[0]["project_id"],
                               payload={"task_id": task_id, "records": len(rows)})
        return len(rows)
