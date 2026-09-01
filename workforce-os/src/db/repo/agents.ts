import type { Db } from '../connection.js';
import { parseJson, toJson } from '../connection.js';
import {
  AgentContract,
  type AgentInstanceRecord,
  type AgentRecord,
  type ActivationMode,
  type AgentStatus,
  type RoleLevel,
  nowIso,
} from '../../domain/index.js';

export interface AgentTemplateRecord {
  template_id: string;
  key: string;
  name: string;
  role_level: RoleLevel;
  version: number;
  description: string;
  contract_template: Record<string, unknown>;
  status: 'draft' | 'active' | 'deprecated';
  created_at: string;
  updated_at: string;
}

export interface ContractVersionRecord {
  contract_version_id: string;
  agent_id: string;
  version: number;
  contract: AgentContract;
  contract_hash: string;
  validation: Record<string, unknown>;
  validated_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

function mapAgent(row: Record<string, unknown>): AgentRecord {
  return {
    agent_id: row.agent_id as string,
    display_name: row.display_name as string,
    role_level: row.role_level as RoleLevel,
    status: row.status as AgentStatus,
    current_version: Number(row.current_version),
    parent_agent_id: (row.parent_agent_id as string) ?? null,
    template_id: (row.template_id as string) ?? null,
    merged_into_id: (row.merged_into_id as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    retired_at: (row.retired_at as string) ?? null,
  };
}

function mapInstance(row: Record<string, unknown>): AgentInstanceRecord {
  return {
    instance_id: row.instance_id as string,
    agent_id: row.agent_id as string,
    contract_version: Number(row.contract_version),
    activation_mode: row.activation_mode as ActivationMode,
    status: row.status as AgentInstanceRecord['status'],
    project_id: (row.project_id as string) ?? null,
    task_id: (row.task_id as string) ?? null,
    loop_id: (row.loop_id as string) ?? null,
    ttl_seconds: row.ttl_seconds == null ? null : Number(row.ttl_seconds),
    metadata: parseJson(row.metadata, {}),
    started_at: row.started_at as string,
    last_active_at: row.last_active_at as string,
    ended_at: (row.ended_at as string) ?? null,
    end_reason: (row.end_reason as string) ?? null,
  };
}

export function createAgentRepo(db: Db) {
  return {
    insertAgent(rec: Omit<AgentRecord, 'created_at' | 'updated_at' | 'retired_at'>): AgentRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO agents (agent_id, display_name, role_level, status, current_version,
           parent_agent_id, template_id, merged_into_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.agent_id,
        rec.display_name,
        rec.role_level,
        rec.status,
        rec.current_version,
        rec.parent_agent_id,
        rec.template_id,
        rec.merged_into_id,
        ts,
        ts,
      );
      return { ...rec, created_at: ts, updated_at: ts, retired_at: null };
    },

    getAgent(agentId: string): AgentRecord | undefined {
      const row = db.get('SELECT * FROM agents WHERE agent_id = ?', agentId);
      return row ? mapAgent(row) : undefined;
    },

    listAgents(filter: { status?: string; role_level?: string; parent_agent_id?: string } = {}): AgentRecord[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter.role_level) {
        clauses.push('role_level = ?');
        params.push(filter.role_level);
      }
      if (filter.parent_agent_id) {
        clauses.push('parent_agent_id = ?');
        params.push(filter.parent_agent_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return db.all(`SELECT * FROM agents ${where} ORDER BY agent_id`, ...params).map(mapAgent);
    },

    updateAgent(
      agentId: string,
      patch: Partial<Pick<AgentRecord, 'display_name' | 'status' | 'current_version' | 'parent_agent_id' | 'merged_into_id' | 'retired_at'>>,
    ): void {
      const fields: string[] = [];
      const params: (string | number | null)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        fields.push(`${k} = ?`);
        params.push(v as string | number | null);
      }
      if (fields.length === 0) return;
      fields.push('updated_at = ?');
      params.push(nowIso(), agentId);
      db.run(`UPDATE agents SET ${fields.join(', ')} WHERE agent_id = ?`, ...params);
    },

    insertContractVersion(rec: Omit<ContractVersionRecord, 'created_at'>): ContractVersionRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO agent_contract_versions (contract_version_id, agent_id, version, contract,
           contract_hash, validation, validated_at, approved_by, approved_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.contract_version_id,
        rec.agent_id,
        rec.version,
        toJson(rec.contract),
        rec.contract_hash,
        toJson(rec.validation),
        rec.validated_at,
        rec.approved_by,
        rec.approved_at,
        ts,
      );
      return { ...rec, created_at: ts };
    },

    getContractVersion(agentId: string, version: number): ContractVersionRecord | undefined {
      const row = db.get(
        'SELECT * FROM agent_contract_versions WHERE agent_id = ? AND version = ?',
        agentId,
        version,
      );
      if (!row) return undefined;
      return {
        contract_version_id: row.contract_version_id as string,
        agent_id: row.agent_id as string,
        version: Number(row.version),
        contract: parseJson(row.contract, {} as AgentContract),
        contract_hash: row.contract_hash as string,
        validation: parseJson(row.validation, {}),
        validated_at: (row.validated_at as string) ?? null,
        approved_by: (row.approved_by as string) ?? null,
        approved_at: (row.approved_at as string) ?? null,
        created_at: row.created_at as string,
      };
    },

    listContractVersions(agentId: string): { version: number; contract_hash: string; created_at: string; approved_by: string | null }[] {
      return db
        .all(
          'SELECT version, contract_hash, created_at, approved_by FROM agent_contract_versions WHERE agent_id = ? ORDER BY version',
          agentId,
        )
        .map((r) => ({
          version: Number(r.version),
          contract_hash: r.contract_hash as string,
          created_at: r.created_at as string,
          approved_by: (r.approved_by as string) ?? null,
        }));
    },

    markContractApproved(agentId: string, version: number, approvedBy: string): void {
      db.run(
        'UPDATE agent_contract_versions SET approved_by = ?, approved_at = ? WHERE agent_id = ? AND version = ?',
        approvedBy,
        nowIso(),
        agentId,
        version,
      );
    },

    markContractValidated(agentId: string, version: number, validation: Record<string, unknown>): void {
      db.run(
        'UPDATE agent_contract_versions SET validation = ?, validated_at = ? WHERE agent_id = ? AND version = ?',
        toJson(validation),
        nowIso(),
        agentId,
        version,
      );
    },

    // ---- templates ----

    insertTemplate(rec: Omit<AgentTemplateRecord, 'created_at' | 'updated_at'>): AgentTemplateRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO agent_templates (template_id, key, name, role_level, version, description,
           contract_template, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.template_id,
        rec.key,
        rec.name,
        rec.role_level,
        rec.version,
        rec.description,
        toJson(rec.contract_template),
        rec.status,
        ts,
        ts,
      );
      return { ...rec, created_at: ts, updated_at: ts };
    },

    getTemplateByKey(key: string): AgentTemplateRecord | undefined {
      const row = db.get('SELECT * FROM agent_templates WHERE key = ?', key);
      return row ? this.mapTemplate(row) : undefined;
    },

    getTemplate(templateId: string): AgentTemplateRecord | undefined {
      const row = db.get('SELECT * FROM agent_templates WHERE template_id = ?', templateId);
      return row ? this.mapTemplate(row) : undefined;
    },

    listTemplates(): AgentTemplateRecord[] {
      return db.all('SELECT * FROM agent_templates ORDER BY key').map((r) => this.mapTemplate(r));
    },

    mapTemplate(row: Record<string, unknown>): AgentTemplateRecord {
      return {
        template_id: row.template_id as string,
        key: row.key as string,
        name: row.name as string,
        role_level: row.role_level as RoleLevel,
        version: Number(row.version),
        description: row.description as string,
        contract_template: parseJson(row.contract_template, {}),
        status: row.status as AgentTemplateRecord['status'],
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
      };
    },

    // ---- instances ----

    insertInstance(rec: Omit<AgentInstanceRecord, 'started_at' | 'last_active_at' | 'ended_at' | 'end_reason'>): AgentInstanceRecord {
      const ts = nowIso();
      db.run(
        `INSERT INTO agent_instances (instance_id, agent_id, contract_version, activation_mode,
           status, project_id, task_id, loop_id, ttl_seconds, metadata, started_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.instance_id,
        rec.agent_id,
        rec.contract_version,
        rec.activation_mode,
        rec.status,
        rec.project_id,
        rec.task_id,
        rec.loop_id,
        rec.ttl_seconds,
        toJson(rec.metadata),
        ts,
        ts,
      );
      return { ...rec, started_at: ts, last_active_at: ts, ended_at: null, end_reason: null };
    },

    getInstance(instanceId: string): AgentInstanceRecord | undefined {
      const row = db.get('SELECT * FROM agent_instances WHERE instance_id = ?', instanceId);
      return row ? mapInstance(row) : undefined;
    },

    listInstances(filter: { agent_id?: string; status?: string } = {}): AgentInstanceRecord[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter.agent_id) {
        clauses.push('agent_id = ?');
        params.push(filter.agent_id);
      }
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return db
        .all(`SELECT * FROM agent_instances ${where} ORDER BY started_at DESC`, ...params)
        .map(mapInstance);
    },

    countLiveInstances(agentId: string): number {
      const row = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agent_instances WHERE agent_id = ? AND status IN ('idle','busy')",
        agentId,
      );
      return Number(row?.n ?? 0);
    },

    touchInstance(instanceId: string, status?: AgentInstanceRecord['status']): void {
      if (status) {
        db.run(
          'UPDATE agent_instances SET last_active_at = ?, status = ? WHERE instance_id = ?',
          nowIso(),
          status,
          instanceId,
        );
      } else {
        db.run('UPDATE agent_instances SET last_active_at = ? WHERE instance_id = ?', nowIso(), instanceId);
      }
    },

    endInstance(instanceId: string, reason: string): void {
      const ts = nowIso();
      db.run(
        "UPDATE agent_instances SET status = 'ended', ended_at = ?, end_reason = ?, last_active_at = ? WHERE instance_id = ?",
        ts,
        reason,
        ts,
        instanceId,
      );
    },

    /** Instances whose last activity is older than their contract idle timeout. */
    findIdleInstances(cutoffIso: string): AgentInstanceRecord[] {
      return db
        .all(
          "SELECT * FROM agent_instances WHERE status = 'idle' AND last_active_at < ?",
          cutoffIso,
        )
        .map(mapInstance);
    },
  };
}

export type AgentRepo = ReturnType<typeof createAgentRepo>;
