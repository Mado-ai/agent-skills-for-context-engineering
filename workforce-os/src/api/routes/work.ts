import type { Runtime } from '../../runtime.js';
import { RuntimeError } from '../../domain/index.js';
import { Router, optionalString, requireString } from '../http.js';

/** Tasks, work packets, execution, quality and CAPA. */
export function registerWorkRoutes(router: Router, runtime: Runtime): void {
  // ---- tasks -------------------------------------------------------------

  router.get('/api/tasks', ({ query }) => ({
    tasks: runtime.execution.listTasks({
      project_id: query.get('project_id') ?? undefined,
      status: query.get('status') ?? undefined,
      assigned_agent_id: query.get('agent_id') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  router.post('/api/tasks', ({ body, actor }) => ({
    task: runtime.execution.createTask(body, { type: actor.type, id: actor.id }),
  }));

  router.get('/api/tasks/:id', ({ params }) => {
    const task = runtime.execution.getTask(params.id!);
    return {
      task,
      packets: runtime.delegation.listPackets({ task_id: task.task_id }),
      artifacts: runtime.execution.listArtifacts(task.task_id),
      evaluations: runtime.quality.listEvaluations({ task_id: task.task_id }),
      capa: runtime.quality.listCapa({ task_id: task.task_id }),
      budget: runtime.repos.budgets.find('task', task.task_id) ?? null,
      tool_calls: runtime.gateway.listCalls({ task_id: task.task_id, limit: 100 }),
    };
  });

  router.get('/api/tasks/:id/artifacts', ({ params }) => ({
    artifacts: runtime.execution.listArtifacts(params.id!),
  }));

  router.post('/api/tasks/:id/status', ({ params, body }) => ({
    task: runtime.execution.setStatus(params.id!, requireString(body, 'status') as never),
  }));

  router.post('/api/tasks/:id/escalate', ({ params, body }) => ({
    task: runtime.execution.escalateToOwner(
      params.id!,
      optionalString(body, 'reason') ?? 'escalated by Owner',
      optionalString(body, 'agent_id'),
    ),
  }));

  // ---- delegation --------------------------------------------------------

  router.get('/api/packets', ({ query }) => ({
    packets: runtime.delegation.listPackets({
      task_id: query.get('task_id') ?? undefined,
      trace_id: query.get('trace_id') ?? undefined,
      receiver_agent_id: query.get('agent_id') ?? undefined,
      status: query.get('status') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  router.post('/api/packets', ({ body }) => ({
    packet: runtime.delegation.delegate(requireString(body, 'sender_agent_id'), body),
  }));

  router.get('/api/packets/:id', ({ params }) => {
    const packet = runtime.delegation.getPacket(params.id!);
    return {
      packet,
      artifacts: runtime.repos.tasks.listArtifacts(packet.task_id).filter((a) => a.packet_id === packet.packet_id),
      children: runtime.delegation.listPackets({ task_id: packet.task_id }).filter((p) => p.parent_packet_id === packet.packet_id),
    };
  });

  router.post('/api/packets/:id/execute', async ({ params }) => runtime.execution.executePacket(params.id!));

  router.post('/api/packets/:id/rework', ({ params, body }) => ({
    packet: runtime.delegation.requestRework(
      params.id!,
      requireString(body, 'reviewer_agent_id'),
      optionalString(body, 'reason') ?? 'rework requested',
    ),
  }));

  router.post('/api/packets/:id/escalate', ({ params, body }) => ({
    packet: runtime.delegation.escalate(
      params.id!,
      requireString(body, 'agent_id'),
      optionalString(body, 'reason') ?? 'escalated',
    ),
  }));

  /**
   * Execute -> evaluate -> rework, to a terminal state. The single call the
   * Task Queue view uses to run a packet through the quality loop.
   */
  router.post('/api/packets/:id/run', async ({ params, body }) =>
    runtime.execution.runToCompletion({
      packet_id: params.id!,
      evaluator_agent_id: requireString(body, 'evaluator_agent_id'),
      max_cycles: typeof body.max_cycles === 'number' ? body.max_cycles : undefined,
    }),
  );

  // ---- trace -------------------------------------------------------------

  router.get('/api/traces/:traceId', ({ params }) => {
    const view = runtime.delegation.traceView(params.traceId!);
    const tasks = runtime.repos.tasks
      .listTasks({ limit: 500 })
      .filter((t) => t.trace_id === params.traceId);
    return { ...view, tasks };
  });

  // ---- quality -----------------------------------------------------------

  router.get('/api/quality/gates', () => ({ gates: runtime.quality.listGates() }));

  router.get('/api/quality/evaluations', ({ query }) => ({
    evaluations: runtime.quality.listEvaluations({
      task_id: query.get('task_id') ?? undefined,
      project_id: query.get('project_id') ?? undefined,
      passed: query.get('passed') === null ? undefined : query.get('passed') === 'true',
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  router.post('/api/quality/evaluate', async ({ body }) => ({
    evaluation: await runtime.quality.evaluate({
      task_id: requireString(body, 'task_id'),
      artifact_id: requireString(body, 'artifact_id'),
      gate_key: requireString(body, 'gate_key'),
      evaluator_agent_id: optionalString(body, 'evaluator_agent_id'),
    }),
  }));

  router.post('/api/quality/review', async ({ body }) =>
    runtime.quality.reviewDelivery({
      task_id: requireString(body, 'task_id'),
      artifact_id: requireString(body, 'artifact_id'),
      evaluator_agent_id: optionalString(body, 'evaluator_agent_id'),
      gate_keys: Array.isArray(body.gate_keys) ? (body.gate_keys as string[]) : undefined,
    }),
  );

  // ---- CAPA --------------------------------------------------------------

  router.get('/api/capa', ({ query }) => ({
    capa: runtime.quality.listCapa({
      project_id: query.get('project_id') ?? undefined,
      state: query.get('state') ?? undefined,
      task_id: query.get('task_id') ?? undefined,
      limit: Number(query.get('limit') ?? 100),
    }),
  }));

  router.post('/api/capa', ({ body }) => ({
    capa: runtime.quality.openCapa({
      project_id: requireString(body, 'project_id'),
      task_id: optionalString(body, 'task_id'),
      agent_id: optionalString(body, 'agent_id'),
      issue: requireString(body, 'issue'),
      root_cause_hypothesis: optionalString(body, 'root_cause_hypothesis') ?? '',
      corrective_action: optionalString(body, 'corrective_action') ?? '',
      preventive_action: optionalString(body, 'preventive_action') ?? '',
      owner_human: optionalString(body, 'owner_human'),
      evidence: (body.evidence as Record<string, unknown>) ?? {},
    }),
  }));

  router.get('/api/capa/:id', ({ params }) => ({ capa: runtime.quality.getCapa(params.id!) }));

  router.patch('/api/capa/:id', ({ params, body, actor }) => ({
    capa: runtime.quality.updateCapa(params.id!, body as never, actor.id),
  }));

  // ---- memory ------------------------------------------------------------

  router.get('/api/memory', ({ query }) => {
    // The Owner-facing view is unscoped by design; an agent-scoped read must
    // name the agent so the scope rules apply.
    const agentId = query.get('agent_id');
    if (agentId) {
      return {
        scoped_to: agentId,
        records: runtime.memory.read(agentId, {
          key: query.get('key') ?? undefined,
          layer: (query.get('layer') as never) ?? undefined,
          project_id: query.get('project_id') ?? undefined,
          limit: Number(query.get('limit') ?? 50),
        }),
      };
    }
    return { scoped_to: 'owner', records: runtime.memory.listAll(Number(query.get('limit') ?? 100)) };
  });

  router.post('/api/memory', ({ body }) => {
    const agentId = optionalString(body, 'agent_id');
    if (!agentId) {
      throw new RuntimeError(
        'VALIDATION_FAILED',
        '"agent_id" is required: memory writes are always attributed and scope-checked',
      );
    }
    return { record: runtime.memory.write(agentId, body) };
  });

  router.get('/api/memory/:id', ({ params }) => {
    const record = runtime.memory.get(params.id!);
    if (!record) throw new RuntimeError('NOT_FOUND', `memory record ${params.id} not found`);
    return { record };
  });
}
