import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import {
  BudgetConsumed,
  BudgetLimits,
  RuntimeError,
  type BudgetRecord,
  type UsageDelta,
} from '../domain/index.js';
import type { BudgetVerdict } from '../policy/engine.js';

/**
 * Budgets at project, agent and task level.
 *
 * A hard limit pauses and escalates rather than silently continuing; a soft
 * limit warns. Every enclosing scope is checked, and the most restrictive one
 * wins — a generous project budget cannot rescue an agent that has spent its
 * own allowance.
 */

export interface BudgetScopes {
  project_id?: string | null;
  agent_id?: string | null;
  task_id?: string | null;
}

export interface BudgetDeps {
  repos: Repos;
  audit: AuditLog;
}

const COUNTERS = [
  ['model_calls', 'max_model_calls'],
  ['tokens', 'max_tokens'],
  ['estimated_cost', 'max_estimated_cost'],
  ['tool_calls', 'max_tool_calls'],
  ['executions', 'max_executions'],
  ['retries', 'max_retries'],
  ['elapsed_ms', 'max_elapsed_ms'],
] as const;

function deltaToConsumed(delta: Partial<UsageDelta>): BudgetConsumed {
  return BudgetConsumed.parse({
    model_calls: delta.model_calls ?? 0,
    tokens: (delta.tokens_in ?? 0) + (delta.tokens_out ?? 0),
    estimated_cost: delta.estimated_cost ?? 0,
    tool_calls: delta.tool_calls ?? 0,
    executions: 0,
    retries: delta.retries ?? 0,
    elapsed_ms: delta.elapsed_ms ?? 0,
  });
}

export function createBudgetService(deps: BudgetDeps) {
  const { repos, audit } = deps;

  function scopeList(scopes: BudgetScopes): { type: BudgetRecord['scope_type']; id: string }[] {
    const out: { type: BudgetRecord['scope_type']; id: string }[] = [];
    if (scopes.project_id) out.push({ type: 'project', id: scopes.project_id });
    if (scopes.agent_id) out.push({ type: 'agent', id: scopes.agent_id });
    if (scopes.task_id) out.push({ type: 'task', id: scopes.task_id });
    return out;
  }

  const service = {
    define(
      scopeType: BudgetRecord['scope_type'],
      scopeId: string,
      limits: Partial<BudgetLimits>,
    ): BudgetRecord {
      const budget = repos.budgets.upsert({ scope_type: scopeType, scope_id: scopeId, limits });
      audit.append({
        kind: 'budget.defined',
        actor_type: 'system',
        subject_type: 'budget',
        subject_id: budget.budget_id,
        payload: { scope_type: scopeType, scope_id: scopeId, limits: budget.limits },
      });
      return budget;
    },

    get(scopeType: string, scopeId: string): BudgetRecord | undefined {
      return repos.budgets.find(scopeType, scopeId);
    },

    list(filter: { scope_type?: string; scope_id?: string } = {}): BudgetRecord[] {
      return repos.budgets.list(filter);
    },

    /**
     * Pre-flight check. `delta` is the cost the caller is about to incur, so a
     * call that would cross a hard limit is refused before it runs rather than
     * discovered afterwards.
     */
    check(scopes: BudgetScopes, delta: Partial<UsageDelta> = {}): BudgetVerdict {
      const warnings: string[] = [];
      const add = deltaToConsumed(delta);

      for (const scope of scopeList(scopes)) {
        const budget = repos.budgets.find(scope.type, scope.id);
        if (!budget) continue;

        if (budget.status === 'paused') {
          return {
            ok: false,
            code: 'BUDGET_HARD_EXCEEDED',
            reason: `${scope.type} budget for ${scope.id} is paused`,
            warnings,
          };
        }

        for (const [counter, limitKey] of COUNTERS) {
          const limit = budget.limits[limitKey];
          if (limit == null) continue;
          const projected = budget.consumed[counter] + add[counter];
          if (projected > limit) {
            return {
              ok: false,
              code: 'BUDGET_HARD_EXCEEDED',
              reason: `${scope.type} budget for ${scope.id}: ${counter} would reach ${projected}, limit is ${limit}`,
              warnings,
            };
          }
          const softAt = limit * budget.limits.soft_limit_ratio;
          if (projected >= softAt) {
            warnings.push(`${scope.type}:${counter} at ${projected}/${limit}`);
          }
        }
      }

      return { ok: true, code: null, reason: 'within limits', warnings };
    },

    /**
     * Record actual consumption. Writes an immutable usage record and rolls the
     * cost up into every enclosing budget, pausing any scope that crosses a
     * hard limit.
     */
    record(
      scopes: BudgetScopes & { trace_id?: string | null; packet_id?: string | null; call_id?: string | null },
      kind: 'model_call' | 'tool_call' | 'execution' | 'retry',
      delta: Partial<UsageDelta>,
    ): { warnings: string[]; exceeded: string[] } {
      repos.budgets.insertUsage({
        trace_id: scopes.trace_id ?? null,
        project_id: scopes.project_id ?? null,
        agent_id: scopes.agent_id ?? null,
        task_id: scopes.task_id ?? null,
        packet_id: scopes.packet_id ?? null,
        call_id: scopes.call_id ?? null,
        kind,
        model_calls: delta.model_calls ?? 0,
        tokens_in: delta.tokens_in ?? 0,
        tokens_out: delta.tokens_out ?? 0,
        estimated_cost: delta.estimated_cost ?? 0,
        tool_calls: delta.tool_calls ?? 0,
        retries: delta.retries ?? 0,
        elapsed_ms: delta.elapsed_ms ?? 0,
      });

      const add = deltaToConsumed(delta);
      if (kind === 'execution') add.executions = 1;

      const warnings: string[] = [];
      const exceeded: string[] = [];

      for (const scope of scopeList(scopes)) {
        const budget = repos.budgets.find(scope.type, scope.id);
        if (!budget) continue;

        const consumed = BudgetConsumed.parse({
          model_calls: budget.consumed.model_calls + add.model_calls,
          tokens: budget.consumed.tokens + add.tokens,
          estimated_cost: Number((budget.consumed.estimated_cost + add.estimated_cost).toFixed(6)),
          tool_calls: budget.consumed.tool_calls + add.tool_calls,
          executions: budget.consumed.executions + add.executions,
          retries: budget.consumed.retries + add.retries,
          elapsed_ms: budget.consumed.elapsed_ms + add.elapsed_ms,
        });

        let status: BudgetRecord['status'] = 'ok';
        for (const [counter, limitKey] of COUNTERS) {
          const limit = budget.limits[limitKey];
          if (limit == null) continue;
          if (consumed[counter] >= limit) {
            status = 'hard_exceeded';
            exceeded.push(`${scope.type}:${scope.id}:${counter}`);
          } else if (consumed[counter] >= limit * budget.limits.soft_limit_ratio && status === 'ok') {
            status = 'soft_exceeded';
            warnings.push(`${scope.type}:${scope.id}:${counter}`);
          }
        }

        repos.budgets.applyConsumption(budget.budget_id, consumed, status);

        if (status === 'hard_exceeded') {
          audit.append({
            kind: 'budget.hard_limit_reached',
            actor_type: 'system',
            project_id: scopes.project_id ?? null,
            trace_id: scopes.trace_id ?? null,
            subject_type: 'budget',
            subject_id: budget.budget_id,
            severity: 'error',
            payload: { scope_type: scope.type, scope_id: scope.id, consumed },
          });
        } else if (status === 'soft_exceeded') {
          audit.append({
            kind: 'budget.soft_limit_reached',
            actor_type: 'system',
            project_id: scopes.project_id ?? null,
            trace_id: scopes.trace_id ?? null,
            subject_type: 'budget',
            subject_id: budget.budget_id,
            severity: 'warn',
            payload: { scope_type: scope.type, scope_id: scope.id, consumed },
          });
        }
      }

      return { warnings, exceeded };
    },

    pause(scopeType: string, scopeId: string, reason: string): void {
      const budget = repos.budgets.find(scopeType, scopeId);
      if (!budget) throw new RuntimeError('NOT_FOUND', `no ${scopeType} budget for ${scopeId}`);
      repos.budgets.setStatus(budget.budget_id, 'paused');
      audit.append({
        kind: 'budget.paused',
        actor_type: 'owner',
        subject_type: 'budget',
        subject_id: budget.budget_id,
        severity: 'security',
        payload: { reason },
      });
    },

    resume(scopeType: string, scopeId: string): void {
      const budget = repos.budgets.find(scopeType, scopeId);
      if (!budget) throw new RuntimeError('NOT_FOUND', `no ${scopeType} budget for ${scopeId}`);
      repos.budgets.setStatus(budget.budget_id, 'ok');
    },

    totals(filter: { project_id?: string; agent_id?: string } = {}) {
      return repos.budgets.usageTotals(filter);
    },

    usage(filter: { project_id?: string; agent_id?: string; task_id?: string; trace_id?: string; limit?: number } = {}) {
      return repos.budgets.listUsage(filter);
    },
  };

  return service;
}

export type BudgetService = ReturnType<typeof createBudgetService>;
