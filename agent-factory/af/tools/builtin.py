"""Reference tools, one per risk class.

These exist so the gateway's policy chain can be exercised end to end and so
benchmarks have deterministic work to do. They are intentionally inert: nothing
here touches a network, a shell, or a real external system.

Note what is *absent*: there is no generic "run shell command" or "execute SQL"
tool, at any risk level. The mandate forbids handing agents raw infrastructure,
and the cleanest way to honour that is for the capability not to exist in the
catalogue at all.
"""

from __future__ import annotations

from typing import Any

from af.tools.gateway import RiskLevel, ToolRegistry, ToolSpec

__all__ = ["register_builtin_tools", "MEMORY_BACKED_TOOLS"]

MEMORY_BACKED_TOOLS = ("kb.search", "note.write")


def register_builtin_tools(registry: ToolRegistry, *, store=None) -> ToolRegistry:
    """Register the reference catalogue."""

    # --- R0: read-only internal ------------------------------------------
    def kb_search(query: str, limit: int = 5) -> dict[str, Any]:
        if store is None:
            return {"results": [], "count": 0}
        rows = store.all(
            "SELECT mkey, content, trust FROM memory_records "
            "WHERE deleted_at IS NULL AND (mkey LIKE ? OR content LIKE ?) LIMIT ?",
            (f"%{query}%", f"%{query}%", limit))
        results = [{"key": r["mkey"], "content": r["content"][:500], "trust": r["trust"]}
                   for r in rows]
        return {"results": results, "count": len(results)}

    registry.register(ToolSpec(
        tool_id="kb.search", category="knowledge", risk_level=RiskLevel.R0,
        description="Search the internal knowledge base.",
        input_schema={"type": "object", "required": ["query"],
                      "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 500},
                                     "limit": {"type": "integer", "minimum": 1, "maximum": 50}},
                      "additionalProperties": False},
        output_schema={"type": "object", "required": ["results", "count"]},
        rate_limit_per_minute=600, handler=kb_search))

    def compute_stats(numbers: list) -> dict[str, Any]:
        vals = [float(n) for n in numbers]
        if not vals:
            return {"count": 0, "sum": 0.0, "mean": 0.0, "min": 0.0, "max": 0.0}
        return {"count": len(vals), "sum": sum(vals), "mean": sum(vals) / len(vals),
                "min": min(vals), "max": max(vals)}

    registry.register(ToolSpec(
        tool_id="calc.stats", category="compute", risk_level=RiskLevel.R0,
        description="Summary statistics over a list of numbers.",
        input_schema={"type": "object", "required": ["numbers"],
                      "properties": {"numbers": {"type": "array", "maxItems": 10_000,
                                                 "items": {"type": "number"}}},
                      "additionalProperties": False},
        rate_limit_per_minute=600, handler=compute_stats))

    # --- R1: low-risk internal write ---------------------------------------
    def note_write(key: str, content: str) -> dict[str, Any]:
        return {"written": True, "key": key, "bytes": len(content)}

    registry.register(ToolSpec(
        tool_id="note.write", category="knowledge", risk_level=RiskLevel.R1,
        description="Write an internal note.",
        input_schema={"type": "object", "required": ["key", "content"],
                      "properties": {"key": {"type": "string", "maxLength": 200},
                                     "content": {"type": "string", "maxLength": 100_000}},
                      "additionalProperties": False},
        rate_limit_per_minute=120, cost_micros_per_call=1, handler=note_write))

    # --- R2: external but reversible ----------------------------------------
    def draft_publish(title: str, body: str) -> dict[str, Any]:
        return {"draft_id": f"draft-{abs(hash(title)) % 100000}", "status": "draft",
                "title": title, "length": len(body)}

    registry.register(ToolSpec(
        tool_id="cms.draft", category="publishing", risk_level=RiskLevel.R2,
        description="Create an unpublished draft (reversible).",
        input_schema={"type": "object", "required": ["title", "body"],
                      "properties": {"title": {"type": "string", "maxLength": 300},
                                     "body": {"type": "string", "maxLength": 500_000}},
                      "additionalProperties": False},
        rate_limit_per_minute=60, cost_micros_per_call=10, handler=draft_publish))

    # --- R3: sensitive external -> approval + token --------------------------
    def email_send(to: str, subject: str, body: str) -> dict[str, Any]:
        # Inert by design: this reference implementation must never actually
        # send anything. A real adapter replaces the handler; the policy chain
        # around it is what is being demonstrated.
        return {"queued": True, "to": to, "subject": subject, "simulated": True}

    registry.register(ToolSpec(
        tool_id="email.send", category="communication", risk_level=RiskLevel.R3,
        description="Send an external email. Requires owner approval.",
        input_schema={"type": "object", "required": ["to", "subject", "body"],
                      "properties": {"to": {"type": "string", "pattern": r"^[^@\s]+@[^@\s]+\.[^@\s]+$"},
                                     "subject": {"type": "string", "maxLength": 300},
                                     "body": {"type": "string", "maxLength": 100_000}},
                      "additionalProperties": False},
        rate_limit_per_minute=10, cost_micros_per_call=100,
        irreversible=True, handler=email_send))

    # --- R4: owner approval mandatory -----------------------------------------
    def cms_publish(draft_id: str) -> dict[str, Any]:
        return {"published": True, "draft_id": draft_id, "simulated": True}

    registry.register(ToolSpec(
        tool_id="cms.publish", category="publishing", risk_level=RiskLevel.R4,
        description="Publish content externally. Owner approval mandatory.",
        input_schema={"type": "object", "required": ["draft_id"],
                      "properties": {"draft_id": {"type": "string", "maxLength": 100}},
                      "additionalProperties": False},
        rate_limit_per_minute=5, cost_micros_per_call=50,
        irreversible=True, handler=cms_publish))

    # --- R5: never autonomous ---------------------------------------------------
    def funds_transfer(amount_micros: int, destination: str) -> dict[str, Any]:
        return {"transferred": False, "reason": "R5 tools are never executed autonomously"}

    registry.register(ToolSpec(
        tool_id="finance.transfer", category="finance", risk_level=RiskLevel.R5,
        description="Move money. Prohibited for autonomous execution.",
        input_schema={"type": "object", "required": ["amount_micros", "destination"],
                      "properties": {"amount_micros": {"type": "integer", "minimum": 1},
                                     "destination": {"type": "string"}},
                      "additionalProperties": False},
        rate_limit_per_minute=1, irreversible=True, handler=funds_transfer))

    return registry
