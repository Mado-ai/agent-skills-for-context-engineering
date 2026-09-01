import { z } from 'zod';
import { Json, Priority } from './common.js';

export const TaskStatus = z.enum([
  'pending',
  'assigned',
  'running',
  'awaiting_review',
  'rework',
  'blocked',
  'awaiting_approval',
  'completed',
  'failed',
  'escalated',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * Legal task transitions. Enforced centrally so no route can move a task into a
 * state the quality and approval loops do not expect.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  // As with packets, escalation is reachable from every live state: a task
  // that cannot start — no budget, no capacity — must escalate rather than sit.
  pending: ['assigned', 'cancelled', 'blocked', 'escalated'],
  assigned: ['running', 'blocked', 'cancelled', 'pending', 'escalated'],
  running: ['awaiting_review', 'awaiting_approval', 'blocked', 'failed', 'escalated', 'cancelled'],
  awaiting_review: ['completed', 'rework', 'escalated', 'failed'],
  rework: ['running', 'assigned', 'escalated', 'failed', 'cancelled'],
  blocked: ['assigned', 'running', 'cancelled', 'escalated'],
  awaiting_approval: ['running', 'blocked', 'failed', 'cancelled', 'escalated'],
  completed: [],
  failed: ['rework'],
  escalated: ['assigned', 'rework', 'cancelled', 'failed', 'completed'],
  cancelled: [],
};

export const TaskRecord = z.object({
  task_id: z.string(),
  project_id: z.string(),
  loop_id: z.string().nullable(),
  parent_task_id: z.string().nullable(),
  trace_id: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatus,
  priority: Priority,
  assigned_agent_id: z.string().nullable(),
  created_by: z.string(),
  input: Json,
  result: Json.nullable(),
  attempt: z.number().int(),
  max_attempts: z.number().int(),
  deadline_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskRecord = z.infer<typeof TaskRecord>;

export const CreateTaskInput = z.object({
  project_id: z.string().min(1),
  title: z.string().min(3).max(200),
  description: z.string().max(4000).default(''),
  loop_id: z.string().nullable().default(null),
  parent_task_id: z.string().nullable().default(null),
  priority: Priority.default('normal'),
  assigned_agent_id: z.string().nullable().default(null),
  input: Json.default({}),
  max_attempts: z.number().int().min(1).max(10).default(3),
  deadline_at: z.string().nullable().default(null),
  trace_id: z.string().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const TaskArtifactRecord = z.object({
  artifact_id: z.string(),
  task_id: z.string(),
  packet_id: z.string().nullable(),
  agent_id: z.string(),
  project_id: z.string(),
  trace_id: z.string(),
  kind: z.string(),
  content: Json,
  content_hash: z.string(),
  provenance: Json,
  attempt: z.number().int(),
  created_at: z.string(),
});
export type TaskArtifactRecord = z.infer<typeof TaskArtifactRecord>;
