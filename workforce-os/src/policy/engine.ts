import {
  ACCESS_RANK,
  RISK_RANK,
  type AgentContract,
  type AgentRecord,
  type ErrorCode,
  type ToolDefinition,
  type WorkPacketRecord,
} from '../domain/index.js';
import { EXPLICIT_GRANT_SCOPES, OWNER_ONLY_SCOPES, deriveScopes } from './scopes.js';

/**
 * The single authorization point.
 *
 * Every check is explicit, ordered, and recorded on the decision, so a denial
 * can always answer "which rule, and why". The engine never reads ambient
 * configuration: everything it decides on comes from the agent's contract, the
 * tool definition, and the packet in hand.
 *
 * The default is deny. A request is allowed only when every check passes.
 */

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  code: ErrorCode | null;
  reason: string;
  checks: PolicyCheck[];
  /** Set when the action is legitimate but needs an Owner decision first. */
  requiresApproval: boolean;
  /** Present when a valid token was supplied and consumed-by-the-caller. */
  approvalTokenId: string | null;
}

export interface TokenVerification {
  ok: boolean;
  tokenId: string | null;
  code: ErrorCode | null;
  reason: string;
}

export interface BudgetVerdict {
  ok: boolean;
  code: ErrorCode | null;
  reason: string;
  warnings: string[];
}

export interface AuthorizeToolCallRequest {
  agent: AgentRecord;
  contract: AgentContract;
  tool: ToolDefinition | undefined;
  toolName: string;
  args: Record<string, unknown>;
  projectId: string | null;
  packet: WorkPacketRecord | null;
  /** Live instance count for this agent, used for the concurrency check. */
  liveInstances: number;
  approvalToken: string | null;
  actionFingerprint: string;
  verifyToken: (token: string, fingerprint: string, agentId: string) => TokenVerification;
  checkBudgets: () => BudgetVerdict;
}

function fail(
  checks: PolicyCheck[],
  code: ErrorCode,
  name: string,
  reason: string,
  requiresApproval = false,
): AuthorizationDecision {
  checks.push({ name, passed: false, detail: reason });
  return { allowed: false, code, reason, checks, requiresApproval, approvalTokenId: null };
}

function pass(checks: PolicyCheck[], name: string, detail: string): void {
  checks.push({ name, passed: true, detail });
}

/** Statuses in which an agent may execute anything at all. */
export const EXECUTABLE_STATUSES = new Set(['active']);

export function agentCanSeeProject(contract: AgentContract, projectId: string | null): boolean {
  if (projectId === null) return true; // Runtime-global action, not project data.
  if (contract.project_scope.all_projects) return true;
  return contract.project_scope.project_ids.includes(projectId);
}

export function authorizeToolCall(req: AuthorizeToolCallRequest): AuthorizationDecision {
  const checks: PolicyCheck[] = [];

  // 1. The agent exists and is in an executing state.
  if (!EXECUTABLE_STATUSES.has(req.agent.status)) {
    return fail(
      checks,
      'DENIED_AGENT_INACTIVE',
      'agent_active',
      `agent ${req.agent.agent_id} is ${req.agent.status}, not active`,
    );
  }
  pass(checks, 'agent_active', `agent is ${req.agent.status}`);

  // 2. The tool is registered, enabled, and inside the contract allowlist.
  if (!req.tool) {
    return fail(checks, 'DENIED_TOOL_NOT_ALLOWED', 'tool_registered', `tool ${req.toolName} is not registered`);
  }
  if (req.tool.status !== 'active') {
    return fail(checks, 'DENIED_TOOL_DISABLED', 'tool_enabled', `tool ${req.toolName} is disabled`);
  }
  if (!req.contract.allowed_tools.includes(req.toolName)) {
    return fail(
      checks,
      'DENIED_TOOL_NOT_ALLOWED',
      'tool_in_contract',
      `tool ${req.toolName} is not in the contract allowlist`,
    );
  }
  pass(checks, 'tool_in_contract', `${req.toolName} is allowlisted`);

  // A packet may narrow the caller's tools further, never widen them.
  if (req.packet && req.packet.allowed_tools.length > 0 && !req.packet.allowed_tools.includes(req.toolName)) {
    return fail(
      checks,
      'DENIED_TOOL_NOT_ALLOWED',
      'tool_in_packet',
      `tool ${req.toolName} is not permitted by work packet ${req.packet.packet_id}`,
    );
  }
  pass(checks, 'tool_in_packet', req.packet ? 'packet permits tool' : 'no packet narrowing');

  // 3. Forbidden actions and never-permitted classes outrank everything below,
  //    including an Owner approval.
  if (req.contract.forbidden_actions.includes(req.toolName)) {
    return fail(
      checks,
      'DENIED_FORBIDDEN_ACTION',
      'not_forbidden',
      `tool ${req.toolName} is listed in forbidden_actions`,
    );
  }
  if (req.contract.human_approval_requirements.never_permitted.includes(req.toolName)) {
    return fail(
      checks,
      'DENIED_FORBIDDEN_ACTION',
      'not_never_permitted',
      `tool ${req.toolName} is never permitted for this agent`,
    );
  }
  pass(checks, 'not_forbidden', 'action is not forbidden');

  // 4. Project scope. Cross-project access is denied by default.
  if (!agentCanSeeProject(req.contract, req.projectId)) {
    return fail(
      checks,
      'DENIED_PROJECT_SCOPE',
      'project_scope',
      `agent has no access to project ${req.projectId}`,
    );
  }
  pass(checks, 'project_scope', req.projectId ? `project ${req.projectId} in scope` : 'no project context');

  // 5. Data scope: every scope the tool requires must be held by the contract.
  const held = deriveScopes(req.contract);
  const ownerGatedScopes: string[] = [];
  const missing: string[] = [];
  for (const scope of req.tool.required_scopes) {
    if (OWNER_ONLY_SCOPES.has(scope)) {
      // Reachable only through an Owner approval token, checked at step 8.
      ownerGatedScopes.push(scope);
      continue;
    }
    if (!held.has(scope)) missing.push(scope);
  }
  if (missing.length > 0) {
    const explicit = missing.filter((s) => EXPLICIT_GRANT_SCOPES.has(s));
    return fail(
      checks,
      'DENIED_DATA_SCOPE',
      'data_scope',
      explicit.length > 0
        ? `contract does not grant ${explicit.join(', ')}`
        : `missing scopes: ${missing.join(', ')}`,
    );
  }
  pass(checks, 'data_scope', `holds ${req.tool.required_scopes.length} required scope(s)`);

  // 6. Access level, unless the shortfall is exactly the owner-gated part,
  //    which an approval token supplies at step 8.
  const needsOwnerAuthority = req.tool.requires_owner_approval || ownerGatedScopes.length > 0;
  if (!needsOwnerAuthority && ACCESS_RANK[req.contract.access_level] < ACCESS_RANK[req.tool.required_access_level]) {
    return fail(
      checks,
      'DENIED_ACCESS_LEVEL',
      'access_level',
      `tool requires ${req.tool.required_access_level}; agent holds ${req.contract.access_level}`,
    );
  }
  pass(checks, 'access_level', `agent access level ${req.contract.access_level}`);

  // 7. Concurrency.
  if (req.liveInstances > req.contract.concurrency_limit) {
    return fail(
      checks,
      'DENIED_CONCURRENCY_LIMIT',
      'concurrency',
      `agent has ${req.liveInstances} live instances, limit is ${req.contract.concurrency_limit}`,
    );
  }
  pass(checks, 'concurrency', `${req.liveInstances}/${req.contract.concurrency_limit} instances live`);

  // 8. Risk and Owner approval. A tool marked owner-gated, or one whose risk
  //    meets the contract's approval threshold, needs a valid execution token.
  const riskNeedsApproval =
    RISK_RANK[req.tool.risk_class] >=
    RISK_RANK[req.contract.human_approval_requirements.approval_required_at_or_above];
  const alwaysRequires = req.contract.human_approval_requirements.always_require.includes(req.toolName);
  const approvalNeeded = needsOwnerAuthority || riskNeedsApproval || alwaysRequires;

  let approvalTokenId: string | null = null;
  if (approvalNeeded) {
    if (!req.approvalToken) {
      checks.push({ name: 'owner_approval', passed: false, detail: 'no execution token supplied' });
      return {
        allowed: false,
        code: 'APPROVAL_REQUIRED',
        reason: `${req.toolName} requires an Owner approval and a valid execution token`,
        checks,
        requiresApproval: true,
        approvalTokenId: null,
      };
    }
    const verdict = req.verifyToken(req.approvalToken, req.actionFingerprint, req.agent.agent_id);
    if (!verdict.ok) {
      return fail(checks, verdict.code ?? 'APPROVAL_TOKEN_INVALID', 'owner_approval', verdict.reason);
    }
    approvalTokenId = verdict.tokenId;
    pass(checks, 'owner_approval', `token ${verdict.tokenId} valid for this exact action`);
  } else {
    pass(checks, 'owner_approval', 'not required at this risk class');
  }

  // 9. Budgets and operational limits.
  const budget = req.checkBudgets();
  if (!budget.ok) {
    return fail(checks, budget.code ?? 'BUDGET_HARD_EXCEEDED', 'budget', budget.reason);
  }
  pass(
    checks,
    'budget',
    budget.warnings.length > 0 ? `within limits (${budget.warnings.join('; ')})` : 'within limits',
  );

  return {
    allowed: true,
    code: null,
    reason: 'allowed',
    checks,
    requiresApproval: false,
    approvalTokenId,
  };
}
