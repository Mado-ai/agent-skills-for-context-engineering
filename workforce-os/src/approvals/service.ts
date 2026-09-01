import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Repos } from '../db/repo/index.js';
import type { AuditLog } from '../telemetry/audit.js';
import {
  DecideApprovalInput,
  RequestApprovalInput,
  RuntimeError,
  newId,
  newTraceId,
  nowIso,
  type ApprovalRecord,
} from '../domain/index.js';
import { actionFingerprint, argsFingerprint } from '../policy/fingerprint.js';
import type { TokenVerification } from '../policy/engine.js';

/**
 * Owner approvals and execution tokens.
 *
 * An agent may request any owner-gated action. Execution requires a token that
 * is minted only by an explicit Owner decision and is bound to the exact
 * action, arguments, actor and project. Tokens are single-use and short-lived,
 * and only their hash is stored — the plaintext is returned once, to the
 * approver, and never persisted.
 */

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface ApprovalDeps {
  repos: Repos;
  audit: AuditLog;
}

export interface DecideResult {
  approval: ApprovalRecord;
  /** Present only on approval, and only in this response. */
  token: string | null;
  token_id: string | null;
  expires_at: string | null;
}

export function createApprovalService(deps: ApprovalDeps) {
  const { repos, audit } = deps;

  const service = {
    request(input: unknown): ApprovalRecord {
      const parsed = RequestApprovalInput.safeParse(input);
      if (!parsed.success) {
        throw new RuntimeError('VALIDATION_FAILED', 'invalid approval request', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const req = parsed.data;

      const agent = repos.agents.getAgent(req.requested_by_agent_id);
      if (!agent) {
        throw new RuntimeError('NOT_FOUND', `agent ${req.requested_by_agent_id} not found`);
      }

      const traceId = req.trace_id ?? newTraceId();
      const record = repos.governance.insertApproval({
        approval_id: newId('approval'),
        trace_id: traceId,
        requested_by_agent_id: req.requested_by_agent_id,
        action: req.action,
        tool_name: req.tool_name,
        project_id: req.project_id,
        task_id: req.task_id,
        packet_id: req.packet_id,
        args: req.args,
        args_fingerprint: argsFingerprint(req.args),
        justification: req.justification,
        risk_class: req.risk_class,
        status: 'pending',
        decided_by: null,
        decided_at: null,
        decision_note: null,
        expires_at: new Date(Date.now() + req.request_ttl_seconds * 1000).toISOString(),
      });

      audit.append({
        kind: 'approval.requested',
        actor_type: 'agent',
        actor_id: req.requested_by_agent_id,
        trace_id: traceId,
        project_id: req.project_id,
        subject_type: 'approval',
        subject_id: record.approval_id,
        severity: 'security',
        payload: {
          action: req.action,
          tool_name: req.tool_name,
          risk_class: req.risk_class,
          args_fingerprint: record.args_fingerprint,
        },
      });

      return record;
    },

    get(approvalId: string): ApprovalRecord {
      const record = repos.governance.getApproval(approvalId);
      if (!record) throw new RuntimeError('NOT_FOUND', `approval ${approvalId} not found`);
      return record;
    },

    list(filter: { status?: string; project_id?: string; limit?: number } = {}): ApprovalRecord[] {
      return repos.governance.listApprovals(filter);
    },

    /**
     * The Owner decision. Approving mints exactly one execution token, bound by
     * fingerprint to the action as it was requested.
     */
    decide(input: unknown): DecideResult {
      const parsed = DecideApprovalInput.safeParse(input);
      if (!parsed.success) {
        throw new RuntimeError('VALIDATION_FAILED', 'invalid approval decision', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const decision = parsed.data;
      const approval = service.get(decision.approval_id);

      if (approval.status !== 'pending') {
        throw new RuntimeError('CONFLICT', `approval ${approval.approval_id} is already ${approval.status}`, {
          status: approval.status,
        });
      }
      if (new Date(approval.expires_at).getTime() <= Date.now()) {
        repos.governance.updateApproval(approval.approval_id, { status: 'expired' });
        throw new RuntimeError('APPROVAL_TOKEN_EXPIRED', 'the approval request has lapsed', {
          expires_at: approval.expires_at,
        });
      }

      repos.governance.updateApproval(approval.approval_id, {
        status: decision.decision,
        decided_by: decision.decided_by,
        decided_at: nowIso(),
        decision_note: decision.decision_note,
      });

      if (decision.decision === 'denied') {
        audit.append({
          kind: 'approval.denied',
          actor_type: 'owner',
          actor_id: decision.decided_by,
          trace_id: approval.trace_id,
          project_id: approval.project_id,
          subject_type: 'approval',
          subject_id: approval.approval_id,
          severity: 'security',
          payload: { note: decision.decision_note },
        });
        return { approval: service.get(approval.approval_id), token: null, token_id: null, expires_at: null };
      }

      const token = `wtok_${randomBytes(TOKEN_BYTES).toString('base64url')}`;
      const tokenId = newId('token');
      const expiresAt = new Date(Date.now() + decision.token_ttl_seconds * 1000).toISOString();
      const fingerprint = actionFingerprint({
        action: approval.action,
        tool_name: approval.tool_name,
        args: approval.args,
        actor_agent_id: approval.requested_by_agent_id,
        project_id: approval.project_id,
      });

      repos.governance.insertToken({
        token_id: tokenId,
        approval_id: approval.approval_id,
        token_hash: hashToken(token),
        action_fingerprint: fingerprint,
        actor_agent_id: approval.requested_by_agent_id,
        project_id: approval.project_id,
        issued_at: nowIso(),
        expires_at: expiresAt,
        consumed_at: null,
        consumed_call_id: null,
        revoked_at: null,
      });

      audit.append({
        kind: 'approval.granted',
        actor_type: 'owner',
        actor_id: decision.decided_by,
        trace_id: approval.trace_id,
        project_id: approval.project_id,
        subject_type: 'approval',
        subject_id: approval.approval_id,
        severity: 'security',
        payload: {
          token_id: tokenId,
          expires_at: expiresAt,
          action_fingerprint: fingerprint,
          note: decision.decision_note,
        },
      });

      return { approval: service.get(approval.approval_id), token, token_id: tokenId, expires_at: expiresAt };
    },

    /**
     * Token verification. Every failure mode is distinct so the audit trail
     * says which one happened: a replay against different arguments is not the
     * same event as an expiry.
     */
    verifyToken(token: string, fingerprint: string, agentId: string): TokenVerification {
      const record = repos.governance.findTokenByHash(hashToken(token));
      if (!record) {
        return { ok: false, tokenId: null, code: 'APPROVAL_TOKEN_INVALID', reason: 'no such execution token' };
      }
      if (record.revoked_at) {
        return { ok: false, tokenId: record.token_id, code: 'APPROVAL_TOKEN_REVOKED', reason: 'token was revoked' };
      }
      if (record.consumed_at) {
        return {
          ok: false,
          tokenId: record.token_id,
          code: 'APPROVAL_TOKEN_CONSUMED',
          reason: 'token has already been used',
        };
      }
      if (new Date(record.expires_at).getTime() <= Date.now()) {
        return { ok: false, tokenId: record.token_id, code: 'APPROVAL_TOKEN_EXPIRED', reason: 'token has expired' };
      }
      if (!constantTimeEquals(record.action_fingerprint, fingerprint)) {
        return {
          ok: false,
          tokenId: record.token_id,
          code: 'APPROVAL_TOKEN_MISMATCH',
          reason: 'token was issued for a different action or different arguments',
        };
      }
      if (record.actor_agent_id !== agentId) {
        return {
          ok: false,
          tokenId: record.token_id,
          code: 'APPROVAL_TOKEN_MISMATCH',
          reason: 'token was issued to a different agent',
        };
      }
      const approval = repos.governance.getApproval(record.approval_id);
      if (!approval || approval.status !== 'approved') {
        return {
          ok: false,
          tokenId: record.token_id,
          code: 'APPROVAL_TOKEN_REVOKED',
          reason: `the underlying approval is ${approval?.status ?? 'missing'}`,
        };
      }
      return { ok: true, tokenId: record.token_id, code: null, reason: 'token valid' };
    },

    /** Single-use enforcement. Returns false if another caller got there first. */
    consumeToken(tokenId: string, callId: string): boolean {
      const result = repos.governance.consumeToken(tokenId, callId);
      if (result.changes > 0) {
        audit.append({
          kind: 'approval.token_consumed',
          actor_type: 'system',
          subject_type: 'approval_token',
          subject_id: tokenId,
          severity: 'security',
          payload: { call_id: callId },
        });
        return true;
      }
      return false;
    },

    revoke(approvalId: string, actor: string, reason: string): ApprovalRecord {
      const approval = service.get(approvalId);
      repos.governance.revokeTokensForApproval(approvalId);
      if (approval.status === 'pending' || approval.status === 'approved') {
        repos.governance.updateApproval(approvalId, {
          status: 'revoked',
          decided_by: actor,
          decided_at: nowIso(),
          decision_note: reason,
        });
      }
      audit.append({
        kind: 'approval.revoked',
        actor_type: 'owner',
        actor_id: actor,
        subject_type: 'approval',
        subject_id: approvalId,
        severity: 'security',
        payload: { reason },
      });
      return service.get(approvalId);
    },

    listTokens(approvalId: string) {
      return repos.governance.listTokens(approvalId);
    },

    /** Sweep lapsed requests. Run by the scheduler. */
    expireStale(): number {
      let expired = 0;
      for (const approval of repos.governance.listApprovals({ status: 'pending', limit: 500 })) {
        if (new Date(approval.expires_at).getTime() <= Date.now()) {
          repos.governance.updateApproval(approval.approval_id, { status: 'expired' });
          repos.governance.revokeTokensForApproval(approval.approval_id);
          audit.append({
            kind: 'approval.expired',
            actor_type: 'system',
            subject_type: 'approval',
            subject_id: approval.approval_id,
            severity: 'warn',
          });
          expired++;
        }
      }
      return expired;
    },
  };

  return service;
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
