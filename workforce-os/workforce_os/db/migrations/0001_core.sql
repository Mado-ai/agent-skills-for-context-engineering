-- v0.4 core governance schema: projects, agents, versioned contracts, tasks,
-- delegation graph, work packets, approvals, tool calls and the audit event chain.

CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL
);

CREATE TABLE agents (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    name                TEXT NOT NULL,
    role                TEXT NOT NULL,
    level               INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft',
    active_version      INTEGER,
    parent_agent_id     TEXT REFERENCES agents(id),
    template_id         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    retired_at          TEXT,
    UNIQUE (project_id, name)
);
CREATE INDEX idx_agents_project ON agents(project_id);
CREATE INDEX idx_agents_role ON agents(role, status);

-- Contracts are content-addressed and immutable. An edit writes a new version row.
CREATE TABLE agent_contracts (
    id                  TEXT PRIMARY KEY,
    agent_id            TEXT NOT NULL REFERENCES agents(id),
    version             INTEGER NOT NULL,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    name                TEXT NOT NULL,
    role                TEXT NOT NULL,
    level               INTEGER NOT NULL,
    system_prompt       TEXT NOT NULL,
    allowed_tools       TEXT NOT NULL,
    data_domains        TEXT NOT NULL,
    action_types        TEXT NOT NULL,
    budget              TEXT NOT NULL,
    provider_model      TEXT NOT NULL,
    max_delegation_depth INTEGER NOT NULL,
    template_id         TEXT,
    checksum            TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    created_by          TEXT NOT NULL,
    UNIQUE (agent_id, version)
);

CREATE TRIGGER agent_contracts_immutable_update
BEFORE UPDATE ON agent_contracts
BEGIN
    SELECT RAISE(ABORT, 'agent_contracts is append-only: write a new version');
END;

CREATE TRIGGER agent_contracts_immutable_delete
BEFORE DELETE ON agent_contracts
BEGIN
    SELECT RAISE(ABORT, 'agent_contracts is append-only: contracts cannot be deleted');
END;

CREATE TABLE agent_templates (
    id              TEXT PRIMARY KEY,
    project_id      TEXT REFERENCES projects(id),  -- NULL = available to all projects
    name            TEXT NOT NULL,
    role            TEXT NOT NULL,
    level           INTEGER NOT NULL,
    prompt_template TEXT NOT NULL,
    allowed_tools   TEXT NOT NULL,
    data_domains    TEXT NOT NULL,
    action_types    TEXT NOT NULL,
    budget          TEXT NOT NULL,
    parameters      TEXT NOT NULL DEFAULT '[]',
    provider_model  TEXT NOT NULL DEFAULT 'local-echo',
    created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_templates_name ON agent_templates(name, IFNULL(project_id, ''));

CREATE TABLE tasks (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    assignee_agent_id   TEXT REFERENCES agents(id),
    created_by          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open',
    priority            INTEGER NOT NULL DEFAULT 3,
    budget              TEXT NOT NULL,
    criteria            TEXT NOT NULL DEFAULT '[]',
    result              TEXT,
    parent_task_id      TEXT REFERENCES tasks(id),
    rework_of_task_id   TEXT REFERENCES tasks(id),
    rework_count        INTEGER NOT NULL DEFAULT 0,
    depth               INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    completed_at        TEXT
);
CREATE INDEX idx_tasks_project ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_id);

CREATE TABLE work_packets (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    kind            TEXT NOT NULL,
    schema_version  INTEGER NOT NULL,
    payload         TEXT NOT NULL,
    from_agent_id   TEXT NOT NULL REFERENCES agents(id),
    to_agent_id     TEXT NOT NULL REFERENCES agents(id),
    task_id         TEXT REFERENCES tasks(id),
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL
);

CREATE TABLE delegations (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    parent_agent_id TEXT NOT NULL REFERENCES agents(id),
    child_agent_id  TEXT NOT NULL REFERENCES agents(id),
    parent_task_id  TEXT NOT NULL REFERENCES tasks(id),
    child_task_id   TEXT NOT NULL REFERENCES tasks(id),
    packet_id       TEXT REFERENCES work_packets(id),
    depth           INTEGER NOT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_delegations_parent ON delegations(parent_agent_id);
CREATE INDEX idx_delegations_child ON delegations(child_agent_id);

CREATE TABLE approval_requests (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    agent_id            TEXT NOT NULL REFERENCES agents(id),
    task_id             TEXT REFERENCES tasks(id),
    tool_name           TEXT NOT NULL,
    arguments_hash      TEXT NOT NULL,
    arguments_redacted  TEXT NOT NULL,
    risk_level          TEXT NOT NULL,
    reason              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at          TEXT NOT NULL,
    decided_at          TEXT,
    decided_by          TEXT,
    decision_note       TEXT
);
CREATE INDEX idx_approvals_status ON approval_requests(status, project_id);

CREATE TABLE approval_tokens (
    id              TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL REFERENCES approval_requests(id),
    token_hash      TEXT NOT NULL UNIQUE,
    agent_id        TEXT NOT NULL REFERENCES agents(id),
    tool_name       TEXT NOT NULL,
    arguments_hash  TEXT NOT NULL,
    issued_at       TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    used_at         TEXT,
    revoked_at      TEXT
);

CREATE TABLE tool_calls (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    agent_id            TEXT NOT NULL REFERENCES agents(id),
    task_id             TEXT REFERENCES tasks(id),
    tool_name           TEXT NOT NULL,
    arguments_redacted  TEXT NOT NULL,
    decision            TEXT NOT NULL,          -- allowed | denied
    reason_code         TEXT NOT NULL,
    status              TEXT NOT NULL,          -- executed | attempted | denied
    confirmed           INTEGER NOT NULL DEFAULT 0,
    result_redacted     TEXT,
    error               TEXT,
    cost_usd            REAL NOT NULL DEFAULT 0,
    latency_ms          REAL NOT NULL DEFAULT 0,
    approval_token_id   TEXT REFERENCES approval_tokens(id),
    created_at          TEXT NOT NULL
);
CREATE INDEX idx_tool_calls_agent ON tool_calls(agent_id, created_at);
CREATE INDEX idx_tool_calls_project ON tool_calls(project_id, created_at);

-- Append-only, hash-chained audit trail.
CREATE TABLE events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    id          TEXT NOT NULL UNIQUE,
    project_id  TEXT,
    actor_type  TEXT NOT NULL,      -- owner | agent | system
    actor_id    TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_events_project ON events(project_id, seq);
CREATE INDEX idx_events_type ON events(event_type, seq);

CREATE TRIGGER events_immutable_update
BEFORE UPDATE ON events
BEGIN
    SELECT RAISE(ABORT, 'events is append-only');
END;

CREATE TRIGGER events_immutable_delete
BEFORE DELETE ON events
BEGIN
    SELECT RAISE(ABORT, 'events is append-only');
END;
