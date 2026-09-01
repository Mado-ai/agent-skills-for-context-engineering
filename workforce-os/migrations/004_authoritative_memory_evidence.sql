-- The `memory.write_authoritative` handler previously asserted human
-- provenance on the caller's behalf, which let any agent holding the tool
-- launder its own inference into canonical fact. The handler now records the
-- write as what it is — an agent write — so the memory service requires a
-- granted Owner approval among the evidence references.
--
-- This migration brings the catalogue entry in line: evidence_refs is now a
-- required argument, and the description says what is actually enforced.

UPDATE tool_definitions
SET description = 'Record a fact in the authoritative layer. Requires admin access, an explicit contract grant, and evidence_refs naming a granted Owner approval — an agent cannot promote its own inference.',
    input_schema = '{"type":"object","properties":{"key":{"type":"string"},"content":{"type":"object"},"source":{"type":"string"},"evidence_refs":{"type":"array","items":{"type":"string"},"minItems":1},"supersedes_id":{"type":"string"}},"required":["key","content","source","evidence_refs"]}',
    updated_at = '2026-01-02T00:00:00.000Z'
WHERE tool_name = 'memory.write_authoritative';
