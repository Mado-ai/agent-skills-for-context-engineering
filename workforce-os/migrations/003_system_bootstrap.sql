-- System bootstrap: the tool catalogue and quality gates the runtime itself
-- depends on. These are runtime configuration, not demo data — the Tool Gateway
-- refuses any tool that is not registered here, so an empty catalogue would
-- mean an agent runtime that can do nothing at all.
--
-- Demo organisation data (projects, the Chief, master agents, templates) is NOT
-- here; it is applied separately by `npm run seed` so it can be reshaped
-- without a schema migration.
--
-- Deliberately absent: any shell, filesystem-write, or arbitrary-code tool.
-- v0.4 runtime agents have no route to a shell.

INSERT INTO tool_definitions (tool_name, description, risk_class, input_schema, output_schema, required_access_level, required_scopes, requires_owner_approval, timeout_ms, audit_policy, handler_key, status, created_at, updated_at) VALUES

('registry.inspect',
 'Read the agent registry: definitions, lifecycle state, contracts and the delegation graph.',
 'read',
 '{"type":"object","properties":{"agent_id":{"type":"string"},"role_level":{"type":"string"},"status":{"type":"string"}},"required":[]}',
 '{"type":"object","properties":{"agents":{"type":"array"}},"required":["agents"]}',
 'read', '["registry:read"]', 0, 10000, 'metadata', 'registry.inspect', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('memory.read',
 'Retrieve memory records visible to the caller, ordered by layer precedence.',
 'read',
 '{"type":"object","properties":{"layer":{"type":"string","enum":["working","episodic","project","authoritative"]},"key":{"type":"string"},"project_id":{"type":"string"},"limit":{"type":"integer"}},"required":[]}',
 '{"type":"object","properties":{"records":{"type":"array"}},"required":["records"]}',
 'read', '["memory:read"]', 0, 10000, 'metadata', 'memory.read', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('memory.write',
 'Write a non-authoritative memory record (working, episodic or project layer).',
 'low',
 '{"type":"object","properties":{"layer":{"type":"string","enum":["working","episodic","project"]},"key":{"type":"string"},"content":{"type":"object"},"confidence":{"type":"number"},"ttl_seconds":{"type":"integer"},"supersedes_id":{"type":"string"}},"required":["layer","key","content"]}',
 '{"type":"object","properties":{"memory_id":{"type":"string"}},"required":["memory_id"]}',
 'write', '["memory:write"]', 0, 10000, 'full', 'memory.write', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('memory.write_authoritative',
 'Promote or record a fact in the authoritative layer. Requires admin access; agents cannot self-promote inferred memory.',
 'high',
 '{"type":"object","properties":{"key":{"type":"string"},"content":{"type":"object"},"source":{"type":"string"},"supersedes_id":{"type":"string"}},"required":["key","content","source"]}',
 '{"type":"object","properties":{"memory_id":{"type":"string"}},"required":["memory_id"]}',
 'admin', '["memory:write","memory:authoritative"]', 0, 10000, 'full', 'memory.write_authoritative', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('task.create',
 'Create a task inside a project the caller can reach.',
 'low',
 '{"type":"object","properties":{"project_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"priority":{"type":"string"},"loop_id":{"type":"string"},"input":{"type":"object"}},"required":["project_id","title"]}',
 '{"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]}',
 'write', '["task:write"]', 0, 10000, 'full', 'task.create', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('packet.delegate',
 'Send a typed WorkPacket to a subordinate agent. Authority carried by the packet can never exceed the sender''s own contract.',
 'medium',
 '{"type":"object","properties":{"task_id":{"type":"string"},"receiver_agent_id":{"type":"string"},"intent":{"type":"string"},"objective":{"type":"string"},"input_payload":{"type":"object"},"allowed_tools":{"type":"array"},"acceptance_criteria":{"type":"array"},"quality_gate_ids":{"type":"array"},"budget":{"type":"object"}},"required":["task_id","receiver_agent_id","intent","objective"]}',
 '{"type":"object","properties":{"packet_id":{"type":"string"}},"required":["packet_id"]}',
 'write', '["delegation:write"]', 0, 15000, 'full', 'packet.delegate', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('agent.instantiate',
 'Instantiate a specialist agent from an allowed template, bounded by the caller''s own scope and delegation authority.',
 'medium',
 '{"type":"object","properties":{"template_key":{"type":"string"},"project_id":{"type":"string"},"display_name":{"type":"string"},"overrides":{"type":"object"}},"required":["template_key","project_id"]}',
 '{"type":"object","properties":{"agent_id":{"type":"string"},"status":{"type":"string"}},"required":["agent_id"]}',
 'write', '["registry:write"]', 0, 15000, 'full', 'agent.instantiate', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('quality.evaluate',
 'Run a quality gate against a task artifact and record the evaluation.',
 'low',
 '{"type":"object","properties":{"task_id":{"type":"string"},"artifact_id":{"type":"string"},"gate_key":{"type":"string"}},"required":["task_id","artifact_id","gate_key"]}',
 '{"type":"object","properties":{"passed":{"type":"boolean"},"evaluation_id":{"type":"string"}},"required":["passed","evaluation_id"]}',
 'write', '["quality:write"]', 0, 20000, 'full', 'quality.evaluate', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('report.compose',
 'Compose a structured report artifact from supplied, already-retrieved evidence. Performs no retrieval of its own.',
 'low',
 '{"type":"object","properties":{"task_id":{"type":"string"},"summary":{"type":"string"},"sections":{"type":"array"},"evidence":{"type":"array"}},"required":["task_id","summary"]}',
 '{"type":"object","properties":{"artifact_id":{"type":"string"}},"required":["artifact_id"]}',
 'write', '["artifact:write"]', 0, 20000, 'full', 'report.compose', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

-- ---------------------------------------------------------------------------
-- Owner-gated action classes. Each is registered so it can be requested and
-- audited, and each requires an explicit Owner approval plus a short-lived
-- execution token bound to the exact arguments.
-- ---------------------------------------------------------------------------

('finance.commit_payment',
 'Commit a financial payment. Owner-gated.',
 'critical',
 '{"type":"object","properties":{"project_id":{"type":"string"},"amount":{"type":"number"},"currency":{"type":"string"},"payee":{"type":"string"},"reference":{"type":"string"}},"required":["project_id","amount","currency","payee"]}',
 '{"type":"object","properties":{"committed":{"type":"boolean"},"reference":{"type":"string"}},"required":["committed"]}',
 'owner', '["finance:commit"]', 1, 30000, 'full', 'finance.commit_payment', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('contract.finalize',
 'Finalize or sign a binding contract. Owner-gated.',
 'critical',
 '{"type":"object","properties":{"project_id":{"type":"string"},"counterparty":{"type":"string"},"document_ref":{"type":"string"}},"required":["project_id","counterparty","document_ref"]}',
 '{"type":"object","properties":{"finalized":{"type":"boolean"}},"required":["finalized"]}',
 'owner', '["legal:bind"]', 1, 30000, 'full', 'contract.finalize', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('secret.grant',
 'Grant an agent access to a credential reference. Owner-gated. Never returns a secret value.',
 'critical',
 '{"type":"object","properties":{"agent_id":{"type":"string"},"secret_key":{"type":"string"}},"required":["agent_id","secret_key"]}',
 '{"type":"object","properties":{"granted":{"type":"boolean"},"secret_key":{"type":"string"}},"required":["granted"]}',
 'owner', '["secrets:grant"]', 1, 15000, 'full', 'secret.grant', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('publish.external',
 'Publish content to an external/public channel. Owner-gated.',
 'high',
 '{"type":"object","properties":{"project_id":{"type":"string"},"channel":{"type":"string"},"artifact_id":{"type":"string"}},"required":["project_id","channel","artifact_id"]}',
 '{"type":"object","properties":{"published":{"type":"boolean"}},"required":["published"]}',
 'owner', '["publish:external"]', 1, 30000, 'full', 'publish.external', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('data.destructive_action',
 'Irreversible production data action (delete, purge, overwrite). Owner-gated.',
 'critical',
 '{"type":"object","properties":{"project_id":{"type":"string"},"target":{"type":"string"},"operation":{"type":"string"}},"required":["project_id","target","operation"]}',
 '{"type":"object","properties":{"executed":{"type":"boolean"}},"required":["executed"]}',
 'owner', '["data:destructive"]', 1, 30000, 'full', 'data.destructive_action', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('policy.update',
 'Change runtime policy or an agent''s permissions. Owner-gated; an agent may never target its own contract with this tool.',
 'critical',
 '{"type":"object","properties":{"target_agent_id":{"type":"string"},"change":{"type":"object"}},"required":["target_agent_id","change"]}',
 '{"type":"object","properties":{"applied":{"type":"boolean"}},"required":["applied"]}',
 'owner', '["policy:write"]', 1, 30000, 'full', 'policy.update', 'active',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('http.fetch',
 'Outbound HTTP GET against an allowlisted host. Disabled by default in v0.4 — no egress is enabled in a pre-production build.',
 'medium',
 '{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}',
 '{"type":"object","properties":{"status":{"type":"integer"},"body":{"type":"string"}},"required":["status"]}',
 'write', '["net:egress"]', 0, 15000, 'full', 'http.fetch', 'disabled',
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');


INSERT INTO quality_gates (gate_id, key, name, description, checks, threshold, blocking, separation_of_duties, created_at, updated_at) VALUES

('qg_schema', 'gate.schema', 'Output schema compliance',
 'Artifact content validates against the expected_output_schema declared on the WorkPacket.',
 '[{"kind":"schema","weight":1}]', 1.0, 1, 0,
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('qg_acceptance', 'gate.acceptance', 'Acceptance criteria',
 'Every acceptance criterion declared on the WorkPacket is satisfied by the artifact.',
 '[{"kind":"acceptance_criteria","weight":1}]', 1.0, 1, 0,
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('qg_provenance', 'gate.provenance', 'Evidence and provenance',
 'Claims carry evidence references, and every reference resolves to a real artifact or memory record.',
 '[{"kind":"evidence","weight":1}]', 1.0, 1, 0,
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('qg_permissions', 'gate.permissions', 'Permission compliance',
 'No tool call recorded against the task fell outside the executing agent''s contract or the packet allowlist.',
 '[{"kind":"permission_compliance","weight":1}]', 1.0, 1, 0,
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('qg_duplication', 'gate.duplication', 'Duplication and conflict',
 'The artifact does not contradict authoritative memory and does not duplicate an existing accepted artifact.',
 '[{"kind":"duplication","weight":1}]', 1.0, 0, 0,
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),

('qg_standard', 'gate.standard_delivery', 'Standard delivery gate',
 'Default blocking gate for delivered work: schema, acceptance criteria, provenance and permission compliance, evaluated by an agent other than the author.',
 '[{"kind":"schema","weight":1},{"kind":"acceptance_criteria","weight":1},{"kind":"evidence","weight":1},{"kind":"permission_compliance","weight":1}]',
 1.0, 1, 1,
 '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
