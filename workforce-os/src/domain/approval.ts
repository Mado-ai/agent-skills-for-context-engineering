import { z } from 'zod';
import { Json, RiskClass } from './common.js';

/**
 * Owner-gated action classes. An agent may request any of these; none of them
 * executes without an explicit Owner decision and a token bound to the exact
 * action, arguments, actor, project and trace.
 */
export const OWNER_GATED_ACTION_CLASSES = [
  'financial_commitment',
  'binding_contract',
  'credential_grant',
  'destructive_production',
  'external_publishing',
  'policy_change',
  'irreversible_data',
] as const;
export type OwnerGatedActionClass = (typeof OWNER_GATED_ACTION_CLASSES)[number];

export const ApprovalStatus = z.enum(['pending', 'approved', 'denied', 'expired', 'revoked']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRecord = z.object({
  approval_id: z.string(),
  trace_id: z.string(),
  requested_by_agent_id: z.string(),
  action: z.string(),
  tool_name: z.string().nullable(),
  project_id: z.string().nullable(),
  task_id: z.string().nullable(),
  packet_id: z.string().nullable(),
  args: Json,
  args_fingerprint: z.string(),
  justification: z.string(),
  risk_class: RiskClass,
  status: ApprovalStatus,
  decided_by: z.string().nullable(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecord>;

export const RequestApprovalInput = z.object({
  requested_by_agent_id: z.string().min(1),
  action: z.string().min(1),
  tool_name: z.string().nullable().default(null),
  project_id: z.string().nullable().default(null),
  task_id: z.string().nullable().default(null),
  packet_id: z.string().nullable().default(null),
  args: Json.default({}),
  justification: z.string().min(1).max(2000),
  risk_class: RiskClass.default('high'),
  /** How long the Owner has to decide before the request lapses. */
  request_ttl_seconds: z.number().int().min(60).max(604800).default(86400),
  trace_id: z.string().optional(),
});
export type RequestApprovalInput = z.infer<typeof RequestApprovalInput>;

export const DecideApprovalInput = z.object({
  approval_id: z.string().min(1),
  decision: z.enum(['approved', 'denied']),
  decided_by: z.string().min(1),
  decision_note: z.string().max(2000).default(''),
  /**
   * Lifetime of the execution token minted on approval. Deliberately short:
   * the token authorises one execution of one exact action.
   */
  token_ttl_seconds: z.number().int().min(30).max(3600).default(300),
});
export type DecideApprovalInput = z.infer<typeof DecideApprovalInput>;

export const ApprovalTokenRecord = z.object({
  token_id: z.string(),
  approval_id: z.string(),
  action_fingerprint: z.string(),
  actor_agent_id: z.string(),
  project_id: z.string().nullable(),
  issued_at: z.string(),
  expires_at: z.string(),
  consumed_at: z.string().nullable(),
  consumed_call_id: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export type ApprovalTokenRecord = z.infer<typeof ApprovalTokenRecord>;
