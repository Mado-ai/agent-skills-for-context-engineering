-- AI Workforce OS v0.4 — initial schema.
--
-- Portability notes (target: PostgreSQL / Supabase):
--   * All primary keys are application-generated, time-sortable TEXT ids. No
--     AUTOINCREMENT / SERIAL is used, so ORDER BY <id> is a stable insertion
--     order on either engine.
--   * Timestamps are ISO-8601 UTC strings (TEXT). Postgres migration maps these
--     to TIMESTAMPTZ with a straight cast.
--   * Booleans are INTEGER 0/1 and map to BOOLEAN.
--   * Structured columns hold JSON text and map to JSONB.
--   * No SQLite-only functions are used in DDL defaults.

CREATE TABLE projects (
  project_id        TEXT PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','archived')),
  parent_project_id TEXT REFERENCES projects(project_id),
  metadata          TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE workflow_loops (
  loop_id      TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(project_id),
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  trigger_kind TEXT NOT NULL DEFAULT 'manual'
                 CHECK (trigger_kind IN ('manual','scheduled','event')),
  schedule_expr TEXT,
  event_key    TEXT,
  definition   TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paused','retired')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE TABLE agent_templates (
  template_id       TEXT PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  role_level        TEXT NOT NULL
                      CHECK (role_level IN ('chief','master','specialist','ephemeral')),
  version           INTEGER NOT NULL DEFAULT 1,
  description       TEXT NOT NULL DEFAULT '',
  contract_template TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('draft','active','deprecated')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Registered agent identity. The authoritative contract body lives in
-- agent_contract_versions; this row carries identity + lifecycle only.
CREATE TABLE agents (
  agent_id        TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  role_level      TEXT NOT NULL
                    CHECK (role_level IN ('chief','master','specialist','ephemeral')),
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','validated','testing','approved','active','paused','merged','retired')),
  current_version INTEGER NOT NULL DEFAULT 0,
  parent_agent_id TEXT REFERENCES agents(agent_id),
  template_id     TEXT REFERENCES agent_templates(template_id),
  merged_into_id  TEXT REFERENCES agents(agent_id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  retired_at      TEXT
);

CREATE INDEX idx_agents_parent ON agents(parent_agent_id);
CREATE INDEX idx_agents_status ON agents(status);

-- Immutable versioned contracts. A row is never updated once written.
CREATE TABLE agent_contract_versions (
  contract_version_id TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(agent_id),
  version             INTEGER NOT NULL,
  contract            TEXT NOT NULL,
  contract_hash       TEXT NOT NULL,
  validation          TEXT NOT NULL DEFAULT '{}',
  validated_at        TEXT,
  approved_by         TEXT,
  approved_at         TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (agent_id, version)
);

-- Elastic runtime instances. A definition may have zero instances; instances are
-- created on demand and reaped when idle.
CREATE TABLE agent_instances (
  instance_id     TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(agent_id),
  contract_version INTEGER NOT NULL,
  activation_mode TEXT NOT NULL
                    CHECK (activation_mode IN ('scheduled','event','session','ephemeral','manual')),
  status          TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','busy','paused','ended')),
  project_id      TEXT REFERENCES projects(project_id),
  task_id         TEXT,
  loop_id         TEXT REFERENCES workflow_loops(loop_id),
  ttl_seconds     INTEGER,
  metadata        TEXT NOT NULL DEFAULT '{}',
  started_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL,
  ended_at        TEXT,
  end_reason      TEXT
);

CREATE INDEX idx_instances_agent ON agent_instances(agent_id, status);

CREATE TABLE tasks (
  task_id           TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(project_id),
  loop_id           TEXT REFERENCES workflow_loops(loop_id),
  parent_task_id    TEXT REFERENCES tasks(task_id),
  trace_id          TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','assigned','running','awaiting_review','rework','blocked','awaiting_approval','completed','failed','escalated','cancelled')),
  priority          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','critical')),
  assigned_agent_id TEXT REFERENCES agents(agent_id),
  created_by        TEXT NOT NULL,
  input             TEXT NOT NULL DEFAULT '{}',
  result            TEXT,
  attempt           INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  deadline_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_trace ON tasks(trace_id);

-- Typed inter-agent message. This, not free-form chat, is the control channel.
CREATE TABLE work_packets (
  packet_id             TEXT PRIMARY KEY,
  trace_id              TEXT NOT NULL,
  task_id               TEXT NOT NULL REFERENCES tasks(task_id),
  sender_agent_id       TEXT NOT NULL REFERENCES agents(agent_id),
  receiver_agent_id     TEXT NOT NULL REFERENCES agents(agent_id),
  parent_packet_id      TEXT REFERENCES work_packets(packet_id),
  project_id            TEXT NOT NULL REFERENCES projects(project_id),
  workflow_loop_id      TEXT REFERENCES workflow_loops(loop_id),
  intent                TEXT NOT NULL
                          CHECK (intent IN ('execute','review','rework','research','plan','escalate','verify','notify')),
  objective             TEXT NOT NULL,
  context_refs          TEXT NOT NULL DEFAULT '[]',
  input_payload         TEXT NOT NULL DEFAULT '{}',
  allowed_tools         TEXT NOT NULL DEFAULT '[]',
  data_scope            TEXT NOT NULL DEFAULT '{}',
  expected_output_schema TEXT NOT NULL DEFAULT '{}',
  acceptance_criteria   TEXT NOT NULL DEFAULT '[]',
  quality_gate_ids      TEXT NOT NULL DEFAULT '[]',
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','critical')),
  budget                TEXT NOT NULL DEFAULT '{}',
  deadline_at           TEXT,
  ttl_seconds           INTEGER,
  escalation_target     TEXT,
  status                TEXT NOT NULL DEFAULT 'created'
                          CHECK (status IN ('created','dispatched','accepted','in_progress','delivered','accepted_final','rejected','rework_requested','expired','cancelled','escalated','failed')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_packets_task ON work_packets(task_id);
CREATE INDEX idx_packets_trace ON work_packets(trace_id);
CREATE INDEX idx_packets_receiver ON work_packets(receiver_agent_id, status);

CREATE TABLE task_artifacts (
  artifact_id  TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(task_id),
  packet_id    TEXT REFERENCES work_packets(packet_id),
  agent_id     TEXT NOT NULL REFERENCES agents(agent_id),
  project_id   TEXT NOT NULL REFERENCES projects(project_id),
  trace_id     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'result',
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  provenance   TEXT NOT NULL DEFAULT '{}',
  attempt      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_artifacts_task ON task_artifacts(task_id);

CREATE TABLE quality_gates (
  gate_id                TEXT PRIMARY KEY,
  key                    TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  checks                 TEXT NOT NULL,
  threshold              REAL NOT NULL DEFAULT 1.0,
  blocking               INTEGER NOT NULL DEFAULT 1,
  separation_of_duties   INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE quality_evaluations (
  evaluation_id      TEXT PRIMARY KEY,
  gate_id            TEXT NOT NULL REFERENCES quality_gates(gate_id),
  task_id            TEXT NOT NULL REFERENCES tasks(task_id),
  packet_id          TEXT REFERENCES work_packets(packet_id),
  artifact_id        TEXT REFERENCES task_artifacts(artifact_id),
  project_id         TEXT NOT NULL REFERENCES projects(project_id),
  trace_id           TEXT NOT NULL,
  evaluator_agent_id TEXT REFERENCES agents(agent_id),
  evaluator_kind     TEXT NOT NULL DEFAULT 'deterministic'
                       CHECK (evaluator_kind IN ('deterministic','model','human')),
  passed             INTEGER NOT NULL,
  score              REAL NOT NULL DEFAULT 0,
  results            TEXT NOT NULL DEFAULT '[]',
  attempt            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_evals_task ON quality_evaluations(task_id);

CREATE TABLE capa_records (
  capa_id                TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects(project_id),
  task_id                TEXT REFERENCES tasks(task_id),
  agent_id               TEXT REFERENCES agents(agent_id),
  trace_id               TEXT,
  issue                  TEXT NOT NULL,
  root_cause_hypothesis  TEXT NOT NULL DEFAULT '',
  corrective_action      TEXT NOT NULL DEFAULT '',
  preventive_action      TEXT NOT NULL DEFAULT '',
  owner_agent_id         TEXT REFERENCES agents(agent_id),
  owner_human            TEXT,
  state                  TEXT NOT NULL DEFAULT 'open'
                           CHECK (state IN ('open','investigating','action_proposed','verifying','closed','rejected')),
  verification_result    TEXT,
  evidence               TEXT NOT NULL DEFAULT '{}',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE memory_records (
  memory_id        TEXT PRIMARY KEY,
  layer            TEXT NOT NULL
                     CHECK (layer IN ('working','episodic','project','authoritative')),
  scope_project_id TEXT REFERENCES projects(project_id),
  agent_id         TEXT REFERENCES agents(agent_id),
  key              TEXT NOT NULL,
  content          TEXT NOT NULL,
  source           TEXT NOT NULL,
  provenance       TEXT NOT NULL DEFAULT '{}',
  confidence       REAL,
  authoritative    INTEGER NOT NULL DEFAULT 0,
  supersedes_id    TEXT REFERENCES memory_records(memory_id),
  superseded_by_id TEXT REFERENCES memory_records(memory_id),
  ttl_expires_at   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_memory_lookup ON memory_records(scope_project_id, layer, key);

-- Append-only audit log. Enforced by triggers in migration 002 and by the
-- absence of any update/delete path in the repository layer.
CREATE TABLE events (
  event_id     TEXT PRIMARY KEY,
  trace_id     TEXT,
  kind         TEXT NOT NULL,
  actor_type   TEXT NOT NULL
                 CHECK (actor_type IN ('owner','agent','system','instance')),
  actor_id     TEXT,
  project_id   TEXT,
  subject_type TEXT,
  subject_id   TEXT,
  severity     TEXT NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('debug','info','warn','error','security')),
  payload      TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_events_trace ON events(trace_id);
CREATE INDEX idx_events_kind ON events(kind);
CREATE INDEX idx_events_project ON events(project_id);

CREATE TABLE tool_definitions (
  tool_name               TEXT PRIMARY KEY,
  description             TEXT NOT NULL,
  risk_class              TEXT NOT NULL
                            CHECK (risk_class IN ('read','low','medium','high','critical')),
  input_schema            TEXT NOT NULL,
  output_schema           TEXT NOT NULL,
  required_access_level   TEXT NOT NULL
                            CHECK (required_access_level IN ('read','write','admin','owner')),
  required_scopes         TEXT NOT NULL DEFAULT '[]',
  requires_owner_approval INTEGER NOT NULL DEFAULT 0,
  timeout_ms              INTEGER NOT NULL DEFAULT 30000,
  audit_policy            TEXT NOT NULL DEFAULT 'full'
                            CHECK (audit_policy IN ('none','metadata','full')),
  handler_key             TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','disabled')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

-- Append-only. Written twice per call (pre-execution row, then a completion
-- row) so a crash mid-execution still leaves the attempt on record.
CREATE TABLE tool_calls (
  call_id           TEXT PRIMARY KEY,
  trace_id          TEXT NOT NULL,
  tool_name         TEXT NOT NULL,
  agent_id          TEXT,
  instance_id       TEXT,
  task_id           TEXT,
  packet_id         TEXT,
  project_id        TEXT,
  args              TEXT NOT NULL DEFAULT '{}',
  args_fingerprint  TEXT NOT NULL,
  phase             TEXT NOT NULL DEFAULT 'requested'
                      CHECK (phase IN ('requested','denied','executed')),
  decision          TEXT NOT NULL
                      CHECK (decision IN ('allow','deny')),
  denial_code       TEXT,
  denial_reason     TEXT,
  approval_token_id TEXT,
  status            TEXT
                      CHECK (status IN ('ok','error','timeout')),
  duration_ms       INTEGER,
  result_summary    TEXT,
  error             TEXT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT
);

CREATE INDEX idx_tool_calls_trace ON tool_calls(trace_id);
CREATE INDEX idx_tool_calls_agent ON tool_calls(agent_id);

CREATE TABLE approvals (
  approval_id            TEXT PRIMARY KEY,
  trace_id               TEXT NOT NULL,
  requested_by_agent_id  TEXT NOT NULL REFERENCES agents(agent_id),
  action                 TEXT NOT NULL,
  tool_name              TEXT,
  project_id             TEXT REFERENCES projects(project_id),
  task_id                TEXT REFERENCES tasks(task_id),
  packet_id              TEXT REFERENCES work_packets(packet_id),
  args                   TEXT NOT NULL DEFAULT '{}',
  args_fingerprint       TEXT NOT NULL,
  justification          TEXT NOT NULL DEFAULT '',
  risk_class             TEXT NOT NULL DEFAULT 'high',
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','denied','expired','revoked')),
  decided_by             TEXT,
  decided_at             TEXT,
  decision_note          TEXT,
  expires_at             TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX idx_approvals_status ON approvals(status);

-- Short-lived, single-use execution tokens. Only the hash is persisted; the
-- plaintext token is returned once, to the approver, and never stored.
CREATE TABLE approval_tokens (
  token_id            TEXT PRIMARY KEY,
  approval_id         TEXT NOT NULL REFERENCES approvals(approval_id),
  token_hash          TEXT NOT NULL UNIQUE,
  action_fingerprint  TEXT NOT NULL,
  actor_agent_id      TEXT NOT NULL REFERENCES agents(agent_id),
  project_id          TEXT,
  issued_at           TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  consumed_at         TEXT,
  consumed_call_id    TEXT,
  revoked_at          TEXT
);

CREATE TABLE budgets (
  budget_id   TEXT PRIMARY KEY,
  scope_type  TEXT NOT NULL
                CHECK (scope_type IN ('project','agent','task')),
  scope_id    TEXT NOT NULL,
  period      TEXT NOT NULL DEFAULT 'lifetime'
                CHECK (period IN ('lifetime','daily','monthly')),
  limits      TEXT NOT NULL,
  consumed    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'ok'
                CHECK (status IN ('ok','soft_exceeded','hard_exceeded','paused')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (scope_type, scope_id, period)
);

CREATE TABLE usage_records (
  usage_id       TEXT PRIMARY KEY,
  trace_id       TEXT,
  project_id     TEXT,
  agent_id       TEXT,
  task_id        TEXT,
  packet_id      TEXT,
  call_id        TEXT,
  kind           TEXT NOT NULL
                   CHECK (kind IN ('model_call','tool_call','execution','retry')),
  model_calls    INTEGER NOT NULL DEFAULT 0,
  tokens_in      INTEGER NOT NULL DEFAULT 0,
  tokens_out     INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  tool_calls     INTEGER NOT NULL DEFAULT 0,
  retries        INTEGER NOT NULL DEFAULT 0,
  elapsed_ms     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_usage_project ON usage_records(project_id);
CREATE INDEX idx_usage_agent ON usage_records(agent_id);

-- Durable local job queue backing the scheduler/event abstraction. The
-- interface in src/scheduler is deliberately narrow so an external queue can
-- replace this table without touching callers.
CREATE TABLE jobs (
  job_id       TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  schedule_kind TEXT NOT NULL
                 CHECK (schedule_kind IN ('once','interval','event')),
  interval_ms  INTEGER,
  event_key    TEXT,
  payload      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT,
  locked_by    TEXT,
  locked_at    TEXT,
  next_run_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_jobs_due ON jobs(status, next_run_at);

-- Secrets are never stored here. A row records only where a credential lives,
-- so the Tool Gateway can resolve it from the process environment at call time.
CREATE TABLE secret_refs (
  ref_id      TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  provider    TEXT NOT NULL,
  env_var     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_id  TEXT REFERENCES projects(project_id),
  created_at  TEXT NOT NULL
);
