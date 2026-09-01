import { z } from 'zod';
import { Json } from './common.js';

export const QualityCheckKind = z.enum([
  'schema',
  'acceptance_criteria',
  'evidence',
  'permission_compliance',
  'duplication',
  'model_evaluator',
]);
export type QualityCheckKind = z.infer<typeof QualityCheckKind>;

export const QualityCheckSpec = z.object({
  kind: QualityCheckKind,
  weight: z.number().min(0).default(1),
  config: Json.default({}),
});
export type QualityCheckSpec = z.infer<typeof QualityCheckSpec>;

export const QualityGateRecord = z.object({
  gate_id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  checks: z.array(QualityCheckSpec),
  threshold: z.number(),
  blocking: z.boolean(),
  separation_of_duties: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type QualityGateRecord = z.infer<typeof QualityGateRecord>;

export const CheckResult = z.object({
  kind: QualityCheckKind,
  passed: z.boolean(),
  weight: z.number(),
  detail: z.string(),
  findings: z.array(z.string()).default([]),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const QualityEvaluationRecord = z.object({
  evaluation_id: z.string(),
  gate_id: z.string(),
  task_id: z.string(),
  packet_id: z.string().nullable(),
  artifact_id: z.string().nullable(),
  project_id: z.string(),
  trace_id: z.string(),
  evaluator_agent_id: z.string().nullable(),
  evaluator_kind: z.enum(['deterministic', 'model', 'human']),
  passed: z.boolean(),
  score: z.number(),
  results: z.array(CheckResult),
  attempt: z.number().int(),
  created_at: z.string(),
});
export type QualityEvaluationRecord = z.infer<typeof QualityEvaluationRecord>;

export const CapaState = z.enum([
  'open',
  'investigating',
  'action_proposed',
  'verifying',
  'closed',
  'rejected',
]);
export type CapaState = z.infer<typeof CapaState>;

export const CapaRecord = z.object({
  capa_id: z.string(),
  project_id: z.string(),
  task_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  trace_id: z.string().nullable(),
  issue: z.string(),
  root_cause_hypothesis: z.string(),
  corrective_action: z.string(),
  preventive_action: z.string(),
  owner_agent_id: z.string().nullable(),
  owner_human: z.string().nullable(),
  state: CapaState,
  verification_result: z.string().nullable(),
  evidence: Json,
  created_at: z.string(),
  updated_at: z.string(),
});
export type CapaRecord = z.infer<typeof CapaRecord>;
