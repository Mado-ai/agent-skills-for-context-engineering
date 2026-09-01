import type { Db } from '../connection.js';
import { fromBool, parseJson, toBool, toJson } from '../connection.js';
import {
  newId,
  nowIso,
  type CapaRecord,
  type CapaState,
  type QualityEvaluationRecord,
  type QualityGateRecord,
} from '../../domain/index.js';

function mapGate(row: Record<string, unknown>): QualityGateRecord {
  return {
    gate_id: row.gate_id as string,
    key: row.key as string,
    name: row.name as string,
    description: row.description as string,
    checks: parseJson(row.checks, []),
    threshold: Number(row.threshold),
    blocking: toBool(row.blocking),
    separation_of_duties: toBool(row.separation_of_duties),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapEval(row: Record<string, unknown>): QualityEvaluationRecord {
  return {
    evaluation_id: row.evaluation_id as string,
    gate_id: row.gate_id as string,
    task_id: row.task_id as string,
    packet_id: (row.packet_id as string) ?? null,
    artifact_id: (row.artifact_id as string) ?? null,
    project_id: row.project_id as string,
    trace_id: row.trace_id as string,
    evaluator_agent_id: (row.evaluator_agent_id as string) ?? null,
    evaluator_kind: row.evaluator_kind as QualityEvaluationRecord['evaluator_kind'],
    passed: toBool(row.passed),
    score: Number(row.score),
    results: parseJson(row.results, []),
    attempt: Number(row.attempt),
    created_at: row.created_at as string,
  };
}

function mapCapa(row: Record<string, unknown>): CapaRecord {
  return {
    capa_id: row.capa_id as string,
    project_id: row.project_id as string,
    task_id: (row.task_id as string) ?? null,
    agent_id: (row.agent_id as string) ?? null,
    trace_id: (row.trace_id as string) ?? null,
    issue: row.issue as string,
    root_cause_hypothesis: row.root_cause_hypothesis as string,
    corrective_action: row.corrective_action as string,
    preventive_action: row.preventive_action as string,
    owner_agent_id: (row.owner_agent_id as string) ?? null,
    owner_human: (row.owner_human as string) ?? null,
    state: row.state as CapaState,
    verification_result: (row.verification_result as string) ?? null,
    evidence: parseJson(row.evidence, {}),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createQualityRepo(db: Db) {
  return {
    getGate(gateId: string): QualityGateRecord | undefined {
      const row = db.get('SELECT * FROM quality_gates WHERE gate_id = ?', gateId);
      return row ? mapGate(row) : undefined;
    },

    getGateByKey(key: string): QualityGateRecord | undefined {
      const row = db.get('SELECT * FROM quality_gates WHERE key = ?', key);
      return row ? mapGate(row) : undefined;
    },

    listGates(): QualityGateRecord[] {
      return db.all('SELECT * FROM quality_gates ORDER BY key').map(mapGate);
    },

    insertGate(rec: Omit<QualityGateRecord, 'created_at' | 'updated_at'>): QualityGateRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO quality_gates (gate_id, key, name, description, checks, threshold, blocking,
           separation_of_duties, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.gate_id,
        rec.key,
        rec.name,
        rec.description,
        toJson(rec.checks),
        rec.threshold,
        fromBool(rec.blocking),
        fromBool(rec.separation_of_duties),
        ts,
        ts,
      );
      return { ...rec, created_at: ts, updated_at: ts };
    },

    insertEvaluation(rec: Omit<QualityEvaluationRecord, 'evaluation_id' | 'created_at'>): QualityEvaluationRecord {
      const ts = nowIso();
      const id = newId('evaluation');
      db.run(
        `INSERT INTO quality_evaluations (evaluation_id, gate_id, task_id, packet_id, artifact_id,
           project_id, trace_id, evaluator_agent_id, evaluator_kind, passed, score, results,
           attempt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        rec.gate_id,
        rec.task_id,
        rec.packet_id,
        rec.artifact_id,
        rec.project_id,
        rec.trace_id,
        rec.evaluator_agent_id,
        rec.evaluator_kind,
        fromBool(rec.passed),
        rec.score,
        toJson(rec.results),
        rec.attempt,
        ts,
      );
      return { ...rec, evaluation_id: id, created_at: ts };
    },

    listEvaluations(filter: { task_id?: string; project_id?: string; passed?: boolean; limit?: number } = {}): QualityEvaluationRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.task_id) {
        clauses.push('task_id = ?');
        params.push(filter.task_id);
      }
      if (filter.project_id) {
        clauses.push('project_id = ?');
        params.push(filter.project_id);
      }
      if (filter.passed !== undefined) {
        clauses.push('passed = ?');
        params.push(fromBool(filter.passed));
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 200);
      return db
        .all(`SELECT * FROM quality_evaluations ${where} ORDER BY created_at DESC LIMIT ?`, ...params)
        .map(mapEval);
    },

    countFailures(taskId: string): number {
      const row = db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM quality_evaluations WHERE task_id = ? AND passed = 0',
        taskId,
      );
      return Number(row?.n ?? 0);
    },

    insertCapa(rec: Omit<CapaRecord, 'capa_id' | 'created_at' | 'updated_at'>): CapaRecord {
      const ts = nowIso();
      const id = newId('capa');
      db.run(
        `INSERT INTO capa_records (capa_id, project_id, task_id, agent_id, trace_id, issue,
           root_cause_hypothesis, corrective_action, preventive_action, owner_agent_id, owner_human,
           state, verification_result, evidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        rec.project_id,
        rec.task_id,
        rec.agent_id,
        rec.trace_id,
        rec.issue,
        rec.root_cause_hypothesis,
        rec.corrective_action,
        rec.preventive_action,
        rec.owner_agent_id,
        rec.owner_human,
        rec.state,
        rec.verification_result,
        toJson(rec.evidence),
        ts,
        ts,
      );
      return { ...rec, capa_id: id, created_at: ts, updated_at: ts };
    },

    getCapa(capaId: string): CapaRecord | undefined {
      const row = db.get('SELECT * FROM capa_records WHERE capa_id = ?', capaId);
      return row ? mapCapa(row) : undefined;
    },

    listCapa(filter: { project_id?: string; state?: string; task_id?: string; limit?: number } = {}): CapaRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      for (const key of ['project_id', 'state', 'task_id'] as const) {
        const value = filter[key];
        if (value) {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 100);
      return db
        .all(`SELECT * FROM capa_records ${where} ORDER BY created_at DESC LIMIT ?`, ...params)
        .map(mapCapa);
    },

    updateCapa(
      capaId: string,
      patch: Partial<Pick<CapaRecord, 'state' | 'root_cause_hypothesis' | 'corrective_action' | 'preventive_action' | 'verification_result' | 'owner_agent_id' | 'owner_human'>>,
    ): void {
      const fields: string[] = [];
      const params: (string | null)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        fields.push(`${k} = ?`);
        params.push(v as string | null);
      }
      if (fields.length === 0) return;
      fields.push('updated_at = ?');
      params.push(nowIso(), capaId);
      db.run(`UPDATE capa_records SET ${fields.join(', ')} WHERE capa_id = ?`, ...params);
    },
  };
}

export type QualityRepo = ReturnType<typeof createQualityRepo>;
