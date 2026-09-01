import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import type { Registry } from '../registry/registry.js';
import type { DelegationService } from '../delegation/service.js';
import type { QualityService, ReviewOutcome } from '../quality/service.js';
import type { MemoryService } from '../memory/service.js';
import type { BudgetService } from '../budget/service.js';
import type { LlmProvider } from '../llm/provider.js';
import {
  CreateTaskInput,
  RuntimeError,
  newId,
  newTraceId,
  type TaskArtifactRecord,
  type TaskRecord,
  type WorkPacketRecord,
} from '../domain/index.js';

/**
 * Task execution.
 *
 * One `executePacket` call is the whole unit of agent work: acquire an
 * instance, gather the context the contract says the agent needs, produce an
 * artifact through the model provider, deliver it, release the instance. Every
 * step is bounded — scope on the context gather, budget on the model call,
 * concurrency on the instance.
 */

export interface ExecutionDeps {
  repos: Repos;
  audit: AuditLog;
  registry: Registry;
  delegation: DelegationService;
  quality: QualityService;
  memory: MemoryService;
  budgets: BudgetService;
  provider: LlmProvider;
}

export interface ExecutionResult {
  packet: WorkPacketRecord;
  artifact: TaskArtifactRecord;
  instance_id: string;
  model_calls: number;
  duration_ms: number;
}

export function createExecutionService(deps: ExecutionDeps) {
  const { repos, audit, registry, delegation, quality, memory, budgets, provider } = deps;

  const service = {
    createTask(rawInput: unknown, actor: { type: 'owner' | 'agent' | 'system'; id: string }): TaskRecord {
      const parsed = CreateTaskInput.safeParse(rawInput);
      if (!parsed.success) {
        throw new RuntimeError('VALIDATION_FAILED', 'invalid task input', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const input = parsed.data;

      const project = repos.projects.get(input.project_id);
      if (!project) throw new RuntimeError('NOT_FOUND', `project ${input.project_id} not found`);
      if (project.status !== 'active') {
        throw new RuntimeError('CONFLICT', `project ${project.key} is ${project.status}`);
      }

      if (input.loop_id) {
        const loop = repos.projects.getLoop(input.loop_id);
        if (!loop) throw new RuntimeError('NOT_FOUND', `workflow loop ${input.loop_id} not found`);
        if (loop.project_id !== input.project_id) {
          throw new RuntimeError('VALIDATION_FAILED', 'workflow loop belongs to a different project', {
            loop_project: loop.project_id,
          });
        }
      }

      const task = repos.tasks.insertTask({
        task_id: newId('task'),
        project_id: input.project_id,
        loop_id: input.loop_id,
        parent_task_id: input.parent_task_id,
        trace_id: input.trace_id ?? newTraceId(),
        title: input.title,
        description: input.description,
        status: 'pending',
        priority: input.priority,
        assigned_agent_id: input.assigned_agent_id,
        created_by: `${actor.type}:${actor.id}`,
        input: input.input,
        result: null,
        attempt: 0,
        max_attempts: input.max_attempts,
        deadline_at: input.deadline_at,
      });

      // A task-scoped budget bounds a single unit of work even when the
      // project's own allowance is generous.
      budgets.define('task', task.task_id, {
        max_model_calls: 25,
        max_tool_calls: 100,
        max_retries: input.max_attempts,
      });

      audit.append({
        kind: 'task.created',
        actor_type: actor.type === 'system' ? 'system' : actor.type,
        actor_id: actor.id,
        project_id: task.project_id,
        trace_id: task.trace_id,
        subject_type: 'task',
        subject_id: task.task_id,
        payload: { title: task.title, priority: task.priority },
      });

      return task;
    },

    getTask(taskId: string): TaskRecord {
      const task = repos.tasks.getTask(taskId);
      if (!task) throw new RuntimeError('NOT_FOUND', `task ${taskId} not found`);
      return task;
    },

    listTasks(filter: { project_id?: string; status?: string; assigned_agent_id?: string; limit?: number } = {}) {
      return repos.tasks.listTasks(filter);
    },

    listArtifacts(taskId: string) {
      return repos.tasks.listArtifacts(taskId);
    },

    setStatus(taskId: string, status: Parameters<QualityService['setTaskStatus']>[1]): TaskRecord {
      quality.setTaskStatus(taskId, status);
      return service.getTask(taskId);
    },

    /**
     * Gather the context an agent is contractually required to have, and
     * nothing beyond what its scope permits. A missing required source is
     * surfaced rather than silently tolerated.
     */
    gatherContext(agentId: string, packet: WorkPacketRecord) {
      const agent = repos.agents.getAgent(agentId);
      if (!agent) throw new RuntimeError('NOT_FOUND', `agent ${agentId} not found`);
      const contract = repos.agents.getContractVersion(agentId, agent.current_version)?.contract;
      if (!contract) throw new RuntimeError('CONTRACT_INVALID', `agent ${agentId} has no current contract`);

      const knowledge: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const source of contract.required_knowledge_sources) {
        const record = memory.resolve(agentId, source.key, packet.project_id);
        if (record) {
          knowledge[source.key] = { layer: record.layer, content: record.content, authoritative: record.authoritative };
        } else if (source.required) {
          missing.push(source.key);
        }
      }

      const referenced: Record<string, unknown> = {};
      for (const ref of packet.context_refs) {
        if (ref.kind === 'memory') {
          const record = repos.memory.get(ref.id);
          // Scope still applies to explicitly referenced records.
          if (
            record &&
            (contract.project_scope.all_projects ||
              record.scope_project_id === null ||
              contract.project_scope.project_ids.includes(record.scope_project_id))
          ) {
            referenced[ref.id] = record.content;
          }
        } else if (ref.kind === 'artifact') {
          const artifact = repos.tasks.getArtifact(ref.id);
          if (artifact && artifact.project_id === packet.project_id) referenced[ref.id] = artifact.content;
        }
      }

      return { knowledge, referenced, missing };
    },

    /**
     * Run one packet to delivery. Returns the artifact; it does not review it —
     * review is a separate step performed by a different agent, so separation
     * of duties survives.
     */
    async executePacket(packetId: string): Promise<ExecutionResult> {
      const startedMs = Date.now();
      const packet = delegation.getPacket(packetId);
      const agentId = packet.receiver_agent_id;

      const budgetVerdict = budgets.check(
        { project_id: packet.project_id, agent_id: agentId, task_id: packet.task_id },
        { model_calls: 1 },
      );
      if (!budgetVerdict.ok) {
        delegation.escalate(packetId, agentId, budgetVerdict.reason);
        quality.setTaskStatus(packet.task_id, 'escalated');
        throw new RuntimeError(budgetVerdict.code ?? 'BUDGET_HARD_EXCEEDED', budgetVerdict.reason, {
          packet_id: packetId,
        });
      }

      const instance = registry.acquireInstance({
        agentId,
        project_id: packet.project_id,
        task_id: packet.task_id,
        loop_id: packet.workflow_loop_id,
      });

      try {
        if (packet.status === 'dispatched') delegation.accept(packetId, agentId);
        if (delegation.getPacket(packetId).status === 'accepted') delegation.start(packetId);

        const contract = repos.agents.getContractVersion(
          agentId,
          repos.agents.getAgent(agentId)!.current_version,
        )!.contract;
        const context = service.gatherContext(agentId, packet);

        const response = await provider.complete({
          purpose: 'agent.execute',
          expect_json: true,
          system: [
            `You are ${contract.display_name}, a ${contract.role_level} agent.`,
            `Mission: ${contract.mission}`,
            contract.persona.rules.length ? `Rules: ${contract.persona.rules.join(' ')}` : '',
            'Produce only the JSON artifact the packet asks for.',
          ]
            .filter(Boolean)
            .join('\n'),
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                objective: packet.objective,
                input: packet.input_payload,
                acceptance_criteria: packet.acceptance_criteria,
                expected_output_schema: packet.expected_output_schema,
                knowledge: context.knowledge,
                referenced_context: context.referenced,
                missing_required_knowledge: context.missing,
              }),
            },
          ],
        });

        budgets.record(
          {
            project_id: packet.project_id,
            agent_id: agentId,
            task_id: packet.task_id,
            packet_id: packetId,
            trace_id: packet.trace_id,
          },
          'model_call',
          {
            model_calls: response.usage.model_calls,
            tokens_in: response.usage.tokens_in,
            tokens_out: response.usage.tokens_out,
            estimated_cost: response.usage.estimated_cost,
          },
        );

        const content =
          response.json && typeof response.json === 'object'
            ? (response.json as Record<string, unknown>)
            : { text: response.text };

        const evidenceRefs = [
          ...Object.keys(context.referenced),
          ...Object.values(context.knowledge).map(() => '').filter(Boolean),
        ];

        const { artifact } = delegation.deliver({
          packet_id: packetId,
          agent_id: agentId,
          content,
          provenance: {
            origin: 'agent',
            origin_id: agentId,
            trace_id: packet.trace_id,
            task_id: packet.task_id,
            evidence_refs: evidenceRefs,
            note: `model=${response.model} provider=${response.provider}`,
          },
        });

        const durationMs = Date.now() - startedMs;
        budgets.record(
          {
            project_id: packet.project_id,
            agent_id: agentId,
            task_id: packet.task_id,
            packet_id: packetId,
            trace_id: packet.trace_id,
          },
          'execution',
          { elapsed_ms: durationMs },
        );

        registry.releaseInstance(instance.instance_id, false);

        audit.append({
          kind: 'task.executed',
          actor_type: 'agent',
          actor_id: agentId,
          project_id: packet.project_id,
          trace_id: packet.trace_id,
          subject_type: 'task',
          subject_id: packet.task_id,
          payload: {
            packet_id: packetId,
            artifact_id: artifact.artifact_id,
            duration_ms: durationMs,
            missing_required_knowledge: context.missing,
          },
        });

        return {
          packet: delegation.getPacket(packetId),
          artifact,
          instance_id: instance.instance_id,
          model_calls: response.usage.model_calls,
          duration_ms: durationMs,
        };
      } catch (err) {
        registry.releaseInstance(instance.instance_id, true, 'execution failed');
        audit.append({
          kind: 'task.execution_failed',
          actor_type: 'agent',
          actor_id: agentId,
          project_id: packet.project_id,
          trace_id: packet.trace_id,
          subject_type: 'task',
          subject_id: packet.task_id,
          severity: 'error',
          payload: { packet_id: packetId, error: (err as Error).message },
        });
        throw err;
      }
    },

    /** Review a delivered artifact. The evaluator must not be its author. */
    async review(input: {
      task_id: string;
      artifact_id: string;
      evaluator_agent_id: string;
      gate_keys?: string[];
    }): Promise<ReviewOutcome> {
      return quality.reviewDelivery(input);
    },

    /**
     * Execute, then review, then rework up to the packet's limit. This is the
     * runtime quality loop end to end.
     */
    async runToCompletion(input: {
      packet_id: string;
      evaluator_agent_id: string;
      max_cycles?: number;
    }): Promise<{ outcome: ReviewOutcome; cycles: number }> {
      const maxCycles = input.max_cycles ?? 3;
      let packetId = input.packet_id;
      let cycles = 0;
      let outcome: ReviewOutcome | null = null;

      while (cycles < maxCycles) {
        cycles++;
        const execution = await service.executePacket(packetId);
        outcome = await service.review({
          task_id: execution.packet.task_id,
          artifact_id: execution.artifact.artifact_id,
          evaluator_agent_id: input.evaluator_agent_id,
        });

        if (outcome.action !== 'rework_requested') break;

        // Rework re-uses the same packet: the receiver, its bounds and its
        // trace stay put, so the rework chain is visible on one packet.
        const packet = delegation.getPacket(packetId);
        if (packet.status === 'rework_requested') {
          delegation.start(packetId);
          packetId = packet.packet_id;
        }
        budgets.record(
          {
            project_id: packet.project_id,
            agent_id: packet.receiver_agent_id,
            task_id: packet.task_id,
            trace_id: packet.trace_id,
          },
          'retry',
          { retries: 1 },
        );
      }

      if (!outcome) throw new RuntimeError('INTERNAL', 'execution loop produced no outcome');
      return { outcome, cycles };
    },

    escalateToOwner(taskId: string, reason: string, actorAgentId: string | null): TaskRecord {
      const task = service.getTask(taskId);
      quality.setTaskStatus(taskId, 'escalated');
      audit.append({
        kind: 'task.escalated_to_owner',
        actor_type: actorAgentId ? 'agent' : 'system',
        actor_id: actorAgentId,
        project_id: task.project_id,
        trace_id: task.trace_id,
        subject_type: 'task',
        subject_id: taskId,
        severity: 'warn',
        payload: { reason },
      });
      return service.getTask(taskId);
    },
  };

  return service;
}

export type ExecutionService = ReturnType<typeof createExecutionService>;
