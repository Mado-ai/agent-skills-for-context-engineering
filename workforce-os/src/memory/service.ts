import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import {
  MEMORY_PRECEDENCE,
  Provenance,
  RuntimeError,
  WriteMemoryInput,
  type AgentContract,
  type MemoryLayer,
  type MemoryRecord,
} from '../domain/index.js';

/**
 * Four-layer memory with provenance and precedence.
 *
 *   working       — short-lived execution context, TTL'd and swept
 *   episodic      — what happened: past tasks, events, results
 *   project       — reusable project knowledge and decisions
 *   authoritative — verified policy, approved standards, canonical facts
 *
 * Authoritative outranks everything inferred, and nothing an agent infers can
 * quietly become authoritative: promotion needs human-sourced provenance or an
 * Owner approval on the record.
 */

export interface MemoryDeps {
  repos: Repos;
  audit: AuditLog;
}

export interface MemoryReadQuery {
  key?: string;
  key_prefix?: string;
  layer?: MemoryLayer;
  project_id?: string | null;
  include_superseded?: boolean;
  limit?: number;
}

function allowedProjects(contract: AgentContract): string[] | 'all' {
  return contract.project_scope.all_projects ? 'all' : contract.project_scope.project_ids;
}

export function createMemoryService(deps: MemoryDeps) {
  const { repos, audit } = deps;

  function contractFor(agentId: string): AgentContract {
    const agent = repos.agents.getAgent(agentId);
    if (!agent) throw new RuntimeError('NOT_FOUND', `agent ${agentId} not found`);
    const version = repos.agents.getContractVersion(agentId, agent.current_version);
    if (!version) throw new RuntimeError('CONTRACT_INVALID', `agent ${agentId} has no current contract`);
    return version.contract;
  }

  const service = {
    /**
     * Reads are always scope-bound. An agent asking for a project it does not
     * hold gets a denial, not an empty list — silence would hide a
     * misconfiguration.
     */
    read(agentId: string, query: MemoryReadQuery = {}): MemoryRecord[] {
      const contract = contractFor(agentId);
      const projects = allowedProjects(contract);

      if (query.project_id && projects !== 'all' && !projects.includes(query.project_id)) {
        throw new RuntimeError(
          'DENIED_PROJECT_SCOPE',
          `agent ${agentId} cannot read memory scoped to project ${query.project_id}`,
          { project_id: query.project_id },
        );
      }

      if (query.layer && !contract.memory_policy.readable_layers.includes(query.layer)) {
        throw new RuntimeError(
          'DENIED_DATA_SCOPE',
          `agent ${agentId} may not read the ${query.layer} memory layer`,
          { layer: query.layer, readable: contract.memory_policy.readable_layers },
        );
      }

      return repos.memory.query({
        allowedProjectIds: projects,
        allowedLayers: contract.memory_policy.readable_layers,
        key: query.key,
        keyPrefix: query.key_prefix,
        layer: query.layer,
        projectId: query.project_id,
        includeSuperseded: query.include_superseded ?? false,
        limit: query.limit ?? 50,
      });
    },

    /**
     * The record that wins for a key. Authoritative beats project beats
     * episodic beats working; within a layer, most recent wins.
     */
    resolve(agentId: string, key: string, projectId: string | null = null): MemoryRecord | undefined {
      const records = service.read(agentId, {
        key,
        project_id: projectId ?? undefined,
        limit: 50,
      });
      if (records.length === 0) return undefined;
      return records.reduce((best, r) => {
        if (MEMORY_PRECEDENCE[r.layer] > MEMORY_PRECEDENCE[best.layer]) return r;
        if (MEMORY_PRECEDENCE[r.layer] === MEMORY_PRECEDENCE[best.layer] && r.created_at > best.created_at) return r;
        return best;
      });
    },

    write(agentId: string, input: unknown): MemoryRecord {
      const parsed = WriteMemoryInput.safeParse(input);
      if (!parsed.success) {
        throw new RuntimeError('VALIDATION_FAILED', 'invalid memory write', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const req = parsed.data;
      const contract = contractFor(agentId);

      if (!contract.memory_policy.writable_layers.includes(req.layer)) {
        throw new RuntimeError(
          'DENIED_DATA_SCOPE',
          `agent ${agentId} may not write to the ${req.layer} memory layer`,
          { layer: req.layer, writable: contract.memory_policy.writable_layers },
        );
      }

      const projects = allowedProjects(contract);
      if (req.scope_project_id && projects !== 'all' && !projects.includes(req.scope_project_id)) {
        throw new RuntimeError(
          'DENIED_PROJECT_SCOPE',
          `agent ${agentId} cannot write memory scoped to project ${req.scope_project_id}`,
          { project_id: req.scope_project_id },
        );
      }

      const authoritative = req.layer === 'authoritative';
      const provenance = Provenance.parse({
        origin: authoritative ? 'human' : 'agent',
        origin_id: agentId,
        ...req.provenance,
      });

      if (authoritative) {
        if (!contract.memory_policy.may_write_authoritative) {
          throw new RuntimeError(
            'DENIED_DATA_SCOPE',
            `agent ${agentId} is not permitted to write authoritative memory`,
            { agent_id: agentId },
          );
        }
        // The anti-laundering rule: an inferred fact cannot be relabelled as
        // canonical just because a privileged agent is the one writing it.
        const humanSourced = provenance.origin === 'human' || provenance.origin === 'import';
        const approvalRef = provenance.evidence_refs.find((r) => r.startsWith('apr_'));
        const approvalOk = approvalRef
          ? repos.governance.getApproval(approvalRef)?.status === 'approved'
          : false;
        if (!humanSourced && !approvalOk) {
          throw new RuntimeError(
            'DENIED_FORBIDDEN_ACTION',
            'authoritative memory requires human-sourced provenance or a granted Owner approval reference',
            { provenance_origin: provenance.origin, evidence_refs: provenance.evidence_refs },
          );
        }
      } else if (
        req.confidence != null &&
        req.confidence < contract.memory_policy.min_write_confidence
      ) {
        throw new RuntimeError(
          'VALIDATION_FAILED',
          `confidence ${req.confidence} is below this agent's minimum of ${contract.memory_policy.min_write_confidence}`,
          { confidence: req.confidence, minimum: contract.memory_policy.min_write_confidence },
        );
      }

      if (req.supersedes_id) {
        const prior = repos.memory.get(req.supersedes_id);
        if (!prior) {
          throw new RuntimeError('NOT_FOUND', `superseded record ${req.supersedes_id} not found`);
        }
        // A lower layer must not overwrite a higher one by claiming succession.
        if (MEMORY_PRECEDENCE[req.layer] < MEMORY_PRECEDENCE[prior.layer]) {
          throw new RuntimeError(
            'DENIED_FORBIDDEN_ACTION',
            `a ${req.layer} record cannot supersede a ${prior.layer} record`,
            { from: prior.layer, to: req.layer },
          );
        }
      }

      const ttlSeconds =
        req.ttl_seconds ?? (req.layer === 'working' ? contract.memory_policy.working_ttl_seconds : null);

      const record = repos.memory.insert({
        layer: req.layer,
        scope_project_id: req.scope_project_id,
        agent_id: agentId,
        key: req.key,
        content: req.content,
        source: req.source,
        provenance,
        confidence: authoritative ? null : req.confidence,
        authoritative,
        supersedes_id: req.supersedes_id,
        ttl_expires_at: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null,
      });

      audit.append({
        kind: authoritative ? 'memory.authoritative_written' : 'memory.written',
        actor_type: 'agent',
        actor_id: agentId,
        project_id: req.scope_project_id,
        trace_id: provenance.trace_id,
        subject_type: 'memory',
        subject_id: record.memory_id,
        severity: authoritative ? 'security' : 'info',
        payload: {
          layer: req.layer,
          key: req.key,
          supersedes: req.supersedes_id,
          provenance_origin: provenance.origin,
        },
      });

      return record;
    },

    get(memoryId: string): MemoryRecord | undefined {
      return repos.memory.get(memoryId);
    },

    /** Unscoped listing for the Owner-facing Control Center. */
    listAll(limit = 200): MemoryRecord[] {
      return repos.memory.listAll(limit);
    },

    /**
     * Conflicts between an artifact's claims and authoritative memory. The
     * duplication/conflict quality check reads this.
     */
    findConflicts(projectId: string | null, claims: Record<string, unknown>): { key: string; authoritative: unknown; claimed: unknown }[] {
      const conflicts: { key: string; authoritative: unknown; claimed: unknown }[] = [];
      for (const [key, claimed] of Object.entries(claims)) {
        const records = repos.memory.query({
          allowedProjectIds: projectId ? [projectId] : 'all',
          allowedLayers: ['authoritative'],
          key,
          limit: 1,
        });
        const authoritative = records[0];
        if (!authoritative) continue;
        const canonical = (authoritative.content as Record<string, unknown>).value ?? authoritative.content;
        if (JSON.stringify(canonical) !== JSON.stringify(claimed)) {
          conflicts.push({ key, authoritative: canonical, claimed });
        }
      }
      return conflicts;
    },

    sweepExpired(): number {
      const removed = repos.memory.deleteExpired();
      if (removed > 0) {
        audit.append({
          kind: 'memory.swept',
          actor_type: 'system',
          payload: { removed },
        });
      }
      return removed;
    },
  };

  return service;
}

export type MemoryService = ReturnType<typeof createMemoryService>;
