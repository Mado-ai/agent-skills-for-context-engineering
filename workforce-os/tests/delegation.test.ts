import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, delegateWork, expectDenial, makeAnalyst, type Fixture } from './helpers.js';

describe('delegation and work packets', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('walks a packet through its full lifecycle', async () => {
    const { packetId } = delegateWork(f);
    expect(f.runtime.delegation.getPacket(packetId).status).toBe('dispatched');

    const result = await f.runtime.execution.executePacket(packetId);
    expect(result.packet.status).toBe('delivered');
    expect(result.artifact.artifact_id).toMatch(/^art_/);

    const task = f.runtime.execution.getTask(result.packet.task_id);
    expect(task.status).toBe('awaiting_review');
  });

  it('refuses an illegal packet transition', async () => {
    const { packetId } = delegateWork(f);
    await expectDenial(
      () => f.runtime.delegation.deliver({ packet_id: packetId, agent_id: 'agt_nobody', content: {} }),
      'DENIED_DEFAULT',
    );
  });

  it('refuses delegation to an agent that is not a descendant', async () => {
    const analyst = makeAnalyst(f);
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Sideways delegation attempt' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.delegation.delegate(analyst.agent_id, {
          task_id: task.task_id,
          receiver_agent_id: f.hardwareMaster.agent_id,
          intent: 'execute',
          objective: 'Delegate upward to my own parent.',
        }),
      'DENIED_DELEGATION_ESCALATION',
    );
  });

  it('refuses delegation to a paused agent', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.registry.pause(analyst.agent_id, 'owner', 'test');
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Delegate to a paused agent' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
          task_id: task.task_id,
          receiver_agent_id: analyst.agent_id,
          intent: 'execute',
          objective: 'Work that cannot be accepted.',
        }),
      'DENIED_AGENT_INACTIVE',
    );
  });

  it('refuses a packet carrying a tool the receiver does not hold', async () => {
    const analyst = makeAnalyst(f);
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Over-scoped packet' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
          task_id: task.task_id,
          receiver_agent_id: analyst.agent_id,
          intent: 'execute',
          objective: 'Instantiate more agents.',
          allowed_tools: ['agent.instantiate'],
        }),
      'DENIED_TOOL_NOT_ALLOWED',
    );
  });

  it('narrows, but never widens, the receiver’s tools', async () => {
    const analyst = makeAnalyst(f);
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Narrowed packet' },
      { type: 'owner', id: 'owner' },
    );
    const packet = f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
      task_id: task.task_id,
      receiver_agent_id: analyst.agent_id,
      intent: 'research',
      objective: 'Read memory only; do not write anything.',
      allowed_tools: ['memory.read'],
    });

    // memory.write is in the analyst's contract but not in this packet.
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.write',
          projectId: f.projects.hardware.project_id,
          packetId: packet.packet_id,
          args: { layer: 'working', key: 'k', content: {} },
        }),
      'DENIED_TOOL_NOT_ALLOWED',
    );
  });

  it('expires a packet past its TTL', () => {
    const { packetId } = delegateWork(f);
    const future = new Date(Date.now() + 10 * 60 * 60 * 1000);
    expect(f.runtime.delegation.expireStale(future)).toBeGreaterThan(0);
    expect(f.runtime.delegation.getPacket(packetId).status).toBe('expired');
  });
});

describe('dynamic specialist instantiation', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('clamps an instance to the parent project scope', () => {
    const analyst = makeAnalyst(f);
    const contract = f.runtime.registry.getContract(analyst.agent_id);
    expect(contract.project_scope.project_ids).toEqual([f.projects.hardware.project_id]);
    expect(contract.project_scope.all_projects).toBe(false);
  });

  it('clamps instance tools to the intersection with the parent', () => {
    const analyst = makeAnalyst(f);
    const parentTools = f.runtime.registry.getContract(f.hardwareMaster.agent_id).allowed_tools;
    for (const tool of f.runtime.registry.getContract(analyst.agent_id).allowed_tools) {
      expect(parentTools).toContain(tool);
    }
  });

  it('refuses a template the parent may not instantiate', async () => {
    await expectDenial(
      () =>
        f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
          template_key: 'content-producer',
          project_id: f.projects.hardware.project_id,
        }),
      'DENIED_DELEGATION_ESCALATION',
    );
  });

  it('refuses a project outside the parent scope', async () => {
    await expectDenial(
      () =>
        f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
          template_key: 'research-analyst',
          project_id: f.projects.content.project_id,
        }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('refuses instantiation by an agent that is not active', async () => {
    f.runtime.registry.pause(f.hardwareMaster.agent_id, 'owner', 'test');
    await expectDenial(
      () =>
        f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
          template_key: 'research-analyst',
          project_id: f.projects.hardware.project_id,
        }),
      'DENIED_AGENT_INACTIVE',
    );
  });

  it('caps the number of live children per parent', async () => {
    const limit = f.runtime.registry.getContract(f.hardwareMaster.agent_id).concurrency_limit * 10;
    for (let i = 0; i < limit; i++) {
      f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
        template_key: 'research-analyst',
        project_id: f.projects.hardware.project_id,
      });
    }
    await expectDenial(
      () =>
        f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
          template_key: 'research-analyst',
          project_id: f.projects.hardware.project_id,
        }),
      'DENIED_CONCURRENCY_LIMIT',
    );
  });

  it('enforces the per-agent instance concurrency limit', async () => {
    const analyst = makeAnalyst(f);
    const limit = f.runtime.registry.getContract(analyst.agent_id).concurrency_limit;
    for (let i = 0; i < limit; i++) f.runtime.registry.acquireInstance({ agentId: analyst.agent_id });
    await expectDenial(() => f.runtime.registry.acquireInstance({ agentId: analyst.agent_id }), 'DENIED_CONCURRENCY_LIMIT');
  });

  it('reaps instances that have been idle past their timeout', () => {
    const analyst = makeAnalyst(f);
    const instance = f.runtime.registry.acquireInstance({ agentId: analyst.agent_id });
    f.runtime.registry.releaseInstance(instance.instance_id, false);
    expect(f.runtime.repos.agents.countLiveInstances(analyst.agent_id)).toBe(1);

    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(f.runtime.registry.reapIdleInstances(later)).toBeGreaterThan(0);
    expect(f.runtime.repos.agents.countLiveInstances(analyst.agent_id)).toBe(0);
  });

  it('retires instantiated specialists with no work and no instances', () => {
    const analyst = makeAnalyst(f);
    const retired = f.runtime.delegation.reapUnusedSpecialists(0, new Date(Date.now() + 60_000));
    expect(retired).toContain(analyst.agent_id);
    expect(f.runtime.registry.getAgent(analyst.agent_id).status).toBe('retired');
  });

  it('leaves declared master agents alone when reaping', () => {
    f.runtime.delegation.reapUnusedSpecialists(0, new Date(Date.now() + 60_000));
    expect(f.runtime.registry.getAgent(f.hardwareMaster.agent_id).status).toBe('active');
    expect(f.runtime.registry.getAgent(f.chief.agent_id).status).toBe('active');
  });
});
