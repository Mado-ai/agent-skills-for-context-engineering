import { createHash } from 'node:crypto';
import type { Db } from '../connection.js';
import { parseJson, toJson } from '../connection.js';
import {
  newId,
  nowIso,
  type Priority,
  type TaskArtifactRecord,
  type TaskRecord,
  type TaskStatus,
  type WorkPacketRecord,
} from '../../domain/index.js';

function mapTask(row: Record<string, unknown>): TaskRecord {
  return {
    task_id: row.task_id as string,
    project_id: row.project_id as string,
    loop_id: (row.loop_id as string) ?? null,
    parent_task_id: (row.parent_task_id as string) ?? null,
    trace_id: row.trace_id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    assigned_agent_id: (row.assigned_agent_id as string) ?? null,
    created_by: row.created_by as string,
    input: parseJson(row.input, {}),
    result: row.result == null ? null : parseJson(row.result, {}),
    attempt: Number(row.attempt),
    max_attempts: Number(row.max_attempts),
    deadline_at: (row.deadline_at as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapPacket(row: Record<string, unknown>): WorkPacketRecord {
  return {
    packet_id: row.packet_id as string,
    trace_id: row.trace_id as string,
    task_id: row.task_id as string,
    sender_agent_id: row.sender_agent_id as string,
    receiver_agent_id: row.receiver_agent_id as string,
    parent_packet_id: (row.parent_packet_id as string) ?? null,
    project_id: row.project_id as string,
    workflow_loop_id: (row.workflow_loop_id as string) ?? null,
    intent: row.intent as WorkPacketRecord['intent'],
    objective: row.objective as string,
    context_refs: parseJson(row.context_refs, []),
    input_payload: parseJson(row.input_payload, {}),
    allowed_tools: parseJson(row.allowed_tools, []),
    data_scope: parseJson(row.data_scope, {}),
    expected_output_schema: parseJson(row.expected_output_schema, {}),
    acceptance_criteria: parseJson(row.acceptance_criteria, []),
    quality_gate_ids: parseJson(row.quality_gate_ids, []),
    priority: row.priority as Priority,
    budget: parseJson(row.budget, {}),
    deadline_at: (row.deadline_at as string) ?? null,
    ttl_seconds: row.ttl_seconds == null ? null : Number(row.ttl_seconds),
    escalation_target: (row.escalation_target as string) ?? null,
    status: row.status as WorkPacketRecord['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapArtifact(row: Record<string, unknown>): TaskArtifactRecord {
  return {
    artifact_id: row.artifact_id as string,
    task_id: row.task_id as string,
    packet_id: (row.packet_id as string) ?? null,
    agent_id: row.agent_id as string,
    project_id: row.project_id as string,
    trace_id: row.trace_id as string,
    kind: row.kind as string,
    content: parseJson(row.content, {}),
    content_hash: row.content_hash as string,
    provenance: parseJson(row.provenance, {}),
    attempt: Number(row.attempt),
    created_at: row.created_at as string,
  };
}

export function createTaskRepo(db: Db) {
  return {
    insertTask(rec: Omit<TaskRecord, 'created_at' | 'updated_at'>): TaskRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO tasks (task_id, project_id, loop_id, parent_task_id, trace_id, title, description,
           status, priority, assigned_agent_id, created_by, input, result, attempt, max_attempts,
           deadline_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.task_id,
        rec.project_id,
        rec.loop_id,
        rec.parent_task_id,
        rec.trace_id,
        rec.title,
        rec.description,
        rec.status,
        rec.priority,
        rec.assigned_agent_id,
        rec.created_by,
        toJson(rec.input),
        rec.result == null ? null : toJson(rec.result),
        rec.attempt,
        rec.max_attempts,
        rec.deadline_at,
        ts,
        ts,
      );
      return { ...rec, created_at: ts, updated_at: ts };
    },

    getTask(taskId: string): TaskRecord | undefined {
      const row = db.get('SELECT * FROM tasks WHERE task_id = ?', taskId);
      return row ? mapTask(row) : undefined;
    },

    listTasks(filter: { project_id?: string; status?: string; assigned_agent_id?: string; limit?: number } = {}): TaskRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.project_id) {
        clauses.push('project_id = ?');
        params.push(filter.project_id);
      }
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter.assigned_agent_id) {
        clauses.push('assigned_agent_id = ?');
        params.push(filter.assigned_agent_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 200);
      return db.all(`SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`, ...params).map(mapTask);
    },

    updateTask(
      taskId: string,
      patch: Partial<Pick<TaskRecord, 'status' | 'assigned_agent_id' | 'result' | 'attempt' | 'priority' | 'deadline_at' | 'loop_id'>>,
    ): void {
      const fields: string[] = [];
      const params: (string | number | null)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        fields.push(`${k} = ?`);
        params.push(k === 'result' ? (v == null ? null : toJson(v)) : (v as string | number | null));
      }
      if (fields.length === 0) return;
      fields.push('updated_at = ?');
      params.push(nowIso(), taskId);
      db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE task_id = ?`, ...params);
    },

    // ---- work packets ----

    insertPacket(rec: Omit<WorkPacketRecord, 'created_at' | 'updated_at'>): WorkPacketRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO work_packets (packet_id, trace_id, task_id, sender_agent_id, receiver_agent_id,
           parent_packet_id, project_id, workflow_loop_id, intent, objective, context_refs,
           input_payload, allowed_tools, data_scope, expected_output_schema, acceptance_criteria,
           quality_gate_ids, priority, budget, deadline_at, ttl_seconds, escalation_target, status,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.packet_id,
        rec.trace_id,
        rec.task_id,
        rec.sender_agent_id,
        rec.receiver_agent_id,
        rec.parent_packet_id,
        rec.project_id,
        rec.workflow_loop_id,
        rec.intent,
        rec.objective,
        toJson(rec.context_refs),
        toJson(rec.input_payload),
        toJson(rec.allowed_tools),
        toJson(rec.data_scope),
        toJson(rec.expected_output_schema),
        toJson(rec.acceptance_criteria),
        toJson(rec.quality_gate_ids),
        rec.priority,
        toJson(rec.budget),
        rec.deadline_at,
        rec.ttl_seconds,
        rec.escalation_target,
        rec.status,
        ts,
        ts,
      );
      return { ...rec, created_at: ts, updated_at: ts };
    },

    getPacket(packetId: string): WorkPacketRecord | undefined {
      const row = db.get('SELECT * FROM work_packets WHERE packet_id = ?', packetId);
      return row ? mapPacket(row) : undefined;
    },

    listPackets(filter: { task_id?: string; trace_id?: string; receiver_agent_id?: string; status?: string; limit?: number } = {}): WorkPacketRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      for (const key of ['task_id', 'trace_id', 'receiver_agent_id', 'status'] as const) {
        const value = filter[key];
        if (value) {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 200);
      return db
        .all(`SELECT * FROM work_packets ${where} ORDER BY created_at ASC LIMIT ?`, ...params)
        .map(mapPacket);
    },

    setPacketStatus(packetId: string, status: WorkPacketRecord['status']): void {
      db.run(
        'UPDATE work_packets SET status = ?, updated_at = ? WHERE packet_id = ?',
        status,
        nowIso(),
        packetId,
      );
    },

    // ---- artifacts ----

    insertArtifact(
      rec: Omit<TaskArtifactRecord, 'artifact_id' | 'content_hash' | 'created_at'> & { artifact_id?: string },
    ): TaskArtifactRecord {
      const ts = nowIso();
      const artifactId = rec.artifact_id ?? newId('artifact');
      const contentHash = createHash('sha256').update(toJson(rec.content)).digest('hex');
      db.run(
        `INSERT INTO task_artifacts (artifact_id, task_id, packet_id, agent_id, project_id, trace_id,
           kind, content, content_hash, provenance, attempt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        artifactId,
        rec.task_id,
        rec.packet_id,
        rec.agent_id,
        rec.project_id,
        rec.trace_id,
        rec.kind,
        toJson(rec.content),
        contentHash,
        toJson(rec.provenance),
        rec.attempt,
        ts,
      );
      return { ...rec, artifact_id: artifactId, content_hash: contentHash, created_at: ts };
    },

    getArtifact(artifactId: string): TaskArtifactRecord | undefined {
      const row = db.get('SELECT * FROM task_artifacts WHERE artifact_id = ?', artifactId);
      return row ? mapArtifact(row) : undefined;
    },

    listArtifacts(taskId: string): TaskArtifactRecord[] {
      return db
        .all('SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at ASC', taskId)
        .map(mapArtifact);
    },

    /** Used by the duplication check: same content already accepted elsewhere. */
    findArtifactsByHash(projectId: string, contentHash: string, excludeArtifactId: string): TaskArtifactRecord[] {
      return db
        .all(
          'SELECT * FROM task_artifacts WHERE project_id = ? AND content_hash = ? AND artifact_id <> ?',
          projectId,
          contentHash,
          excludeArtifactId,
        )
        .map(mapArtifact);
    },
  };
}

export type TaskRepo = ReturnType<typeof createTaskRepo>;
