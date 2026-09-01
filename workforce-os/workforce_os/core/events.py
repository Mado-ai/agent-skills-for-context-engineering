"""Append-only, hash-chained audit trail.

Each event's hash covers its own content *and* the previous event's hash, so removing
or altering any event breaks verification for every event after it. The table itself
rejects UPDATE and DELETE at the database level.
"""

from __future__ import annotations

import hashlib

from ..errors import IntegrityError
from ..redaction import redact
from ..schemas import canonical_json, new_id, utcnow

GENESIS_HASH = "0" * 64


def _event_hash(prev_hash: str, payload: dict) -> str:
    return hashlib.sha256((prev_hash + canonical_json(payload)).encode("utf-8")).hexdigest()


class EventLog:
    def __init__(self, db):
        self.db = db

    def _last_hash(self) -> str:
        row = self.db.query_one("SELECT hash FROM events ORDER BY seq DESC LIMIT 1")
        return row["hash"] if row else GENESIS_HASH

    def append(self, event_type: str, *, actor_type: str, actor_id: str,
               project_id: str | None = None, payload: dict | None = None) -> dict:
        """Record an event. Payload is redacted before it is ever written."""
        safe_payload = redact(payload or {})
        event_id = new_id("evt")
        created_at = utcnow()
        prev_hash = self._last_hash()
        content = {
            "id": event_id, "project_id": project_id, "actor_type": actor_type,
            "actor_id": actor_id, "event_type": event_type, "payload": safe_payload,
            "created_at": created_at,
        }
        digest = _event_hash(prev_hash, content)
        self.db.execute(
            """INSERT INTO events (id, project_id, actor_type, actor_id, event_type,
                                   payload, prev_hash, hash, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (event_id, project_id, actor_type, actor_id, event_type,
             canonical_json(safe_payload), prev_hash, digest, created_at),
        )
        return {**content, "hash": digest, "prev_hash": prev_hash}

    def list(self, *, project_id: str | None = None, event_type: str | None = None,
             limit: int = 100, since_seq: int = 0) -> list[dict]:
        sql = "SELECT * FROM events WHERE seq > ?"
        params: list = [since_seq]
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        if event_type:
            sql += " AND event_type = ?"
            params.append(event_type)
        sql += " ORDER BY seq DESC LIMIT ?"
        params.append(min(limit, 1000))
        return self.db.query(sql, tuple(params))

    def verify_chain(self) -> dict:
        """Recompute the whole chain. Raises IntegrityError on the first break."""
        rows = self.db.query("SELECT * FROM events ORDER BY seq ASC")
        prev_hash = GENESIS_HASH
        import json as _json

        for row in rows:
            if row["prev_hash"] != prev_hash:
                raise IntegrityError(
                    f"Audit chain broken at seq {row['seq']}: prev_hash mismatch",
                    details={"seq": row["seq"]},
                )
            content = {
                "id": row["id"], "project_id": row["project_id"], "actor_type": row["actor_type"],
                "actor_id": row["actor_id"], "event_type": row["event_type"],
                "payload": _json.loads(row["payload"]), "created_at": row["created_at"],
            }
            expected = _event_hash(prev_hash, content)
            if expected != row["hash"]:
                raise IntegrityError(
                    f"Audit chain broken at seq {row['seq']}: content hash mismatch",
                    details={"seq": row["seq"]},
                )
            prev_hash = row["hash"]
        return {"verified": True, "events": len(rows), "head": prev_hash}
