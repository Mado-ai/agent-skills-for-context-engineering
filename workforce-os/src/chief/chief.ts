import type { Runtime } from '../runtime.js';
import { RuntimeError, type AgentRecord } from '../domain/index.js';

/**
 * The Chief Agent Architect.
 *
 * The Chief is the only agent with system-wide visibility, and the only one the
 * Owner talks to directly. Two design choices matter here:
 *
 * 1. Its skepticism is mechanical. The findings below come from registry,
 *    budget, quality and approval state — not from asking a model to be
 *    critical. A model that is having a agreeable day cannot make a duplicate
 *    agent or a blown budget disappear.
 * 2. It has no privileged path. Every action it takes runs through the Tool
 *    Gateway on its own contract, so an Owner-gated action needs an Owner
 *    approval and an execution token exactly as it would for any other agent.
 */

export interface ChiefFinding {
  severity: 'info' | 'caution' | 'blocker';
  kind: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface SituationReport {
  generated_at: string;
  projects: { project_id: string; key: string; name: string; status: string; open_tasks: number; escalated_tasks: number }[];
  agents: { total: number; by_status: Record<string, number>; by_role: Record<string, number> };
  live_instances: number;
  tasks: { total: number; by_status: Record<string, number> };
  quality: { evaluations: number; failures: number; open_capa: number };
  approvals: { pending: number; expired: number };
  budgets: { hard_exceeded: number; soft_exceeded: number };
  recent_denials: { tool_name: string; denial_code: string | null; agent_id: string | null; started_at: string }[];
}

export interface TeamProposal {
  project_id: string;
  objective: string;
  workflow_loops: { key: string; name: string; rationale: string }[];
  roles: {
    template_key: string;
    display_name: string;
    rationale: string;
    allowed_tools: string[];
    quality_gates: string[];
  }[];
  findings: ChiefFinding[];
  requires_owner_decision: string[];
  narrative: string;
}

export function createChief(getRuntime: () => Runtime) {
  function rt(): Runtime {
    return getRuntime();
  }

  function chiefAgent(): AgentRecord {
    const chief = rt().repos.agents.listAgents({ role_level: 'chief' }).find((a) => a.status === 'active');
    if (!chief) {
      throw new RuntimeError('NOT_FOUND', 'no active Chief Agent Architect is registered', {});
    }
    return chief;
  }

  const chief = {
    agent: chiefAgent,

    situationReport(): SituationReport {
      const runtime = rt();
      const projects = runtime.repos.projects.list().map((p) => {
        const tasks = runtime.repos.tasks.listTasks({ project_id: p.project_id, limit: 500 });
        return {
          project_id: p.project_id,
          key: p.key,
          name: p.name,
          status: p.status,
          open_tasks: tasks.filter((t) => !['completed', 'cancelled', 'failed'].includes(t.status)).length,
          escalated_tasks: tasks.filter((t) => t.status === 'escalated').length,
        };
      });

      const agents = runtime.repos.agents.listAgents();
      const byStatus: Record<string, number> = {};
      const byRole: Record<string, number> = {};
      for (const a of agents) {
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
        byRole[a.role_level] = (byRole[a.role_level] ?? 0) + 1;
      }

      const allTasks = runtime.repos.tasks.listTasks({ limit: 1000 });
      const taskByStatus: Record<string, number> = {};
      for (const t of allTasks) taskByStatus[t.status] = (taskByStatus[t.status] ?? 0) + 1;

      const evaluations = runtime.repos.quality.listEvaluations({ limit: 1000 });
      const budgets = runtime.repos.budgets.list();
      const approvals = runtime.repos.governance.listApprovals({ limit: 500 });

      return {
        generated_at: new Date().toISOString(),
        projects,
        agents: { total: agents.length, by_status: byStatus, by_role: byRole },
        live_instances: runtime.repos.agents.listInstances({}).filter((i) => i.status !== 'ended').length,
        tasks: { total: allTasks.length, by_status: taskByStatus },
        quality: {
          evaluations: evaluations.length,
          failures: evaluations.filter((e) => !e.passed).length,
          open_capa: runtime.repos.quality.listCapa({ limit: 500 }).filter((c) => c.state !== 'closed' && c.state !== 'rejected').length,
        },
        approvals: {
          pending: approvals.filter((a) => a.status === 'pending').length,
          expired: approvals.filter((a) => a.status === 'expired').length,
        },
        budgets: {
          hard_exceeded: budgets.filter((b) => b.status === 'hard_exceeded').length,
          soft_exceeded: budgets.filter((b) => b.status === 'soft_exceeded').length,
        },
        recent_denials: runtime.repos.governance
          .listCalls({ decision: 'deny', limit: 10 })
          .map((c) => ({
            tool_name: c.tool_name,
            denial_code: c.denial_code,
            agent_id: c.agent_id,
            started_at: c.started_at,
          })),
      };
    },

    /**
     * The skeptical pass. Everything here is derived from state, so the Chief
     * surfaces the same contradictions whether or not a model is available.
     */
    assess(input: { project_id?: string | null; objective: string }): ChiefFinding[] {
      const runtime = rt();
      const findings: ChiefFinding[] = [];

      if (input.project_id) {
        const project = runtime.repos.projects.get(input.project_id);
        if (!project) {
          findings.push({
            severity: 'blocker',
            kind: 'unknown_project',
            message: `Project ${input.project_id} does not exist. Nothing can be scoped to it.`,
            evidence: { project_id: input.project_id },
          });
          return findings;
        }
        if (project.status !== 'active') {
          findings.push({
            severity: 'blocker',
            kind: 'project_inactive',
            message: `Project ${project.key} is ${project.status}; work should not be scheduled against it.`,
            evidence: { status: project.status },
          });
        }

        const escalated = runtime.repos.tasks.listTasks({ project_id: project.project_id, status: 'escalated', limit: 50 });
        if (escalated.length > 0) {
          findings.push({
            severity: 'caution',
            kind: 'unresolved_escalations',
            message: `${escalated.length} task(s) in ${project.key} are already escalated and unresolved. Adding capacity before resolving them repeats the failure.`,
            evidence: { task_ids: escalated.map((t) => t.task_id) },
          });
        }

        const openCapa = runtime.repos.quality
          .listCapa({ project_id: project.project_id, limit: 50 })
          .filter((c) => c.state !== 'closed' && c.state !== 'rejected');
        if (openCapa.length > 0) {
          findings.push({
            severity: 'caution',
            kind: 'open_capa',
            message: `${openCapa.length} open CAPA record(s) in ${project.key}. The root causes are not yet verified as fixed.`,
            evidence: { capa_ids: openCapa.map((c) => c.capa_id) },
          });
        }

        const budget = runtime.repos.budgets.find('project', project.project_id);
        if (budget && budget.status === 'hard_exceeded') {
          findings.push({
            severity: 'blocker',
            kind: 'budget_exhausted',
            message: `The project budget for ${project.key} is exhausted. New work will be refused until the Owner raises it.`,
            evidence: { consumed: budget.consumed, limits: budget.limits },
          });
        } else if (budget && budget.status === 'soft_exceeded') {
          findings.push({
            severity: 'caution',
            kind: 'budget_pressure',
            message: `The project budget for ${project.key} is past its soft limit.`,
            evidence: { consumed: budget.consumed, limits: budget.limits },
          });
        } else if (!budget) {
          findings.push({
            severity: 'caution',
            kind: 'no_budget',
            message: `Project ${project.key} has no budget defined, so nothing bounds its spend.`,
            evidence: { project_id: project.project_id },
          });
        }
      }

      for (const dup of runtime.registry.findDuplicateCapabilities()) {
        const a = runtime.repos.agents.getAgent(dup.a);
        const b = runtime.repos.agents.getAgent(dup.b);
        findings.push({
          severity: 'caution',
          kind: 'duplicate_capability',
          message: `${a?.display_name ?? dup.a} and ${b?.display_name ?? dup.b} overlap ${Math.round(dup.overlap * 100)}% on tools within the same project. Consider merging before adding more agents.`,
          evidence: dup as unknown as Record<string, unknown>,
        });
      }

      const pending = runtime.repos.governance.listApprovals({ status: 'pending', limit: 50 });
      if (pending.length > 0) {
        findings.push({
          severity: 'caution',
          kind: 'pending_approvals',
          message: `${pending.length} approval request(s) are waiting on the Owner. Work depending on them is blocked, not slow.`,
          evidence: { approval_ids: pending.map((a) => a.approval_id) },
        });
      }

      const denials = runtime.repos.governance.listCalls({ decision: 'deny', limit: 50 });
      const scopeDenials = denials.filter((d) => d.denial_code?.startsWith('DENIED_'));
      if (scopeDenials.length >= 3) {
        findings.push({
          severity: 'caution',
          kind: 'permission_friction',
          message: `${scopeDenials.length} recent tool calls were denied by policy. Either the contracts are wrong or agents are attempting work outside their remit; both need a decision, not a retry.`,
          evidence: {
            codes: [...new Set(scopeDenials.map((d) => d.denial_code))],
          },
        });
      }

      if (input.objective.trim().length < 20) {
        findings.push({
          severity: 'caution',
          kind: 'weak_objective',
          message: 'The objective is too thin to derive acceptance criteria from. Without them, quality gates cannot judge the output.',
          evidence: { objective: input.objective },
        });
      }

      const nonActive = runtime.repos.agents.listAgents().filter((a) => a.status === 'draft' || a.status === 'testing');
      if (nonActive.length > 0) {
        findings.push({
          severity: 'info',
          kind: 'agents_not_activated',
          message: `${nonActive.length} agent(s) are drafted or under test and cannot execute yet.`,
          evidence: { agent_ids: nonActive.map((a) => a.agent_id) },
        });
      }

      return findings;
    },

    /**
     * Propose a team for an objective. Reusable loops first: the proposal is
     * shaped around the workflow the project needs repeatedly, not around a
     * one-off task.
     */
    async proposeTeam(input: { project_id: string; objective: string }): Promise<TeamProposal> {
      const runtime = rt();
      const project = runtime.repos.projects.get(input.project_id);
      if (!project) throw new RuntimeError('NOT_FOUND', `project ${input.project_id} not found`);

      const findings = chief.assess(input);
      const chiefContract = runtime.registry.getContract(chiefAgent().agent_id);
      const templates = runtime.repos.agents
        .listTemplates()
        .filter((t) => t.status === 'active' && chiefContract.allowed_child_templates.includes(t.key));

      const existingLoops = runtime.repos.projects.listLoops(input.project_id);

      const response = await runtime.provider.complete({
        purpose: 'chief.propose_team',
        expect_json: true,
        system: [
          'You are the Chief Agent Architect for an AI workforce.',
          'You are neutral, evidence-first, systems-minded, concise, and skeptical of weak assumptions.',
          'You design reusable workflow loops, not one-off task assignments.',
          'You never propose an agent whose template is not in the available list.',
          'Reply with JSON: {"workflow_loops":[{"key","name","rationale"}],"roles":[{"template_key","display_name","rationale"}],"narrative":string}',
        ].join(' '),
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              project: { key: project.key, name: project.name, description: project.description },
              objective: input.objective,
              existing_loops: existingLoops.map((l) => ({ key: l.key, name: l.name })),
              available_templates: templates.map((t) => ({
                key: t.key,
                name: t.name,
                role_level: t.role_level,
                description: t.description,
              })),
              standing_findings: findings,
            }),
          },
        ],
      });

      runtime.budgets.record(
        { project_id: input.project_id, agent_id: chiefAgent().agent_id },
        'model_call',
        {
          model_calls: response.usage.model_calls,
          tokens_in: response.usage.tokens_in,
          tokens_out: response.usage.tokens_out,
          estimated_cost: response.usage.estimated_cost,
        },
      );

      const proposed = (response.json ?? {}) as {
        workflow_loops?: { key: string; name: string; rationale: string }[];
        roles?: { template_key: string; display_name?: string; rationale?: string }[];
        narrative?: string;
      };

      // The proposal is filtered against what the Chief may actually delegate,
      // so a hallucinated template never reaches the Owner as an option.
      const templateByKey = new Map(templates.map((t) => [t.key, t]));
      const roles = (proposed.roles ?? [])
        .filter((r) => templateByKey.has(r.template_key))
        .map((r) => {
          const template = templateByKey.get(r.template_key)!;
          const contract = template.contract_template as { allowed_tools?: string[]; quality_gates?: string[] };
          return {
            template_key: r.template_key,
            display_name: r.display_name ?? template.name,
            rationale: r.rationale ?? template.description,
            allowed_tools: (contract.allowed_tools ?? []).filter((t) => chiefContract.allowed_tools.includes(t)),
            quality_gates: contract.quality_gates ?? [],
          };
        });

      const dropped = (proposed.roles ?? []).filter((r) => !templateByKey.has(r.template_key));
      if (dropped.length > 0) {
        findings.push({
          severity: 'info',
          kind: 'proposal_filtered',
          message: `${dropped.length} proposed role(s) referenced templates this Chief cannot instantiate and were dropped.`,
          evidence: { dropped: dropped.map((d) => d.template_key) },
        });
      }

      if (roles.length === 0) {
        findings.push({
          severity: 'blocker',
          kind: 'no_viable_roles',
          message: 'No allowed template fits this objective. Either the objective needs narrowing or the Owner needs to approve a new template.',
          evidence: { available_templates: templates.map((t) => t.key) },
        });
      }

      const requiresOwnerDecision: string[] = [];
      for (const finding of findings) {
        if (finding.severity === 'blocker') requiresOwnerDecision.push(finding.kind);
      }
      for (const role of roles) {
        for (const tool of role.allowed_tools) {
          const definition = runtime.repos.governance.getTool(tool);
          if (definition?.requires_owner_approval) {
            requiresOwnerDecision.push(`owner_gated_tool:${tool}`);
          }
        }
      }

      const proposal: TeamProposal = {
        project_id: input.project_id,
        objective: input.objective,
        workflow_loops: proposed.workflow_loops ?? [],
        roles,
        findings,
        requires_owner_decision: [...new Set(requiresOwnerDecision)],
        narrative: proposed.narrative ?? response.text,
      };

      runtime.audit.append({
        kind: 'chief.team_proposed',
        actor_type: 'agent',
        actor_id: chiefAgent().agent_id,
        project_id: input.project_id,
        subject_type: 'project',
        subject_id: input.project_id,
        payload: {
          objective: input.objective,
          roles: roles.map((r) => r.template_key),
          blockers: findings.filter((f) => f.severity === 'blocker').map((f) => f.kind),
        },
      });

      return proposal;
    },

    /**
     * Instantiate approved roles from a proposal. Runs through the Tool
     * Gateway, so the Chief's own contract bounds what it can create.
     */
    async instantiateRoles(input: {
      project_id: string;
      template_keys: string[];
      task_id?: string | null;
    }): Promise<{ template_key: string; agent_id: string | null; error: string | null }[]> {
      const runtime = rt();
      const chiefId = chiefAgent().agent_id;
      const results: { template_key: string; agent_id: string | null; error: string | null }[] = [];

      for (const key of input.template_keys) {
        try {
          const result = await runtime.gateway.call({
            agentId: chiefId,
            toolName: 'agent.instantiate',
            projectId: input.project_id,
            taskId: input.task_id ?? null,
            args: { template_key: key, project_id: input.project_id },
          });
          results.push({ template_key: key, agent_id: result.output.agent_id as string, error: null });
        } catch (err) {
          results.push({ template_key: key, agent_id: null, error: (err as Error).message });
        }
      }
      return results;
    },

    async delegate(input: {
      task_id: string;
      receiver_agent_id: string;
      objective: string;
      intent?: string;
      allowed_tools?: string[];
      acceptance_criteria?: unknown[];
      quality_gate_ids?: string[];
      input_payload?: Record<string, unknown>;
    }) {
      const runtime = rt();
      const task = runtime.repos.tasks.getTask(input.task_id);
      if (!task) throw new RuntimeError('NOT_FOUND', `task ${input.task_id} not found`);

      const result = await runtime.gateway.call({
        agentId: chiefAgent().agent_id,
        toolName: 'packet.delegate',
        projectId: task.project_id,
        taskId: task.task_id,
        traceId: task.trace_id,
        args: {
          task_id: input.task_id,
          receiver_agent_id: input.receiver_agent_id,
          intent: input.intent ?? 'execute',
          objective: input.objective,
          input_payload: input.input_payload ?? {},
          allowed_tools: input.allowed_tools ?? [],
          acceptance_criteria: input.acceptance_criteria ?? [],
          quality_gate_ids: input.quality_gate_ids ?? [],
        },
      });
      return runtime.delegation.getPacket(result.output.packet_id as string);
    },

    /** Review a delivered artifact as the Chief. */
    async review(input: { task_id: string; artifact_id: string; gate_keys?: string[] }) {
      return rt().execution.review({
        task_id: input.task_id,
        artifact_id: input.artifact_id,
        evaluator_agent_id: chiefAgent().agent_id,
        gate_keys: input.gate_keys,
      });
    },

    requestRework(packetId: string, reason: string) {
      return rt().delegation.requestRework(packetId, chiefAgent().agent_id, reason);
    },

    escalateToOwner(taskId: string, reason: string) {
      return rt().execution.escalateToOwner(taskId, reason, chiefAgent().agent_id);
    },

    /** Merge and retirement recommendations, with the evidence behind each. */
    recommendConsolidation(): {
      merges: { keep: string; merge: string; reason: string; evidence: Record<string, unknown> }[];
      retirements: { agent_id: string; reason: string; evidence: Record<string, unknown> }[];
    } {
      const runtime = rt();
      const merges = runtime.registry.findDuplicateCapabilities().map((dup) => {
        const a = runtime.repos.agents.getAgent(dup.a)!;
        const b = runtime.repos.agents.getAgent(dup.b)!;
        // Keep the one that has actually done work; merge the other into it.
        const aWork = runtime.repos.tasks.listTasks({ assigned_agent_id: a.agent_id, limit: 200 }).length;
        const bWork = runtime.repos.tasks.listTasks({ assigned_agent_id: b.agent_id, limit: 200 }).length;
        const keep = aWork >= bWork ? a : b;
        const merge = keep.agent_id === a.agent_id ? b : a;
        return {
          keep: keep.agent_id,
          merge: merge.agent_id,
          reason: `${Math.round(dup.overlap * 100)}% tool overlap within the same project; ${keep.display_name} carries more of the workload.`,
          evidence: { overlap: dup.overlap, shared_tools: dup.shared_tools, tasks: { [a.agent_id]: aWork, [b.agent_id]: bWork } },
        };
      });

      const retirements: { agent_id: string; reason: string; evidence: Record<string, unknown> }[] = [];
      for (const agent of runtime.repos.agents.listAgents({ status: 'active' })) {
        if (agent.role_level === 'chief') continue;
        const tasks = runtime.repos.tasks.listTasks({ assigned_agent_id: agent.agent_id, limit: 200 });
        const live = runtime.repos.agents.countLiveInstances(agent.agent_id);
        if (tasks.length === 0 && live === 0) {
          const ageDays = (Date.now() - new Date(agent.created_at).getTime()) / 86_400_000;
          if (ageDays >= 7) {
            retirements.push({
              agent_id: agent.agent_id,
              reason: `Active for ${Math.floor(ageDays)} days with no assigned work and no live instances.`,
              evidence: { created_at: agent.created_at, tasks: 0, live_instances: 0 },
            });
          }
        }
      }

      return { merges, retirements };
    },
  };

  return chief;
}

export type ChiefService = ReturnType<typeof createChief>;
