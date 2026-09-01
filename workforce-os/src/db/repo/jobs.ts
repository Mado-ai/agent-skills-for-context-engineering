import type { Db } from '../connection.js';
import { parseJson, toJson } from '../connection.js';
import { newId, nowIso, type JobRecord } from '../../domain/index.js';

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    job_id: row.job_id as string,
    kind: row.kind as string,
    schedule_kind: row.schedule_kind as JobRecord['schedule_kind'],
    interval_ms: row.interval_ms == null ? null : Number(row.interval_ms),
    event_key: (row.event_key as string) ?? null,
    payload: parseJson(row.payload, {}),
    status: row.status as JobRecord['status'],
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    last_error: (row.last_error as string) ?? null,
    locked_by: (row.locked_by as string) ?? null,
    locked_at: (row.locked_at as string) ?? null,
    next_run_at: (row.next_run_at as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createJobRepo(db: Db) {
  return {
    insert(rec: {
      kind: string;
      schedule_kind: JobRecord['schedule_kind'];
      payload?: Record<string, unknown>;
      interval_ms?: number | null;
      event_key?: string | null;
      next_run_at?: string | null;
      max_attempts?: number;
    }): JobRecord {
      const ts = nowIso();
      const job: JobRecord = {
        job_id: newId('job'),
        kind: rec.kind,
        schedule_kind: rec.schedule_kind,
        interval_ms: rec.interval_ms ?? null,
        event_key: rec.event_key ?? null,
        payload: rec.payload ?? {},
        status: 'pending',
        attempts: 0,
        max_attempts: rec.max_attempts ?? 3,
        last_error: null,
        locked_by: null,
        locked_at: null,
        next_run_at: rec.next_run_at ?? ts,
        created_at: ts,
        updated_at: ts,
      };
      db.run(
        `INSERT INTO jobs (job_id, kind, schedule_kind, interval_ms, event_key, payload, status,
           attempts, max_attempts, last_error, locked_by, locked_at, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        job.job_id,
        job.kind,
        job.schedule_kind,
        job.interval_ms,
        job.event_key,
        toJson(job.payload),
        job.status,
        job.attempts,
        job.max_attempts,
        job.last_error,
        job.locked_by,
        job.locked_at,
        job.next_run_at,
        ts,
        ts,
      );
      return job;
    },

    get(jobId: string): JobRecord | undefined {
      const row = db.get('SELECT * FROM jobs WHERE job_id = ?', jobId);
      return row ? mapJob(row) : undefined;
    },

    list(filter: { status?: string; kind?: string; limit?: number } = {}): JobRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter.kind) {
        clauses.push('kind = ?');
        params.push(filter.kind);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 100);
      return db.all(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`, ...params).map(mapJob);
    },

    /**
     * Claim one due job. The UPDATE ... WHERE status='pending' is the lock: a
     * second worker racing for the same row updates zero rows and moves on.
     */
    claimDue(workerId: string, nowIsoTs: string = nowIso()): JobRecord | undefined {
      return db.tx(() => {
        const row = db.get(
          `SELECT * FROM jobs WHERE status = 'pending' AND schedule_kind <> 'event'
             AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY next_run_at LIMIT 1`,
          nowIsoTs,
        );
        if (!row) return undefined;
        const job = mapJob(row);
        const claimed = db.run(
          "UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE job_id = ? AND status = 'pending'",
          workerId,
          nowIsoTs,
          nowIsoTs,
          job.job_id,
        );
        if (claimed.changes === 0) return undefined;
        return { ...job, status: 'running' as const, locked_by: workerId, attempts: job.attempts + 1 };
      });
    },

    claimEventJobs(eventKey: string, workerId: string): JobRecord[] {
      return db.tx(() => {
        const rows = db.all(
          "SELECT * FROM jobs WHERE status = 'pending' AND schedule_kind = 'event' AND event_key = ?",
          eventKey,
        );
        const claimed: JobRecord[] = [];
        for (const row of rows) {
          const job = mapJob(row);
          const res = db.run(
            "UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE job_id = ? AND status = 'pending'",
            workerId,
            nowIso(),
            nowIso(),
            job.job_id,
          );
          if (res.changes > 0) claimed.push({ ...job, status: 'running', attempts: job.attempts + 1 });
        }
        return claimed;
      });
    },

    complete(jobId: string, nextRunAt: string | null): void {
      // An interval job goes back to pending with a new due time; a one-shot is done.
      if (nextRunAt) {
        db.run(
          "UPDATE jobs SET status = 'pending', locked_by = NULL, locked_at = NULL, next_run_at = ?, updated_at = ? WHERE job_id = ?",
          nextRunAt,
          nowIso(),
          jobId,
        );
      } else {
        db.run(
          "UPDATE jobs SET status = 'succeeded', locked_by = NULL, locked_at = NULL, updated_at = ? WHERE job_id = ?",
          nowIso(),
          jobId,
        );
      }
    },

    fail(jobId: string, error: string, retryAt: string | null): void {
      const job = this.get(jobId);
      const exhausted = !job || job.attempts >= job.max_attempts || retryAt === null;
      db.run(
        `UPDATE jobs SET status = ?, last_error = ?, locked_by = NULL, locked_at = NULL,
           next_run_at = ?, updated_at = ? WHERE job_id = ?`,
        exhausted ? 'failed' : 'pending',
        error.slice(0, 2000),
        exhausted ? null : retryAt,
        nowIso(),
        jobId,
      );
    },

    cancel(jobId: string): void {
      db.run("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE job_id = ?", nowIso(), jobId);
    },
  };
}

export type JobRepo = ReturnType<typeof createJobRepo>;
