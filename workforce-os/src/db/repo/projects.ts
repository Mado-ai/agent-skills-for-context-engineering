import type { Db } from '../connection.js';
import { parseJson, toJson } from '../connection.js';
import { newId, nowIso, type ProjectRecord, type WorkflowLoopRecord } from '../../domain/index.js';

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    project_id: row.project_id as string,
    key: row.key as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as ProjectRecord['status'],
    parent_project_id: (row.parent_project_id as string) ?? null,
    metadata: parseJson(row.metadata, {}),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapLoop(row: Record<string, unknown>): WorkflowLoopRecord {
  return {
    loop_id: row.loop_id as string,
    project_id: row.project_id as string,
    key: row.key as string,
    name: row.name as string,
    description: row.description as string,
    trigger_kind: row.trigger_kind as WorkflowLoopRecord['trigger_kind'],
    schedule_expr: (row.schedule_expr as string) ?? null,
    event_key: (row.event_key as string) ?? null,
    definition: parseJson(row.definition, {}),
    status: row.status as WorkflowLoopRecord['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createProjectRepo(db: Db) {
  return {
    insert(input: Omit<ProjectRecord, 'project_id' | 'created_at' | 'updated_at' | 'status'> & { status?: ProjectRecord['status'] }): ProjectRecord {
      const ts = nowIso();
      const rec: ProjectRecord = {
        ...input,
        project_id: newId('project'),
        status: input.status ?? 'active',
        created_at: ts,
        updated_at: ts,
      };
      db.run(
        `INSERT INTO projects (project_id, key, name, description, status, parent_project_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.project_id,
        rec.key,
        rec.name,
        rec.description,
        rec.status,
        rec.parent_project_id,
        toJson(rec.metadata),
        ts,
        ts,
      );
      return rec;
    },

    get(projectId: string): ProjectRecord | undefined {
      const row = db.get('SELECT * FROM projects WHERE project_id = ?', projectId);
      return row ? mapProject(row) : undefined;
    },

    getByKey(key: string): ProjectRecord | undefined {
      const row = db.get('SELECT * FROM projects WHERE key = ?', key);
      return row ? mapProject(row) : undefined;
    },

    list(): ProjectRecord[] {
      return db.all('SELECT * FROM projects ORDER BY key').map(mapProject);
    },

    setStatus(projectId: string, status: ProjectRecord['status']): void {
      db.run('UPDATE projects SET status = ?, updated_at = ? WHERE project_id = ?', status, nowIso(), projectId);
    },

    insertLoop(input: Omit<WorkflowLoopRecord, 'loop_id' | 'created_at' | 'updated_at' | 'status'> & { status?: WorkflowLoopRecord['status'] }): WorkflowLoopRecord {
      const ts = nowIso();
      const rec: WorkflowLoopRecord = {
        ...input,
        loop_id: newId('loop'),
        status: input.status ?? 'active',
        created_at: ts,
        updated_at: ts,
      };
      db.run(
        `INSERT INTO workflow_loops (loop_id, project_id, key, name, description, trigger_kind,
           schedule_expr, event_key, definition, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.loop_id,
        rec.project_id,
        rec.key,
        rec.name,
        rec.description,
        rec.trigger_kind,
        rec.schedule_expr,
        rec.event_key,
        toJson(rec.definition),
        rec.status,
        ts,
        ts,
      );
      return rec;
    },

    getLoop(loopId: string): WorkflowLoopRecord | undefined {
      const row = db.get('SELECT * FROM workflow_loops WHERE loop_id = ?', loopId);
      return row ? mapLoop(row) : undefined;
    },

    listLoops(projectId?: string): WorkflowLoopRecord[] {
      return projectId
        ? db.all('SELECT * FROM workflow_loops WHERE project_id = ? ORDER BY key', projectId).map(mapLoop)
        : db.all('SELECT * FROM workflow_loops ORDER BY project_id, key').map(mapLoop);
    },

    listScheduledLoops(): WorkflowLoopRecord[] {
      return db
        .all("SELECT * FROM workflow_loops WHERE status = 'active' AND trigger_kind = 'scheduled'")
        .map(mapLoop);
    },

    listEventLoops(eventKey: string): WorkflowLoopRecord[] {
      return db
        .all(
          "SELECT * FROM workflow_loops WHERE status = 'active' AND trigger_kind = 'event' AND event_key = ?",
          eventKey,
        )
        .map(mapLoop);
    },

    setLoopStatus(loopId: string, status: WorkflowLoopRecord['status']): void {
      db.run('UPDATE workflow_loops SET status = ?, updated_at = ? WHERE loop_id = ?', status, nowIso(), loopId);
    },
  };
}

export type ProjectRepo = ReturnType<typeof createProjectRepo>;
