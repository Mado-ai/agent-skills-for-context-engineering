import { z } from 'zod';
import { AccessLevel, Json, RiskClass } from './common.js';

export const ToolDefinition = z.object({
  tool_name: z.string(),
  description: z.string(),
  risk_class: RiskClass,
  input_schema: Json,
  output_schema: Json,
  required_access_level: AccessLevel,
  required_scopes: z.array(z.string()),
  requires_owner_approval: z.boolean(),
  timeout_ms: z.number().int().positive(),
  audit_policy: z.enum(['none', 'metadata', 'full']),
  handler_key: z.string(),
  status: z.enum(['active', 'disabled']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;

export const ToolCallRecord = z.object({
  call_id: z.string(),
  trace_id: z.string(),
  tool_name: z.string(),
  agent_id: z.string().nullable(),
  instance_id: z.string().nullable(),
  task_id: z.string().nullable(),
  packet_id: z.string().nullable(),
  project_id: z.string().nullable(),
  args: Json,
  args_fingerprint: z.string(),
  phase: z.enum(['requested', 'denied', 'executed']),
  decision: z.enum(['allow', 'deny']),
  denial_code: z.string().nullable(),
  denial_reason: z.string().nullable(),
  approval_token_id: z.string().nullable(),
  status: z.enum(['ok', 'error', 'timeout']).nullable(),
  duration_ms: z.number().int().nullable(),
  result_summary: Json.nullable(),
  error: Json.nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecord>;
