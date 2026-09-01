import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, expectDenial, type Fixture } from './helpers.js';

describe('owner approvals and execution tokens', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  const paymentArgs = () => ({
    project_id: f.projects.hardware.project_id,
    amount: 2500,
    currency: 'USD',
    payee: 'Parts Supplier',
  });

  function requestPayment(args = paymentArgs()) {
    return f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.finance.commit_payment',
      tool_name: 'finance.commit_payment',
      project_id: f.projects.hardware.project_id,
      args,
      justification: 'Parts order for the actuator test rig.',
      risk_class: 'critical',
    });
  }

  it('records a request without granting anything', () => {
    const approval = requestPayment();
    expect(approval.status).toBe('pending');
    expect(f.runtime.approvals.listTokens(approval.approval_id)).toHaveLength(0);
  });

  it('mints exactly one token on approval', () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    expect(decision.token).toMatch(/^wtok_/);
    expect(f.runtime.approvals.listTokens(approval.approval_id)).toHaveLength(1);
  });

  it('never persists the token itself', () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    const rows = f.runtime.db.all<{ token_hash: string }>('SELECT token_hash FROM approval_tokens');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(decision.token);
    // Nothing in the row, or anywhere else in the database, echoes the plaintext.
    const dump = JSON.stringify(f.runtime.db.all('SELECT * FROM approval_tokens'));
    expect(dump.includes(decision.token!)).toBe(false);
  });

  it('executes exactly once with a valid token', async () => {
    const args = paymentArgs();
    const approval = requestPayment(args);
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });

    const result = await f.runtime.gateway.call({
      agentId: f.chief.agent_id,
      toolName: 'finance.commit_payment',
      projectId: f.projects.hardware.project_id,
      args,
      approvalToken: decision.token!,
    });
    expect(result.output.committed).toBe(true);

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'finance.commit_payment',
          projectId: f.projects.hardware.project_id,
          args,
          approvalToken: decision.token!,
        }),
      'APPROVAL_TOKEN_CONSUMED',
    );
  });

  it('refuses a token replayed against different arguments', async () => {
    const args = paymentArgs();
    const approval = requestPayment(args);
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'finance.commit_payment',
          projectId: f.projects.hardware.project_id,
          args: { ...args, amount: 999_999 },
          approvalToken: decision.token!,
        }),
      'APPROVAL_TOKEN_MISMATCH',
    );
  });

  it('refuses a token replayed against a different tool', async () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'publish.external',
          projectId: f.projects.hardware.project_id,
          args: { project_id: f.projects.hardware.project_id, channel: 'blog', artifact_id: 'art_x' },
          approvalToken: decision.token!,
        }),
      'APPROVAL_TOKEN_MISMATCH',
    );
  });

  it('refuses a token used by a different agent', async () => {
    const args = paymentArgs();
    const approval = requestPayment(args);
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    const verdict = f.runtime.approvals.verifyToken(
      decision.token!,
      f.runtime.gateway.fingerprintFor({
        agentId: f.chief.agent_id,
        toolName: 'finance.commit_payment',
        args,
        projectId: f.projects.hardware.project_id,
      }),
      f.hardwareMaster.agent_id,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('APPROVAL_TOKEN_MISMATCH');
  });

  it('refuses an expired token', async () => {
    const args = paymentArgs();
    const approval = requestPayment(args);
    f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });

    // A token's expiry is immutable once issued — the trigger in migration 002
    // refuses to move it — so this inserts a token that was already expired
    // when it was written, rather than ageing a live one.
    const plaintext = 'wtok_expired_fixture_token';
    f.runtime.repos.governance.insertToken({
      token_id: 'tok_expired_fixture',
      approval_id: approval.approval_id,
      token_hash: createHash('sha256').update(plaintext).digest('hex'),
      action_fingerprint: f.runtime.gateway.fingerprintFor({
        agentId: f.chief.agent_id,
        toolName: 'finance.commit_payment',
        args,
        projectId: f.projects.hardware.project_id,
      }),
      actor_agent_id: f.chief.agent_id,
      project_id: f.projects.hardware.project_id,
      issued_at: new Date(Date.now() - 600_000).toISOString(),
      expires_at: new Date(Date.now() - 300_000).toISOString(),
      consumed_at: null,
      consumed_call_id: null,
      revoked_at: null,
    });

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'finance.commit_payment',
          projectId: f.projects.hardware.project_id,
          args,
          approvalToken: plaintext,
        }),
      'APPROVAL_TOKEN_EXPIRED',
    );
  });

  it('refuses to extend the life of an issued token', () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    expect(() =>
      f.runtime.db.run(
        'UPDATE approval_tokens SET expires_at = ? WHERE token_id = ?',
        new Date(Date.now() + 86_400_000).toISOString(),
        decision.token_id!,
      ),
    ).toThrow(/immutable/);
  });

  it('refuses an unknown token', () => {
    const verdict = f.runtime.approvals.verifyToken('wtok_not_a_real_token', 'anything', f.chief.agent_id);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('APPROVAL_TOKEN_INVALID');
  });

  it('refuses a token after its approval is revoked', async () => {
    const args = paymentArgs();
    const approval = requestPayment(args);
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    f.runtime.approvals.revoke(approval.approval_id, 'owner', 'changed my mind');

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'finance.commit_payment',
          projectId: f.projects.hardware.project_id,
          args,
          approvalToken: decision.token!,
        }),
      'APPROVAL_TOKEN_REVOKED',
    );
  });

  it('mints nothing when the Owner denies', () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'denied',
      decided_by: 'owner',
      decision_note: 'Not this quarter.',
    });
    expect(decision.token).toBeNull();
    expect(f.runtime.approvals.get(approval.approval_id).status).toBe('denied');
  });

  it('refuses to decide the same request twice', async () => {
    const approval = requestPayment();
    f.runtime.approvals.decide({ approval_id: approval.approval_id, decision: 'approved', decided_by: 'owner' });
    await expectDenial(
      () => f.runtime.approvals.decide({ approval_id: approval.approval_id, decision: 'approved', decided_by: 'owner' }),
      'CONFLICT',
    );
  });

  it('expires stale requests and revokes their tokens', () => {
    const approval = requestPayment();
    f.runtime.db.run(
      'UPDATE approvals SET expires_at = ? WHERE approval_id = ?',
      new Date(Date.now() - 1000).toISOString(),
      approval.approval_id,
    );
    expect(f.runtime.approvals.expireStale()).toBe(1);
    expect(f.runtime.approvals.get(approval.approval_id).status).toBe('expired');
  });

  it('writes a security-severity audit trail for the whole flow', async () => {
    const args = paymentArgs();
    const approval = requestPayment(args);
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    await f.runtime.gateway.call({
      agentId: f.chief.agent_id,
      toolName: 'finance.commit_payment',
      projectId: f.projects.hardware.project_id,
      args,
      approvalToken: decision.token!,
    });

    const kinds = f.runtime.audit.list({ limit: 300 }).map((e) => e.kind);
    expect(kinds).toContain('approval.requested');
    expect(kinds).toContain('approval.granted');
    expect(kinds).toContain('approval.token_consumed');
    expect(kinds).toContain('owner_gated.finance_commit_payment');
  });

  it('refuses a second use of a token at the database level', () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    expect(f.runtime.approvals.consumeToken(decision.token_id!, 'call_one')).toBe(true);
    expect(() =>
      f.runtime.db.run(
        'UPDATE approval_tokens SET consumed_at = ? WHERE token_id = ?',
        new Date().toISOString(),
        decision.token_id!,
      ),
    ).toThrow(/already consumed/);
  });

  it('refuses to re-point a token at a different action', () => {
    const approval = requestPayment();
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    expect(() =>
      f.runtime.db.run(
        "UPDATE approval_tokens SET action_fingerprint = 'forged' WHERE token_id = ?",
        decision.token_id!,
      ),
    ).toThrow(/immutable/);
  });
});
