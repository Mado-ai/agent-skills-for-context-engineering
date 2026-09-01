import { z } from 'zod';
import { Json } from './common.js';

export const ProjectRecord = z.object({
  project_id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'paused', 'archived']),
  parent_project_id: z.string().nullable(),
  metadata: Json,
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProjectRecord = z.infer<typeof ProjectRecord>;

export const CreateProjectInput = z.object({
  key: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase, hyphenated'),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).default(''),
  parent_project_id: z.string().nullable().default(null),
  metadata: Json.default({}),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const WorkflowLoopRecord = z.object({
  loop_id: z.string(),
  project_id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  trigger_kind: z.enum(['manual', 'scheduled', 'event']),
  schedule_expr: z.string().nullable(),
  event_key: z.string().nullable(),
  definition: Json,
  status: z.enum(['active', 'paused', 'retired']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type WorkflowLoopRecord = z.infer<typeof WorkflowLoopRecord>;

export const CreateWorkflowLoopInput = z.object({
  project_id: z.string().min(1),
  key: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).default(''),
  trigger_kind: z.enum(['manual', 'scheduled', 'event']).default('manual'),
  /** Interval in milliseconds for scheduled loops; null otherwise. */
  schedule_expr: z.string().nullable().default(null),
  event_key: z.string().nullable().default(null),
  /** Ordered steps: each names an intent and the agent role expected to own it. */
  definition: Json.default({}),
});
export type CreateWorkflowLoopInput = z.infer<typeof CreateWorkflowLoopInput>;
