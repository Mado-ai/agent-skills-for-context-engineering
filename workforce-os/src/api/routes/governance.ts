import type { Runtime } from '../../runtime.js';
import { OWNER_GATED_ACTION_CLASSES, RuntimeError } from '../../domain/index.js';
import { EXPLICIT_GRANT_SCOPES, OWNER_ONLY_SCOPES } from '../../policy/scopes.js';
import { Router, optionalString, requireString } from '../http.js';

/** Tool Gateway, approvals, budgets, telemetry, scheduler, policy and the Chief. */
export function registerGovernanceRoutes(router: Router, runtime: Runtime): void {
  // ---- tool gateway ------------------------------------------------------

  router.get('/api/tools', () => ({
    tools: runtime.gateway.listTools().map((t) => ({
      ...t,
      // The UI needs to distinguish "you may not" from "the Owner must decide".
      owner_gated: t.requires_owner_approval || t.required_scopes.some((s) => OWNER_ONLY_SCOPES.has(s)),
    })),
  }));

  router.get('/api/tools/:name', ({ params }) => {
    const tool = runtime.gateway.getTool(params.name!);
    if (!tool) throw new RuntimeError('NOT_FOUND', `tool ${params.name} is not registered`);
    return { tool };
  });

  router.post('/api/tools/:name/status', ({ params, body, actor }) => {
    runtime.gateway.setToolStatus(params.name!, requireString(body, 'status') as never, actor.id);
    return { tool: runtime.gateway.getTool(params.name!) };
  });

  /** Authorization preview. No side effects, same verdict as the real call. */
  router.post('/api/tools/dry-run', ({ body }) =>
    runtime.gateway.dryRun({
      agentId: requireString(body, 'agent_id'),
      toolName: requireString(body, 'tool_name'),
      projectId: optionalString(body, 'project_id'),
      args: (body.args as Record<string, unknown>) ?? {},
    }),
  );

  router.post('/api/tools/call', async ({ body }) =>
    runtime.gateway.call({
      agentId: requireString(body, 'agent_id'),
      toolName: requireString(body, 'tool_name'),
      args: (body.args as Record<string, unknown>) ?? {},
      projectId: optionalString(body, 'project_id'),
      taskId: optionalString(body, 'task_id'),
      packetId: optionalString(body, 'packet_id'),
      approvalToken: optionalString(body, 'approval_token'),
    }),
  );

  router.get('/api/tool-calls', ({ query }) => ({
    calls: runtime.gateway.listCalls({
      trace_id: query.get('trace_id') ?? undefined,
      agent_id: query.get('agent_id') ?? undefined,
      task_id: query.get('task_id') ?? undefined,
      decision: query.get('decision') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  // ---- approvals ---------------------------------------------------------

  router.get('/api/approvals', ({ query }) => ({
    approvals: runtime.approvals.list({
      status: query.get('status') ?? undefined,
      project_id: query.get('project_id') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  router.post('/api/approvals', ({ body }) => ({ approval: runtime.approvals.request(body) }));

  router.get('/api/approvals/:id', ({ params }) => ({
    approval: runtime.approvals.get(params.id!),
    // Only token metadata is ever returned; the token itself is shown once, at
    // the moment of approval, and is never retrievable afterwards.
    tokens: runtime.approvals.listTokens(params.id!),
  }));

  router.post('/api/approvals/:id/decide', ({ params, body, actor }) => {
    const result = runtime.approvals.decide({
      approval_id: params.id!,
      decision: requireString(body, 'decision'),
      decided_by: optionalString(body, 'decided_by') ?? actor.id,
      decision_note: optionalString(body, 'decision_note') ?? '',
      token_ttl_seconds: typeof body.token_ttl_seconds === 'number' ? body.token_ttl_seconds : undefined,
    });
    return {
      approval: result.approval,
      execution_token: result.token,
      token_id: result.token_id,
      expires_at: result.expires_at,
      note: result.token
        ? 'This token is shown once, authorises exactly one execution of this exact action, and is not retrievable again.'
        : undefined,
    };
  });

  router.post('/api/approvals/:id/revoke', ({ params, body, actor }) => ({
    approval: runtime.approvals.revoke(params.id!, actor.id, optionalString(body, 'reason') ?? 'revoked by Owner'),
  }));

  // ---- budgets and usage -------------------------------------------------

  router.get('/api/budgets', ({ query }) => ({
    budgets: runtime.budgets.list({
      scope_type: query.get('scope_type') ?? undefined,
      scope_id: query.get('scope_id') ?? undefined,
    }),
  }));

  router.post('/api/budgets', ({ body }) => ({
    budget: runtime.budgets.define(
      requireString(body, 'scope_type') as never,
      requireString(body, 'scope_id'),
      (body.limits as Record<string, unknown>) ?? {},
    ),
  }));

  router.post('/api/budgets/pause', ({ body }) => {
    runtime.budgets.pause(
      requireString(body, 'scope_type'),
      requireString(body, 'scope_id'),
      optionalString(body, 'reason') ?? 'paused by Owner',
    );
    return { ok: true };
  });

  router.post('/api/budgets/resume', ({ body }) => {
    runtime.budgets.resume(requireString(body, 'scope_type'), requireString(body, 'scope_id'));
    return { ok: true };
  });

  router.get('/api/usage', ({ query }) => ({
    totals: runtime.budgets.totals({
      project_id: query.get('project_id') ?? undefined,
      agent_id: query.get('agent_id') ?? undefined,
    }),
    records: runtime.budgets.usage({
      project_id: query.get('project_id') ?? undefined,
      agent_id: query.get('agent_id') ?? undefined,
      task_id: query.get('task_id') ?? undefined,
      trace_id: query.get('trace_id') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  // ---- telemetry ---------------------------------------------------------

  router.get('/api/telemetry/events', ({ query }) => ({
    events: runtime.audit.list({
      trace_id: query.get('trace_id') ?? undefined,
      kind: query.get('kind') ?? undefined,
      project_id: query.get('project_id') ?? undefined,
      severity: query.get('severity') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  router.get('/api/telemetry/summary', () => {
    const events = runtime.audit.list({ limit: 1000 });
    const byKind: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const e of events) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    }
    const calls = runtime.gateway.listCalls({ limit: 1000 });
    const durations = calls.map((c) => c.duration_ms ?? 0).filter((d) => d > 0).sort((a, b) => a - b);
    return {
      events: { total: events.length, by_kind: byKind, by_severity: bySeverity },
      tool_calls: {
        total: calls.length,
        denied: calls.filter((c) => c.decision === 'deny').length,
        errors: calls.filter((c) => c.status === 'error' || c.status === 'timeout').length,
        latency_ms: {
          p50: durations[Math.floor(durations.length * 0.5)] ?? 0,
          p95: durations[Math.floor(durations.length * 0.95)] ?? 0,
          max: durations[durations.length - 1] ?? 0,
        },
      },
      usage: runtime.budgets.totals(),
    };
  });

  // ---- scheduler ---------------------------------------------------------

  router.get('/api/scheduler/jobs', ({ query }) => ({
    jobs: runtime.scheduler.list({
      status: query.get('status') ?? undefined,
      kind: query.get('kind') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
    handlers: runtime.scheduler.registeredKinds(),
  }));

  router.post('/api/scheduler/tick', async () => runtime.scheduler.tick());

  router.post('/api/scheduler/emit', async ({ body }) => ({
    ran: await runtime.scheduler.emit(
      requireString(body, 'event_key'),
      (body.payload as Record<string, unknown>) ?? {},
    ),
  }));

  router.post('/api/scheduler/jobs/:id/cancel', ({ params }) => {
    runtime.scheduler.cancel(params.id!);
    return { job: runtime.repos.jobs.get(params.id!) };
  });

  // ---- policy visibility -------------------------------------------------

  router.get('/api/policy', () => ({
    owner_gated_action_classes: OWNER_GATED_ACTION_CLASSES,
    owner_only_scopes: [...OWNER_ONLY_SCOPES],
    explicit_grant_scopes: [...EXPLICIT_GRANT_SCOPES],
    defaults: {
      authorization: 'deny by default; every check must pass',
      cross_project_access: 'denied unless the contract names the project',
      delegation: 'a packet can never carry authority the sender does not hold',
      approval_tokens: 'single-use, short-lived, bound to action + arguments + actor + project',
      authoritative_memory: 'requires an explicit contract grant plus human-sourced or Owner-approved provenance',
      shell_access: 'no shell, filesystem-write or arbitrary-code tool is registered for runtime agents',
    },
    lifecycle: {
      agent: 'draft -> validated -> testing -> approved -> active -> paused -> merged/retired',
      activation_gate: 'contract validation and required tests must both pass',
    },
    quality_gates: runtime.quality.listGates().map((g) => ({
      key: g.key,
      name: g.name,
      blocking: g.blocking,
      separation_of_duties: g.separation_of_duties,
      checks: g.checks.map((c) => c.kind),
    })),
    secret_handling: {
      storage: 'only references are stored; no table holds a secret value',
      references: runtime.repos.governance.listSecretRefs(),
    },
  }));

  // ---- Chief Agent Architect ---------------------------------------------

  router.get('/api/chief/report', () => runtime.chief.situationReport());

  router.post('/api/chief/assess', ({ body }) => ({
    findings: runtime.chief.assess({
      project_id: optionalString(body, 'project_id'),
      objective: optionalString(body, 'objective') ?? '',
    }),
  }));

  router.post('/api/chief/propose-team', async ({ body }) =>
    runtime.chief.proposeTeam({
      project_id: requireString(body, 'project_id'),
      objective: requireString(body, 'objective'),
    }),
  );

  router.post('/api/chief/instantiate', async ({ body }) => ({
    results: await runtime.chief.instantiateRoles({
      project_id: requireString(body, 'project_id'),
      template_keys: Array.isArray(body.template_keys) ? (body.template_keys as string[]) : [],
      task_id: optionalString(body, 'task_id'),
    }),
  }));

  router.post('/api/chief/delegate', async ({ body }) => ({
    packet: await runtime.chief.delegate({
      task_id: requireString(body, 'task_id'),
      receiver_agent_id: requireString(body, 'receiver_agent_id'),
      objective: requireString(body, 'objective'),
      intent: optionalString(body, 'intent') ?? undefined,
      allowed_tools: Array.isArray(body.allowed_tools) ? (body.allowed_tools as string[]) : undefined,
      acceptance_criteria: Array.isArray(body.acceptance_criteria) ? (body.acceptance_criteria as unknown[]) : undefined,
      quality_gate_ids: Array.isArray(body.quality_gate_ids) ? (body.quality_gate_ids as string[]) : undefined,
      input_payload: (body.input_payload as Record<string, unknown>) ?? {},
    }),
  }));

  router.post('/api/chief/review', async ({ body }) =>
    runtime.chief.review({
      task_id: requireString(body, 'task_id'),
      artifact_id: requireString(body, 'artifact_id'),
      gate_keys: Array.isArray(body.gate_keys) ? (body.gate_keys as string[]) : undefined,
    }),
  );

  router.get('/api/chief/consolidation', () => runtime.chief.recommendConsolidation());
}
