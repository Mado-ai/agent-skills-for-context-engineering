import type { Db } from '../connection.js';
import { parseJson, toJson } from '../connection.js';
import {
  BudgetConsumed,
  BudgetLimits,
  newId,
  nowIso,
  type BudgetRecord,
  type UsageRecord,
} from '../../domain/index.js';

function mapBudget(row: Record<string, unknown>): BudgetRecord {
  return {
    budget_id: row.budget_id as string,
    scope_type: row.scope_type as BudgetRecord['scope_type'],
    scope_id: row.scope_id as string,
    period: row.period as BudgetRecord['period'],
    limits: BudgetLimits.parse(parseJson(row.limits, {})),
    consumed: BudgetConsumed.parse(parseJson(row.consumed, {})),
    status: row.status as BudgetRecord['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createBudgetRepo(db: Db) {
  return {
    upsert(rec: {
      scope_type: BudgetRecord['scope_type'];
      scope_id: string;
      period?: BudgetRecord['period'];
      limits: Partial<BudgetRecord['limits']>;
    }): BudgetRecord {
      const period = rec.period ?? 'lifetime';
      const existing = this.find(rec.scope_type, rec.scope_id, period);
      const limits = BudgetLimits.parse({ ...(existing?.limits ?? {}), ...rec.limits });
      const ts = nowIso();
      if (existing) {
        db.run(
          'UPDATE budgets SET limits = ?, updated_at = ? WHERE budget_id = ?',
          toJson(limits),
          ts,
          existing.budget_id,
        );
        return { ...existing, limits, updated_at: ts };
      }
      const budget: BudgetRecord = {
        budget_id: newId('budget'),
        scope_type: rec.scope_type,
        scope_id: rec.scope_id,
        period,
        limits,
        consumed: BudgetConsumed.parse({}),
        status: 'ok',
        created_at: ts,
        updated_at: ts,
      };
      db.run(
        `INSERT INTO budgets (budget_id, scope_type, scope_id, period, limits, consumed, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        budget.budget_id,
        budget.scope_type,
        budget.scope_id,
        budget.period,
        toJson(budget.limits),
        toJson(budget.consumed),
        budget.status,
        ts,
        ts,
      );
      return budget;
    },

    find(scopeType: string, scopeId: string, period = 'lifetime'): BudgetRecord | undefined {
      const row = db.get(
        'SELECT * FROM budgets WHERE scope_type = ? AND scope_id = ? AND period = ?',
        scopeType,
        scopeId,
        period,
      );
      return row ? mapBudget(row) : undefined;
    },

    get(budgetId: string): BudgetRecord | undefined {
      const row = db.get('SELECT * FROM budgets WHERE budget_id = ?', budgetId);
      return row ? mapBudget(row) : undefined;
    },

    list(filter: { scope_type?: string; scope_id?: string } = {}): BudgetRecord[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter.scope_type) {
        clauses.push('scope_type = ?');
        params.push(filter.scope_type);
      }
      if (filter.scope_id) {
        clauses.push('scope_id = ?');
        params.push(filter.scope_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return db.all(`SELECT * FROM budgets ${where} ORDER BY scope_type, scope_id`, ...params).map(mapBudget);
    },

    applyConsumption(budgetId: string, consumed: BudgetRecord['consumed'], status: BudgetRecord['status']): void {
      db.run(
        'UPDATE budgets SET consumed = ?, status = ?, updated_at = ? WHERE budget_id = ?',
        toJson(consumed),
        status,
        nowIso(),
        budgetId,
      );
    },

    setStatus(budgetId: string, status: BudgetRecord['status']): void {
      db.run('UPDATE budgets SET status = ?, updated_at = ? WHERE budget_id = ?', status, nowIso(), budgetId);
    },

    insertUsage(rec: Omit<UsageRecord, 'usage_id' | 'created_at'>): UsageRecord {
      const ts = nowIso();
      const id = newId('usage');
      db.run(
        `INSERT INTO usage_records (usage_id, trace_id, project_id, agent_id, task_id, packet_id,
           call_id, kind, model_calls, tokens_in, tokens_out, estimated_cost, tool_calls, retries,
           elapsed_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        rec.trace_id,
        rec.project_id,
        rec.agent_id,
        rec.task_id,
        rec.packet_id,
        rec.call_id,
        rec.kind,
        rec.model_calls,
        rec.tokens_in,
        rec.tokens_out,
        rec.estimated_cost,
        rec.tool_calls,
        rec.retries,
        rec.elapsed_ms,
        ts,
      );
      return { ...rec, usage_id: id, created_at: ts };
    },

    listUsage(filter: { project_id?: string; agent_id?: string; task_id?: string; trace_id?: string; limit?: number } = {}): UsageRecord[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      for (const key of ['project_id', 'agent_id', 'task_id', 'trace_id'] as const) {
        const value = filter[key];
        if (value) {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(filter.limit ?? 200);
      return db.all(`SELECT * FROM usage_records ${where} ORDER BY usage_id DESC LIMIT ?`, ...params).map(
        (row): UsageRecord => ({
          usage_id: row.usage_id as string,
          trace_id: (row.trace_id as string) ?? null,
          project_id: (row.project_id as string) ?? null,
          agent_id: (row.agent_id as string) ?? null,
          task_id: (row.task_id as string) ?? null,
          packet_id: (row.packet_id as string) ?? null,
          call_id: (row.call_id as string) ?? null,
          kind: row.kind as UsageRecord['kind'],
          model_calls: Number(row.model_calls),
          tokens_in: Number(row.tokens_in),
          tokens_out: Number(row.tokens_out),
          estimated_cost: Number(row.estimated_cost),
          tool_calls: Number(row.tool_calls),
          retries: Number(row.retries),
          elapsed_ms: Number(row.elapsed_ms),
          created_at: row.created_at as string,
        }),
      );
    },

    usageTotals(filter: { project_id?: string; agent_id?: string } = {}): {
      model_calls: number;
      tokens: number;
      estimated_cost: number;
      tool_calls: number;
      retries: number;
      elapsed_ms: number;
      records: number;
    } {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter.project_id) {
        clauses.push('project_id = ?');
        params.push(filter.project_id);
      }
      if (filter.agent_id) {
        clauses.push('agent_id = ?');
        params.push(filter.agent_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const row = db.get<Record<string, number>>(
        `SELECT COALESCE(SUM(model_calls),0) AS model_calls,
                COALESCE(SUM(tokens_in + tokens_out),0) AS tokens,
                COALESCE(SUM(estimated_cost),0) AS estimated_cost,
                COALESCE(SUM(tool_calls),0) AS tool_calls,
                COALESCE(SUM(retries),0) AS retries,
                COALESCE(SUM(elapsed_ms),0) AS elapsed_ms,
                COUNT(*) AS records
         FROM usage_records ${where}`,
        ...params,
      );
      return {
        model_calls: Number(row?.model_calls ?? 0),
        tokens: Number(row?.tokens ?? 0),
        estimated_cost: Number(row?.estimated_cost ?? 0),
        tool_calls: Number(row?.tool_calls ?? 0),
        retries: Number(row?.retries ?? 0),
        elapsed_ms: Number(row?.elapsed_ms ?? 0),
        records: Number(row?.records ?? 0),
      };
    },
  };
}

export type BudgetRepo = ReturnType<typeof createBudgetRepo>;
