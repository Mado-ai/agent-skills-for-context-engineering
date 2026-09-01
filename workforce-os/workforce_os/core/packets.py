"""Typed inter-agent work packets.

Every packet declares a `kind` and `schema_version` and is validated against a
registered schema before it is persisted or delegated. Untyped payloads are refused —
this is the contract that keeps agent-to-agent hand-offs legible and auditable.
"""

from __future__ import annotations

import json

from ..errors import NotFoundError, ValidationError
from ..schemas import canonical_json, new_id, require, utcnow

# A field spec is (name, python type, required).
PacketSchema = dict


def _field(name: str, type_: type, required: bool = True) -> dict:
    return {"name": name, "type": type_, "required": required}


# Built-in packet types covering the standard workflow loop.
PACKET_SCHEMAS: dict[tuple[str, int], list[dict]] = {
    ("work_request", 1): [
        _field("objective", str), _field("context", str, False),
        _field("acceptance_criteria", list), _field("deadline", str, False),
    ],
    ("work_result", 1): [
        _field("summary", str), _field("artifacts", list, False),
        _field("confidence", (int, float), False),
    ],
    ("review_request", 1): [
        _field("task_id", str), _field("deliverable", str), _field("criteria", list),
    ],
    ("review_result", 1): [
        _field("verdict", str), _field("score", (int, float)), _field("findings", list, False),
    ],
    ("escalation", 1): [
        _field("reason", str), _field("blocking", bool, False), _field("detail", str, False),
    ],
}

MAX_PAYLOAD_BYTES = 256 * 1024


def validate_payload(kind: str, schema_version: int, payload: dict) -> dict:
    """Validate a payload against its registered schema. Unknown fields are rejected."""
    schema = PACKET_SCHEMAS.get((kind, schema_version))
    if schema is None:
        raise ValidationError(
            f"No registered schema for packet kind {kind!r} version {schema_version}",
            details={"field": "kind", "known_kinds": sorted({k for k, _ in PACKET_SCHEMAS})})

    require(isinstance(payload, dict), "payload must be an object", "payload")

    known = {spec["name"] for spec in schema}
    unknown = sorted(set(payload) - known)
    if unknown:
        raise ValidationError(f"Unknown payload field(s): {', '.join(unknown)}",
                              details={"field": "payload", "unknown": unknown})

    for spec in schema:
        name, expected, required = spec["name"], spec["type"], spec["required"]
        if name not in payload or payload[name] is None:
            if required:
                raise ValidationError(f"payload.{name} is required",
                                      details={"field": f"payload.{name}"})
            continue
        value = payload[name]
        if expected is bool or (isinstance(expected, tuple) and bool in expected):
            ok = isinstance(value, bool)
        else:
            ok = isinstance(value, expected) and not isinstance(value, bool)
        if not ok:
            type_name = getattr(expected, "__name__", str(expected))
            raise ValidationError(f"payload.{name} must be of type {type_name}",
                                  details={"field": f"payload.{name}"})

    encoded = canonical_json(payload)
    if len(encoded.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ValidationError(f"payload exceeds {MAX_PAYLOAD_BYTES} bytes",
                              details={"field": "payload"})
    return payload


class PacketService:
    def __init__(self, db, events):
        self.db = db
        self.events = events

    def create(self, *, project_id: str, kind: str, schema_version: int, payload: dict,
               from_agent_id: str, to_agent_id: str, task_id: str | None = None) -> dict:
        validate_payload(kind, schema_version, payload)
        packet = {"id": new_id("pkt"), "project_id": project_id, "kind": kind,
                  "schema_version": schema_version, "payload": canonical_json(payload),
                  "from_agent_id": from_agent_id, "to_agent_id": to_agent_id,
                  "task_id": task_id, "status": "pending", "created_at": utcnow()}
        self.db.execute(
            """INSERT INTO work_packets (id, project_id, kind, schema_version, payload,
                   from_agent_id, to_agent_id, task_id, status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            tuple(packet[k] for k in ("id", "project_id", "kind", "schema_version", "payload",
                                      "from_agent_id", "to_agent_id", "task_id", "status", "created_at")))
        self.events.append("packet.created", actor_type="agent", actor_id=from_agent_id,
                           project_id=project_id,
                           payload={"packet_id": packet["id"], "kind": kind,
                                    "to_agent_id": to_agent_id, "task_id": task_id})
        return self.get(packet["id"])

    def mark(self, packet_id: str, status: str, *, actor_id: str) -> dict:
        require(status in ("pending", "accepted", "rejected", "consumed"),
                "invalid packet status", "status")
        packet = self.get(packet_id)
        self.db.execute("UPDATE work_packets SET status = ? WHERE id = ?", (status, packet_id))
        self.events.append(f"packet.{status}", actor_type="agent", actor_id=actor_id,
                           project_id=packet["project_id"], payload={"packet_id": packet_id})
        return self.get(packet_id)

    def get(self, packet_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM work_packets WHERE id = ?", (packet_id,))
        if not row:
            raise NotFoundError(f"Work packet {packet_id} not found")
        return row

    def hydrate(self, packet: dict) -> dict:
        return {**packet, "payload": json.loads(packet["payload"])}

    def inbox(self, agent_id: str, *, status: str = "pending") -> list[dict]:
        return self.db.query(
            "SELECT * FROM work_packets WHERE to_agent_id = ? AND status = ? ORDER BY created_at DESC",
            (agent_id, status))

    @staticmethod
    def known_kinds() -> list[dict]:
        return [{"kind": kind, "schema_version": version,
                 "fields": [{"name": f["name"],
                             "type": getattr(f["type"], "__name__", str(f["type"])),
                             "required": f["required"]} for f in schema]}
                for (kind, version), schema in sorted(PACKET_SCHEMAS.items())]
