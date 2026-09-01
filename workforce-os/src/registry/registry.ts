import { createHash } from 'node:crypto';
import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import {
  AgentContract,
  RuntimeError,
  newId,
  nowIso,
  type ActivationMode,
  type AgentInstanceRecord,
  type AgentRecord,
  type AgentStatus,
  type RoleLevel,
} from '../domain/index.js';
import { canonicalJson } from '../policy/fingerprint.js';
import { assertTransition } from './lifecycle.js';
import { validateContract, type ValidationResult } from './validation.js';

/**
 * The agent builder and registry.
 *
 * Contracts are immutable and versioned: a revision writes a new version and
 * drops the agent back to `draft`, so a change to permissions cannot slip into
 * a running agent without re-validation, re-testing and a fresh activation.
 */

export interface ContractTestCase {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ContractTestReport {
  passed: boolean;
  cases: ContractTestCase[];
  ran_at: string;
}

/**
 * Supplied by the Tool Gateway. Returns the authorization outcome without
 * executing anything, so activation testing exercises the real policy engine
 * rather than a copy of its rules.
 */
export type DryRunAuthorize = (input: {
  agentId: string;
  toolName: string;
  projectId: string | null;
  args?: Record<string, unknown>;
}) => { allowed: boolean; code: string | null; reason: string; requiresApproval: boolean };

export interface RegistryDeps {
  repos: Repos;
  audit: AuditLog;
  dryRunAuthorize: DryRunAuthorize;
}

export interface CreateAgentInput {
  display_name: string;
  role_level: RoleLevel;
  mission: string;
  parent_agent_id?: string | null;
  template_id?: string | null;
  contract: Record<string, unknown>;
}

function hashContract(contract: unknown): string {
  return createHash('sha256').update(canonicalJson(contract)).digest('hex');
}

export function createRegistry(deps: RegistryDeps) {
  const { repos, audit } = deps;

  function requireAgent(agentId: string): AgentRecord {
    const agent = repos.agents.getAgent(agentId);
    if (!agent) throw new RuntimeError('NOT_FOUND', `agent ${agentId} not found`, { agent_id: agentId });
    return agent;
  }

  function getContract(agentId: string, version?: number): AgentContract {
    const agent = requireAgent(agentId);
    const v = version ?? agent.current_version;
    const row = repos.agents.getContractVersion(agentId, v);
    if (!row) {
      throw new RuntimeError('NOT_FOUND', `agent ${agentId} has no contract version ${v}`, {
        agent_id: agentId,
        version: v,
      });
    }
    return row.contract;
  }

  function writeVersion(
    agentId: string,
    contractInput: Record<string, unknown>,
    version: number,
    status: AgentStatus,
  ): AgentContract {
    const parsed = AgentContract.safeParse({
      ...contractInput,
      agent_id: agentId,
      version,
      status,
    });
    if (!parsed.success) {
      throw new RuntimeError('CONTRACT_INVALID', 'contract does not match the required shape', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    repos.agents.insertContractVersion({
      contract_version_id: newId('contractVersion'),
      agent_id: agentId,
      version,
      contract: parsed.data,
      contract_hash: hashContract(parsed.data),
      validation: {},
      validated_at: null,
      approved_by: null,
      approved_at: null,
    });
    return parsed.data;
  }

  const registry = {
    getAgent: requireAgent,
    getContract,

    listAgents(filter: { status?: string; role_level?: string; parent_agent_id?: string } = {}) {
      return repos.agents.listAgents(filter);
    },

    /** Full registry view: identity, lifecycle, contract summary, live instances. */
    describeAgent(agentId: string) {
      const agent = requireAgent(agentId);
      const contract = agent.current_version > 0 ? getContract(agentId) : null;
      return {
        agent,
        contract,
        versions: repos.agents.listContractVersions(agentId),
        instances: repos.agents.listInstances({ agent_id: agentId }),
        children: repos.agents.listAgents({ parent_agent_id: agentId }),
      };
    },

    createDraft(input: CreateAgentInput, actor: { type: 'owner' | 'agent'; id: string }): AgentRecord {
      const agentId = newId('agent');
      const agent = repos.agents.insertAgent({
        agent_id: agentId,
        display_name: input.display_name,
        role_level: input.role_level,
        status: 'draft',
        current_version: 1,
        parent_agent_id: input.parent_agent_id ?? null,
        template_id: input.template_id ?? null,
        merged_into_id: null,
      });

      writeVersion(
        agentId,
        {
          ...input.contract,
          display_name: input.display_name,
          role_level: input.role_level,
          mission: input.mission,
          parent_agent_id: input.parent_agent_id ?? null,
        },
        1,
        'draft',
      );

      audit.append({
        kind: 'agent.draft_created',
        actor_type: actor.type,
        actor_id: actor.id,
        subject_type: 'agent',
        subject_id: agentId,
        payload: { display_name: input.display_name, role_level: input.role_level },
      });

      return agent;
    },

    /**
     * A revision is a new immutable version. The agent returns to `draft`: any
     * permission change must walk the whole gate again before it can execute.
     */
    reviseContract(
      agentId: string,
      patch: Record<string, unknown>,
      actor: { type: 'owner' | 'agent'; id: string },
    ): { version: number; contract: AgentContract } {
      const agent = requireAgent(agentId);
      if (agent.status === 'retired' || agent.status === 'merged') {
        throw new RuntimeError('INVALID_LIFECYCLE_TRANSITION', `agent ${agentId} is ${agent.status}`, {
          status: agent.status,
        });
      }

      // An agent may never edit its own contract, whatever its access level.
      if (actor.type === 'agent' && actor.id === agentId) {
        throw new RuntimeError(
          'DENIED_SELF_MUTATION',
          'an agent cannot modify its own contract',
          { agent_id: agentId },
        );
      }

      const current = getContract(agentId);
      const version = agent.current_version + 1;
      const contract = writeVersion(agentId, { ...current, ...patch }, version, 'draft');

      repos.agents.updateAgent(agentId, {
        current_version: version,
        status: 'draft',
        display_name: contract.display_name,
      });

      audit.append({
        kind: 'agent.contract_revised',
        actor_type: actor.type,
        actor_id: actor.id,
        subject_type: 'agent',
        subject_id: agentId,
        severity: 'security',
        payload: { version, changed_fields: Object.keys(patch) },
      });

      return { version, contract };
    },

    validate(agentId: string): ValidationResult {
      const agent = requireAgent(agentId);
      const contract = getContract(agentId);
      const result = validateContract(contract, repos);

      repos.agents.markContractValidated(agentId, agent.current_version, result as never);

      if (result.valid && agent.status === 'draft') {
        assertTransition(agent.status, 'validated', agentId);
        repos.agents.updateAgent(agentId, { status: 'validated' });
      }

      audit.append({
        kind: result.valid ? 'agent.validated' : 'agent.validation_failed',
        actor_type: 'system',
        subject_type: 'agent',
        subject_id: agentId,
        severity: result.valid ? 'info' : 'warn',
        payload: { issues: result.issues, warnings: result.warnings },
      });

      return result;
    },

    /**
     * Required tests for activation. These exercise the real policy engine
     * against the agent's own contract: every allowlisted tool must resolve to
     * a decision the runtime understands, and the negative cases — an
     * unlisted tool, an out-of-scope project — must actually deny.
     */
    runTests(agentId: string): ContractTestReport {
      const agent = requireAgent(agentId);
      const contract = getContract(agentId);
      const cases: ContractTestCase[] = [];

      if (agent.status === 'validated') {
        assertTransition(agent.status, 'testing', agentId);
        repos.agents.updateAgent(agentId, { status: 'testing' });
      }

      const validation = validateContract(contract, repos);
      cases.push({
        name: 'contract_validates',
        passed: validation.valid,
        detail: validation.valid ? 'contract is valid' : validation.issues.map((i) => i.message).join('; '),
      });

      const probeProject = contract.project_scope.all_projects
        ? (repos.projects.list()[0]?.project_id ?? null)
        : (contract.project_scope.project_ids[0] ?? null);

      for (const toolName of contract.allowed_tools) {
        const decision = deps.dryRunAuthorize({
          agentId,
          toolName,
          projectId: probeProject,
        });
        // An approval-gated tool is expected to come back needing approval;
        // that is a correct outcome, not a failure.
        const ok = decision.allowed || decision.requiresApproval || decision.code === 'DENIED_AGENT_INACTIVE';
        cases.push({
          name: `tool_reachable:${toolName}`,
          passed: ok,
          detail: ok ? decision.reason : `${decision.code}: ${decision.reason}`,
        });
      }

      // Negative: a tool outside the allowlist must be refused.
      const allTools = repos.governance.listTools().map((t) => t.tool_name);
      const unlisted = allTools.find((t) => !contract.allowed_tools.includes(t));
      if (unlisted) {
        const decision = deps.dryRunAuthorize({ agentId, toolName: unlisted, projectId: probeProject });
        cases.push({
          name: 'unlisted_tool_denied',
          passed: !decision.allowed,
          detail: decision.allowed
            ? `tool ${unlisted} was allowed despite not being allowlisted`
            : `${unlisted} denied (${decision.code})`,
        });
      }

      // Negative: a project outside scope must be refused.
      if (!contract.project_scope.all_projects) {
        const outside = repos.projects
          .list()
          .find((p) => !contract.project_scope.project_ids.includes(p.project_id));
        const probeTool = contract.allowed_tools[0];
        if (outside && probeTool) {
          const decision = deps.dryRunAuthorize({
            agentId,
            toolName: probeTool,
            projectId: outside.project_id,
          });
          cases.push({
            name: 'out_of_scope_project_denied',
            passed: !decision.allowed,
            detail: decision.allowed
              ? `project ${outside.project_id} was reachable despite being out of scope`
              : `denied (${decision.code})`,
          });
        }
      }

      // Negative: a forbidden action must be refused even if otherwise valid.
      for (const forbidden of contract.forbidden_actions.slice(0, 3)) {
        const decision = deps.dryRunAuthorize({ agentId, toolName: forbidden, projectId: probeProject });
        cases.push({
          name: `forbidden_denied:${forbidden}`,
          passed: !decision.allowed,
          detail: decision.allowed ? 'forbidden action was allowed' : `denied (${decision.code})`,
        });
      }

      const passed = cases.every((c) => c.passed);
      const report: ContractTestReport = { passed, cases, ran_at: nowIso() };

      const existing = repos.agents.getContractVersion(agentId, agent.current_version);
      repos.agents.markContractValidated(agentId, agent.current_version, {
        ...(existing?.validation ?? {}),
        tests: report,
      });

      if (passed) {
        const current = requireAgent(agentId);
        if (current.status === 'testing') {
          assertTransition(current.status, 'approved', agentId);
          repos.agents.updateAgent(agentId, { status: 'approved' });
        }
      }

      audit.append({
        kind: passed ? 'agent.tests_passed' : 'agent.tests_failed',
        actor_type: 'system',
        subject_type: 'agent',
        subject_id: agentId,
        severity: passed ? 'info' : 'warn',
        payload: { cases: report.cases.filter((c) => !c.passed) },
      });

      return report;
    },

    /**
     * The activation gate. Refuses unless the current contract version has both
     * a passing validation and a passing test run on record.
     */
    activate(agentId: string, approvedBy: string): AgentRecord {
      const agent = requireAgent(agentId);

      if (agent.status === 'paused') {
        assertTransition(agent.status, 'active', agentId);
        repos.agents.updateAgent(agentId, { status: 'active' });
        audit.append({
          kind: 'agent.resumed',
          actor_type: 'owner',
          actor_id: approvedBy,
          subject_type: 'agent',
          subject_id: agentId,
          severity: 'security',
        });
        return requireAgent(agentId);
      }

      const version = repos.agents.getContractVersion(agentId, agent.current_version);
      const validation = version?.validation as
        | { valid?: boolean; tests?: ContractTestReport }
        | undefined;

      if (!validation?.valid) {
        throw new RuntimeError(
          'CONTRACT_INVALID',
          `agent ${agentId} has not passed contract validation for version ${agent.current_version}`,
          { agent_id: agentId, version: agent.current_version },
        );
      }
      if (!validation.tests?.passed) {
        throw new RuntimeError(
          'REQUIRED_TESTS_NOT_PASSED',
          `agent ${agentId} has not passed required tests for version ${agent.current_version}`,
          { agent_id: agentId, version: agent.current_version },
        );
      }

      assertTransition(agent.status, 'active', agentId);
      repos.agents.markContractApproved(agentId, agent.current_version, approvedBy);
      repos.agents.updateAgent(agentId, { status: 'active' });

      audit.append({
        kind: 'agent.activated',
        actor_type: 'owner',
        actor_id: approvedBy,
        subject_type: 'agent',
        subject_id: agentId,
        severity: 'security',
        payload: { version: agent.current_version },
      });

      return requireAgent(agentId);
    },

    pause(agentId: string, actor: string, reason: string): AgentRecord {
      const agent = requireAgent(agentId);
      assertTransition(agent.status, 'paused', agentId);
      repos.agents.updateAgent(agentId, { status: 'paused' });
      for (const inst of repos.agents.listInstances({ agent_id: agentId })) {
        if (inst.status === 'idle' || inst.status === 'busy') {
          repos.agents.endInstance(inst.instance_id, `agent paused: ${reason}`);
        }
      }
      audit.append({
        kind: 'agent.paused',
        actor_type: 'owner',
        actor_id: actor,
        subject_type: 'agent',
        subject_id: agentId,
        severity: 'security',
        payload: { reason },
      });
      return requireAgent(agentId);
    },

    retire(agentId: string, actor: string, reason: string): AgentRecord {
      const agent = requireAgent(agentId);
      assertTransition(agent.status, 'retired', agentId);
      repos.agents.updateAgent(agentId, { status: 'retired', retired_at: nowIso() });
      for (const inst of repos.agents.listInstances({ agent_id: agentId })) {
        if (inst.status !== 'ended') repos.agents.endInstance(inst.instance_id, `agent retired: ${reason}`);
      }
      audit.append({
        kind: 'agent.retired',
        actor_type: 'owner',
        actor_id: actor,
        subject_type: 'agent',
        subject_id: agentId,
        severity: 'security',
        payload: { reason },
      });
      return requireAgent(agentId);
    },

    merge(agentId: string, intoAgentId: string, actor: string, reason: string): AgentRecord {
      const agent = requireAgent(agentId);
      requireAgent(intoAgentId);
      assertTransition(agent.status, 'merged', agentId);
      repos.agents.updateAgent(agentId, { status: 'merged', merged_into_id: intoAgentId, retired_at: nowIso() });
      for (const inst of repos.agents.listInstances({ agent_id: agentId })) {
        if (inst.status !== 'ended') repos.agents.endInstance(inst.instance_id, 'agent merged');
      }
      audit.append({
        kind: 'agent.merged',
        actor_type: 'owner',
        actor_id: actor,
        subject_type: 'agent',
        subject_id: agentId,
        severity: 'security',
        payload: { merged_into: intoAgentId, reason },
      });
      return requireAgent(agentId);
    },

    // ---- elastic instances -------------------------------------------------

    /**
     * Instances are the unit of execution, and they are cheap and disposable.
     * A definition with no work has none; the concurrency limit is enforced
     * here rather than left to callers.
     */
    acquireInstance(input: {
      agentId: string;
      activation_mode?: ActivationMode;
      project_id?: string | null;
      task_id?: string | null;
      loop_id?: string | null;
    }): AgentInstanceRecord {
      const agent = requireAgent(input.agentId);
      if (agent.status !== 'active') {
        throw new RuntimeError(
          'DENIED_AGENT_INACTIVE',
          `agent ${input.agentId} is ${agent.status}; only an active agent can run`,
          { agent_id: input.agentId, status: agent.status },
        );
      }
      const contract = getContract(input.agentId);
      const live = repos.agents.countLiveInstances(input.agentId);
      if (live >= contract.concurrency_limit) {
        throw new RuntimeError(
          'DENIED_CONCURRENCY_LIMIT',
          `agent ${input.agentId} is at its concurrency limit of ${contract.concurrency_limit}`,
          { agent_id: input.agentId, live, limit: contract.concurrency_limit },
        );
      }

      const instance = repos.agents.insertInstance({
        instance_id: newId('instance'),
        agent_id: input.agentId,
        contract_version: agent.current_version,
        activation_mode: input.activation_mode ?? contract.activation_mode,
        status: 'busy',
        project_id: input.project_id ?? null,
        task_id: input.task_id ?? null,
        loop_id: input.loop_id ?? null,
        ttl_seconds: contract.time_limits.idle_timeout_seconds,
        metadata: {},
      });

      audit.append({
        kind: 'instance.acquired',
        actor_type: 'system',
        subject_type: 'instance',
        subject_id: instance.instance_id,
        project_id: input.project_id ?? null,
        payload: { agent_id: input.agentId, task_id: input.task_id ?? null },
      });

      return instance;
    },

    releaseInstance(instanceId: string, end = false, reason = 'released'): void {
      if (end) {
        repos.agents.endInstance(instanceId, reason);
        audit.append({
          kind: 'instance.ended',
          actor_type: 'system',
          subject_type: 'instance',
          subject_id: instanceId,
          payload: { reason },
        });
      } else {
        repos.agents.touchInstance(instanceId, 'idle');
      }
    },

    /** Reap instances idle past their contract's idle timeout. */
    reapIdleInstances(now: Date = new Date()): number {
      let reaped = 0;
      for (const inst of repos.agents.listInstances({ status: 'idle' })) {
        const ttl = inst.ttl_seconds ?? 600;
        const idleMs = now.getTime() - new Date(inst.last_active_at).getTime();
        if (idleMs >= ttl * 1000) {
          repos.agents.endInstance(inst.instance_id, 'idle timeout');
          audit.append({
            kind: 'instance.reaped',
            actor_type: 'system',
            subject_type: 'instance',
            subject_id: inst.instance_id,
            payload: { idle_ms: idleMs, ttl_seconds: ttl },
          });
          reaped++;
        }
      }
      return reaped;
    },

    /**
     * Capability overlap across the registry. The Chief uses this to recommend
     * a merge rather than letting near-duplicate agents accumulate.
     */
    findDuplicateCapabilities(): {
      a: string;
      b: string;
      overlap: number;
      shared_tools: string[];
      shared_projects: string[];
    }[] {
      const active = repos.agents
        .listAgents()
        .filter((a) => a.status === 'active' || a.status === 'approved' || a.status === 'paused');
      const contracts = new Map<string, AgentContract>();
      for (const a of active) {
        if (a.current_version > 0) {
          const v = repos.agents.getContractVersion(a.agent_id, a.current_version);
          if (v) contracts.set(a.agent_id, v.contract);
        }
      }
      const out: { a: string; b: string; overlap: number; shared_tools: string[]; shared_projects: string[] }[] = [];
      const ids = [...contracts.keys()];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const ca = contracts.get(ids[i]!)!;
          const cb = contracts.get(ids[j]!)!;
          if (ca.role_level !== cb.role_level) continue;
          const sharedTools = ca.allowed_tools.filter((t) => cb.allowed_tools.includes(t));
          const sharedProjects = ca.project_scope.project_ids.filter((p) =>
            cb.project_scope.project_ids.includes(p),
          );
          const union = new Set([...ca.allowed_tools, ...cb.allowed_tools]);
          const overlap = union.size === 0 ? 0 : sharedTools.length / union.size;
          if (overlap >= 0.8 && sharedProjects.length > 0) {
            out.push({
              a: ids[i]!,
              b: ids[j]!,
              overlap: Number(overlap.toFixed(2)),
              shared_tools: sharedTools,
              shared_projects: sharedProjects,
            });
          }
        }
      }
      return out;
    },
  };

  return registry;
}

export type Registry = ReturnType<typeof createRegistry>;
