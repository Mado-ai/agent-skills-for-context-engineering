import { z } from 'zod';

export const BudgetLimits = z.object({
  max_model_calls: z.number().int().nonnegative().nullable().default(null),
  max_tokens: z.number().int().nonnegative().nullable().default(null),
  max_estimated_cost: z.number().nonnegative().nullable().default(null),
  max_tool_calls: z.number().int().nonnegative().nullable().default(null),
  max_executions: z.number().int().nonnegative().nullable().default(null),
  max_retries: z.number().int().nonnegative().nullable().default(null),
  max_elapsed_ms: z.number().int().nonnegative().nullable().default(null),
  /** Below this fraction of a limit the runtime is silent; at or above it warns. */
  soft_limit_ratio: z.number().min(0).max(1).default(0.8),
});
export type BudgetLimits = z.infer<typeof BudgetLimits>;

export const BudgetConsumed = z.object({
  model_calls: z.number().int().nonnegative().default(0),
  tokens: z.number().int().nonnegative().default(0),
  estimated_cost: z.number().nonnegative().default(0),
  tool_calls: z.number().int().nonnegative().default(0),
  executions: z.number().int().nonnegative().default(0),
  retries: z.number().int().nonnegative().default(0),
  elapsed_ms: z.number().int().nonnegative().default(0),
});
export type BudgetConsumed = z.infer<typeof BudgetConsumed>;

export const BudgetRecord = z.object({
  budget_id: z.string(),
  scope_type: z.enum(['project', 'agent', 'task']),
  scope_id: z.string(),
  period: z.enum(['lifetime', 'daily', 'monthly']),
  limits: BudgetLimits,
  consumed: BudgetConsumed,
  status: z.enum(['ok', 'soft_exceeded', 'hard_exceeded', 'paused']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BudgetRecord = z.infer<typeof BudgetRecord>;

/** A single unit of work's resource cost, applied to every enclosing budget. */
export const UsageDelta = z.object({
  model_calls: z.number().int().nonnegative().default(0),
  tokens_in: z.number().int().nonnegative().default(0),
  tokens_out: z.number().int().nonnegative().default(0),
  estimated_cost: z.number().nonnegative().default(0),
  tool_calls: z.number().int().nonnegative().default(0),
  retries: z.number().int().nonnegative().default(0),
  elapsed_ms: z.number().int().nonnegative().default(0),
});
export type UsageDelta = z.infer<typeof UsageDelta>;

export const UsageRecord = z.object({
  usage_id: z.string(),
  trace_id: z.string().nullable(),
  project_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  task_id: z.string().nullable(),
  packet_id: z.string().nullable(),
  call_id: z.string().nullable(),
  kind: z.enum(['model_call', 'tool_call', 'execution', 'retry']),
  model_calls: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  estimated_cost: z.number(),
  tool_calls: z.number().int(),
  retries: z.number().int(),
  elapsed_ms: z.number().int(),
  created_at: z.string(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;
