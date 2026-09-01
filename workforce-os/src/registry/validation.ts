import {
  ACCESS_RANK,
  AgentContract,
  ROLE_RANK,
  type AgentRecord,
} from '../domain/index.js';
import type { Repos } from '../db/repo/index.js';
import { deriveScopes, scopesWithinParent } from '../policy/scopes.js';

/**
 * Contract validation.
 *
 * Zod already guarantees shape. This pass checks the things shape cannot: that
 * every reference resolves, that the contract is internally consistent, and —
 * the load-bearing rule — that a child never claims more authority than the
 * parent it hangs from. An agent that fails validation cannot reach `active`.
 */

export interface ValidationIssue {
  code: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  checked_at: string;
}

function issue(code: string, field: string, message: string): ValidationIssue {
  return { code, field, message };
}

export function validateContract(
  raw: unknown,
  repos: Repos,
  options: { parent?: AgentRecord | null } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parsed = AgentContract.safeParse(raw);
  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push(issue('SHAPE', err.path.join('.') || '(root)', err.message));
    }
    return { valid: false, issues, warnings, checked_at: new Date().toISOString() };
  }
  const c = parsed.data;

  // --- referenced entities must exist -------------------------------------

  for (const toolName of c.allowed_tools) {
    const tool = repos.governance.getTool(toolName);
    if (!tool) {
      issues.push(issue('UNKNOWN_TOOL', 'allowed_tools', `tool "${toolName}" is not registered`));
    } else if (tool.status !== 'active') {
      warnings.push(issue('TOOL_DISABLED', 'allowed_tools', `tool "${toolName}" is currently disabled`));
    }
  }

  for (const projectId of c.project_scope.project_ids) {
    if (!repos.projects.get(projectId)) {
      issues.push(issue('UNKNOWN_PROJECT', 'project_scope', `project "${projectId}" does not exist`));
    }
  }

  for (const loopId of c.owned_workflow_loops) {
    if (!repos.projects.getLoop(loopId)) {
      issues.push(issue('UNKNOWN_LOOP', 'owned_workflow_loops', `loop "${loopId}" does not exist`));
    }
  }

  for (const gateKey of c.quality_gates) {
    if (!repos.quality.getGateByKey(gateKey) && !repos.quality.getGate(gateKey)) {
      issues.push(issue('UNKNOWN_GATE', 'quality_gates', `quality gate "${gateKey}" does not exist`));
    }
  }

  for (const templateKey of c.allowed_child_templates) {
    if (!repos.agents.getTemplateByKey(templateKey)) {
      issues.push(
        issue('UNKNOWN_TEMPLATE', 'allowed_child_templates', `template "${templateKey}" does not exist`),
      );
    }
  }

  // --- internal consistency ------------------------------------------------

  const forbidden = new Set(c.forbidden_actions);
  for (const toolName of c.allowed_tools) {
    if (forbidden.has(toolName)) {
      issues.push(
        issue(
          'CONTRADICTION',
          'forbidden_actions',
          `"${toolName}" appears in both allowed_tools and forbidden_actions`,
        ),
      );
    }
  }
  for (const toolName of c.human_approval_requirements.never_permitted) {
    if (c.allowed_tools.includes(toolName)) {
      issues.push(
        issue(
          'CONTRADICTION',
          'human_approval_requirements.never_permitted',
          `"${toolName}" is both allowlisted and never permitted`,
        ),
      );
    }
  }

  if (c.memory_policy.may_write_authoritative && ACCESS_RANK[c.access_level] < ACCESS_RANK.admin) {
    issues.push(
      issue(
        'INSUFFICIENT_LEVEL',
        'memory_policy.may_write_authoritative',
        'writing authoritative memory requires access_level admin or higher',
      ),
    );
  }

  for (const layer of c.memory_policy.writable_layers) {
    if (layer === 'authoritative' && !c.memory_policy.may_write_authoritative) {
      issues.push(
        issue(
          'CONTRADICTION',
          'memory_policy.writable_layers',
          'authoritative is writable but may_write_authoritative is false',
        ),
      );
    }
    if (!c.memory_policy.readable_layers.includes(layer)) {
      warnings.push(
        issue(
          'WRITE_WITHOUT_READ',
          'memory_policy',
          `layer "${layer}" is writable but not readable; the agent cannot verify its own writes`,
        ),
      );
    }
  }

  for (const source of c.required_knowledge_sources) {
    if (!c.memory_policy.readable_layers.includes(source.layer)) {
      issues.push(
        issue(
          'UNREACHABLE_KNOWLEDGE',
          'required_knowledge_sources',
          `required source "${source.key}" is in layer "${source.layer}", which the memory policy cannot read`,
        ),
      );
    }
  }

  const kpiKeys = new Set<string>();
  for (const kpi of c.kpis) {
    if (kpiKeys.has(kpi.key)) {
      issues.push(issue('DUPLICATE_KPI', 'kpis', `duplicate KPI key "${kpi.key}"`));
    }
    kpiKeys.add(kpi.key);
  }

  if (c.role_level !== 'ephemeral' && c.concurrency_limit < 1) {
    issues.push(
      issue('INVALID_CONCURRENCY', 'concurrency_limit', 'a non-ephemeral agent needs a concurrency limit of at least 1'),
    );
  }

  if (c.allowed_child_templates.length > 0 && c.role_level === 'specialist') {
    warnings.push(
      issue(
        'UNUSUAL_HIERARCHY',
        'allowed_child_templates',
        'a specialist that can instantiate children deepens the delegation graph; confirm this is intended',
      ),
    );
  }

  for (const rule of c.escalation_rules) {
    if (rule.escalate_to !== 'owner' && !rule.escalate_to.startsWith('agt_') && !ROLE_RANK[rule.escalate_to as never]) {
      warnings.push(
        issue('UNRESOLVED_ESCALATION', 'escalation_rules', `escalation target "${rule.escalate_to}" is not an agent id, role level, or "owner"`),
      );
    }
  }

  if (c.quality_gates.length === 0 && c.role_level !== 'ephemeral') {
    warnings.push(
      issue('NO_QUALITY_GATE', 'quality_gates', 'agent declares no quality gate; its output will not be evaluated'),
    );
  }

  // --- authority bounds against the parent ---------------------------------

  const parent = options.parent ?? (c.parent_agent_id ? repos.agents.getAgent(c.parent_agent_id) : null);

  if (c.parent_agent_id && !parent) {
    issues.push(issue('UNKNOWN_PARENT', 'parent_agent_id', `parent "${c.parent_agent_id}" does not exist`));
  }

  if (c.role_level !== 'chief' && !c.parent_agent_id) {
    issues.push(issue('ORPHAN_AGENT', 'parent_agent_id', 'only the Chief may have no parent'));
  }

  if (c.role_level === 'chief' && c.parent_agent_id) {
    issues.push(issue('CHIEF_HAS_PARENT', 'parent_agent_id', 'the Chief reports to the Owner, not to an agent'));
  }

  if (parent) {
    const parentContract = repos.agents.getContractVersion(parent.agent_id, parent.current_version)?.contract;
    if (!parentContract) {
      issues.push(issue('PARENT_UNVERSIONED', 'parent_agent_id', 'parent has no current contract version'));
    } else {
      if (ROLE_RANK[c.role_level] >= ROLE_RANK[parentContract.role_level]) {
        issues.push(
          issue(
            'ROLE_ESCALATION',
            'role_level',
            `a ${c.role_level} cannot report to a ${parentContract.role_level}`,
          ),
        );
      }

      if (ACCESS_RANK[c.access_level] > ACCESS_RANK[parentContract.access_level]) {
        issues.push(
          issue(
            'ACCESS_ESCALATION',
            'access_level',
            `child access level "${c.access_level}" exceeds parent "${parentContract.access_level}"`,
          ),
        );
      }

      const parentTools = new Set(parentContract.allowed_tools);
      const excessTools = c.allowed_tools.filter((t) => !parentTools.has(t));
      if (excessTools.length > 0) {
        issues.push(
          issue(
            'TOOL_ESCALATION',
            'allowed_tools',
            `child claims tools the parent cannot delegate: ${excessTools.join(', ')}`,
          ),
        );
      }

      if (!parentContract.project_scope.all_projects) {
        if (c.project_scope.all_projects) {
          issues.push(
            issue('SCOPE_ESCALATION', 'project_scope', 'child claims all projects but the parent does not'),
          );
        }
        const parentProjects = new Set(parentContract.project_scope.project_ids);
        const excessProjects = c.project_scope.project_ids.filter((p) => !parentProjects.has(p));
        if (excessProjects.length > 0) {
          issues.push(
            issue(
              'SCOPE_ESCALATION',
              'project_scope',
              `child claims projects outside the parent scope: ${excessProjects.join(', ')}`,
            ),
          );
        }
      }

      const excessScopes = scopesWithinParent(deriveScopes(c), deriveScopes(parentContract));
      if (excessScopes.length > 0) {
        issues.push(
          issue(
            'SCOPE_ESCALATION',
            'data_scope',
            `child derives scopes the parent does not hold: ${excessScopes.join(', ')}`,
          ),
        );
      }

      const parentLayers = new Set(parentContract.memory_policy.readable_layers);
      const excessLayers = c.memory_policy.readable_layers.filter((l) => !parentLayers.has(l));
      if (excessLayers.length > 0) {
        issues.push(
          issue(
            'SCOPE_ESCALATION',
            'memory_policy.readable_layers',
            `child reads memory layers the parent cannot: ${excessLayers.join(', ')}`,
          ),
        );
      }

      if (c.budget_policy.max_estimated_cost > parentContract.budget_policy.max_estimated_cost) {
        warnings.push(
          issue(
            'BUDGET_ABOVE_PARENT',
            'budget_policy.max_estimated_cost',
            `child cost ceiling ${c.budget_policy.max_estimated_cost} exceeds parent ${parentContract.budget_policy.max_estimated_cost}`,
          ),
        );
      }

      const parentTemplates = new Set(parentContract.allowed_child_templates);
      if (parentContract.allowed_child_templates.length > 0) {
        const excessTemplates = c.allowed_child_templates.filter((t) => !parentTemplates.has(t));
        if (excessTemplates.length > 0) {
          issues.push(
            issue(
              'TEMPLATE_ESCALATION',
              'allowed_child_templates',
              `child may not delegate templates the parent cannot: ${excessTemplates.join(', ')}`,
            ),
          );
        }
      }
    }
  }

  // Only the Chief gets system-wide visibility, and never Owner access level.
  if (c.project_scope.all_projects && c.role_level !== 'chief') {
    issues.push(
      issue('SCOPE_ESCALATION', 'project_scope.all_projects', 'only the Chief may hold system-wide project scope'),
    );
  }
  if (c.access_level === 'owner') {
    issues.push(
      issue(
        'OWNER_LEVEL_AGENT',
        'access_level',
        'no agent may hold Owner access level; owner-gated actions run on an approval token',
      ),
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    checked_at: new Date().toISOString(),
  };
}
