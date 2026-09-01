import { RuntimeError } from '../domain/index.js';
import type { ToolHandler, ToolHandlerContext } from './gateway.js';
import type { Runtime } from '../runtime.js';

/**
 * Built-in tool handlers.
 *
 * Two things are deliberately absent: any shell, filesystem, or eval tool, and
 * any handler that reads a secret value. `secret.grant` records that an agent
 * may use a credential reference; resolving that reference to a value happens
 * outside the agent's reach.
 *
 * The owner-gated handlers at the bottom are governance-complete — request,
 * approval, exact-action token, audit — but their external effects are
 * simulated. Wiring them to real payment rails, signature services and
 * production data is a v0.5 concern and is listed in the production blockers.
 */

export function createHandlers(getRuntime: () => Runtime): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  const rt = () => getRuntime();

  handlers.set('registry.inspect', (args) => {
    const registry = rt().registry;
    const agentId = args.agent_id as string | undefined;
    if (agentId) {
      const described = registry.describeAgent(agentId);
      return { agents: [described.agent], contract: described.contract ?? {}, instances: described.instances };
    }
    return {
      agents: registry.listAgents({
        status: args.status as string | undefined,
        role_level: args.role_level as string | undefined,
      }),
    };
  });

  handlers.set('memory.read', (args, ctx) => {
    const records = rt().memory.read(ctx.agentId, {
      layer: args.layer as never,
      key: args.key as string | undefined,
      project_id: (args.project_id as string | undefined) ?? ctx.projectId,
      limit: (args.limit as number | undefined) ?? 25,
    });
    return { records };
  });

  handlers.set('memory.write', (args, ctx) => {
    const record = rt().memory.write(ctx.agentId, {
      layer: args.layer,
      key: args.key,
      content: args.content,
      scope_project_id: ctx.projectId,
      source: `agent:${ctx.agentId}`,
      confidence: args.confidence ?? null,
      ttl_seconds: args.ttl_seconds ?? null,
      supersedes_id: args.supersedes_id ?? null,
      provenance: { origin: 'agent', origin_id: ctx.agentId, trace_id: ctx.traceId, task_id: ctx.taskId },
    });
    return { memory_id: record.memory_id };
  });

  handlers.set('memory.write_authoritative', (args, ctx) => {
    const record = rt().memory.write(ctx.agentId, {
      layer: 'authoritative',
      key: args.key,
      content: args.content,
      scope_project_id: ctx.projectId,
      source: args.source,
      supersedes_id: args.supersedes_id ?? null,
      provenance: {
        origin: 'human',
        origin_id: String(args.source),
        trace_id: ctx.traceId,
        task_id: ctx.taskId,
        evidence_refs: (args.evidence_refs as string[] | undefined) ?? [],
      },
    });
    return { memory_id: record.memory_id };
  });

  handlers.set('task.create', (args, ctx) => {
    const task = rt().execution.createTask(
      {
        project_id: args.project_id,
        title: args.title,
        description: args.description ?? '',
        priority: args.priority ?? 'normal',
        loop_id: args.loop_id ?? null,
        input: args.input ?? {},
        trace_id: ctx.traceId,
      },
      { type: 'agent', id: ctx.agentId },
    );
    return { task_id: task.task_id };
  });

  handlers.set('packet.delegate', (args, ctx) => {
    const packet = rt().delegation.delegate(ctx.agentId, {
      task_id: args.task_id,
      receiver_agent_id: args.receiver_agent_id,
      intent: args.intent,
      objective: args.objective,
      input_payload: args.input_payload ?? {},
      allowed_tools: args.allowed_tools ?? [],
      acceptance_criteria: args.acceptance_criteria ?? [],
      quality_gate_ids: args.quality_gate_ids ?? [],
      budget: args.budget ?? {},
    });
    return { packet_id: packet.packet_id };
  });

  handlers.set('agent.instantiate', (args, ctx) => {
    const result = rt().delegation.instantiateSpecialist(ctx.agentId, {
      template_key: args.template_key as string,
      project_id: args.project_id as string,
      display_name: args.display_name as string | undefined,
      task_id: ctx.taskId,
      overrides: (args.overrides as Record<string, unknown>) ?? {},
    });
    return { agent_id: result.agent.agent_id, status: result.agent.status };
  });

  handlers.set('quality.evaluate', async (args, ctx) => {
    const evaluation = await rt().quality.evaluate({
      task_id: args.task_id as string,
      artifact_id: args.artifact_id as string,
      gate_key: args.gate_key as string,
      evaluator_agent_id: ctx.agentId,
    });
    return { passed: evaluation.passed, evaluation_id: evaluation.evaluation_id, score: evaluation.score };
  });

  handlers.set('report.compose', (args, ctx) => {
    const runtime = rt();
    const task = runtime.repos.tasks.getTask(args.task_id as string);
    if (!task) throw new RuntimeError('NOT_FOUND', `task ${args.task_id} not found`);
    const artifact = runtime.repos.tasks.insertArtifact({
      task_id: task.task_id,
      packet_id: ctx.packetId,
      agent_id: ctx.agentId,
      project_id: task.project_id,
      trace_id: ctx.traceId,
      kind: 'report',
      content: {
        summary: args.summary,
        sections: args.sections ?? [],
      },
      provenance: {
        origin: 'agent',
        origin_id: ctx.agentId,
        trace_id: ctx.traceId,
        task_id: task.task_id,
        evidence_refs: (args.evidence as string[] | undefined) ?? [],
        note: 'composed by report.compose',
      },
      attempt: task.attempt + 1,
    });
    return { artifact_id: artifact.artifact_id };
  });

  // ---- Owner-gated action classes ----------------------------------------
  //
  // Reaching any of these means an Owner approved this exact action and the
  // gateway consumed a matching single-use token. The governance record is
  // real; the external effect is simulated in v0.4.

  function governedEffect(kind: string, extra: (args: Record<string, unknown>) => Record<string, unknown>) {
    return (args: Record<string, unknown>, ctx: ToolHandlerContext) => {
      rt().audit.append({
        kind: `owner_gated.${kind}`,
        actor_type: 'agent',
        actor_id: ctx.agentId,
        project_id: ctx.projectId,
        trace_id: ctx.traceId,
        subject_type: 'tool_call',
        subject_id: ctx.callId,
        severity: 'security',
        payload: { args, simulated: true },
      });
      return { ...extra(args), simulated: true };
    };
  }

  handlers.set(
    'finance.commit_payment',
    governedEffect('finance_commit_payment', (args) => ({
      committed: true,
      reference: (args.reference as string) ?? `sim-${Date.now()}`,
    })),
  );

  handlers.set('contract.finalize', governedEffect('contract_finalize', () => ({ finalized: true })));

  handlers.set('publish.external', governedEffect('publish_external', () => ({ published: true })));

  handlers.set('data.destructive_action', governedEffect('data_destructive', () => ({ executed: true })));

  /** Records the grant of a credential *reference*. No secret value is returned. */
  handlers.set('secret.grant', (args, ctx) => {
    const runtime = rt();
    const key = args.secret_key as string;
    const ref = runtime.repos.governance.getSecretRef(key);
    if (!ref) throw new RuntimeError('NOT_FOUND', `no secret reference registered under "${key}"`);
    runtime.audit.append({
      kind: 'owner_gated.secret_grant',
      actor_type: 'agent',
      actor_id: ctx.agentId,
      project_id: ctx.projectId,
      trace_id: ctx.traceId,
      subject_type: 'secret_ref',
      subject_id: ref.ref_id,
      severity: 'security',
      payload: { granted_to: args.agent_id, secret_key: key },
    });
    return { granted: true, secret_key: key };
  });

  /**
   * Permission changes. Owner-gated at the tool level, and additionally
   * refused when an agent points it at its own contract — an approval token
   * does not make self-mutation acceptable.
   */
  handlers.set('policy.update', (args, ctx) => {
    const runtime = rt();
    const target = args.target_agent_id as string;
    if (target === ctx.agentId) {
      throw new RuntimeError('DENIED_SELF_MUTATION', 'an agent cannot change its own permissions', {
        agent_id: ctx.agentId,
      });
    }
    const change = (args.change as Record<string, unknown>) ?? {};
    const result = runtime.registry.reviseContract(target, change, { type: 'agent', id: ctx.agentId });
    return { applied: true, version: result.version };
  });

  handlers.set('http.fetch', () => {
    throw new RuntimeError(
      'DENIED_TOOL_DISABLED',
      'outbound HTTP is disabled in v0.4; no egress is enabled in a pre-production build',
    );
  });

  return handlers;
}
