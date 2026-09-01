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
