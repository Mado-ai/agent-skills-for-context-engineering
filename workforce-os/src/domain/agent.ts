import { z } from 'zod';
import {
  AccessLevel,
  ActivationMode,
  AgentStatus,
  Json,
  MemoryLayer,
  Priority,
  RiskClass,
  RoleLevel,
} from './common.js';

/**
 * The agent contract is the single source of truth for what an agent is and
 * what it may do. Nothing in the runtime consults ambient configuration: the
 * policy engine, the Tool Gateway, the delegation runtime and the quality loop
 * all read this object.
 *
 * Contracts are versioned and immutable once written. Changing an agent means
 * writing a new version and re-running validation and lifecycle gating.
 */

export const ProjectScope = z.object({
  /** Projects this agent may read from and act within. Empty means none. */
  project_ids: z.array(z.string()).default([]),
  /** When true the agent sees every project. Reserved for the Chief. */
  all_projects: z.boolean().default(false),
});
export type ProjectScope = z.infer<typeof ProjectScope>;

export const DataScope = z.object({
  /** Memory layers the agent may read. */
  memory_layers: z.array(MemoryLayer).default(['working', 'episodic', 'project']),
  /** Named data domains, e.g. "finance.ledger", "crm.contacts". */
  domains: z.array(z.string()).default([]),
  /** Domains explicitly withheld even if a broader domain would include them. */
  excluded_domains: z.array(z.string()).default([]),
});
export type DataScope = z.infer<typeof DataScope>;

export const MemoryPolicy = z.object({
  readable_layers: z.array(MemoryLayer).default(['working', 'episodic', 'project']),
  writable_layers: z.array(MemoryLayer).default(['working', 'episodic']),
  /**
   * Whether this agent may write to the authoritative layer. Off by default:
   * agents must not silently promote inferred facts to verified ones.
   */
  may_write_authoritative: z.boolean().default(false),
  working_ttl_seconds: z.number().int().positive().default(3600),
  /** Minimum confidence an inferred record must carry to be written at all. */
  min_write_confidence: z.number().min(0).max(1).default(0.4),
});
export type MemoryPolicy = z.infer<typeof MemoryPolicy>;

export const BudgetPolicy = z.object({
  max_model_calls: z.number().int().nonnegative().default(50),
  max_tokens: z.number().int().nonnegative().default(500_000),
  max_estimated_cost: z.number().nonnegative().default(10),
  max_tool_calls: z.number().int().nonnegative().default(200),
  max_retries: z.number().int().nonnegative().default(3),
  /** Fraction of a limit at which the runtime warns rather than blocks. */
  soft_limit_ratio: z.number().min(0).max(1).default(0.8),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicy>;

export const TimeLimits = z.object({
  max_task_seconds: z.number().int().positive().default(900),
  max_tool_call_seconds: z.number().int().positive().default(60),
  /** Idle time after which an elastic instance is reaped. */
  idle_timeout_seconds: z.number().int().positive().default(600),
});
export type TimeLimits = z.infer<typeof TimeLimits>;

export const Kpi = z.object({
  key: z.string().min(1),
  description: z.string().default(''),
  unit: z.string().default('ratio'),
  target: z.number(),
  direction: z.enum(['higher_is_better', 'lower_is_better']).default('higher_is_better'),
});
export type Kpi = z.infer<typeof Kpi>;

export const EscalationRule = z.object({
  /** Machine-checkable condition key, e.g. "quality_failures>=2". */
  condition: z.string().min(1),
  /** Agent id, role level, or the literal "owner". */
  escalate_to: z.string().min(1),
  note: z.string().default(''),
});
export type EscalationRule = z.infer<typeof EscalationRule>;

export const ReworkPolicy = z.object({
  max_attempts: z.number().int().min(1).max(10).default(3),
  /** What happens once max_attempts is spent. */
  on_exhaustion: z.enum(['escalate', 'fail', 'capa_and_escalate']).default('capa_and_escalate'),
  /** Open a CAPA record after this many failed attempts on one task. */
  capa_after_failures: z.number().int().min(1).default(2),
});
export type ReworkPolicy = z.infer<typeof ReworkPolicy>;

export const HumanApprovalRequirements = z.object({
  /** Risk class at or above which every call needs an Owner decision. */
  approval_required_at_or_above: RiskClass.default('high'),
  /** Named action classes that always require approval regardless of risk. */
  always_require: z.array(z.string()).default([]),
  /** Actions this agent may never take, approved or not. */
  never_permitted: z.array(z.string()).default([]),
});
export type HumanApprovalRequirements = z.infer<typeof HumanApprovalRequirements>;

export const KnowledgeSource = z.object({
  key: z.string().min(1),
  layer: MemoryLayer.default('project'),
  required: z.boolean().default(true),
  description: z.string().default(''),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;

export const Persona = z.object({
  tone: z.string().default('neutral, evidence-first, concise'),
  /** Behavioural rules injected into the agent's system context. */
  rules: z.array(z.string()).default([]),
  /** Things the agent must refuse or flag rather than do. */
  anti_patterns: z.array(z.string()).default([]),
});
export type Persona = z.infer<typeof Persona>;

export const AgentContract = z.object({
  agent_id: z.string().min(1),
  display_name: z.string().min(1).max(120),
  role_level: RoleLevel,
  version: z.number().int().positive(),
  status: AgentStatus,
  mission: z.string().min(10).max(2000),

  owned_workflow_loops: z.array(z.string()).default([]),
  parent_agent_id: z.string().nullable().default(null),
  allowed_child_templates: z.array(z.string()).default([]),

  project_scope: ProjectScope,
  data_scope: DataScope,

  allowed_tools: z.array(z.string()).default([]),
  forbidden_actions: z.array(z.string()).default([]),
  access_level: AccessLevel,

  input_schema: Json.default({}),
  output_schema: Json.default({}),

  persona: Persona.default({}),
  required_knowledge_sources: z.array(KnowledgeSource).default([]),

  memory_policy: MemoryPolicy.default({}),
  budget_policy: BudgetPolicy.default({}),
  time_limits: TimeLimits.default({}),

  kpis: z.array(Kpi).default([]),
  quality_gates: z.array(z.string()).default([]),
  escalation_rules: z.array(EscalationRule).default([]),
  rework_policy: ReworkPolicy.default({}),
  human_approval_requirements: HumanApprovalRequirements.default({}),

  concurrency_limit: z.number().int().min(0).max(1000).default(1),
  activation_mode: ActivationMode,

  /** Free-form annotations; never consulted by the policy engine. */
  metadata: Json.default({}),
});
export type AgentContract = z.infer<typeof AgentContract>;

/** A template is a contract with identity and lifecycle fields left open. */
export const AgentContractTemplate = AgentContract.omit({
  agent_id: true,
  version: true,
  status: true,
  parent_agent_id: true,
}).partial({ display_name: true });
export type AgentContractTemplate = z.infer<typeof AgentContractTemplate>;

export const AgentRecord = z.object({
  agent_id: z.string(),
  display_name: z.string(),
  role_level: RoleLevel,
  status: AgentStatus,
  current_version: z.number().int(),
  parent_agent_id: z.string().nullable(),
  template_id: z.string().nullable(),
  merged_into_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  retired_at: z.string().nullable(),
});
export type AgentRecord = z.infer<typeof AgentRecord>;

export const AgentInstanceRecord = z.object({
  instance_id: z.string(),
  agent_id: z.string(),
  contract_version: z.number().int(),
  activation_mode: ActivationMode,
  status: z.enum(['idle', 'busy', 'paused', 'ended']),
  project_id: z.string().nullable(),
  task_id: z.string().nullable(),
  loop_id: z.string().nullable(),
  ttl_seconds: z.number().int().nullable(),
  metadata: Json,
  started_at: z.string(),
  last_active_at: z.string(),
  ended_at: z.string().nullable(),
  end_reason: z.string().nullable(),
});
export type AgentInstanceRecord = z.infer<typeof AgentInstanceRecord>;

export { Priority };
