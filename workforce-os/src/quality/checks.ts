import type { Repos } from '../db/repo/index.js';
import type { MemoryService } from '../memory/service.js';
import { resolvePath, validateAgainstSchema } from '../gateway/schema.js';
import type {
  AcceptanceCriterion,
  CheckResult,
  QualityCheckSpec,
  TaskArtifactRecord,
  WorkPacketRecord,
} from '../domain/index.js';

/**
 * Deterministic quality checks.
 *
 * Every check here reaches a verdict from stored state alone — no model call,
 * no clock, no network. That is the point: a quality system whose verdicts vary
 * run-to-run cannot gate anything. The one non-deterministic check
 * (model_evaluator) is separated out in evaluator.ts.
 */

export interface CheckContext {
  repos: Repos;
  memory: MemoryService;
  artifact: TaskArtifactRecord;
  packet: WorkPacketRecord | null;
}

function evaluateCriterion(criterion: AcceptanceCriterion, content: unknown): { passed: boolean; detail: string } {
  const check = criterion.check;
  switch (check.kind) {
    case 'field_present': {
      const value = resolvePath(content, check.path);
      return {
        passed: value !== undefined && value !== null,
        detail: `${check.path} ${value === undefined || value === null ? 'is missing' : 'is present'}`,
      };
    }
    case 'field_equals': {
      const value = resolvePath(content, check.path);
      const passed = JSON.stringify(value) === JSON.stringify(check.value);
      return { passed, detail: `${check.path} ${passed ? 'matches' : 'does not match'} the expected value` };
    }
    case 'min_length': {
      const value = resolvePath(content, check.path);
      const length = typeof value === 'string' ? value.length : -1;
      return {
        passed: length >= check.min,
        detail: `${check.path} length ${length} vs minimum ${check.min}`,
      };
    }
    case 'min_items': {
      const value = resolvePath(content, check.path);
      const length = Array.isArray(value) ? value.length : -1;
      return {
        passed: length >= check.min,
        detail: `${check.path} has ${length} item(s), minimum ${check.min}`,
      };
    }
    case 'manual':
    default:
      // A criterion nobody can check automatically must not silently pass.
      return { passed: false, detail: 'criterion requires a model or human evaluator' };
  }
}

export function runSchemaCheck(ctx: CheckContext, spec: QualityCheckSpec): CheckResult {
  const schema = (ctx.packet?.expected_output_schema ?? {}) as Record<string, unknown>;
  if (Object.keys(schema).length === 0) {
    return {
      kind: 'schema',
      passed: true,
      weight: spec.weight,
      detail: 'no output schema declared on the packet',
      findings: [],
    };
  }
  const violations = validateAgainstSchema(ctx.artifact.content, schema);
  return {
    kind: 'schema',
    passed: violations.length === 0,
    weight: spec.weight,
    detail: violations.length === 0 ? 'artifact matches the declared output schema' : `${violations.length} violation(s)`,
    findings: violations.map((v) => `${v.path}: ${v.message}`),
  };
}

export function runAcceptanceCheck(ctx: CheckContext, spec: QualityCheckSpec): CheckResult {
  const criteria = ctx.packet?.acceptance_criteria ?? [];
  if (criteria.length === 0) {
    return {
      kind: 'acceptance_criteria',
      passed: true,
      weight: spec.weight,
      detail: 'no acceptance criteria declared',
      findings: [],
    };
  }
  const findings: string[] = [];
  let failed = 0;
  for (const criterion of criteria) {
    const result = evaluateCriterion(criterion, ctx.artifact.content);
    if (!result.passed) {
      failed++;
      findings.push(`${criterion.id}: ${result.detail}`);
    }
  }
  return {
    kind: 'acceptance_criteria',
    passed: failed === 0,
    weight: spec.weight,
    detail: `${criteria.length - failed}/${criteria.length} criteria satisfied`,
    findings,
  };
}

/** Every evidence reference must resolve to something that actually exists. */
export function runEvidenceCheck(ctx: CheckContext, spec: QualityCheckSpec): CheckResult {
  const provenance = ctx.artifact.provenance as { evidence_refs?: string[]; origin?: string };
  const refs = provenance.evidence_refs ?? [];
  const findings: string[] = [];

  if (refs.length === 0) {
    return {
      kind: 'evidence',
      passed: false,
      weight: spec.weight,
      detail: 'artifact carries no evidence references',
      findings: ['provenance.evidence_refs is empty'],
    };
  }

  for (const ref of refs) {
    const exists =
      (ref.startsWith('art_') && !!ctx.repos.tasks.getArtifact(ref)) ||
      (ref.startsWith('mem_') && !!ctx.repos.memory.get(ref)) ||
      (ref.startsWith('tsk_') && !!ctx.repos.tasks.getTask(ref)) ||
      (ref.startsWith('call_') && !!ctx.repos.governance.getCall(ref)) ||
      (ref.startsWith('apr_') && !!ctx.repos.governance.getApproval(ref));
    if (!exists) findings.push(`evidence reference ${ref} does not resolve`);
  }

  return {
    kind: 'evidence',
    passed: findings.length === 0,
    weight: spec.weight,
    detail: findings.length === 0 ? `${refs.length} evidence reference(s) resolve` : `${findings.length} dangling reference(s)`,
    findings,
  };
}

/**
 * Did producing this artifact involve any denied call? A denial on the task is
 * a signal the agent attempted something outside its contract, and that is a
 * quality finding even when the final output looks fine.
 */
export function runPermissionCheck(ctx: CheckContext, spec: QualityCheckSpec): CheckResult {
  const calls = ctx.repos.governance.listCalls({ task_id: ctx.artifact.task_id, limit: 500 });
  const findings: string[] = [];

  for (const call of calls) {
    if (call.decision === 'deny') {
      findings.push(`${call.tool_name} denied: ${call.denial_code ?? 'unknown'}`);
      continue;
    }
    if (ctx.packet && ctx.packet.allowed_tools.length > 0 && call.packet_id === ctx.packet.packet_id) {
      if (!ctx.packet.allowed_tools.includes(call.tool_name)) {
        findings.push(`${call.tool_name} executed outside the packet allowlist`);
      }
    }
  }

  return {
    kind: 'permission_compliance',
    passed: findings.length === 0,
    weight: spec.weight,
    detail: findings.length === 0 ? `${calls.length} call(s), none outside policy` : `${findings.length} policy finding(s)`,
    findings,
  };
}

/**
 * Two failure modes in one check: byte-identical work already produced
 * elsewhere, and claims that contradict authoritative memory.
 */
export function runDuplicationCheck(ctx: CheckContext, spec: QualityCheckSpec): CheckResult {
  const findings: string[] = [];

  const duplicates = ctx.repos.tasks.findArtifactsByHash(
    ctx.artifact.project_id,
    ctx.artifact.content_hash,
    ctx.artifact.artifact_id,
  );
  for (const dup of duplicates) {
    findings.push(`identical content already recorded as ${dup.artifact_id} (task ${dup.task_id})`);
  }

  const claims = (ctx.artifact.content as { claims?: Record<string, unknown> }).claims;
  if (claims && typeof claims === 'object') {
    for (const conflict of ctx.memory.findConflicts(ctx.artifact.project_id, claims)) {
      findings.push(
        `claim "${conflict.key}" contradicts authoritative memory (${JSON.stringify(conflict.authoritative)})`,
      );
    }
  }

  return {
    kind: 'duplication',
    passed: findings.length === 0,
    weight: spec.weight,
    detail: findings.length === 0 ? 'no duplicate or conflicting content' : `${findings.length} finding(s)`,
    findings,
  };
}
