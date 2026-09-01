import type { Db } from '../connection.js';
import { fromBool, parseJson, toBool, toJson } from '../connection.js';
import {
  MEMORY_PRECEDENCE,
  newId,
  nowIso,
  type MemoryLayer,
  type MemoryRecord,
  type Provenance,
} from '../../domain/index.js';

function mapMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    memory_id: row.memory_id as string,
    layer: row.layer as MemoryLayer,
    scope_project_id: (row.scope_project_id as string) ?? null,
    agent_id: (row.agent_id as string) ?? null,
    key: row.key as string,
    content: parseJson(row.content, {}),
    source: row.source as string,
    provenance: parseJson(row.provenance, {} as Provenance),
    confidence: row.confidence == null ? null : Number(row.confidence),
    authoritative: toBool(row.authoritative),
    supersedes_id: (row.supersedes_id as string) ?? null,
    superseded_by_id: (row.superseded_by_id as string) ?? null,
    ttl_expires_at: (row.ttl_expires_at as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createMemoryRepo(db: Db) {
  return {
    insert(rec: Omit<MemoryRecord, 'memory_id' | 'created_at' | 'updated_at' | 'superseded_by_id'>): MemoryRecord {
      const ts = nowIso();
      const memoryId = newId('memory');
      db.run(
        `INSERT INTO memory_records (memory_id, layer, scope_project_id, agent_id, key, content,
           source, provenance, confidence, authoritative, supersedes_id, superseded_by_id,
           ttl_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        memoryId,
        rec.layer,
        rec.scope_project_id,
        rec.agent_id,
        rec.key,
        toJson(rec.content),
        rec.source,
        toJson(rec.provenance),
        rec.confidence,
        fromBool(rec.authoritative),
        rec.supersedes_id,
        rec.ttl_expires_at,
        ts,
        ts,
      );
      if (rec.supersedes_id) {
        db.run(
          'UPDATE memory_records SET superseded_by_id = ?, updated_at = ? WHERE memory_id = ?',
          memoryId,
          ts,
          rec.supersedes_id,
        );
      }
      return { ...rec, memory_id: memoryId, superseded_by_id: null, created_at: ts, updated_at: ts };
    },

    get(memoryId: string): MemoryRecord | undefined {
      const row = db.get('SELECT * FROM memory_records WHERE memory_id = ?', memoryId);
      return row ? mapMemory(row) : undefined;
    },

    /**
     * Scope filtering happens here, not in the caller: a query is always bound
     * to the set of projects and layers the caller is allowed to see. Records
     * come back ordered by memory precedence (authoritative first) so a caller
     * that takes the head of the list gets the record that outranks the rest.
     */
    query(params: {
      allowedProjectIds: string[] | 'all';
      allowedLayers: MemoryLayer[];
      key?: string;
      keyPrefix?: string;
      layer?: MemoryLayer;
      projectId?: string | null;
      includeSuperseded?: boolean;
      includeExpired?: boolean;
      limit?: number;
    }): MemoryRecord[] {
      const clauses: string[] = [];
      const sqlParams: (string | number)[] = [];

      const layers = params.layer
        ? params.allowedLayers.filter((l) => l === params.layer)
        : params.allowedLayers;
      if (layers.length === 0) return [];
      clauses.push(`layer IN (${layers.map(() => '?').join(',')})`);
      sqlParams.push(...layers);

      if (params.allowedProjectIds !== 'all') {
        const ids = params.allowedProjectIds;
        // Global records (scope_project_id IS NULL) are visible to everyone;
        // project-scoped records only to agents holding that project.
        if (ids.length === 0) {
          clauses.push('scope_project_id IS NULL');
        } else {
          clauses.push(`(scope_project_id IS NULL OR scope_project_id IN (${ids.map(() => '?').join(',')}))`);
          sqlParams.push(...ids);
        }
      }

      if (params.projectId !== undefined) {
        if (params.projectId === null) {
          clauses.push('scope_project_id IS NULL');
        } else {
          clauses.push('scope_project_id = ?');
          sqlParams.push(params.projectId);
        }
      }
      if (params.key) {
        clauses.push('key = ?');
        sqlParams.push(params.key);
      }
      if (params.keyPrefix) {
        clauses.push('key LIKE ?');
        sqlParams.push(`${params.keyPrefix}%`);
      }
      if (!params.includeSuperseded) clauses.push('superseded_by_id IS NULL');
      if (!params.includeExpired) {
        clauses.push('(ttl_expires_at IS NULL OR ttl_expires_at > ?)');
        sqlParams.push(nowIso());
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      sqlParams.push(params.limit ?? 50);
      const rows = db.all(
        `SELECT * FROM memory_records ${where} ORDER BY created_at DESC LIMIT ?`,
        ...sqlParams,
      );
      return rows
        .map(mapMemory)
        .sort((a, b) => MEMORY_PRECEDENCE[b.layer] - MEMORY_PRECEDENCE[a.layer]);
    },

    listAll(limit = 200): MemoryRecord[] {
      return db.all('SELECT * FROM memory_records ORDER BY created_at DESC LIMIT ?', limit).map(mapMemory);
    },

    /** Working memory is short-lived by design; the scheduler sweeps it. */
    deleteExpired(): number {
      return db.run(
        "DELETE FROM memory_records WHERE layer = 'working' AND ttl_expires_at IS NOT NULL AND ttl_expires_at < ?",
        nowIso(),
      ).changes;
    },
  };
}

export type MemoryRepo = ReturnType<typeof createMemoryRepo>;
