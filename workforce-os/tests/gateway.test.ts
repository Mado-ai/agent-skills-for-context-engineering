import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, expectDenial, makeAnalyst, type Fixture } from './helpers.js';

describe('tool gateway', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('allows a tool inside the contract allowlist', async () => {
    const analyst = makeAnalyst(f);
    const result = await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: { limit: 5 },
    });
    expect(Array.isArray(result.output.records)).toBe(true);
    expect(result.call_id).toMatch(/^call_/);
  });

  it('denies a tool that is not in the allowlist', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'agent.instantiate',
          projectId: f.projects.hardware.project_id,
          args: { template_key: 'research-analyst', project_id: f.projects.hardware.project_id },
        }),
      'DENIED_TOOL_NOT_ALLOWED',
    );
  });

  it('denies a project outside the agent scope', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.content.project_id,
          args: {},
        }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('denies an agent that is not active', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.registry.pause(analyst.agent_id, 'owner', 'test');
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'DENIED_AGENT_INACTIVE',
    );
  });

  it('denies a retired agent', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.registry.retire(analyst.agent_id, 'owner', 'test');
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'DENIED_AGENT_INACTIVE',
    );
  });

  it('denies a disabled tool even when it is allowlisted', async () => {
    f.runtime.registry.reviseContract(
      f.chief.agent_id,
      { allowed_tools: [...f.runtime.registry.getContract(f.chief.agent_id).allowed_tools, 'http.fetch'] },
      { type: 'owner', id: 'owner' },
    );
    // The revision drops the Chief to draft, so re-walk the activation gate.
    f.runtime.registry.validate(f.chief.agent_id);
    f.runtime.registry.runTests(f.chief.agent_id);
    f.runtime.registry.activate(f.chief.agent_id, 'owner');

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'http.fetch',
          projectId: f.projects.hardware.project_id,
          args: { url: 'https://example.com' },
        }),
      'DENIED_TOOL_DISABLED',
    );
  });

  it('denies a forbidden action listed on the contract', async () => {
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.hardwareMaster.agent_id,
          toolName: 'finance.commit_payment',
          projectId: f.projects.hardware.project_id,
          args: { project_id: f.projects.hardware.project_id, amount: 1, currency: 'USD', payee: 'x' },
        }),
      'DENIED_TOOL_NOT_ALLOWED',
    );
  });

  it('reports APPROVAL_REQUIRED rather than a flat denial for owner-gated tools', async () => {
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'publish.external',
          projectId: f.projects.content.project_id,
          args: { project_id: f.projects.content.project_id, channel: 'blog', artifact_id: 'art_x' },
        }),
      'APPROVAL_REQUIRED',
    );
  });

  it('rejects arguments that do not match the declared schema', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.write',
          projectId: f.projects.hardware.project_id,
          args: { layer: 'working' }, // key and content are required
        }),
      'VALIDATION_FAILED',
    );
  });

  it('audits both the denial and the successful call', async () => {
    const analyst = makeAnalyst(f);
    await f.runtime.gateway
      .call({
        agentId: analyst.agent_id,
        toolName: 'agent.instantiate',
        projectId: f.projects.hardware.project_id,
        args: { template_key: 'research-analyst', project_id: f.projects.hardware.project_id },
      })
      .catch(() => undefined);
    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });

    const calls = f.runtime.gateway.listCalls({ agent_id: analyst.agent_id });
    expect(calls.some((c) => c.decision === 'deny' && c.denial_code === 'DENIED_TOOL_NOT_ALLOWED')).toBe(true);
    expect(calls.some((c) => c.decision === 'allow' && c.status === 'ok')).toBe(true);

    const events = f.runtime.audit.list({ limit: 200 }).map((e) => e.kind);
    expect(events).toContain('tool.denied');
    expect(events).toContain('tool.call_succeeded');
  });

  it('registers no shell, filesystem-write or arbitrary-code tool', () => {
    const names = f.runtime.gateway.listTools().map((t) => t.tool_name);
    // Namespace prefixes rather than substrings: "quality.evaluate" legitimately
    // contains "eval", and a substring match would flag it.
    const forbiddenNamespaces = ['shell.', 'bash.', 'fs.', 'file.', 'process.', 'code.', 'script.'];
    const forbiddenNames = ['exec', 'eval', 'shell', 'bash', 'spawn'];
    for (const name of names) {
      const namespace = `${name.split('.')[0]}.`;
      expect(forbiddenNamespaces).not.toContain(namespace);
      expect(forbiddenNames).not.toContain(name);
      expect(forbiddenNames).not.toContain(name.split('.')[1] ?? '');
    }
  });

  it('dry-run reaches the same verdict as the live call, without side effects', async () => {
    const analyst = makeAnalyst(f);
    const before = f.runtime.gateway.listCalls({ agent_id: analyst.agent_id }).length;

    const dry = f.runtime.gateway.dryRun({
      agentId: analyst.agent_id,
      toolName: 'agent.instantiate',
      projectId: f.projects.hardware.project_id,
    });
    expect(dry.allowed).toBe(false);
    expect(dry.code).toBe('DENIED_TOOL_NOT_ALLOWED');
    expect(f.runtime.gateway.listCalls({ agent_id: analyst.agent_id }).length).toBe(before);

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'agent.instantiate',
          projectId: f.projects.hardware.project_id,
          args: { template_key: 'research-analyst', project_id: f.projects.hardware.project_id },
        }),
      'DENIED_TOOL_NOT_ALLOWED',
    );
  });

  it('refuses to let an agent change its own permissions through policy.update', async () => {
    const project = f.projects.hardware.project_id;
    const args = { target_agent_id: f.chief.agent_id, change: { access_level: 'admin' } };
    const approval = f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.policy.update',
      tool_name: 'policy.update',
      project_id: project,
      args,
      justification: 'self-elevation attempt',
      risk_class: 'critical',
    });
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });

    // Even with a valid Owner token, self-mutation is refused.
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'policy.update',
          projectId: project,
          args,
          approvalToken: decision.token!,
        }),
      'DENIED_SELF_MUTATION',
    );
  });
});
