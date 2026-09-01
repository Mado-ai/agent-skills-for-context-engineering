import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type Fixture } from './helpers.js';
import { bootstrapLoopJobs } from '../src/runtime.js';

describe('scheduler and event bus', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('runs a one-shot job', async () => {
    let ran = 0;
    f.runtime.scheduler.registerHandler('test.once', () => {
      ran++;
    });
    const job = f.runtime.scheduler.enqueue('test.once', { value: 1 });

    const result = await f.runtime.scheduler.tick();
    expect(result.succeeded).toBe(1);
    expect(ran).toBe(1);
    expect(f.runtime.repos.jobs.get(job.job_id)!.status).toBe('succeeded');
  });

  it('re-arms an interval job after each run', async () => {
    f.runtime.scheduler.registerHandler('test.interval', () => undefined);
    const job = f.runtime.scheduler.every('test.interval', 60_000);
    // `every` schedules the first run one interval out, so make it due now.
    f.runtime.db.run(
      'UPDATE jobs SET next_run_at = ? WHERE job_id = ?',
      new Date(Date.now() - 1000).toISOString(),
      job.job_id,
    );

    await f.runtime.scheduler.tick();
    const after = f.runtime.repos.jobs.get(job.job_id)!;
    expect(after.status).toBe('pending');
    expect(new Date(after.next_run_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it('runs event-subscribed jobs when the event fires', async () => {
    const seen: Record<string, unknown>[] = [];
    f.runtime.scheduler.registerHandler('test.event', (payload) => {
      seen.push(payload);
    });
    f.runtime.scheduler.on('demo.happened', 'test.event', { source: 'subscription' });

    const ran = await f.runtime.scheduler.emit('demo.happened', { extra: 'from the event' });
    expect(ran).toBe(1);
    expect(seen[0]).toMatchObject({ source: 'subscription', extra: 'from the event' });
  });

  it('records every emitted event even with no subscriber', async () => {
    await f.runtime.scheduler.emit('nobody.listening', { a: 1 });
    expect(f.runtime.audit.list({ kind: 'event.nobody.listening' })).toHaveLength(1);
  });

  it('retries a failing job and gives up at max_attempts', async () => {
    f.runtime.scheduler.registerHandler('test.failing', () => {
      throw new Error('deliberate failure');
    });
    const job = f.runtime.scheduler.enqueue('test.failing');

    for (let attempt = 0; attempt < 4; attempt++) {
      f.runtime.db.run(
        "UPDATE jobs SET next_run_at = ? WHERE job_id = ? AND status = 'pending'",
        new Date(Date.now() - 1000).toISOString(),
        job.job_id,
      );
      await f.runtime.scheduler.tick();
    }

    const final = f.runtime.repos.jobs.get(job.job_id)!;
    expect(final.status).toBe('failed');
    expect(final.last_error).toContain('deliberate failure');
  });

  it('fails a job with no registered handler rather than losing it', async () => {
    const job = f.runtime.scheduler.enqueue('test.unregistered');
    await f.runtime.scheduler.tick();
    const after = f.runtime.repos.jobs.get(job.job_id)!;
    expect(after.status).toBe('failed');
    expect(after.last_error).toContain('no handler registered');
  });

  it('claims each job exactly once', async () => {
    f.runtime.scheduler.registerHandler('test.claim', () => undefined);
    f.runtime.scheduler.enqueue('test.claim');
    const first = await f.runtime.scheduler.tick();
    const second = await f.runtime.scheduler.tick();
    expect(first.claimed).toBe(1);
    expect(second.claimed).toBe(0);
  });

  it('turns a scheduled workflow loop into a real task', async () => {
    bootstrapLoopJobs(f.runtime);
    const loopJobs = f.runtime.scheduler.list({ kind: 'loop.run', limit: 50 });
    expect(loopJobs.length).toBeGreaterThan(0);

    const scheduled = loopJobs.find((j) => j.schedule_kind === 'interval')!;
    f.runtime.db.run(
      'UPDATE jobs SET next_run_at = ? WHERE job_id = ?',
      new Date(Date.now() - 1000).toISOString(),
      scheduled.job_id,
    );

    const before = f.runtime.execution.listTasks({ limit: 500 }).length;
    await f.runtime.scheduler.tick();
    const after = f.runtime.execution.listTasks({ limit: 500 });
    expect(after.length).toBe(before + 1);
    expect(after[0]!.title).toContain('scheduled run');
  });

  it('turns an event-triggered loop into a task when its event fires', async () => {
    bootstrapLoopJobs(f.runtime);
    const before = f.runtime.execution.listTasks({ limit: 500 }).length;
    await f.runtime.scheduler.emit('content.brief_approved', {});
    expect(f.runtime.execution.listTasks({ limit: 500 }).length).toBe(before + 1);
  });

  it('sweeps expired state through the maintenance job', async () => {
    await f.runtime.scheduler.enqueue('maintenance.sweep');
    const result = await f.runtime.scheduler.tick();
    expect(result.succeeded).toBe(1);
    expect(f.runtime.audit.list({ kind: 'maintenance.swept' })).toHaveLength(1);
  });

  it('cancels a job before it runs', async () => {
    f.runtime.scheduler.registerHandler('test.cancelled', () => {
      throw new Error('should never run');
    });
    const job = f.runtime.scheduler.enqueue('test.cancelled');
    f.runtime.scheduler.cancel(job.job_id);
    const result = await f.runtime.scheduler.tick();
    expect(result.claimed).toBe(0);
    expect(f.runtime.repos.jobs.get(job.job_id)!.status).toBe('cancelled');
  });

  it('refuses an interval below one second', () => {
    expect(() => f.runtime.scheduler.every('test.fast', 10)).toThrow(/at least 1000ms/);
  });
});
