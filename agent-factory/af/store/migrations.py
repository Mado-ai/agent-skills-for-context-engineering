"""Versioned schema.

Design notes that matter for scale, not style:

* **Every row that belongs to a tenant carries ``project_id`` directly** rather
  than reaching it through a join. Isolation is enforced as a predicate on the
  row itself, which is what makes the PostgreSQL migration a matter of turning
  on row-level security with a single policy shape per table (ADR-0002).
* **The task claim index is the single most important index in the system.**
  ``idx_tasks_claim`` covers exactly the predicate the queue claim uses; without
  it the claim degrades to a full scan and throughput collapses as the table
  grows. This was measured, not assumed — see V04_PERFORMANCE_REPORT.md.
* **Partial indexes** (``WHERE status = ...``) keep the hot indexes proportional
  to the *runnable* backlog rather than to total history. A finished task leaves
  the index. This is what lets a table with a million completed rows still claim
  in constant time.
* IDs are ULID-style text, so primary-key order equals creation order and
  inserts stay append-mostly.
"""

from __future__ import annotations

__all__ = ["MIGRATIONS", "SCHEMA_VERSION"]

# Each entry is (version, [statements]). Applied in order inside one transaction
# per version, recorded in schema_migrations. Never edit an applied migration —
# append a new one.
MIGRATIONS: list[tuple[int, list[str]]] = [
    (
        1,
        [
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version     INTEGER PRIMARY KEY,
                applied_at  REAL NOT NULL
            )
            """,
            # --- Tenancy -------------------------------------------------
            """
            CREATE TABLE IF NOT EXISTS projects (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL UNIQUE,
                status      TEXT NOT NULL DEFAULT 'active',
                created_at  REAL NOT NULL,
                metadata    TEXT NOT NULL DEFAULT '{}'
            )
            """,
            # --- Agent definition ----------------------------------------
            """
            CREATE TABLE IF NOT EXISTS agent_templates (
                id              TEXT PRIMARY KEY,
                project_id      TEXT,               -- NULL = system-wide template
                name            TEXT NOT NULL,
                role            TEXT NOT NULL,
                level           INTEGER NOT NULL,
                latest_version  INTEGER NOT NULL DEFAULT 0,
                active_contract_id TEXT,
                created_by      TEXT NOT NULL,
                created_at      REAL NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
            """,
            # A template name is unique per project. COALESCE gives system-wide
            # templates (project_id NULL) their own namespace instead of letting
            # NULL defeat the uniqueness constraint.
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name
                ON agent_templates (COALESCE(project_id, '~system'), name)
            """,
            """
            CREATE TABLE IF NOT EXISTS agent_contracts (
                id            TEXT PRIMARY KEY,
                template_id   TEXT NOT NULL,
                version       INTEGER NOT NULL,
                project_id    TEXT,
                state         TEXT NOT NULL,
                spec          TEXT NOT NULL,          -- canonical JSON
                content_hash  TEXT NOT NULL,          -- sha256 of canonical spec
                validation    TEXT NOT NULL DEFAULT '{}',
                created_by    TEXT NOT NULL,
                approved_by   TEXT,
                approved_at   REAL,
                created_at    REAL NOT NULL,
                updated_at    REAL NOT NULL,
                UNIQUE (template_id, version),
                FOREIGN KEY (template_id) REFERENCES agent_templates(id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_contracts_state ON agent_contracts (state, project_id)",
            # Deduplication support: identical contract bodies collide on hash.
            "CREATE INDEX IF NOT EXISTS idx_contracts_hash ON agent_contracts (content_hash)",
            # --- Agent instances -----------------------------------------
            """
            CREATE TABLE IF NOT EXISTS agent_instances (
                id            TEXT PRIMARY KEY,
                contract_id   TEXT NOT NULL,
                template_id   TEXT NOT NULL,
                project_id    TEXT NOT NULL,
                state         TEXT NOT NULL,
                parent_id     TEXT,
                depth         INTEGER NOT NULL DEFAULT 0,
                spawned_by    TEXT,                   -- task id that caused the spawn
                inflight      INTEGER NOT NULL DEFAULT 0,
                completed     INTEGER NOT NULL DEFAULT 0,
                failed        INTEGER NOT NULL DEFAULT 0,
                created_at    REAL NOT NULL,
                last_active_at REAL NOT NULL,
                retired_at    REAL,
                FOREIGN KEY (contract_id) REFERENCES agent_contracts(id),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
            """,
            # Idle-instance reaping and capacity lookup both hit this.
            """
            CREATE INDEX IF NOT EXISTS idx_instances_live
                ON agent_instances (project_id, template_id, last_active_at)
                WHERE state = 'ACTIVE'
            """,
            "CREATE INDEX IF NOT EXISTS idx_instances_parent ON agent_instances (parent_id)",
            # --- Work packets / tasks ------------------------------------
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id               TEXT PRIMARY KEY,
                trace_id         TEXT NOT NULL,
                root_id          TEXT NOT NULL,
                parent_id        TEXT,
                project_id       TEXT NOT NULL,
                workflow_id      TEXT,
                sender_agent_id  TEXT,
                receiver_instance_id TEXT,
                receiver_template_id TEXT,
                objective        TEXT NOT NULL,
                packet           TEXT NOT NULL,       -- full WorkPacket JSON
                status           TEXT NOT NULL,
                priority         INTEGER NOT NULL DEFAULT 100,
                depth            INTEGER NOT NULL DEFAULT 0,
                attempts         INTEGER NOT NULL DEFAULT 0,
                max_attempts     INTEGER NOT NULL DEFAULT 3,
                pending_deps     INTEGER NOT NULL DEFAULT 0,
                available_at     REAL NOT NULL,
                lease_owner      TEXT,
                lease_expires_at REAL,
                deadline_at      REAL,
                idempotency_key  TEXT,
                result           TEXT,
                error            TEXT,
                dlq_reason       TEXT,
                created_at       REAL NOT NULL,
                started_at       REAL,
                finished_at      REAL
            )
            """,
            # THE claim index, and the single most load-bearing line in the
            # schema. Column order is (priority, available_at, id) to match the
            # claim's ORDER BY exactly, so the planner walks the index in output
            # order and stops at LIMIT without materialising or sorting the
            # backlog. Putting available_at first instead — the intuitive
            # choice, since it is the filtered column — forces a sort of every
            # runnable row on every claim, and claim latency then grows with
            # queue depth. Measured: see V04_PERFORMANCE_REPORT.md.
            """
            CREATE INDEX IF NOT EXISTS idx_tasks_claim
                ON tasks (priority, available_at, id)
                WHERE status = 'READY'
            """,
            # Lease-expiry sweep (crashed workers). Partial: only leased rows.
            """
            CREATE INDEX IF NOT EXISTS idx_tasks_lease
                ON tasks (lease_expires_at)
                WHERE status = 'RUNNING'
            """,
            # Fan-in: find children of a parent to decide completion.
            "CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_root ON tasks (root_id)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_trace ON tasks (trace_id)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks (project_id, status)",
            # Idempotency: at most one live task per key. Enforced by the DB so
            # concurrent duplicate submits collide here rather than racing.
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idem
                ON tasks (project_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL
            """,
            """
            CREATE TABLE IF NOT EXISTS task_deps (
                task_id     TEXT NOT NULL,
                depends_on  TEXT NOT NULL,
                PRIMARY KEY (task_id, depends_on)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_deps_reverse ON task_deps (depends_on)",
            # --- Observability -------------------------------------------
            """
            CREATE TABLE IF NOT EXISTS events (
                id           TEXT PRIMARY KEY,
                ts           REAL NOT NULL,
                type         TEXT NOT NULL,
                category     TEXT NOT NULL DEFAULT 'runtime',
                trace_id     TEXT,
                span_id      TEXT,
                parent_span  TEXT,
                task_id      TEXT,
                agent_id     TEXT,
                project_id   TEXT,
                workflow_id  TEXT,
                status       TEXT,
                duration_ms  REAL,
                cost_micros  INTEGER,
                tokens_in    INTEGER,
                tokens_out   INTEGER,
                model        TEXT,
                provider     TEXT,
                tool         TEXT,
                error_code   TEXT,
                actor        TEXT,
                payload      TEXT NOT NULL DEFAULT '{}'
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_events_trace ON events (trace_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_events_task ON events (task_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events (project_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events (type, ts)",
            # Audit queries ("who approved what") must not scan runtime events.
            """
            CREATE INDEX IF NOT EXISTS idx_events_audit
                ON events (ts) WHERE category = 'audit'
            """,
            """
            CREATE TABLE IF NOT EXISTS usage_ledger (
                id           TEXT PRIMARY KEY,
                ts           REAL NOT NULL,
                project_id   TEXT NOT NULL,
                task_id      TEXT,
                agent_id     TEXT,
                template_id  TEXT,
                model        TEXT,
                provider     TEXT,
                tokens_in    INTEGER NOT NULL DEFAULT 0,
                tokens_out   INTEGER NOT NULL DEFAULT 0,
                model_cost_micros INTEGER NOT NULL DEFAULT 0,
                tool_cost_micros  INTEGER NOT NULL DEFAULT 0,
                duration_ms  REAL NOT NULL DEFAULT 0,
                queue_ms     REAL NOT NULL DEFAULT 0,
                retries      INTEGER NOT NULL DEFAULT 0
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_usage_project_ts ON usage_ledger (project_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_usage_task ON usage_ledger (task_id)",
            # Budget counters are updated in place; the ledger above is the
            # append-only detail these aggregate. Keeping both means budget
            # checks are O(1) instead of a SUM over history.
            """
            CREATE TABLE IF NOT EXISTS budgets (
                scope_type   TEXT NOT NULL,          -- system|project|team|agent|task
                scope_id     TEXT NOT NULL,
                project_id   TEXT,
                cost_limit_micros INTEGER,
                token_limit  INTEGER,
                task_limit   INTEGER,
                spend_micros INTEGER NOT NULL DEFAULT 0,
                tokens_used  INTEGER NOT NULL DEFAULT 0,
                tasks_used   INTEGER NOT NULL DEFAULT 0,
                window_start REAL,
                window_seconds REAL,
                updated_at   REAL NOT NULL,
                PRIMARY KEY (scope_type, scope_id)
            )
            """,
            # --- Governance ----------------------------------------------
            """
            CREATE TABLE IF NOT EXISTS approvals (
                id            TEXT PRIMARY KEY,
                project_id    TEXT NOT NULL,
                task_id       TEXT,
                requesting_agent_id TEXT NOT NULL,
                action        TEXT NOT NULL,
                tool_id       TEXT,
                risk_level    TEXT NOT NULL,
                reason        TEXT NOT NULL,
                params        TEXT NOT NULL DEFAULT '{}',
                params_hash   TEXT NOT NULL,
                status        TEXT NOT NULL,          -- PENDING|APPROVED|DENIED|EXPIRED
                created_at    REAL NOT NULL,
                expires_at    REAL NOT NULL,
                decided_at    REAL,
                decided_by    TEXT,
                decision_note TEXT
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals (project_id, created_at) WHERE status = 'PENDING'",
            """
            CREATE TABLE IF NOT EXISTS exec_tokens (
                id           TEXT PRIMARY KEY,
                approval_id  TEXT NOT NULL,
                project_id   TEXT NOT NULL,
                agent_id     TEXT NOT NULL,
                task_id      TEXT,
                tool_id      TEXT NOT NULL,
                params_hash  TEXT NOT NULL,
                secret_hash  TEXT NOT NULL,           -- sha256 of the bearer secret
                max_uses     INTEGER NOT NULL DEFAULT 1,
                uses         INTEGER NOT NULL DEFAULT 0,
                created_at   REAL NOT NULL,
                expires_at   REAL NOT NULL,
                consumed_at  REAL,
                revoked_at   REAL,
                FOREIGN KEY (approval_id) REFERENCES approvals(id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS tool_calls (
                id           TEXT PRIMARY KEY,
                ts           REAL NOT NULL,
                task_id      TEXT,
                agent_id     TEXT NOT NULL,
                project_id   TEXT NOT NULL,
                tool_id      TEXT NOT NULL,
                risk_level   TEXT NOT NULL,
                args_hash    TEXT NOT NULL,
                args_preview TEXT,
                status       TEXT NOT NULL,
                token_id     TEXT,
                duration_ms  REAL,
                cost_micros  INTEGER NOT NULL DEFAULT 0,
                error_code   TEXT
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_toolcalls_task ON tool_calls (task_id, ts)",
            "CREATE INDEX IF NOT EXISTS idx_toolcalls_project ON tool_calls (project_id, ts)",
            # Rate limiting reads this; needs to be fast per (agent, tool, window).
            "CREATE INDEX IF NOT EXISTS idx_toolcalls_rate ON tool_calls (agent_id, tool_id, ts)",
            # --- Memory ---------------------------------------------------
            """
            CREATE TABLE IF NOT EXISTS memory_records (
                id           TEXT PRIMARY KEY,
                layer        TEXT NOT NULL,
                project_id   TEXT,                    -- NULL only for shared_org layer
                agent_id     TEXT,
                template_id  TEXT,
                task_id      TEXT,
                mkey         TEXT NOT NULL,
                content      TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT 'text',
                trust        TEXT NOT NULL,           -- authoritative|verified|derived|unverified
                source       TEXT NOT NULL,
                provenance   TEXT NOT NULL DEFAULT '{}',
                version      INTEGER NOT NULL DEFAULT 1,
                supersedes   TEXT,
                tags         TEXT NOT NULL DEFAULT '[]',
                created_at   REAL NOT NULL,
                expires_at   REAL,
                deleted_at   REAL
            )
            """,
            # Retrieval is always scoped by (layer, project) first — the shape
            # that makes cross-project leakage impossible to express by accident.
            """
            CREATE INDEX IF NOT EXISTS idx_memory_scope
                ON memory_records (layer, project_id, mkey)
                WHERE deleted_at IS NULL
            """,
            "CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_records (agent_id, layer) WHERE deleted_at IS NULL",
            "CREATE INDEX IF NOT EXISTS idx_memory_task ON memory_records (task_id) WHERE deleted_at IS NULL",
            # Retention sweep.
            "CREATE INDEX IF NOT EXISTS idx_memory_expiry ON memory_records (expires_at) WHERE deleted_at IS NULL",
            # --- Quality --------------------------------------------------
            """
            CREATE TABLE IF NOT EXISTS quality_reviews (
                id           TEXT PRIMARY KEY,
                task_id      TEXT NOT NULL,
                project_id   TEXT NOT NULL,
                gate_id      TEXT NOT NULL,
                verdict      TEXT NOT NULL,           -- PASS|REWORK|ESCALATE|REJECT
                score        REAL,
                confidence   REAL,
                reviewer_type TEXT NOT NULL,          -- automated|peer|master|chief|owner
                reviewer_id  TEXT,
                findings     TEXT NOT NULL DEFAULT '[]',
                attempt      INTEGER NOT NULL DEFAULT 1,
                created_at   REAL NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_reviews_task ON quality_reviews (task_id, created_at)",
            """
            CREATE TABLE IF NOT EXISTS capa_records (
                id              TEXT PRIMARY KEY,
                project_id      TEXT NOT NULL,
                task_id         TEXT NOT NULL,
                review_id       TEXT,
                issue           TEXT NOT NULL,
                root_cause      TEXT,
                corrective_action TEXT,
                status          TEXT NOT NULL,        -- OPEN|ACTION_PROPOSED|REEXECUTED|VERIFIED|CLOSED
                rework_task_id  TEXT,
                opened_at       REAL NOT NULL,
                verified_at     REAL,
                closed_at       REAL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_capa_task ON capa_records (task_id)",
            "CREATE INDEX IF NOT EXISTS idx_capa_open ON capa_records (project_id) WHERE status != 'CLOSED'",
        ],
    ),
    (
        2,
        [
            # Capability search was O(contracts): it loaded every ACTIVE contract
            # and JSON-parsed each spec in Python to read its capability list.
            # Measured p95 grew linearly — 2.1ms at 100 templates, 210ms at
            # 10,000 — and the Chief runs this on every planning cycle, so the
            # planner would have become the bottleneck well before the runtime.
            # Normalising capabilities into their own indexed table turns that
            # scan into an index probe over short strings.
            """
            CREATE TABLE IF NOT EXISTS agent_capabilities (
                contract_id  TEXT NOT NULL,
                template_id  TEXT NOT NULL,
                project_id   TEXT,
                capability   TEXT NOT NULL,
                state        TEXT NOT NULL,
                PRIMARY KEY (contract_id, capability)
            )
            """,
            # Exact-match probe, the fast path.
            """
            CREATE INDEX IF NOT EXISTS idx_capabilities_lookup
                ON agent_capabilities (capability, project_id)
                WHERE state = 'ACTIVE'
            """,
            "CREATE INDEX IF NOT EXISTS idx_capabilities_template ON agent_capabilities (template_id)",
        ],
    ),
]

SCHEMA_VERSION = MIGRATIONS[-1][0]
