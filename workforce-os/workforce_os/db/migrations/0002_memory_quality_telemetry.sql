-- v0.4 memory layers, quality/CAPA loop, budget ledger, telemetry and scheduler.

CREATE TABLE memory_records (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    layer       TEXT NOT NULL,          -- working | episodic | semantic
    agent_id    TEXT REFERENCES agents(id),
    task_id     TEXT REFERENCES tasks(id),
    key         TEXT NOT NULL,
    content     TEXT NOT NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    provenance  TEXT NOT NULL,          -- author agent, source, origin kind, derivation
    confidence  REAL NOT NULL DEFAULT 1.0,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_memory_scope ON memory_records(project_id, layer);
CREATE INDEX idx_memory_task ON memory_records(task_id);
CREATE INDEX idx_memory_agent ON memory_records(agent_id);

CREATE TABLE evaluations (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    task_id             TEXT NOT NULL REFERENCES tasks(id),
    evaluator_agent_id  TEXT NOT NULL REFERENCES agents(id),
    verdict             TEXT NOT NULL,  -- pass | fail
    score               REAL NOT NULL,
    threshold           REAL NOT NULL,
    criteria            TEXT NOT NULL,
    findings            TEXT NOT NULL DEFAULT '[]',
    created_at          TEXT NOT NULL
);
CREATE INDEX idx_evaluations_task ON evaluations(task_id, created_at);

CREATE TABLE capa_records (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    task_id             TEXT NOT NULL REFERENCES tasks(id),
    status              TEXT NOT NULL DEFAULT 'open',   -- open | closed
    trigger_reason      TEXT NOT NULL,
    rework_count        INTEGER NOT NULL,
    root_cause          TEXT,
    corrective_action   TEXT,
    preventive_action   TEXT,
    opened_at           TEXT NOT NULL,
    closed_at           TEXT,
    closed_by           TEXT
);
CREATE INDEX idx_capa_task ON capa_records(task_id, status);

CREATE TABLE budget_ledger (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    agent_id    TEXT NOT NULL REFERENCES agents(id),
    task_id     TEXT REFERENCES tasks(id),
    kind        TEXT NOT NULL,          -- tool_call | provider_call | instantiation
    amount_usd  REAL NOT NULL DEFAULT 0,
    tokens      INTEGER NOT NULL DEFAULT 0,
    calls       INTEGER NOT NULL DEFAULT 1,
    ref_id      TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_ledger_agent ON budget_ledger(agent_id);
CREATE INDEX idx_ledger_task ON budget_ledger(task_id);

CREATE TABLE metrics (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    agent_id    TEXT REFERENCES agents(id),
    task_id     TEXT REFERENCES tasks(id),
    metric      TEXT NOT NULL,          -- cost_usd | latency_ms | tokens
    value       REAL NOT NULL,
    unit        TEXT NOT NULL,
    source      TEXT NOT NULL,          -- tool_call | provider_call
    ref_id      TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_metrics_scope ON metrics(project_id, metric, created_at);

CREATE TABLE scheduler_jobs (
    id          TEXT PRIMARY KEY,
    project_id  TEXT REFERENCES projects(id),
    kind        TEXT NOT NULL,
    run_at      TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | claimed | done | failed
    attempts    INTEGER NOT NULL DEFAULT 0,
    claimed_at  TEXT,
    claimed_by  TEXT,
    last_error  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_jobs_due ON scheduler_jobs(status, run_at);
