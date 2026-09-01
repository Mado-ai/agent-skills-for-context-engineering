import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import type { Registry } from '../registry/registry.js';
import type { ApprovalService } from '../approvals/service.js';
import type { BudgetService } from '../budget/service.js';
import {
  RuntimeError,
  newId,
  newTraceId,
  nowIso,
  type AgentContract,
  type ToolCallRecord,
  type ToolDefinition,
} from '../domain/index.js';
import { authorizeToolCall, type AuthorizationDecision } from '../policy/engine.js';
import { actionFingerprint, argsFingerprint } from '../policy/fingerprint.js';
import { validateAgainstSchema } from './schema.js';

/**
 * The Tool Gateway.
 *
 * Every tool invocation in the runtime goes through `call`. There is no second
 * path: handlers are not exported for direct use, and the runtime registers no
 * shell, filesystem-write, or arbitrary-code tool for agents to reach.
 *
 * A call is audited before it executes and again after it settles, so an
 * attempt that crashes mid-flight still leaves a record of having been made.
 */

export interface ToolHandlerContext {
  agentId: string;
  contract: AgentContract;
  instanceId: string | null;
  projectId: string | null;
  taskId: string | null;
  packetId: string | null;
  traceId: string;
  callId: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolHandlerContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface ToolCallRequest {
  agentId: string;
  toolName: string;
  args?: Record<string, unknown>;
  projectId?: string | null;
  taskId?: string | null;
  packetId?: string | null;
  instanceId?: string | null;
  approvalToken?: string | null;
  traceId?: string;
}

export interface ToolCallResult {
  call_id: string;
  trace_id: string;
  tool_name: string;
  output: Record<string, unknown>;
  duration_ms: number;
  warnings: string[];
}

export interface GatewayDeps {
  repos: Repos;
  audit: AuditLog;
  registry: Registry;
  approvals: ApprovalService;
  budgets: BudgetService;
  handlers: Map<string, ToolHandler>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RuntimeError('TOOL_TIMEOUT', `tool ${toolName} exceeded its ${ms}ms timeout`, { timeout_ms: ms }));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Result payloads can be large; the audit trail keeps a shape, not a copy. */
function summarize(output: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      summary[key] = typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else if (Array.isArray(value)) {
      summary[key] = `[array:${value.length}]`;
    } else {
      summary[key] = `{object:${Object.keys(value as object).length}}`;
    }
  }
  return summary;
}

export function createToolGateway(deps: GatewayDeps) {
  const { repos, audit, registry, approvals, budgets } = deps;

  function resolve(request: ToolCallRequest) {
    const agent = repos.agents.getAgent(request.agentId);
    if (!agent) throw new RuntimeError('NOT_FOUND', `agent ${request.agentId} not found`);
    const contract =
      agent.current_version > 0
        ? repos.agents.getContractVersion(agent.agent_id, agent.current_version)?.contract
        : undefined;
    if (!contract) {
      throw new RuntimeError('CONTRACT_INVALID', `agent ${request.agentId} has no current contract`);
    }
    const tool = repos.governance.getTool(request.toolName);
    const packet = request.packetId ? (repos.tasks.getPacket(request.packetId) ?? null) : null;
    return { agent, contract, tool, packet };
  }

  function decide(
    request: ToolCallRequest,
    resolved: ReturnType<typeof resolve>,
    fingerprint: string,
  ): AuthorizationDecision {
    return authorizeToolCall({
      agent: resolved.agent,
      contract: resolved.contract,
      tool: resolved.tool,
      toolName: request.toolName,
      args: request.args ?? {},
      projectId: request.projectId ?? null,
      packet: resolved.packet,
      liveInstances: repos.agents.countLiveInstances(request.agentId),
      approvalToken: request.approvalToken ?? null,
      actionFingerprint: fingerprint,
      verifyToken: (token, fp, agentId) => approvals.verifyToken(token, fp, agentId),
      checkBudgets: () =>
        budgets.check(
          {
            project_id: request.projectId ?? null,
            agent_id: request.agentId,
            task_id: request.taskId ?? null,
          },
          { tool_calls: 1 },
        ),
    });
  }

  const gateway = {
    listTools(): ToolDefinition[] {
      return repos.governance.listTools();
    },

    getTool(toolName: string): ToolDefinition | undefined {
      return repos.governance.getTool(toolName);
    },

    /**
     * Authorization without execution or side effects. Used by the activation
     * test run and by the UI, so both see the same verdict the real call
     * would get.
     */
    dryRun(input: { agentId: string; toolName: string; projectId: string | null; args?: Record<string, unknown> }) {
      let resolved: ReturnType<typeof resolve>;
      try {
        resolved = resolve({ agentId: input.agentId, toolName: input.toolName, args: input.args });
      } catch (err) {
        const e = err as RuntimeError;
        return { allowed: false, code: e.code ?? 'INTERNAL', reason: e.message, requiresApproval: false, checks: [] };
      }
      const args = input.args ?? {};
      const fingerprint = actionFingerprint({
        action: `tool.${input.toolName}`,
        tool_name: input.toolName,
        args,
        actor_agent_id: input.agentId,
        project_id: input.projectId,
      });
      const decision = decide(
        { agentId: input.agentId, toolName: input.toolName, args, projectId: input.projectId },
        resolved,
        fingerprint,
      );
      return {
        allowed: decision.allowed,
        code: decision.code,
        reason: decision.reason,
        requiresApproval: decision.requiresApproval,
        checks: decision.checks,
      };
    },

    /** The fingerprint an approval must be requested against for this call. */
    fingerprintFor(input: {
      agentId: string;
      toolName: string;
      args: Record<string, unknown>;
      projectId: string | null;
    }): string {
      return actionFingerprint({
        action: `tool.${input.toolName}`,
        tool_name: input.toolName,
        args: input.args,
        actor_agent_id: input.agentId,
        project_id: input.projectId,
      });
    },

    async call(request: ToolCallRequest): Promise<ToolCallResult> {
      const traceId = request.traceId ?? newTraceId();
      const args = request.args ?? {};
      const callId = newId('call');
      const startedAt = nowIso();
      const startedMs = Date.now();

      const resolved = resolve(request);
      const fingerprint = gateway.fingerprintFor({
        agentId: request.agentId,
        toolName: request.toolName,
        args,
        projectId: request.projectId ?? null,
      });

      const openCall = (decision: 'allow' | 'deny', denialCode: string | null, denialReason: string | null, tokenId: string | null): ToolCallRecord =>
        repos.governance.openCall({
          call_id: callId,
          trace_id: traceId,
          tool_name: request.toolName,
          agent_id: request.agentId,
          instance_id: request.instanceId ?? null,
          task_id: request.taskId ?? null,
          packet_id: request.packetId ?? null,
          project_id: request.projectId ?? null,
          args,
          args_fingerprint: argsFingerprint(args),
          phase: 'requested',
          decision,
          denial_code: denialCode,
          denial_reason: denialReason,
          approval_token_id: tokenId,
          started_at: startedAt,
        });

      const denyAndThrow = (code: RuntimeError['code'], reason: string, details: Record<string, unknown>): never => {
        openCall('deny', code, reason, null);
        repos.governance.settleCall(callId, {
          phase: 'denied',
          status: 'error',
          duration_ms: Date.now() - startedMs,
          error: { code, reason },
        });
        audit.append({
          kind: 'tool.denied',
          actor_type: 'agent',
          actor_id: request.agentId,
          trace_id: traceId,
          project_id: request.projectId ?? null,
          subject_type: 'tool_call',
          subject_id: callId,
          severity: 'security',
          payload: { tool_name: request.toolName, code, reason, ...details },
        });
        throw new RuntimeError(code, reason, { call_id: callId, ...details }, traceId);
      };

      // Arguments are validated against the schema the tool catalogue declares,
      // before any policy decision, so a malformed call never reaches a handler.
      if (resolved.tool) {
        const violations = validateAgainstSchema(args, resolved.tool.input_schema as Record<string, unknown>);
        if (violations.length > 0) {
          return denyAndThrow('VALIDATION_FAILED', `arguments do not match the schema for ${request.toolName}`, {
            violations,
          });
        }
      }

      const decision = decide(request, resolved, fingerprint);

      if (!decision.allowed) {
        return denyAndThrow(decision.code ?? 'DENIED_DEFAULT', decision.reason, {
          checks: decision.checks.filter((c) => !c.passed),
          requires_approval: decision.requiresApproval,
        });
      }

      // Single-use enforcement happens at execution time, not at verification
      // time: two concurrent calls holding the same token race here, and only
      // one of them wins.
      if (decision.approvalTokenId) {
        const consumed = approvals.consumeToken(decision.approvalTokenId, callId);
        if (!consumed) {
          return denyAndThrow('APPROVAL_TOKEN_CONSUMED', 'execution token was already used', {
            token_id: decision.approvalTokenId,
          });
        }
      }

      const tool = resolved.tool!;
      openCall('allow', null, null, decision.approvalTokenId);
      audit.append({
        kind: 'tool.call_started',
        actor_type: 'agent',
        actor_id: request.agentId,
        trace_id: traceId,
        project_id: request.projectId ?? null,
        subject_type: 'tool_call',
        subject_id: callId,
        severity: tool.risk_class === 'critical' || tool.risk_class === 'high' ? 'security' : 'info',
        payload: {
          tool_name: request.toolName,
          risk_class: tool.risk_class,
          args: tool.audit_policy === 'full' ? args : undefined,
          args_fingerprint: argsFingerprint(args),
          approval_token_id: decision.approvalTokenId,
        },
      });

      const handler = deps.handlers.get(tool.handler_key);
      if (!handler) {
        repos.governance.settleCall(callId, {
          phase: 'executed',
          status: 'error',
          duration_ms: Date.now() - startedMs,
          error: { code: 'INTERNAL', reason: `no handler registered for ${tool.handler_key}` },
        });
        throw new RuntimeError('INTERNAL', `tool ${request.toolName} has no handler`, { handler_key: tool.handler_key }, traceId);
      }

      const ctx: ToolHandlerContext = {
        agentId: request.agentId,
        contract: resolved.contract,
        instanceId: request.instanceId ?? null,
        projectId: request.projectId ?? null,
        taskId: request.taskId ?? null,
        packetId: request.packetId ?? null,
        traceId,
        callId,
      };

      try {
        const output = await withTimeout(
          Promise.resolve(handler(args, ctx)),
          tool.timeout_ms,
          request.toolName,
        );
        const durationMs = Date.now() - startedMs;

        const outputViolations = validateAgainstSchema(output, tool.output_schema as Record<string, unknown>);
        if (outputViolations.length > 0) {
          repos.governance.settleCall(callId, {
            phase: 'executed',
            status: 'error',
            duration_ms: durationMs,
            error: { code: 'VALIDATION_FAILED', violations: outputViolations },
          });
          audit.append({
            kind: 'tool.output_invalid',
            actor_type: 'agent',
            actor_id: request.agentId,
            trace_id: traceId,
            project_id: request.projectId ?? null,
            subject_type: 'tool_call',
            subject_id: callId,
            severity: 'error',
            payload: { tool_name: request.toolName, violations: outputViolations },
          });
          throw new RuntimeError(
            'VALIDATION_FAILED',
            `tool ${request.toolName} returned output that does not match its declared schema`,
            { violations: outputViolations, call_id: callId },
            traceId,
          );
        }

        repos.governance.settleCall(callId, {
          phase: 'executed',
          status: 'ok',
          duration_ms: durationMs,
          result_summary: tool.audit_policy === 'none' ? null : summarize(output),
        });

        const usage = budgets.record(
          {
            project_id: request.projectId ?? null,
            agent_id: request.agentId,
            task_id: request.taskId ?? null,
            packet_id: request.packetId ?? null,
            call_id: callId,
            trace_id: traceId,
          },
          'tool_call',
          { tool_calls: 1, elapsed_ms: durationMs },
        );

        audit.append({
          kind: 'tool.call_succeeded',
          actor_type: 'agent',
          actor_id: request.agentId,
          trace_id: traceId,
          project_id: request.projectId ?? null,
          subject_type: 'tool_call',
          subject_id: callId,
          payload: { tool_name: request.toolName, duration_ms: durationMs },
        });

        if (request.instanceId) repos.agents.touchInstance(request.instanceId);

        return {
          call_id: callId,
          trace_id: traceId,
          tool_name: request.toolName,
          output,
          duration_ms: durationMs,
          warnings: usage.warnings,
        };
      } catch (err) {
        const durationMs = Date.now() - startedMs;
        const runtimeErr =
          err instanceof RuntimeError
            ? err
            : new RuntimeError('INTERNAL', (err as Error).message ?? 'tool execution failed', {}, traceId);

        // A settle may already have happened on the schema-violation path.
        const existing = repos.governance.getCall(callId);
        if (existing?.phase === 'requested') {
          repos.governance.settleCall(callId, {
            phase: 'executed',
            status: runtimeErr.code === 'TOOL_TIMEOUT' ? 'timeout' : 'error',
            duration_ms: durationMs,
            error: { code: runtimeErr.code, message: runtimeErr.message },
          });
          audit.append({
            kind: 'tool.call_failed',
            actor_type: 'agent',
            actor_id: request.agentId,
            trace_id: traceId,
            project_id: request.projectId ?? null,
            subject_type: 'tool_call',
            subject_id: callId,
            severity: 'error',
            payload: { tool_name: request.toolName, code: runtimeErr.code, message: runtimeErr.message },
          });
        }
        throw runtimeErr;
      }
    },

    listCalls(filter: { trace_id?: string; agent_id?: string; task_id?: string; decision?: string; limit?: number } = {}) {
      return repos.governance.listCalls(filter);
    },

    setToolStatus(toolName: string, status: 'active' | 'disabled', actor: string): void {
      if (!repos.governance.getTool(toolName)) {
        throw new RuntimeError('NOT_FOUND', `tool ${toolName} is not registered`);
      }
      repos.governance.setToolStatus(toolName, status);
      audit.append({
        kind: 'tool.status_changed',
        actor_type: 'owner',
        actor_id: actor,
        subject_type: 'tool',
        subject_id: toolName,
        severity: 'security',
        payload: { status },
      });
    },

    /** Exposed for the registry's activation tests. */
    registry,
  };

  return gateway;
}

export type ToolGateway = ReturnType<typeof createToolGateway>;
