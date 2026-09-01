import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import type { MemoryService } from '../memory/service.js';
import type { LlmProvider } from '../llm/provider.js';
import type { BudgetService } from '../budget/service.js';
import {
  RuntimeError,
  TASK_TRANSITIONS,
  type CapaRecord,
  type CheckResult,
  type QualityEvaluationRecord,
  type QualityGateRecord,
  type TaskArtifactRecord,
  type TaskStatus,
  type WorkPacketRecord,
} from '../domain/index.js';
import {
  runAcceptanceCheck,
  runDuplicationCheck,
  runEvidenceCheck,
  runPermissionCheck,
  runSchemaCheck,
  type CheckContext,
} from './checks.js';

/**
 * Quality as a runtime loop:
 *
 *   execute -> evaluate -> pass | rework -> re-evaluate -> escalate
 *
 * Gates are data, not code paths: a gate names its checks and its threshold,
 * and `evaluate` runs exactly those. Repeated failure opens a CAPA record
 * rather than quietly retrying forever.
 */

export interface QualityDeps {
  repos: Repos;
  audit: AuditLog;
  memory: MemoryService;
  provider: LlmProvider;
  budgets: BudgetService;
}

export interface EvaluateInput {
  task_id: string;
  artifact_id: string;
  gate_key: string;
  evaluator_agent_id?: string | null;
}

export interface ReviewOutcome {
  task_id: string;
  artifact_id: string;
  passed: boolean;
  evaluations: QualityEvaluationRecord[];
  action: 'accepted' | 'rework_requested' | 'escalated';
  capa: CapaRecord | null;
  attempt: number;
}

export function createQualityService(deps: QualityDeps) {
  const { repos, audit, memory, provider, budgets } = deps;

  function requireGate(gateKey: string): QualityGateRecord {
    const gate = repos.quality.getGateByKey(gateKey) ?? repos.quality.getGate(gateKey);
    if (!gate) throw new RuntimeError('NOT_FOUND', `quality gate ${gateKey} not found`);
    return gate;
  }

  async function runModelEvaluator(
    ctx: CheckContext,
    weight: number,
  ): Promise<CheckResult> {
    const response = await provider.complete({
      purpose: 'quality.model_evaluator',
      expect_json: true,
      system:
        'You are a quality evaluator. Judge whether the artifact satisfies the stated objective and criteria. ' +
        'Reply with {"passed": boolean, "reasons": string[]}.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            objective: ctx.packet?.objective ?? '',
            acceptance_criteria: ctx.packet?.acceptance_criteria ?? [],
            artifact: ctx.artifact.content,
          }),
        },
      ],
    });

    budgets.record(
      {
        project_id: ctx.artifact.project_id,
        task_id: ctx.artifact.task_id,
        trace_id: ctx.artifact.trace_id,
      },
      'model_call',
      {
        model_calls: response.usage.model_calls,
        tokens_in: response.usage.tokens_in,
        tokens_out: response.usage.tokens_out,
        estimated_cost: response.usage.estimated_cost,
      },
    );

    const verdict = (response.json ?? {}) as { passed?: boolean; reasons?: string[] };
    return {
      kind: 'model_evaluator',
      // An evaluator that returns nothing usable is a failure, not a pass.
      passed: verdict.passed === true,
      weight,
      detail: verdict.passed === true ? 'model evaluator accepted the artifact' : 'model evaluator did not accept the artifact',
      findings: verdict.reasons ?? [],
    };
  }

  const service = {
    listGates(): QualityGateRecord[] {
      return repos.quality.listGates();
    },

    getGate: requireGate,

    listEvaluations(filter: { task_id?: string; project_id?: string; passed?: boolean; limit?: number } = {}) {
      return repos.quality.listEvaluations(filter);
    },

    /**
     * Run one gate against one artifact. Separation of duties is enforced here:
     * where a gate demands it, the evaluator cannot be the artifact's author.
     */
    async evaluate(input: EvaluateInput): Promise<QualityEvaluationRecord> {
      const gate = requireGate(input.gate_key);
      const artifact = repos.tasks.getArtifact(input.artifact_id);
      if (!artifact) throw new RuntimeError('NOT_FOUND', `artifact ${input.artifact_id} not found`);
      if (artifact.task_id !== input.task_id) {
        throw new RuntimeError('VALIDATION_FAILED', 'artifact does not belong to that task', {
          artifact_task: artifact.task_id,
          requested_task: input.task_id,
        });
      }

      const evaluatorId = input.evaluator_agent_id ?? null;
      if (gate.separation_of_duties && evaluatorId && evaluatorId === artifact.agent_id) {
        throw new RuntimeError(
          'DENIED_SEPARATION_OF_DUTIES',
          `gate ${gate.key} requires an evaluator other than the artifact's author`,
          { gate: gate.key, author: artifact.agent_id },
        );
      }

      const packet: WorkPacketRecord | null = artifact.packet_id
        ? (repos.tasks.getPacket(artifact.packet_id) ?? null)
        : null;
      const ctx: CheckContext = { repos, memory, artifact, packet };

      const results: CheckResult[] = [];
      let usedModel = false;
      for (const spec of gate.checks) {
        switch (spec.kind) {
          case 'schema':
            results.push(runSchemaCheck(ctx, spec));
            break;
          case 'acceptance_criteria':
            results.push(runAcceptanceCheck(ctx, spec));
            break;
          case 'evidence':
            results.push(runEvidenceCheck(ctx, spec));
            break;
          case 'permission_compliance':
            results.push(runPermissionCheck(ctx, spec));
            break;
          case 'duplication':
            results.push(runDuplicationCheck(ctx, spec));
            break;
          case 'model_evaluator':
            usedModel = true;
            results.push(await runModelEvaluator(ctx, spec.weight));
            break;
        }
      }

      const totalWeight = results.reduce((sum, r) => sum + r.weight, 0) || 1;
      const score = results.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0) / totalWeight;
      const passed = score >= gate.threshold;

      const record = repos.quality.insertEvaluation({
        gate_id: gate.gate_id,
        task_id: artifact.task_id,
        packet_id: artifact.packet_id,
        artifact_id: artifact.artifact_id,
        project_id: artifact.project_id,
        trace_id: artifact.trace_id,
        evaluator_agent_id: evaluatorId,
        evaluator_kind: usedModel ? 'model' : 'deterministic',
        passed,
        score: Number(score.toFixed(4)),
        results,
        attempt: artifact.attempt,
      });

      audit.append({
        kind: passed ? 'quality.passed' : 'quality.failed',
        actor_type: evaluatorId ? 'agent' : 'system',
        actor_id: evaluatorId,
        project_id: artifact.project_id,
        trace_id: artifact.trace_id,
        subject_type: 'quality_evaluation',
        subject_id: record.evaluation_id,
        severity: passed ? 'info' : 'warn',
        payload: {
          gate: gate.key,
          score: record.score,
          findings: results.filter((r) => !r.passed).flatMap((r) => r.findings),
        },
      });

      return record;
    },

    /**
     * Review a delivered artifact against every gate the packet names, then
     * route the task: accept, send back for rework, or escalate.
     */
    async reviewDelivery(input: {
      task_id: string;
      artifact_id: string;
      evaluator_agent_id?: string | null;
      gate_keys?: string[];
    }): Promise<ReviewOutcome> {
      const task = repos.tasks.getTask(input.task_id);
      if (!task) throw new RuntimeError('NOT_FOUND', `task ${input.task_id} not found`);
      const artifact = repos.tasks.getArtifact(input.artifact_id);
      if (!artifact) throw new RuntimeError('NOT_FOUND', `artifact ${input.artifact_id} not found`);

      const packet = artifact.packet_id ? repos.tasks.getPacket(artifact.packet_id) : undefined;
      const gateKeys =
        input.gate_keys ??
        (packet?.quality_gate_ids.length ? packet.quality_gate_ids : ['gate.standard_delivery']);

      const evaluations: QualityEvaluationRecord[] = [];
      let blockingFailure = false;

      for (const key of gateKeys) {
        const gate = requireGate(key);
        const evaluation = await service.evaluate({
          task_id: input.task_id,
          artifact_id: input.artifact_id,
          gate_key: key,
          evaluator_agent_id: input.evaluator_agent_id ?? null,
        });
        evaluations.push(evaluation);
        if (!evaluation.passed && gate.blocking) blockingFailure = true;
      }

      if (!blockingFailure) {
        service.setTaskStatus(task.task_id, 'completed');
        repos.tasks.updateTask(task.task_id, {
          result: { artifact_id: artifact.artifact_id, evaluations: evaluations.map((e) => e.evaluation_id) },
        });
        if (packet) repos.tasks.setPacketStatus(packet.packet_id, 'accepted_final');
        audit.append({
          kind: 'task.accepted',
          actor_type: 'agent',
          actor_id: input.evaluator_agent_id ?? null,
          project_id: task.project_id,
          trace_id: task.trace_id,
          subject_type: 'task',
          subject_id: task.task_id,
          payload: { artifact_id: artifact.artifact_id },
        });
        return {
          task_id: task.task_id,
          artifact_id: artifact.artifact_id,
          passed: true,
          evaluations,
          action: 'accepted',
          capa: null,
          attempt: task.attempt,
        };
      }

      // --- failure path -----------------------------------------------------

      const attempt = task.attempt + 1;
      repos.tasks.updateTask(task.task_id, { attempt });
      const failures = repos.quality.countFailures(task.task_id);

      const agentContract = task.assigned_agent_id
        ? repos.agents.getContractVersion(
            task.assigned_agent_id,
            repos.agents.getAgent(task.assigned_agent_id)?.current_version ?? 0,
          )?.contract
        : undefined;
      const reworkPolicy = agentContract?.rework_policy ?? {
        max_attempts: task.max_attempts,
        on_exhaustion: 'capa_and_escalate' as const,
        capa_after_failures: 2,
      };

      let capa: CapaRecord | null = null;
      if (failures >= reworkPolicy.capa_after_failures) {
        capa = service.openCapa({
          project_id: task.project_id,
          task_id: task.task_id,
          agent_id: task.assigned_agent_id,
          trace_id: task.trace_id,
          issue: `Task "${task.title}" failed quality review ${failures} time(s)`,
          root_cause_hypothesis: evaluations
            .filter((e) => !e.passed)
            .flatMap((e) => e.results.filter((r) => !r.passed).map((r) => `${r.kind}: ${r.detail}`))
            .join('; '),
          evidence: {
            evaluation_ids: evaluations.map((e) => e.evaluation_id),
            findings: evaluations.flatMap((e) => e.results.filter((r) => !r.passed).flatMap((r) => r.findings)),
          },
        });
      }

      const exhausted = attempt >= reworkPolicy.max_attempts;
      if (exhausted) {
        service.setTaskStatus(task.task_id, 'escalated');
        if (packet) repos.tasks.setPacketStatus(packet.packet_id, 'escalated');
        audit.append({
          kind: 'task.escalated',
          actor_type: 'system',
          project_id: task.project_id,
          trace_id: task.trace_id,
          subject_type: 'task',
          subject_id: task.task_id,
          severity: 'warn',
          payload: { attempt, max_attempts: reworkPolicy.max_attempts, capa_id: capa?.capa_id ?? null },
        });
        return {
          task_id: task.task_id,
          artifact_id: artifact.artifact_id,
          passed: false,
          evaluations,
          action: 'escalated',
          capa,
          attempt,
        };
      }

      service.setTaskStatus(task.task_id, 'rework');
      if (packet) repos.tasks.setPacketStatus(packet.packet_id, 'rework_requested');
      audit.append({
        kind: 'task.rework_requested',
        actor_type: 'agent',
        actor_id: input.evaluator_agent_id ?? null,
        project_id: task.project_id,
        trace_id: task.trace_id,
        subject_type: 'task',
        subject_id: task.task_id,
        severity: 'warn',
        payload: { attempt, capa_id: capa?.capa_id ?? null },
      });

      return {
        task_id: task.task_id,
        artifact_id: artifact.artifact_id,
        passed: false,
        evaluations,
        action: 'rework_requested',
        capa,
        attempt,
      };
    },

    /** Central task transition guard, shared by every service that moves a task. */
    setTaskStatus(taskId: string, to: TaskStatus): void {
      const task = repos.tasks.getTask(taskId);
      if (!task) throw new RuntimeError('NOT_FOUND', `task ${taskId} not found`);
      if (task.status === to) return;
      if (!TASK_TRANSITIONS[task.status].includes(to)) {
        throw new RuntimeError(
          'INVALID_LIFECYCLE_TRANSITION',
          `task ${taskId} cannot move from ${task.status} to ${to}`,
          { from: task.status, to, allowed: TASK_TRANSITIONS[task.status] },
        );
      }
      repos.tasks.updateTask(taskId, { status: to });
    },

    // ---- CAPA --------------------------------------------------------------

    openCapa(input: {
      project_id: string;
      task_id?: string | null;
      agent_id?: string | null;
      trace_id?: string | null;
      issue: string;
      root_cause_hypothesis?: string;
      corrective_action?: string;
      preventive_action?: string;
      owner_agent_id?: string | null;
      owner_human?: string | null;
      evidence?: Record<string, unknown>;
    }): CapaRecord {
      const record = repos.quality.insertCapa({
        project_id: input.project_id,
        task_id: input.task_id ?? null,
        agent_id: input.agent_id ?? null,
        trace_id: input.trace_id ?? null,
        issue: input.issue,
        root_cause_hypothesis: input.root_cause_hypothesis ?? '',
        corrective_action: input.corrective_action ?? '',
        preventive_action: input.preventive_action ?? '',
        owner_agent_id: input.owner_agent_id ?? null,
        owner_human: input.owner_human ?? null,
        state: 'open',
        verification_result: null,
        evidence: input.evidence ?? {},
      });

      audit.append({
        kind: 'capa.opened',
        actor_type: 'system',
        project_id: input.project_id,
        trace_id: input.trace_id ?? null,
        subject_type: 'capa',
        subject_id: record.capa_id,
        severity: 'warn',
        payload: { issue: input.issue, task_id: input.task_id ?? null },
      });

      return record;
    },

    updateCapa(
      capaId: string,
      patch: Partial<Pick<CapaRecord, 'state' | 'root_cause_hypothesis' | 'corrective_action' | 'preventive_action' | 'verification_result' | 'owner_agent_id' | 'owner_human'>>,
      actor: string,
    ): CapaRecord {
      const existing = repos.quality.getCapa(capaId);
      if (!existing) throw new RuntimeError('NOT_FOUND', `CAPA ${capaId} not found`);

      // Closing needs a stated cause, both actions, and a verification result:
      // a CAPA that closes empty records nothing worth having.
      if (patch.state === 'closed') {
        const merged = { ...existing, ...patch };
        const missing = (['root_cause_hypothesis', 'corrective_action', 'preventive_action'] as const).filter(
          (f) => !merged[f] || merged[f].trim() === '',
        );
        if (!merged.verification_result || merged.verification_result.trim() === '') missing.push('verification_result' as never);
        if (missing.length > 0) {
          throw new RuntimeError('VALIDATION_FAILED', `a CAPA cannot be closed without: ${missing.join(', ')}`, {
            missing,
          });
        }
      }

      repos.quality.updateCapa(capaId, patch);
      audit.append({
        kind: 'capa.updated',
        actor_type: 'owner',
        actor_id: actor,
        project_id: existing.project_id,
        subject_type: 'capa',
        subject_id: capaId,
        payload: { changed: Object.keys(patch), state: patch.state ?? existing.state },
      });
      return repos.quality.getCapa(capaId)!;
    },

    listCapa(filter: { project_id?: string; state?: string; task_id?: string; limit?: number } = {}) {
      return repos.quality.listCapa(filter);
    },

    getCapa(capaId: string): CapaRecord {
      const record = repos.quality.getCapa(capaId);
      if (!record) throw new RuntimeError('NOT_FOUND', `CAPA ${capaId} not found`);
      return record;
    },
  };

  return service;
}

export type QualityService = ReturnType<typeof createQualityService>;
export type { TaskArtifactRecord };
