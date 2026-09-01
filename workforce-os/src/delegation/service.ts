import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import type { Registry } from '../registry/registry.js';
import type { BudgetService } from '../budget/service.js';
import {
  DelegateInput,
  PACKET_TRANSITIONS,
  RuntimeError,
  newId,
  newTraceId,
  type AgentContract,
  type PacketStatus,
  type TaskArtifactRecord,
  type WorkPacketRecord,
} from '../domain/index.js';
import { agentCanSeeProject } from '../policy/engine.js';

/**
 * Delegation runtime.
 *
 * Work moves between agents as typed WorkPackets, and a packet can never carry
 * authority its sender does not hold. That single rule — checked here, on every
 * delegation — is what stops privilege from growing as it travels down the
 * hierarchy.
 */

export interface DelegationDeps {
  repos: Repos;
  audit: AuditLog;
  registry: Registry;
  budgets: BudgetService;
}

export interface InstantiateSpecialistInput {
  template_key: string;
  project_id: string;
  display_name?: string;
  task_id?: string | null;
  loop_id?: string | null;
  overrides?: Record<string, unknown>;
  auto_activate?: boolean;
}

export function createDelegationService(deps: DelegationDeps) {
  const { repos, audit, registry, budgets } = deps;

  function contractOf(agentId: string): AgentContract {
    const agent = repos.agents.getAgent(agentId);
    if (!agent) throw new RuntimeError('NOT_FOUND', `agent ${agentId} not found`);
    const version = repos.agents.getContractVersion(agentId, agent.current_version);
    if (!version) throw new RuntimeError('CONTRACT_INVALID', `agent ${agentId} has no current contract`);
    return version.contract;
  }

  /** Walks the parent chain upward; a cycle would be a contract-validation bug. */
  function isDescendant(candidateId: string, ancestorId: string): boolean {
    const seen = new Set<string>();
    let current = repos.agents.getAgent(candidateId);
    while (current?.parent_agent_id) {
      if (seen.has(current.agent_id)) return false;
      seen.add(current.agent_id);
      if (current.parent_agent_id === ancestorId) return true;
      current = repos.agents.getAgent(current.parent_agent_id);
    }
    return false;
  }

  function assertPacketTransition(packet: WorkPacketRecord, to: PacketStatus): void {
    if (!PACKET_TRANSITIONS[packet.status].includes(to)) {
      throw new RuntimeError(
        'INVALID_LIFECYCLE_TRANSITION',
        `packet ${packet.packet_id} cannot move from ${packet.status} to ${to}`,
        { from: packet.status, to, allowed: PACKET_TRANSITIONS[packet.status] },
      );
    }
  }

  function requirePacket(packetId: string): WorkPacketRecord {
    const packet = repos.tasks.getPacket(packetId);
    if (!packet) throw new RuntimeError('NOT_FOUND', `work packet ${packetId} not found`);
    return packet;
  }

  const service = {
    getPacket: requirePacket,

    listPackets(filter: { task_id?: string; trace_id?: string; receiver_agent_id?: string; status?: string; limit?: number } = {}) {
      return repos.tasks.listPackets(filter);
    },

    /** The full packet chain for a trace, for the trace viewer. */
    traceView(traceId: string) {
      const packets = repos.tasks.listPackets({ trace_id: traceId, limit: 500 });
      return {
        trace_id: traceId,
        packets,
        tool_calls: repos.governance.listCalls({ trace_id: traceId, limit: 500 }),
        events: repos.governance.listEvents({ trace_id: traceId, limit: 500 }),
        usage: repos.budgets.listUsage({ trace_id: traceId, limit: 500 }),
      };
    },

    delegate(senderAgentId: string, rawInput: unknown): WorkPacketRecord {
      const parsed = DelegateInput.safeParse(rawInput);
      if (!parsed.success) {
        throw new RuntimeError('VALIDATION_FAILED', 'invalid delegation input', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const input = parsed.data;

      const sender = repos.agents.getAgent(senderAgentId);
      if (!sender) throw new RuntimeError('NOT_FOUND', `sender ${senderAgentId} not found`);
      if (sender.status !== 'active') {
        throw new RuntimeError('DENIED_AGENT_INACTIVE', `sender ${senderAgentId} is ${sender.status}`);
      }

      const receiver = repos.agents.getAgent(input.receiver_agent_id);
      if (!receiver) throw new RuntimeError('NOT_FOUND', `receiver ${input.receiver_agent_id} not found`);
      if (receiver.status !== 'active') {
        throw new RuntimeError(
          'DENIED_AGENT_INACTIVE',
          `receiver ${input.receiver_agent_id} is ${receiver.status}; work cannot be delegated to it`,
          { status: receiver.status },
        );
      }
      if (receiver.agent_id === sender.agent_id) {
        throw new RuntimeError('VALIDATION_FAILED', 'an agent cannot delegate to itself');
      }

      const task = repos.tasks.getTask(input.task_id);
      if (!task) throw new RuntimeError('NOT_FOUND', `task ${input.task_id} not found`);

      const senderContract = contractOf(sender.agent_id);
      const receiverContract = contractOf(receiver.agent_id);

      // Delegation follows the org graph. Nothing delegates sideways or upward.
      if (!isDescendant(receiver.agent_id, sender.agent_id)) {
        throw new RuntimeError(
          'DENIED_DELEGATION_ESCALATION',
          `${receiver.agent_id} is not a descendant of ${sender.agent_id}`,
          { sender: sender.agent_id, receiver: receiver.agent_id },
        );
      }

      if (!agentCanSeeProject(senderContract, task.project_id)) {
        throw new RuntimeError('DENIED_PROJECT_SCOPE', `sender cannot act in project ${task.project_id}`, {
          project_id: task.project_id,
        });
      }
      if (!agentCanSeeProject(receiverContract, task.project_id)) {
        throw new RuntimeError(
          'DENIED_PROJECT_SCOPE',
          `receiver ${receiver.agent_id} has no scope for project ${task.project_id}`,
          { project_id: task.project_id },
        );
      }

      // A packet may only carry tools the sender holds AND the receiver holds.
      // An empty list means "whatever the receiver's contract allows".
      const senderTools = new Set(senderContract.allowed_tools);
      const receiverTools = new Set(receiverContract.allowed_tools);
      const excessFromSender = input.allowed_tools.filter((t) => !senderTools.has(t));
      if (excessFromSender.length > 0) {
        throw new RuntimeError(
          'DENIED_DELEGATION_ESCALATION',
          `sender cannot delegate tools it does not hold: ${excessFromSender.join(', ')}`,
          { tools: excessFromSender },
        );
      }
      const excessForReceiver = input.allowed_tools.filter((t) => !receiverTools.has(t));
      if (excessForReceiver.length > 0) {
        throw new RuntimeError(
          'DENIED_TOOL_NOT_ALLOWED',
          `receiver's contract does not permit: ${excessForReceiver.join(', ')}`,
          { tools: excessForReceiver },
        );
      }

      // Budget on the packet cannot exceed what the sender is allowed to spend.
      const senderBudget = senderContract.budget_policy;
      if (input.budget.max_estimated_cost != null && input.budget.max_estimated_cost > senderBudget.max_estimated_cost) {
        throw new RuntimeError(
          'DENIED_DELEGATION_ESCALATION',
          `packet cost ceiling ${input.budget.max_estimated_cost} exceeds the sender's ${senderBudget.max_estimated_cost}`,
          { requested: input.budget.max_estimated_cost, sender_limit: senderBudget.max_estimated_cost },
        );
      }

      const budgetVerdict = budgets.check({ project_id: task.project_id, agent_id: sender.agent_id, task_id: task.task_id });
      if (!budgetVerdict.ok) {
        throw new RuntimeError(budgetVerdict.code ?? 'BUDGET_HARD_EXCEEDED', budgetVerdict.reason, {});
      }

      const packet = repos.tasks.insertPacket({
        packet_id: newId('packet'),
        trace_id: task.trace_id,
        task_id: task.task_id,
        sender_agent_id: sender.agent_id,
        receiver_agent_id: receiver.agent_id,
        parent_packet_id: input.parent_packet_id,
        project_id: task.project_id,
        workflow_loop_id: input.workflow_loop_id ?? task.loop_id,
        intent: input.intent,
        objective: input.objective,
        context_refs: input.context_refs,
        input_payload: input.input_payload,
        allowed_tools: input.allowed_tools,
        data_scope: input.data_scope,
        expected_output_schema: input.expected_output_schema,
        acceptance_criteria: input.acceptance_criteria,
        quality_gate_ids: input.quality_gate_ids.length ? input.quality_gate_ids : receiverContract.quality_gates,
        priority: input.priority,
        budget: input.budget,
        deadline_at: input.deadline_at,
        ttl_seconds: input.ttl_seconds,
        escalation_target: input.escalation_target ?? sender.agent_id,
        status: 'dispatched',
      });

      if (task.status === 'pending') {
        repos.tasks.updateTask(task.task_id, { status: 'assigned', assigned_agent_id: receiver.agent_id });
      } else if (!task.assigned_agent_id) {
        repos.tasks.updateTask(task.task_id, { assigned_agent_id: receiver.agent_id });
      }

      audit.append({
        kind: 'packet.dispatched',
        actor_type: 'agent',
        actor_id: sender.agent_id,
        project_id: task.project_id,
        trace_id: task.trace_id,
        subject_type: 'work_packet',
        subject_id: packet.packet_id,
        payload: {
          receiver: receiver.agent_id,
          intent: packet.intent,
          objective: packet.objective,
          allowed_tools: packet.allowed_tools,
        },
      });

      return packet;
    },

    accept(packetId: string, receiverAgentId: string): WorkPacketRecord {
      const packet = requirePacket(packetId);
      if (packet.receiver_agent_id !== receiverAgentId) {
        throw new RuntimeError('DENIED_DEFAULT', 'only the addressed receiver may accept this packet', {
          receiver: packet.receiver_agent_id,
        });
      }
      assertPacketTransition(packet, 'accepted');
      repos.tasks.setPacketStatus(packetId, 'accepted');
      audit.append({
        kind: 'packet.accepted',
        actor_type: 'agent',
        actor_id: receiverAgentId,
        project_id: packet.project_id,
        trace_id: packet.trace_id,
        subject_type: 'work_packet',
        subject_id: packetId,
      });
      return requirePacket(packetId);
    },

    start(packetId: string): WorkPacketRecord {
      const packet = requirePacket(packetId);
      assertPacketTransition(packet, 'in_progress');
      repos.tasks.setPacketStatus(packetId, 'in_progress');
      const task = repos.tasks.getTask(packet.task_id);
      if (task && (task.status === 'assigned' || task.status === 'rework')) {
        repos.tasks.updateTask(task.task_id, { status: 'running' });
      }
      return requirePacket(packetId);
    },

    /** Deliver the result as an artifact and hand the task to the quality loop. */
    deliver(input: {
      packet_id: string;
      agent_id: string;
      content: Record<string, unknown>;
      provenance?: Record<string, unknown>;
      kind?: string;
    }): { packet: WorkPacketRecord; artifact: TaskArtifactRecord } {
      const packet = requirePacket(input.packet_id);
      if (packet.receiver_agent_id !== input.agent_id) {
        throw new RuntimeError('DENIED_DEFAULT', 'only the addressed receiver may deliver this packet', {
          receiver: packet.receiver_agent_id,
        });
      }
      assertPacketTransition(packet, 'delivered');

      const task = repos.tasks.getTask(packet.task_id);
      if (!task) throw new RuntimeError('NOT_FOUND', `task ${packet.task_id} not found`);

      const artifact = repos.tasks.insertArtifact({
        task_id: packet.task_id,
        packet_id: packet.packet_id,
        agent_id: input.agent_id,
        project_id: packet.project_id,
        trace_id: packet.trace_id,
        kind: input.kind ?? 'result',
        content: input.content,
        provenance: {
          origin: 'agent',
          origin_id: input.agent_id,
          trace_id: packet.trace_id,
          task_id: packet.task_id,
          evidence_refs: [],
          note: '',
          ...(input.provenance ?? {}),
        },
        attempt: task.attempt + 1,
      });

      repos.tasks.setPacketStatus(packet.packet_id, 'delivered');
      if (task.status === 'running') {
        repos.tasks.updateTask(task.task_id, { status: 'awaiting_review' });
      }

      audit.append({
        kind: 'packet.delivered',
        actor_type: 'agent',
        actor_id: input.agent_id,
        project_id: packet.project_id,
        trace_id: packet.trace_id,
        subject_type: 'work_packet',
        subject_id: packet.packet_id,
        payload: { artifact_id: artifact.artifact_id },
      });

      return { packet: requirePacket(packet.packet_id), artifact };
    },

    requestRework(packetId: string, reviewerAgentId: string, reason: string): WorkPacketRecord {
      const packet = requirePacket(packetId);
      assertPacketTransition(packet, 'rework_requested');
      repos.tasks.setPacketStatus(packetId, 'rework_requested');
      audit.append({
        kind: 'packet.rework_requested',
        actor_type: 'agent',
        actor_id: reviewerAgentId,
        project_id: packet.project_id,
        trace_id: packet.trace_id,
        subject_type: 'work_packet',
        subject_id: packetId,
        severity: 'warn',
        payload: { reason },
      });
      return requirePacket(packetId);
    },

    escalate(packetId: string, actorAgentId: string, reason: string): WorkPacketRecord {
      const packet = requirePacket(packetId);
      assertPacketTransition(packet, 'escalated');
      repos.tasks.setPacketStatus(packetId, 'escalated');
      audit.append({
        kind: 'packet.escalated',
        actor_type: 'agent',
        actor_id: actorAgentId,
        project_id: packet.project_id,
        trace_id: packet.trace_id,
        subject_type: 'work_packet',
        subject_id: packetId,
        severity: 'warn',
        payload: { reason, escalation_target: packet.escalation_target },
      });
      return requirePacket(packetId);
    },

    /** Packets past their TTL are expired rather than left dangling. */
    expireStale(now: Date = new Date()): number {
      let expired = 0;
      for (const status of ['dispatched', 'accepted', 'in_progress'] as const) {
        for (const packet of repos.tasks.listPackets({ status, limit: 500 })) {
          const ttlMs = (packet.ttl_seconds ?? 0) * 1000;
          const deadline = packet.deadline_at ? new Date(packet.deadline_at).getTime() : null;
          const ttlDeadline = ttlMs > 0 ? new Date(packet.created_at).getTime() + ttlMs : null;
          const effective = deadline ?? ttlDeadline;
          if (effective !== null && now.getTime() > effective) {
            repos.tasks.setPacketStatus(packet.packet_id, 'expired');
            audit.append({
              kind: 'packet.expired',
              actor_type: 'system',
              project_id: packet.project_id,
              trace_id: packet.trace_id,
              subject_type: 'work_packet',
              subject_id: packet.packet_id,
              severity: 'warn',
              payload: { ttl_seconds: packet.ttl_seconds, deadline_at: packet.deadline_at },
            });
            expired++;
          }
        }
      }
      return expired;
    },

    /**
     * Elastic specialist creation.
     *
     * A template is a definition; this turns one into a governed agent only
     * when there is work for it, and only inside the parent's envelope. The
     * validator re-checks every bound, so a template that would escalate
     * authority fails here rather than at first use.
     */
    instantiateSpecialist(parentAgentId: string, input: InstantiateSpecialistInput) {
      const parent = repos.agents.getAgent(parentAgentId);
      if (!parent) throw new RuntimeError('NOT_FOUND', `agent ${parentAgentId} not found`);
      if (parent.status !== 'active') {
        throw new RuntimeError('DENIED_AGENT_INACTIVE', `agent ${parentAgentId} is ${parent.status}`);
      }
      const parentContract = contractOf(parentAgentId);

      const template = repos.agents.getTemplateByKey(input.template_key);
      if (!template) throw new RuntimeError('NOT_FOUND', `template ${input.template_key} not found`);
      if (template.status !== 'active') {
        throw new RuntimeError('CONFLICT', `template ${input.template_key} is ${template.status}`);
      }

      if (!parentContract.allowed_child_templates.includes(input.template_key)) {
        throw new RuntimeError(
          'DENIED_DELEGATION_ESCALATION',
          `agent ${parentAgentId} may not instantiate template ${input.template_key}`,
          { allowed: parentContract.allowed_child_templates },
        );
      }

      if (!agentCanSeeProject(parentContract, input.project_id)) {
        throw new RuntimeError(
          'DENIED_PROJECT_SCOPE',
          `agent ${parentAgentId} has no scope for project ${input.project_id}`,
          { project_id: input.project_id },
        );
      }

      // Concurrency: children count against the parent's own limit, so a
      // runaway loop cannot spawn an unbounded fleet.
      const existingChildren = repos.agents
        .listAgents({ parent_agent_id: parentAgentId })
        .filter((a) => a.status === 'active' || a.status === 'approved');
      const childLimit = parentContract.concurrency_limit * 10;
      if (existingChildren.length >= childLimit) {
        throw new RuntimeError(
          'DENIED_CONCURRENCY_LIMIT',
          `agent ${parentAgentId} already has ${existingChildren.length} live children (limit ${childLimit})`,
          { children: existingChildren.length, limit: childLimit },
        );
      }

      const budgetVerdict = budgets.check({ project_id: input.project_id, agent_id: parentAgentId });
      if (!budgetVerdict.ok) {
        throw new RuntimeError(budgetVerdict.code ?? 'BUDGET_HARD_EXCEEDED', budgetVerdict.reason, {});
      }

      const base = template.contract_template as Record<string, unknown>;
      const displayName = input.display_name ?? `${template.name} (${input.project_id.slice(-6)})`;

      // The instance is clamped to the parent's envelope before validation even
      // sees it: narrower is fine, wider is refused.
      const contract: Record<string, unknown> = {
        ...base,
        ...(input.overrides ?? {}),
        display_name: displayName,
        role_level: template.role_level,
        parent_agent_id: parentAgentId,
        project_scope: { project_ids: [input.project_id], all_projects: false },
        allowed_tools: ((input.overrides?.allowed_tools as string[]) ?? (base.allowed_tools as string[]) ?? []).filter(
          (t) => parentContract.allowed_tools.includes(t),
        ),
      };

      const agent = registry.createDraft(
        {
          display_name: displayName,
          role_level: template.role_level,
          mission: (contract.mission as string) ?? template.description,
          parent_agent_id: parentAgentId,
          template_id: template.template_id,
          contract,
        },
        { type: 'agent', id: parentAgentId },
      );

      const validation = registry.validate(agent.agent_id);
      if (!validation.valid) {
        throw new RuntimeError(
          'CONTRACT_INVALID',
          `instantiated specialist failed contract validation: ${validation.issues.map((i) => i.message).join('; ')}`,
          { agent_id: agent.agent_id, issues: validation.issues },
        );
      }

      const tests = registry.runTests(agent.agent_id);
      if (!tests.passed) {
        throw new RuntimeError(
          'REQUIRED_TESTS_NOT_PASSED',
          `instantiated specialist failed required tests`,
          { agent_id: agent.agent_id, failures: tests.cases.filter((c) => !c.passed) },
        );
      }

      if (input.auto_activate !== false) {
        registry.activate(agent.agent_id, parentAgentId);
      }

      audit.append({
        kind: 'agent.instantiated',
        actor_type: 'agent',
        actor_id: parentAgentId,
        project_id: input.project_id,
        subject_type: 'agent',
        subject_id: agent.agent_id,
        severity: 'security',
        payload: {
          template_key: input.template_key,
          project_id: input.project_id,
          task_id: input.task_id ?? null,
          allowed_tools: contract.allowed_tools,
        },
      });

      return {
        agent: repos.agents.getAgent(agent.agent_id)!,
        validation,
        tests,
      };
    },

    /**
     * Retire specialists that have no live instances and no open work. Called
     * by the scheduler: a definition is cheap, a running agent is not.
     */
    reapUnusedSpecialists(idleSeconds = 3600, now: Date = new Date()): string[] {
      const retired: string[] = [];
      for (const agent of repos.agents.listAgents({ status: 'active', role_level: 'specialist' })) {
        if (!agent.template_id) continue; // Only reap dynamically instantiated ones.
        const live = repos.agents.countLiveInstances(agent.agent_id);
        if (live > 0) continue;
        const openPackets = repos.tasks
          .listPackets({ receiver_agent_id: agent.agent_id, limit: 100 })
          .filter((p) => !['accepted_final', 'rejected', 'expired', 'cancelled', 'failed'].includes(p.status));
        if (openPackets.length > 0) continue;
        const ageMs = now.getTime() - new Date(agent.updated_at).getTime();
        if (ageMs < idleSeconds * 1000) continue;
        registry.retire(agent.agent_id, 'system', 'idle specialist reaped');
        retired.push(agent.agent_id);
      }
      return retired;
    },
  };

  return service;
}

export type DelegationService = ReturnType<typeof createDelegationService>;
