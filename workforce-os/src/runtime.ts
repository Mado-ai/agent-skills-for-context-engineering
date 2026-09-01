import { openDatabase, type Db } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createRepos, type Repos } from './db/repo/index.js';
import { createAuditLog, type AuditLog } from './telemetry/audit.js';
import { createApprovalService, type ApprovalService } from './approvals/service.js';
import { createBudgetService, type BudgetService } from './budget/service.js';
import { createMemoryService, type MemoryService } from './memory/service.js';
import { createQualityService, type QualityService } from './quality/service.js';
import { createRegistry, type Registry } from './registry/registry.js';
import { createToolGateway, type ToolGateway } from './gateway/gateway.js';
import { createHandlers } from './gateway/handlers.js';
import { createDelegationService, type DelegationService } from './delegation/service.js';
import { createExecutionService, type ExecutionService } from './execution/service.js';
import { createScheduler, type Scheduler } from './scheduler/scheduler.js';
import { createChief, type ChiefService } from './chief/chief.js';
import { createProviderFromEnv, type LlmProvider } from './llm/provider.js';

/**
 * Composition root.
 *
 * Everything the runtime can do hangs off this object, and nothing constructs
 * its own dependencies. That is what lets a test stand up a complete, isolated
 * system against an in-memory database in one call.
 */

export interface RuntimeConfig {
  dbPath?: string;
  provider?: LlmProvider;
  /** Apply migrations on open. Off for a database known to be current. */
  migrate?: boolean;
  workerId?: string;
}

export interface Runtime {
  db: Db;
  repos: Repos;
  audit: AuditLog;
  provider: LlmProvider;
  approvals: ApprovalService;
  budgets: BudgetService;
  memory: MemoryService;
  quality: QualityService;
  registry: Registry;
  gateway: ToolGateway;
  delegation: DelegationService;
  execution: ExecutionService;
  scheduler: Scheduler;
  chief: ChiefService;
  close(): void;
}

export function createRuntime(config: RuntimeConfig = {}): Runtime {
  const db = openDatabase({ path: config.dbPath });
  if (config.migrate !== false) migrate(db);

  const repos = createRepos(db);
  const audit = createAuditLog(repos);
  const provider = config.provider ?? createProviderFromEnv();

  const approvals = createApprovalService({ repos, audit });
  const budgets = createBudgetService({ repos, audit });
  const memory = createMemoryService({ repos, audit });
  const quality = createQualityService({ repos, audit, memory, provider, budgets });

  // The gateway needs the registry (for activation testing) and the registry
  // needs the gateway (to dry-run authorize). The cycle is broken by deferring
  // the lookup to call time rather than construction time.
  let gateway: ToolGateway;
  const registry = createRegistry({
    repos,
    audit,
    dryRunAuthorize: (input) => gateway.dryRun(input),
  });

  // Handlers reach back into the finished runtime for the same reason.
  let runtime: Runtime;
  const handlers = createHandlers(() => runtime);

  gateway = createToolGateway({ repos, audit, registry, approvals, budgets, handlers });

  const delegation = createDelegationService({ repos, audit, registry, budgets });
  const execution = createExecutionService({
    repos,
    audit,
    registry,
    delegation,
    quality,
    memory,
    budgets,
    provider,
  });
  const scheduler = createScheduler({ repos, audit, workerId: config.workerId });
  const chief = createChief(() => runtime);

  runtime = {
    db,
    repos,
    audit,
    provider,
    approvals,
    budgets,
    memory,
    quality,
    registry,
    gateway,
    delegation,
    execution,
    scheduler,
    chief,
    close() {
      scheduler.stop();
      db.close();
    },
  };

  registerMaintenanceJobs(runtime);

  return runtime;
}

/**
 * Housekeeping the runtime owes itself: expiring what has lapsed and releasing
 * what is idle. Registered as scheduler handlers rather than timers so the
 * work is durable and auditable like any other job.
 */
export function registerMaintenanceJobs(runtime: Runtime): void {
  runtime.scheduler.registerHandler('maintenance.sweep', () => {
    const swept = {
      memory_records: runtime.memory.sweepExpired(),
      idle_instances: runtime.registry.reapIdleInstances(),
      expired_packets: runtime.delegation.expireStale(),
      expired_approvals: runtime.approvals.expireStale(),
    };
    runtime.audit.append({
      kind: 'maintenance.swept',
      actor_type: 'system',
      severity: 'debug',
      payload: swept,
    });
  });

  runtime.scheduler.registerHandler('maintenance.reap_specialists', (payload) => {
    const retired = runtime.delegation.reapUnusedSpecialists((payload.idle_seconds as number) ?? 3600);
    if (retired.length > 0) {
      runtime.audit.append({
        kind: 'maintenance.specialists_reaped',
        actor_type: 'system',
        payload: { agent_ids: retired },
      });
    }
  });

  /** A scheduled or event-triggered workflow loop turns into a real task. */
  runtime.scheduler.registerHandler('loop.run', (payload) => {
    const loopId = payload.loop_id as string;
    const loop = runtime.repos.projects.getLoop(loopId);
    if (!loop || loop.status !== 'active') return;
    const task = runtime.execution.createTask(
      {
        project_id: loop.project_id,
        loop_id: loop.loop_id,
        title: `${loop.name} — scheduled run`,
        description: loop.description,
        input: { loop_key: loop.key, trigger: loop.trigger_kind },
      },
      { type: 'system', id: 'scheduler' },
    );
    runtime.audit.append({
      kind: 'loop.triggered',
      actor_type: 'system',
      project_id: loop.project_id,
      trace_id: task.trace_id,
      subject_type: 'workflow_loop',
      subject_id: loop.loop_id,
      payload: { task_id: task.task_id, trigger_kind: loop.trigger_kind },
    });
  });
}

/**
 * Register jobs for every active scheduled/event loop. Idempotent per loop, so
 * it is safe to call on every boot.
 */
export function bootstrapLoopJobs(runtime: Runtime): { scheduled: number; event: number } {
  const existing = new Set(
    runtime.scheduler
      .list({ kind: 'loop.run', limit: 500 })
      .map((j) => String((j.payload as { loop_id?: string }).loop_id ?? '')),
  );

  let scheduled = 0;
  for (const loop of runtime.repos.projects.listScheduledLoops()) {
    if (existing.has(loop.loop_id)) continue;
    const intervalMs = Number(loop.schedule_expr ?? 0);
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) continue;
    runtime.scheduler.every('loop.run', intervalMs, { loop_id: loop.loop_id });
    scheduled++;
  }

  let event = 0;
  for (const loop of runtime.repos.projects.listLoops()) {
    if (loop.trigger_kind !== 'event' || loop.status !== 'active' || !loop.event_key) continue;
    if (existing.has(loop.loop_id)) continue;
    runtime.scheduler.on(loop.event_key, 'loop.run', { loop_id: loop.loop_id });
    event++;
  }

  return { scheduled, event };
}
