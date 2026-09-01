import type { Runtime } from '../../runtime.js';
import { appliedMigrations } from '../../db/migrate.js';
import { CreateProjectInput, CreateWorkflowLoopInput, RuntimeError } from '../../domain/index.js';
import { Router, requireString, optionalString } from '../http.js';

/** Health, registry, projects and workflow loops. */
export function registerRegistryRoutes(router: Router, runtime: Runtime): void {
  router.get('/api/health', () => ({
    status: 'ok',
    version: '0.4.0',
    build: 'pre-production',
    provider: { name: runtime.provider.name, model: runtime.provider.model },
    database: { path: runtime.db.path, migrations: appliedMigrations(runtime.db) },
    scheduler: { worker_id: runtime.scheduler.workerId, handlers: runtime.scheduler.registeredKinds() },
    counts: {
      projects: runtime.repos.projects.list().length,
      agents: runtime.repos.agents.listAgents().length,
      active_agents: runtime.repos.agents.listAgents({ status: 'active' }).length,
      live_instances: runtime.repos.agents.listInstances({}).filter((i) => i.status !== 'ended').length,
      pending_approvals: runtime.repos.governance.listApprovals({ status: 'pending' }).length,
    },
  }));

  // ---- registry ----------------------------------------------------------

  router.get('/api/registry/agents', ({ query }) => ({
    agents: runtime.registry.listAgents({
      status: query.get('status') ?? undefined,
      role_level: query.get('role_level') ?? undefined,
      parent_agent_id: query.get('parent_agent_id') ?? undefined,
    }),
  }));

  router.get('/api/registry/agents/:id', ({ params }) => runtime.registry.describeAgent(params.id!));

  router.get('/api/registry/agents/:id/versions', ({ params }) => ({
    versions: runtime.repos.agents.listContractVersions(params.id!),
  }));

  router.get('/api/registry/agents/:id/instances', ({ params }) => ({
    instances: runtime.repos.agents.listInstances({ agent_id: params.id! }),
  }));

  /** The delegation graph, as the Organization view renders it. */
  router.get('/api/registry/graph', () => {
    const agents = runtime.repos.agents.listAgents();
    // Scope is only legible if it names projects the way a person does.
    const projectKeys = new Map(runtime.repos.projects.list().map((p) => [p.project_id, p.key]));
    return {
      nodes: agents.map((a) => {
        const contract =
          a.current_version > 0
            ? runtime.repos.agents.getContractVersion(a.agent_id, a.current_version)?.contract
            : undefined;
        return {
          agent_id: a.agent_id,
          display_name: a.display_name,
          role_level: a.role_level,
          status: a.status,
          parent_agent_id: a.parent_agent_id,
          template_id: a.template_id,
          is_instance_of_template: a.template_id !== null,
          project_scope: contract?.project_scope ?? null,
          project_keys: (contract?.project_scope.project_ids ?? []).map(
            (id) => projectKeys.get(id) ?? id,
          ),
          allowed_tools: contract?.allowed_tools ?? [],
          access_level: contract?.access_level ?? null,
          concurrency_limit: contract?.concurrency_limit ?? null,
          live_instances: runtime.repos.agents.countLiveInstances(a.agent_id),
        };
      }),
      edges: agents
        .filter((a) => a.parent_agent_id)
        .map((a) => ({ from: a.parent_agent_id!, to: a.agent_id })),
    };
  });

  router.get('/api/registry/templates', () => ({ templates: runtime.repos.agents.listTemplates() }));

  router.get('/api/registry/duplicates', () => ({
    duplicates: runtime.registry.findDuplicateCapabilities(),
  }));

  // ---- agent builder -----------------------------------------------------

  router.post('/api/registry/agents', ({ body, actor }) => {
    const contract = (body.contract ?? {}) as Record<string, unknown>;
    const agent = runtime.registry.createDraft(
      {
        display_name: requireString(body, 'display_name'),
        role_level: requireString(body, 'role_level') as never,
        mission: requireString(body, 'mission'),
        parent_agent_id: optionalString(body, 'parent_agent_id'),
        contract,
      },
      { type: actor.type === 'agent' ? 'agent' : 'owner', id: actor.id },
    );
    return { agent, next: 'POST /api/registry/agents/:id/validate' };
  });

  router.patch('/api/registry/agents/:id/contract', ({ params, body, actor }) => {
    const patch = (body.patch ?? body) as Record<string, unknown>;
    return runtime.registry.reviseContract(params.id!, patch, {
      type: actor.type === 'agent' ? 'agent' : 'owner',
      id: actor.id,
    });
  });

  router.post('/api/registry/agents/:id/validate', ({ params }) => runtime.registry.validate(params.id!));

  router.post('/api/registry/agents/:id/test', ({ params }) => runtime.registry.runTests(params.id!));

  router.post('/api/registry/agents/:id/activate', ({ params, actor }) => ({
    agent: runtime.registry.activate(params.id!, actor.id),
  }));

  router.post('/api/registry/agents/:id/pause', ({ params, body, actor }) => ({
    agent: runtime.registry.pause(params.id!, actor.id, optionalString(body, 'reason') ?? 'paused by Owner'),
  }));

  router.post('/api/registry/agents/:id/retire', ({ params, body, actor }) => ({
    agent: runtime.registry.retire(params.id!, actor.id, optionalString(body, 'reason') ?? 'retired by Owner'),
  }));

  router.post('/api/registry/agents/:id/merge', ({ params, body, actor }) => ({
    agent: runtime.registry.merge(
      params.id!,
      requireString(body, 'into_agent_id'),
      actor.id,
      optionalString(body, 'reason') ?? 'duplicate capability',
    ),
  }));

  router.post('/api/registry/agents/:id/instantiate', ({ params, body }) =>
    runtime.delegation.instantiateSpecialist(params.id!, {
      template_key: requireString(body, 'template_key'),
      project_id: requireString(body, 'project_id'),
      display_name: optionalString(body, 'display_name') ?? undefined,
      overrides: (body.overrides as Record<string, unknown>) ?? {},
    }),
  );

  // ---- projects and loops ------------------------------------------------

  router.get('/api/projects', () => ({
    projects: runtime.repos.projects.list().map((p) => ({
      ...p,
      budget: runtime.repos.budgets.find('project', p.project_id) ?? null,
      loops: runtime.repos.projects.listLoops(p.project_id).length,
      open_tasks: runtime.repos.tasks
        .listTasks({ project_id: p.project_id, limit: 500 })
        .filter((t) => !['completed', 'cancelled', 'failed'].includes(t.status)).length,
    })),
  }));

  router.post('/api/projects', ({ body }) => {
    const parsed = CreateProjectInput.safeParse(body);
    if (!parsed.success) {
      throw new RuntimeError('VALIDATION_FAILED', 'invalid project input', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (runtime.repos.projects.getByKey(parsed.data.key)) {
      throw new RuntimeError('CONFLICT', `a project with key "${parsed.data.key}" already exists`);
    }
    const project = runtime.repos.projects.insert(parsed.data);
    runtime.audit.append({
      kind: 'project.created',
      actor_type: 'owner',
      project_id: project.project_id,
      subject_type: 'project',
      subject_id: project.project_id,
      payload: { key: project.key },
    });
    return { project };
  });

  router.get('/api/projects/:id', ({ params }) => {
    const project = runtime.repos.projects.get(params.id!);
    if (!project) throw new RuntimeError('NOT_FOUND', `project ${params.id} not found`);
    return {
      project,
      loops: runtime.repos.projects.listLoops(project.project_id),
      budget: runtime.repos.budgets.find('project', project.project_id) ?? null,
      usage: runtime.budgets.totals({ project_id: project.project_id }),
      tasks: runtime.repos.tasks.listTasks({ project_id: project.project_id, limit: 50 }),
      agents: runtime.repos.agents
        .listAgents()
        .filter((a) => {
          if (a.current_version === 0) return false;
          const c = runtime.repos.agents.getContractVersion(a.agent_id, a.current_version)?.contract;
          return c?.project_scope.all_projects || c?.project_scope.project_ids.includes(project.project_id);
        }),
    };
  });

  router.get('/api/loops', ({ query }) => ({
    loops: runtime.repos.projects.listLoops(query.get('project_id') ?? undefined),
  }));

  router.post('/api/loops', ({ body }) => {
    const parsed = CreateWorkflowLoopInput.safeParse(body);
    if (!parsed.success) {
      throw new RuntimeError('VALIDATION_FAILED', 'invalid workflow loop input', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (!runtime.repos.projects.get(parsed.data.project_id)) {
      throw new RuntimeError('NOT_FOUND', `project ${parsed.data.project_id} not found`);
    }
    const loop = runtime.repos.projects.insertLoop(parsed.data);
    runtime.audit.append({
      kind: 'loop.created',
      actor_type: 'owner',
      project_id: loop.project_id,
      subject_type: 'workflow_loop',
      subject_id: loop.loop_id,
      payload: { key: loop.key, trigger_kind: loop.trigger_kind },
    });
    return { loop };
  });

  router.post('/api/loops/:id/status', ({ params, body }) => {
    const status = requireString(body, 'status') as 'active' | 'paused' | 'retired';
    runtime.repos.projects.setLoopStatus(params.id!, status);
    return { loop: runtime.repos.projects.getLoop(params.id!) };
  });
}
