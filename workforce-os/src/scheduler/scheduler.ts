import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import { RuntimeError, newId, nowIso, type JobRecord } from '../domain/index.js';

/**
 * Scheduler and event bus.
 *
 * The durable state lives in the `jobs` table and the claim is a conditional
 * UPDATE, so two workers cannot run the same job. The surface is deliberately
 * narrow — enqueue, every, on, emit, tick — because it is meant to be replaced:
 * swapping this for SQS, Temporal or pg-boss should not touch a caller.
 */

export type JobHandler = (payload: Record<string, unknown>, job: JobRecord) => Promise<void> | void;

export interface SchedulerDeps {
  repos: Repos;
  audit: AuditLog;
  workerId?: string;
}

export interface TickResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

export function createScheduler(deps: SchedulerDeps) {
  const { repos, audit } = deps;
  const workerId = deps.workerId ?? `worker_${newId('job').slice(-8)}`;
  const handlers = new Map<string, JobHandler>();
  let timer: NodeJS.Timeout | null = null;

  async function runJob(job: JobRecord): Promise<boolean> {
    const handler = handlers.get(job.kind);
    if (!handler) {
      repos.jobs.fail(job.job_id, `no handler registered for kind "${job.kind}"`, null);
      audit.append({
        kind: 'job.failed',
        actor_type: 'system',
        subject_type: 'job',
        subject_id: job.job_id,
        severity: 'error',
        payload: { reason: 'no handler', job_kind: job.kind },
      });
      return false;
    }

    try {
      await handler(job.payload, job);
      const nextRunAt =
        job.schedule_kind === 'interval' && job.interval_ms
          ? new Date(Date.now() + job.interval_ms).toISOString()
          : null;
      repos.jobs.complete(job.job_id, nextRunAt);
      audit.append({
        kind: 'job.succeeded',
        actor_type: 'system',
        subject_type: 'job',
        subject_id: job.job_id,
        severity: 'debug',
        payload: { job_kind: job.kind, next_run_at: nextRunAt },
      });
      return true;
    } catch (err) {
      const message = (err as Error).message ?? 'job failed';
      // Linear backoff: enough to survive a transient failure without
      // pretending this is a production retry policy.
      const retryAt = new Date(Date.now() + 30_000 * (job.attempts + 1)).toISOString();
      repos.jobs.fail(job.job_id, message, retryAt);
      audit.append({
        kind: 'job.failed',
        actor_type: 'system',
        subject_type: 'job',
        subject_id: job.job_id,
        severity: 'error',
        payload: { job_kind: job.kind, error: message, attempts: job.attempts },
      });
      return false;
    }
  }

  const scheduler = {
    workerId,

    registerHandler(kind: string, handler: JobHandler): void {
      handlers.set(kind, handler);
    },

    registeredKinds(): string[] {
      return [...handlers.keys()];
    },

    /** One-shot job, optionally deferred. */
    enqueue(kind: string, payload: Record<string, unknown> = {}, runAt?: Date): JobRecord {
      const job = repos.jobs.insert({
        kind,
        schedule_kind: 'once',
        payload,
        next_run_at: (runAt ?? new Date()).toISOString(),
      });
      audit.append({
        kind: 'job.enqueued',
        actor_type: 'system',
        subject_type: 'job',
        subject_id: job.job_id,
        severity: 'debug',
        payload: { job_kind: kind, next_run_at: job.next_run_at },
      });
      return job;
    },

    /** Recurring job. Re-arms itself on completion. */
    every(kind: string, intervalMs: number, payload: Record<string, unknown> = {}): JobRecord {
      if (intervalMs < 1000) {
        throw new RuntimeError('VALIDATION_FAILED', 'interval must be at least 1000ms', { intervalMs });
      }
      return repos.jobs.insert({
        kind,
        schedule_kind: 'interval',
        interval_ms: intervalMs,
        payload,
        next_run_at: new Date(Date.now() + intervalMs).toISOString(),
      });
    },

    /** Register a job that waits for an event key. */
    on(eventKey: string, kind: string, payload: Record<string, unknown> = {}): JobRecord {
      return repos.jobs.insert({
        kind,
        schedule_kind: 'event',
        event_key: eventKey,
        payload,
        next_run_at: null,
      });
    },

    /**
     * Fire an event. Subscribed jobs are claimed and run immediately; the
     * event itself is always recorded, subscriber or not.
     */
    async emit(eventKey: string, payload: Record<string, unknown> = {}): Promise<number> {
      audit.append({
        kind: `event.${eventKey}`,
        actor_type: 'system',
        subject_type: 'event_key',
        subject_id: eventKey,
        payload,
      });
      const jobs = repos.jobs.claimEventJobs(eventKey, workerId);
      let ran = 0;
      for (const job of jobs) {
        const ok = await runJob({ ...job, payload: { ...job.payload, ...payload } });
        if (ok) ran++;
      }
      return ran;
    },

    /** Drain due jobs. Called on a timer by `start`, or directly by tests. */
    async tick(limit = 20): Promise<TickResult> {
      let claimed = 0;
      let succeeded = 0;
      let failed = 0;
      for (let i = 0; i < limit; i++) {
        const job = repos.jobs.claimDue(workerId);
        if (!job) break;
        claimed++;
        const ok = await runJob(job);
        if (ok) succeeded++;
        else failed++;
      }
      return { claimed, succeeded, failed };
    },

    start(intervalMs = 5000): void {
      if (timer) return;
      timer = setInterval(() => {
        void scheduler.tick().catch(() => undefined);
      }, intervalMs);
      // Never hold the process open on the scheduler's account.
      timer.unref?.();
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    list(filter: { status?: string; kind?: string; limit?: number } = {}): JobRecord[] {
      return repos.jobs.list(filter);
    },

    cancel(jobId: string): void {
      repos.jobs.cancel(jobId);
      audit.append({
        kind: 'job.cancelled',
        actor_type: 'owner',
        subject_type: 'job',
        subject_id: jobId,
      });
    },

    now: nowIso,
  };

  return scheduler;
}

export type Scheduler = ReturnType<typeof createScheduler>;
