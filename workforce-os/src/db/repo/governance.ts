import type { Db } from '../connection.js';
import { fromBool, parseJson, toBool, toJson } from '../connection.js';
import {
  newId,
  nowIso,
  type AppendEventInput,
  type ApprovalRecord,
  type ApprovalTokenRecord,
  type EventRecord,
  type ToolCallRecord,
  type ToolDefinition,
} from '../../domain/index.js';

function mapTool(row: Record<string, unknown>): ToolDefinition {
  return {
    tool_name: row.tool_name as string,
    description: row.description as string,
    risk_class: row.risk_class as ToolDefinition['risk_class'],
    input_schema: parseJson(row.input_schema, {}),
    output_schema: parseJson(row.output_schema, {}),
    required_access_level: row.required_access_level as ToolDefinition['required_access_level'],
    required_scopes: parseJson(row.required_scopes, []),
    requires_owner_approval: toBool(row.requires_owner_approval),
    timeout_ms: Number(row.timeout_ms),
    audit_policy: row.audit_policy as ToolDefinition['audit_policy'],
    handler_key: row.handler_key as string,
    status: row.status as ToolDefinition['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapCall(row: Record<string, unknown>): ToolCallRecord {
  return {
    call_id: row.call_id as string,
    trace_id: row.trace_id as string,
    tool_name: row.tool_name as string,
    agent_id: (row.agent_id as string) ?? null,
    instance_id: (row.instance_id as string) ?? null,
    task_id: (row.task_id as string) ?? null,
    packet_id: (row.packet_id as string) ?? null,
    project_id: (row.project_id as string) ?? null,
    args: parseJson(row.args, {}),
    args_fingerprint: row.args_fingerprint as string,
    phase: row.phase as ToolCallRecord['phase'],
    decision: row.decision as ToolCallRecord['decision'],
    denial_code: (row.denial_code as string) ?? null,
    denial_reason: (row.denial_reason as string) ?? null,
    approval_token_id: (row.approval_token_id as string) ?? null,
    status: (row.status as ToolCallRecord['status']) ?? null,
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    result_summary: row.result_summary == null ? null : parseJson(row.result_summary, {}),
    error: row.error == null ? null : parseJson(row.error, {}),
    started_at: row.started_at as string,
    finished_at: (row.finished_at as string) ?? null,
  };
}

function mapApproval(row: Record<string, unknown>): ApprovalRecord {
  return {
    approval_id: row.approval_id as string,
    trace_id: row.trace_id as string,
    requested_by_agent_id: row.requested_by_agent_id as string,
    action: row.action as string,
    tool_name: (row.tool_name as string) ?? null,
    project_id: (row.project_id as string) ?? null,
    task_id: (row.task_id as string) ?? null,
    packet_id: (row.packet_id as string) ?? null,
    args: parseJson(row.args, {}),
    args_fingerprint: row.args_fingerprint as string,
    justification: row.justification as string,
    risk_class: row.risk_class as ApprovalRecord['risk_class'],
    status: row.status as ApprovalRecord['status'],
    decided_by: (row.decided_by as string) ?? null,
    decided_at: (row.decided_at as string) ?? null,
    decision_note: (row.decision_note as string) ?? null,
    expires_at: row.expires_at as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapToken(row: Record<string, unknown>): ApprovalTokenRecord {
  return {
    token_id: row.token_id as string,
    approval_id: row.approval_id as string,
    action_fingerprint: row.action_fingerprint as string,
    actor_agent_id: row.actor_agent_id as string,
    project_id: (row.project_id as string) ?? null,
    issued_at: row.issued_at as string,
    expires_at: row.expires_at as string,
    consumed_at: (row.consumed_at as string) ?? null,
    consumed_call_id: (row.consumed_call_id as string) ?? null,
    revoked_at: (row.revoked_at as string) ?? null,
  };
}

export function createGovernanceRepo(db: Db) {
  return {
    // ---- tool catalogue ----

    getTool(toolName: string): ToolDefinition | undefined {
      const row = db.get('SELECT * FROM tool_definitions WHERE tool_name = ?', toolName);
      return row ? mapTool(row) : undefined;
    },

    listTools(): ToolDefinition[] {
      return db.all('SELECT * FROM tool_definitions ORDER BY tool_name').map(mapTool);
    },

    setToolStatus(toolName: string, status: ToolDefinition['status']): void {
      db.run(
        'UPDATE tool_definitions SET status = ?, updated_at = ? WHERE tool_name = ?',
        status,
        nowIso(),
        toolName,
      );
    },

    // ---- tool calls (append-only; one settle permitted) ----

    openCall(rec: Omit<ToolCallRecord, 'finished_at' | 'duration_ms' | 'result_summary' | 'error' | 'status'>): ToolCallRecord {
      db.run(
        `INSERT INTO tool_calls (call_id, trace_id, tool_name, agent_id, instance_id, task_id,
           packet_id, project_id, args, args_fingerprint, phase, decision, denial_code,
           denial_reason, approval_token_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.call_id,
        rec.trace_id,
        rec.tool_name,
        rec.agent_id,
        rec.instance_id,
        rec.task_id,
        rec.packet_id,
        rec.project_id,
        toJson(rec.args),
        rec.args_fingerprint,
        rec.phase,
        rec.decision,
        rec.denial_code,
        rec.denial_reason,
        rec.approval_token_id,
        rec.started_at,
      );
      return { ...rec, status: null, duration_ms: null, result_summary: null, error: null, finished_at: null };
    },

    settleCall(
      callId: string,
      patch: {
        phase: 'denied' | 'executed';
        status: ToolCallRecord['status'];
        duration_ms: number;
        result_summary?: Record<string, unknown> | null;
        error?: Record<string, unknown> | null;
      },
    ): void {
      db.run(
        `UPDATE tool_calls SET phase = ?, status = ?, duration_ms = ?, result_summary = ?, error = ?,
           finished_at = ? WHERE call_id = ?`,
        patch.phase,
        patch.status,
        patch.duration_ms,
        patch.result_summary == null ? null : toJson(patch.result_summary),
        patch.error == null ? null : toJson(patch.error),
        nowIso(),
        callId,
      );
    },

    getCall(callId: string): ToolCallRecord | undefined {
      const row = db.get('SELECT * FROM tool_calls WHERE call_id = ?', callId);
      return row ? mapCall(row) : undefined;
    },

    listCalls(filter: { trace_id?: string; agent_id?: string; task_id?: string; decision?: string; limit?: number } = {}): ToolCallRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      for (const key of ['trace_id', 'agent_id', 'task_id', 'decision'] as const) {
        const value = filter[key];
        if (value) {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 200);
      return db
        .all(`SELECT * FROM tool_calls ${where} ORDER BY call_id DESC LIMIT ?`, ...params)
        .map(mapCall);
    },

    // ---- events (strictly append-only) ----

    appendEvent(input: AppendEventInput): EventRecord {
      const rec: EventRecord = {
        event_id: newId('event'),
        trace_id: input.trace_id ?? null,
        kind: input.kind,
        actor_type: input.actor_type,
        actor_id: input.actor_id ?? null,
        project_id: input.project_id ?? null,
        subject_type: input.subject_type ?? null,
        subject_id: input.subject_id ?? null,
        severity: input.severity,
        payload: input.payload,
        created_at: nowIso(),
      };
      db.run(
        `INSERT INTO events (event_id, trace_id, kind, actor_type, actor_id, project_id,
           subject_type, subject_id, severity, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.event_id,
        rec.trace_id,
        rec.kind,
        rec.actor_type,
        rec.actor_id,
        rec.project_id,
        rec.subject_type,
        rec.subject_id,
        rec.severity,
        toJson(rec.payload),
        rec.created_at,
      );
      return rec;
    },

    listEvents(filter: { trace_id?: string; kind?: string; project_id?: string; severity?: string; limit?: number } = {}): EventRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      for (const key of ['trace_id', 'kind', 'project_id', 'severity'] as const) {
        const value = filter[key];
        if (value) {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 200);
      return db.all(`SELECT * FROM events ${where} ORDER BY event_id DESC LIMIT ?`, ...params).map(
        (row): EventRecord => ({
          event_id: row.event_id as string,
          trace_id: (row.trace_id as string) ?? null,
          kind: row.kind as string,
          actor_type: row.actor_type as EventRecord['actor_type'],
          actor_id: (row.actor_id as string) ?? null,
          project_id: (row.project_id as string) ?? null,
          subject_type: (row.subject_type as string) ?? null,
          subject_id: (row.subject_id as string) ?? null,
          severity: row.severity as EventRecord['severity'],
          payload: parseJson(row.payload, {}),
          created_at: row.created_at as string,
        }),
      );
    },

    // ---- approvals ----

    insertApproval(rec: Omit<ApprovalRecord, 'created_at' | 'updated_at'>): ApprovalRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO approvals (approval_id, trace_id, requested_by_agent_id, action, tool_name,
           project_id, task_id, packet_id, args, args_fingerprint, justification, risk_class,
           status, decided_by, decided_at, decision_note, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.approval_id,
        rec.trace_id,
        rec.requested_by_agent_id,
        rec.action,
        rec.tool_name,
        rec.project_id,
        rec.task_id,
        rec.packet_id,
        toJson(rec.args),
        rec.args_fingerprint,
        rec.justification,
        rec.risk_class,
        rec.status,
        rec.decided_by,
        rec.decided_at,
        rec.decision_note,
        rec.expires_at,
        ts,
        ts,
      );
      return { ...rec, created_at: ts, updated_at: ts };
    },

    getApproval(approvalId: string): ApprovalRecord | undefined {
      const row = db.get('SELECT * FROM approvals WHERE approval_id = ?', approvalId);
      return row ? mapApproval(row) : undefined;
    },

    listApprovals(filter: { status?: string; project_id?: string; limit?: number } = {}): ApprovalRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter.project_id) {
        clauses.push('project_id = ?');
        params.push(filter.project_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 100);
      return db
        .all(`SELECT * FROM approvals ${where} ORDER BY created_at DESC LIMIT ?`, ...params)
        .map(mapApproval);
    },

    updateApproval(
      approvalId: string,
      patch: Partial<Pick<ApprovalRecord, 'status' | 'decided_by' | 'decided_at' | 'decision_note'>>,
    ): void {
      const fields: string[] = [];
      const params: (string | null)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        fields.push(`${k} = ?`);
        params.push(v as string | null);
      }
      if (fields.length === 0) return;
      fields.push('updated_at = ?');
      params.push(nowIso(), approvalId);
      db.run(`UPDATE approvals SET ${fields.join(', ')} WHERE approval_id = ?`, ...params);
    },

    // ---- approval tokens (hash only; plaintext never persisted) ----

    insertToken(rec: ApprovalTokenRecord & { token_hash: string }): void {
      db.run(
        `INSERT INTO approval_tokens (token_id, approval_id, token_hash, action_fingerprint,
           actor_agent_id, project_id, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.token_id,
        rec.approval_id,
        rec.token_hash,
        rec.action_fingerprint,
        rec.actor_agent_id,
        rec.project_id,
        rec.issued_at,
        rec.expires_at,
      );
    },

    findTokenByHash(tokenHash: string): ApprovalTokenRecord | undefined {
      const row = db.get('SELECT * FROM approval_tokens WHERE token_hash = ?', tokenHash);
      return row ? mapToken(row) : undefined;
    },

    listTokens(approvalId: string): ApprovalTokenRecord[] {
      return db
        .all('SELECT * FROM approval_tokens WHERE approval_id = ? ORDER BY issued_at DESC', approvalId)
        .map(mapToken);
    },

    consumeToken(tokenId: string, callId: string): { changes: number } {
      // The WHERE clause is the concurrency guard: a second consumer of the same
      // token matches zero rows rather than double-spending it.
      return db.run(
        'UPDATE approval_tokens SET consumed_at = ?, consumed_call_id = ? WHERE token_id = ? AND consumed_at IS NULL',
        nowIso(),
        callId,
        tokenId,
      );
    },

    revokeTokensForApproval(approvalId: string): void {
      db.run(
        'UPDATE approval_tokens SET revoked_at = ? WHERE approval_id = ? AND revoked_at IS NULL AND consumed_at IS NULL',
        nowIso(),
        approvalId,
      );
    },

    // ---- secret references (never values) ----

    listSecretRefs(): { ref_id: string; key: string; provider: string; env_var: string; description: string; project_id: string | null }[] {
      return db.all('SELECT ref_id, key, provider, env_var, description, project_id FROM secret_refs ORDER BY key') as never;
    },

    insertSecretRef(rec: { key: string; provider: string; env_var: string; description: string; project_id: string | null }): string {
      const refId = newId('secretRef');
      db.run(
        'INSERT INTO secret_refs (ref_id, key, provider, env_var, description, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        refId,
        rec.key,
        rec.provider,
        rec.env_var,
        rec.description,
        rec.project_id,
        nowIso(),
      );
      return refId;
    },

    getSecretRef(key: string): { ref_id: string; key: string; env_var: string } | undefined {
      return db.get('SELECT ref_id, key, env_var FROM secret_refs WHERE key = ?', key) as never;
    },
  };
}

export type GovernanceRepo = ReturnType<typeof createGovernanceRepo>;
export { fromBool };
