import { z } from 'zod';
import { Json } from './common.js';

export const EventRecord = z.object({
  event_id: z.string(),
  trace_id: z.string().nullable(),
  kind: z.string(),
  actor_type: z.enum(['owner', 'agent', 'system', 'instance']),
  actor_id: z.string().nullable(),
  project_id: z.string().nullable(),
  subject_type: z.string().nullable(),
  subject_id: z.string().nullable(),
  severity: z.enum(['debug', 'info', 'warn', 'error', 'security']),
  payload: Json,
  created_at: z.string(),
});
export type EventRecord = z.infer<typeof EventRecord>;

export const AppendEventInput = z.object({
  kind: z.string().min(1),
  actor_type: z.enum(['owner', 'agent', 'system', 'instance']).default('system'),
  actor_id: z.string().nullable().default(null),
  trace_id: z.string().nullable().default(null),
  project_id: z.string().nullable().default(null),
  subject_type: z.string().nullable().default(null),
  subject_id: z.string().nullable().default(null),
  severity: z.enum(['debug', 'info', 'warn', 'error', 'security']).default('info'),
  payload: Json.default({}),
});
export type AppendEventInput = z.infer<typeof AppendEventInput>;

export const JobRecord = z.object({
  job_id: z.string(),
  kind: z.string(),
  schedule_kind: z.enum(['once', 'interval', 'event']),
  interval_ms: z.number().int().nullable(),
  event_key: z.string().nullable(),
  payload: Json,
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  last_error: z.string().nullable(),
  locked_by: z.string().nullable(),
  locked_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobRecord = z.infer<typeof JobRecord>;
