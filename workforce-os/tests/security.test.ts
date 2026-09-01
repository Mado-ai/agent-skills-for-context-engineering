import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, expectDenial, makeAnalyst, type Fixture } from './helpers.js';

/**
 * Threat-boundary suite.
 *
 * One test per security property the runtime claims, named after the claim, so
 * a regression reads as "project isolation broke" rather than as an assertion
 * failure somewhere in a larger test. Some assertions overlap other suites
 * deliberately: this file is the surface docs/V04_SECURITY.md points at.
 */

describe('security boundaries', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('default deny: an unregistered tool is refused', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'shell.exec',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'DENIED_TOOL_NOT_ALLOWED',
    );
  });

  it('default deny: an agent with an empty allowlist can do nothing', async () => {
    const agent = f.runtime.registry.createDraft(
      {
        display_name: 'Powerless',
        role_level: 'specialist',
        mission: 'An agent that has been granted no tools at all.',
        parent_agent_id: f.hardwareMaster.agent_id,
        contract: {
          project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
          data_scope: { memory_layers: ['working'], domains: [], excluded_domains: [] },
          allowed_tools: [],
          access_level: 'read',
          activation_mode: 'manual',
        },
      },
      { type: 'owner', id: 'owner' },
    );
    f.runtime.registry.validate(agent.agent_id);
    f.runtime.registry.runTests(agent.agent_id);
    f.runtime.registry.activate(agent.agent_id, 'owner');

    for (const tool of f.runtime.gateway.listTools()) {
      const decision = f.runtime.gateway.dryRun({
        agentId: agent.agent_id,
        toolName: tool.tool_name,
        projectId: f.projects.hardware.project_id,
      });
      expect(decision.allowed).toBe(false);
    }
  });

  it('project isolation: an agent cannot reach another project', async () => {
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
    await expectDenial(
      () => f.runtime.memory.read(analyst.agent_id, { project_id: f.projects.content.project_id }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('project isolation: a master cannot delegate into another master’s project', async () => {
    const contentAnalyst = f.runtime.delegation.instantiateSpecialist(f.contentMaster.agent_id, {
      template_key: 'research-analyst',
      project_id: f.projects.content.project_id,
    }).agent;
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.content.project_id, title: 'Cross-project delegation attempt' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
          task_id: task.task_id,
          receiver_agent_id: contentAnalyst.agent_id,
          intent: 'execute',
          objective: 'Reach into a project I do not hold.',
        }),
      'DENIED_DELEGATION_ESCALATION',
    );
  });

  it('a parent cannot delegate authority it does not hold', async () => {
    const analyst = makeAnalyst(f);
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Authority escalation attempt' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
          task_id: task.task_id,
          receiver_agent_id: analyst.agent_id,
          intent: 'execute',
          objective: 'Commit a payment on my behalf.',
          allowed_tools: ['finance.commit_payment'],
        }),
      'DENIED_DELEGATION_ESCALATION',
    );
  });

  it('a child contract claiming more than its parent fails validation', () => {
    const result = f.runtime.registry.createDraft(
      {
        display_name: 'Over-reaching child',
        role_level: 'specialist',
        mission: 'An agent attempting to claim more authority than its parent holds.',
        parent_agent_id: f.hardwareMaster.agent_id,
        contract: {
          project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
          data_scope: { memory_layers: ['working'], domains: [], excluded_domains: [] },
          allowed_tools: ['finance.commit_payment'],
          access_level: 'admin',
          activation_mode: 'manual',
        },
      },
      { type: 'owner', id: 'owner' },
    );
    const validation = f.runtime.registry.validate(result.agent_id);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['TOOL_ESCALATION', 'ACCESS_ESCALATION']),
    );
  });

  it('an inactive agent cannot execute', async () => {
    const analyst = makeAnalyst(f);
    for (const transition of ['pause', 'retire'] as const) {
      const fresh = makeAnalyst(f);
      if (transition === 'pause') f.runtime.registry.pause(fresh.agent_id, 'owner', 'test');
      else f.runtime.registry.retire(fresh.agent_id, 'owner', 'test');
      await expectDenial(
        () =>
          f.runtime.gateway.call({
            agentId: fresh.agent_id,
            toolName: 'memory.read',
            projectId: f.projects.hardware.project_id,
            args: {},
          }),
        'DENIED_AGENT_INACTIVE',
      );
    }
    // The untouched agent still works, so the denial is about state, not setup.
    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
  });

  it('a draft agent cannot execute even with a perfect contract', async () => {
    const agent = f.runtime.registry.createDraft(
      {
        display_name: 'Still a draft',
        role_level: 'specialist',
        mission: 'A valid contract that has not been activated.',
        parent_agent_id: f.hardwareMaster.agent_id,
        contract: {
          project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
          data_scope: { memory_layers: ['working'], domains: [], excluded_domains: [] },
          allowed_tools: ['memory.read'],
          access_level: 'write',
          activation_mode: 'manual',
        },
      },
      { type: 'owner', id: 'owner' },
    );
    expect(f.runtime.registry.validate(agent.agent_id).valid).toBe(true);
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: agent.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'DENIED_AGENT_INACTIVE',
    );
  });

  it('an agent cannot alter its own contract permissions', async () => {
    await expectDenial(
      () =>
        f.runtime.registry.reviseContract(
          f.hardwareMaster.agent_id,
          { allowed_tools: ['finance.commit_payment'] },
          { type: 'agent', id: f.hardwareMaster.agent_id },
        ),
      'DENIED_SELF_MUTATION',
    );
  });

  it('authoritative memory requires both the grant and human-backed provenance', async () => {
    const analyst = makeAnalyst(f);
    // No grant at all.
    await expectDenial(
      () =>
        f.runtime.memory.write(analyst.agent_id, {
          layer: 'authoritative',
          key: 'x',
          content: {},
          scope_project_id: f.projects.hardware.project_id,
        }),
      'DENIED_DATA_SCOPE',
    );
    // Grant held, but provenance is the agent's own inference.
    await expectDenial(
      () =>
        f.runtime.memory.write(f.chief.agent_id, {
          layer: 'authoritative',
          key: 'x',
          content: {},
          provenance: { origin: 'agent', origin_id: f.chief.agent_id },
        }),
      'DENIED_FORBIDDEN_ACTION',
    );
  });

  it('audit events cannot be updated or deleted through any interface', async () => {
    const analyst = makeAnalyst(f);
    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    expect(f.runtime.audit.list({ limit: 10 }).length).toBeGreaterThan(0);

    // No update or delete method exists on the audit interface at all.
    expect(Object.keys(f.runtime.audit)).toEqual(['append', 'list']);
    expect(() => f.runtime.db.run("UPDATE events SET kind = 'x'")).toThrow(/append-only/);
    expect(() => f.runtime.db.run('DELETE FROM events')).toThrow(/append-only/);
  });

  it('a settled tool call cannot be rewritten', async () => {
    const analyst = makeAnalyst(f);
    const call = await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    expect(() =>
      f.runtime.db.run("UPDATE tool_calls SET decision = 'deny' WHERE call_id = ?", call.call_id),
    ).toThrow(/already settled/);
    expect(() => f.runtime.db.run('DELETE FROM tool_calls')).toThrow(/append-only/);
  });

  it('no agent holds Owner access level', () => {
    for (const agent of f.runtime.repos.agents.listAgents()) {
      if (agent.current_version === 0) continue;
      expect(f.runtime.registry.getContract(agent.agent_id).access_level).not.toBe('owner');
    }
  });

  it('every owner-gated tool needs an approval, for every agent that holds it', () => {
    const gated = f.runtime.gateway
      .listTools()
      .filter((t) => t.requires_owner_approval)
      .map((t) => t.tool_name);
    expect(gated.length).toBeGreaterThan(0);

    for (const agent of f.runtime.repos.agents.listAgents({ status: 'active' })) {
      const contract = f.runtime.registry.getContract(agent.agent_id);
      for (const tool of gated) {
        if (!contract.allowed_tools.includes(tool)) continue;
        const decision = f.runtime.gateway.dryRun({
          agentId: agent.agent_id,
          toolName: tool,
          projectId: contract.project_scope.project_ids[0] ?? f.projects.hardware.project_id,
        });
        expect(decision.allowed).toBe(false);
        expect(decision.requiresApproval).toBe(true);
      }
    }
  });

  it('every denial is recorded before the error reaches the caller', async () => {
    const analyst = makeAnalyst(f);
    await f.runtime.gateway
      .call({
        agentId: analyst.agent_id,
        toolName: 'memory.read',
        projectId: f.projects.content.project_id,
        args: {},
      })
      .catch(() => undefined);

    const denials = f.runtime.gateway.listCalls({ agent_id: analyst.agent_id, decision: 'deny' });
    expect(denials).toHaveLength(1);
    expect(denials[0]!.denial_code).toBe('DENIED_PROJECT_SCOPE');
    expect(denials[0]!.phase).toBe('denied');

    const securityEvents = f.runtime.audit.list({ severity: 'security', limit: 100 });
    expect(securityEvents.some((e) => e.kind === 'tool.denied')).toBe(true);
  });
});

/**
 * Handler-level scope checks.
 *
 * The gateway authorizes against the project on the *request*. A handler that
 * resolves a different project from its own arguments — `args.project_id`, or
 * the project a supplied task belongs to — is acting on something the policy
 * engine never saw. These tests cover that gap for every handler that does it.
 */
describe('handler-level scope enforcement', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('task.create cannot create a task in another project', async () => {
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.contentMaster.agent_id,
          toolName: 'task.create',
          // Authorized against a project this agent does hold …
          projectId: f.projects.content.project_id,
          // … while naming one it does not.
          args: { project_id: f.projects.hardware.project_id, title: 'Smuggled task' },
        }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('report.compose cannot write an artifact into another project’s task', async () => {
    const hardwareTask = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Hardware task' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.contentMaster.agent_id,
          toolName: 'report.compose',
          projectId: f.projects.content.project_id,
          args: { task_id: hardwareTask.task_id, summary: 'Written across a project boundary.' },
        }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('quality.evaluate cannot evaluate another project’s task', async () => {
    const hardwareTask = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Hardware task' },
      { type: 'owner', id: 'owner' },
    );
    const artifact = f.runtime.repos.tasks.insertArtifact({
      task_id: hardwareTask.task_id,
      packet_id: null,
      agent_id: f.hardwareMaster.agent_id,
      project_id: f.projects.hardware.project_id,
      trace_id: hardwareTask.trace_id,
      kind: 'result',
      content: { summary: 'Hardware work.' },
      provenance: { origin: 'agent', origin_id: f.hardwareMaster.agent_id, evidence_refs: [] },
      attempt: 1,
    });

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.contentMaster.agent_id,
          toolName: 'quality.evaluate',
          projectId: f.projects.content.project_id,
          args: {
            task_id: hardwareTask.task_id,
            artifact_id: artifact.artifact_id,
            gate_key: 'gate.acceptance',
          },
        }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  /**
   * `memory.write_authoritative` is defended twice over. Its `high` risk class
   * means the gateway already demands an Owner approval token from any agent
   * whose contract gates at `high` — but that threshold is a contract field an
   * author could set to `critical`, so the memory service independently
   * requires approval-backed provenance. These two tests cover the second
   * layer, with the first already satisfied.
   */
  function approveToolCall(args: Record<string, unknown>) {
    const approval = f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.memory.write_authoritative',
      tool_name: 'memory.write_authoritative',
      project_id: f.projects.hardware.project_id,
      args,
      justification: 'The Owner confirmed this standard applies.',
      risk_class: 'high',
    });
    const decision = f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    return { approvalId: approval.approval_id, token: decision.token! };
  }

  it('the gateway gates authoritative memory on risk class alone', async () => {
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'memory.write_authoritative',
          projectId: f.projects.hardware.project_id,
          args: {
            key: 'policy.ungated',
            content: { value: 'x' },
            source: 'owner',
            evidence_refs: ['apr_none'],
          },
        }),
      'APPROVAL_REQUIRED',
    );
  });

  it('memory.write_authoritative cannot forge human provenance', async () => {
    // The Chief holds the grant and a valid execution token for this exact
    // call. Passing source: "owner" must still not make the write
    // human-sourced, because the evidence names no granted approval.
    const args = {
      key: 'policy.forged',
      content: { value: 'I decided this is canonical' },
      source: 'owner',
      evidence_refs: ['art_not_an_approval'],
    };
    const { token } = approveToolCall(args);

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'memory.write_authoritative',
          projectId: f.projects.hardware.project_id,
          args,
          approvalToken: token,
        }),
      'DENIED_FORBIDDEN_ACTION',
    );
  });

  it('memory.write_authoritative succeeds when the evidence names a granted approval', async () => {
    // Bootstrapping note: the approval that authorises the call is itself the
    // evidence that the Owner sanctioned the promotion.
    const draftArgs = {
      key: 'policy.ratified',
      content: { value: 'an Owner-approved standard' },
      source: 'owner',
      evidence_refs: [] as string[],
    };
    const approval = f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.memory.write_authoritative',
      tool_name: 'memory.write_authoritative',
      project_id: f.projects.hardware.project_id,
      args: { ...draftArgs, evidence_refs: ['self'] },
      justification: 'The Owner confirmed this standard applies.',
      risk_class: 'high',
    });
    const finalArgs = { ...draftArgs, evidence_refs: [approval.approval_id] };

    // Re-request against the exact arguments the call will carry, so the
    // token's fingerprint matches.
    const real = f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.memory.write_authoritative',
      tool_name: 'memory.write_authoritative',
      project_id: f.projects.hardware.project_id,
      args: finalArgs,
      justification: 'The Owner confirmed this standard applies.',
      risk_class: 'high',
    });
    f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    const decision = f.runtime.approvals.decide({
      approval_id: real.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });

    const result = await f.runtime.gateway.call({
      agentId: f.chief.agent_id,
      toolName: 'memory.write_authoritative',
      projectId: f.projects.hardware.project_id,
      args: finalArgs,
      approvalToken: decision.token!,
    });

    const record = f.runtime.memory.get(result.output.memory_id as string)!;
    expect(record.authoritative).toBe(true);
    // The trail records who actually wrote it, not who was claimed.
    expect(record.provenance.origin).toBe('agent');
    expect(record.provenance.origin_id).toBe(f.chief.agent_id);
    expect(record.provenance.evidence_refs).toContain(approval.approval_id);
  });
});
