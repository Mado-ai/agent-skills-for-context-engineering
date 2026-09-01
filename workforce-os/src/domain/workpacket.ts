import { z } from 'zod';
import { Json, Priority } from './common.js';

/**
 * The typed control channel between agents. Free-form agent-to-agent chat is
 * deliberately not a runtime mechanism: everything an agent is asked to do
 * arrives as one of these, carrying its own authority bounds.
 */

export const PacketIntent = z.enum([
  'execute',
  'review',
  'rework',
  'research',
  'plan',
  'escalate',
  'verify',
  'notify',
]);
export type PacketIntent = z.infer<typeof PacketIntent>;

export const PacketStatus = z.enum([
  'created',
  'dispatched',
  'accepted',
  'in_progress',
  'delivered',
  'accepted_final',
  'rejected',
  'rework_requested',
  'expired',
  'cancelled',
  'escalated',
  'failed',
]);
export type PacketStatus = z.infer<typeof PacketStatus>;

export const PACKET_TRANSITIONS: Record<PacketStatus, PacketStatus[]> = {
  created: ['dispatched', 'cancelled'],
  // Escalation is reachable from every live state, not just from work in
  // flight: a packet the receiver cannot afford to start still has to be
  // escalated rather than left to expire silently.
  dispatched: ['accepted', 'rejected', 'expired', 'cancelled', 'escalated'],
  accepted: ['in_progress', 'failed', 'expired', 'cancelled', 'escalated'],
  in_progress: ['delivered', 'failed', 'escalated', 'expired', 'cancelled'],
  delivered: ['accepted_final', 'rework_requested', 'rejected', 'escalated'],
  rework_requested: ['in_progress', 'escalated', 'failed', 'cancelled'],
  accepted_final: [],
  rejected: [],
  expired: [],
  cancelled: [],
  escalated: ['accepted_final', 'rework_requested', 'cancelled', 'failed'],
  failed: ['rework_requested'],
};

export const AcceptanceCriterion = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /**
   * Machine-checkable assertion. `field_present` and `field_equals` keep the
   * default quality gate deterministic; `manual` defers to a model or human
   * evaluator.
   */
  check: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('field_present'), path: z.string() }),
      z.object({ kind: z.literal('field_equals'), path: z.string(), value: z.unknown() }),
      z.object({ kind: z.literal('min_length'), path: z.string(), min: z.number().int() }),
      z.object({ kind: z.literal('min_items'), path: z.string(), min: z.number().int() }),
      z.object({ kind: z.literal('manual') }),
    ])
    .default({ kind: 'manual' }),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const PacketBudget = z.object({
  max_model_calls: z.number().int().nonnegative().optional(),
  max_tokens: z.number().int().nonnegative().optional(),
  max_estimated_cost: z.number().nonnegative().optional(),
  max_tool_calls: z.number().int().nonnegative().optional(),
});
export type PacketBudget = z.infer<typeof PacketBudget>;

export const ContextRef = z.object({
  kind: z.enum(['memory', 'artifact', 'task', 'packet', 'document']),
  id: z.string().min(1),
  note: z.string().default(''),
});
export type ContextRef = z.infer<typeof ContextRef>;

export const WorkPacketRecord = z.object({
  packet_id: z.string(),
  trace_id: z.string(),
  task_id: z.string(),
  sender_agent_id: z.string(),
  receiver_agent_id: z.string(),
  parent_packet_id: z.string().nullable(),
  project_id: z.string(),
  workflow_loop_id: z.string().nullable(),
  intent: PacketIntent,
  objective: z.string(),
  context_refs: z.array(ContextRef),
  input_payload: Json,
  allowed_tools: z.array(z.string()),
  data_scope: Json,
  expected_output_schema: Json,
  acceptance_criteria: z.array(AcceptanceCriterion),
  quality_gate_ids: z.array(z.string()),
  priority: Priority,
  budget: PacketBudget,
  deadline_at: z.string().nullable(),
  ttl_seconds: z.number().int().nullable(),
  escalation_target: z.string().nullable(),
  status: PacketStatus,
  created_at: z.string(),
  updated_at: z.string(),
});
export type WorkPacketRecord = z.infer<typeof WorkPacketRecord>;

export const DelegateInput = z.object({
  task_id: z.string().min(1),
  receiver_agent_id: z.string().min(1),
  intent: PacketIntent.default('execute'),
  objective: z.string().min(5).max(2000),
  parent_packet_id: z.string().nullable().default(null),
  workflow_loop_id: z.string().nullable().default(null),
  context_refs: z.array(ContextRef).default([]),
  input_payload: Json.default({}),
  allowed_tools: z.array(z.string()).default([]),
  data_scope: Json.default({}),
  expected_output_schema: Json.default({}),
  acceptance_criteria: z.array(AcceptanceCriterion).default([]),
  quality_gate_ids: z.array(z.string()).default([]),
  priority: Priority.default('normal'),
  budget: PacketBudget.default({}),
  deadline_at: z.string().nullable().default(null),
  ttl_seconds: z.number().int().positive().nullable().default(900),
  escalation_target: z.string().nullable().default(null),
});
export type DelegateInput = z.infer<typeof DelegateInput>;
