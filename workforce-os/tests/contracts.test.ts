import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, expectDenial, type Fixture } from './helpers.js';
import { validateContract } from '../src/registry/validation.js';
import { canTransition } from '../src/registry/lifecycle.js';

describe('agent contract validation', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  function baseContract(overrides: Record<string, unknown> = {}) {
    return {
      agent_id: 'agt_test',
      display_name: 'Test Specialist',
      role_level: 'specialist',
      version: 1,
      status: 'draft',
      mission: 'A mission long enough to satisfy the minimum length requirement.',
      parent_agent_id: f.hardwareMaster.agent_id,
      project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
      data_scope: { memory_layers: ['working', 'episodic', 'project'], domains: [], excluded_domains: [] },
      allowed_tools: ['memory.read'],
      access_level: 'write',
      concurrency_limit: 1,
      activation_mode: 'manual',
      ...overrides,
    };
  }

  it('accepts a contract that stays inside its parent', () => {
    const result = validateContract(baseContract(), f.runtime.repos);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a tool the parent cannot delegate', () => {
    const result = validateContract(
      baseContract({ allowed_tools: ['memory.read', 'finance.commit_payment'] }),
      f.runtime.repos,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('TOOL_ESCALATION');
  });

  it('rejects an access level above the parent', () => {
    const result = validateContract(baseContract({ access_level: 'admin' }), f.runtime.repos);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('ACCESS_ESCALATION');
  });

  it('rejects a project outside the parent scope', () => {
    const result = validateContract(
      baseContract({ project_scope: { project_ids: [f.projects.content.project_id], all_projects: false } }),
      f.runtime.repos,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('SCOPE_ESCALATION');
  });

  it('rejects system-wide scope for anyone but the Chief', () => {
    const result = validateContract(
      baseContract({ project_scope: { project_ids: [], all_projects: true } }),
      f.runtime.repos,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('SCOPE_ESCALATION');
  });

  it('rejects an agent claiming Owner access level', () => {
    const result = validateContract(baseContract({ access_level: 'owner' }), f.runtime.repos);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('OWNER_LEVEL_AGENT');
  });

  it('rejects an unregistered tool', () => {
    const result = validateContract(baseContract({ allowed_tools: ['shell.exec'] }), f.runtime.repos);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('UNKNOWN_TOOL');
  });

  it('rejects a contract that both allows and forbids the same tool', () => {
    const result = validateContract(
      baseContract({ allowed_tools: ['memory.read'], forbidden_actions: ['memory.read'] }),
      f.runtime.repos,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('CONTRADICTION');
  });

  it('rejects authoritative memory writes below admin access', () => {
    const result = validateContract(
      baseContract({
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project'],
          writable_layers: ['working'],
          may_write_authoritative: true,
        },
      }),
      f.runtime.repos,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('INSUFFICIENT_LEVEL');
  });

  it('rejects an orphan that is not the Chief', () => {
    const result = validateContract(baseContract({ parent_agent_id: null }), f.runtime.repos);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('ORPHAN_AGENT');
  });

  it('rejects a required knowledge source the memory policy cannot read', () => {
    const result = validateContract(
      baseContract({
        required_knowledge_sources: [{ key: 'policy.governance', layer: 'authoritative', required: true }],
        memory_policy: { readable_layers: ['working'], writable_layers: ['working'], may_write_authoritative: false },
      }),
      f.runtime.repos,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('UNREACHABLE_KNOWLEDGE');
  });

  it('warns, without failing, when an agent declares no quality gate', () => {
    const result = validateContract(baseContract(), f.runtime.repos);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('NO_QUALITY_GATE');
  });
});

describe('agent lifecycle', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('permits only the declared transitions', () => {
    expect(canTransition('draft', 'validated')).toBe(true);
    expect(canTransition('validated', 'testing')).toBe(true);
    expect(canTransition('testing', 'approved')).toBe(true);
    expect(canTransition('approved', 'active')).toBe(true);
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
    expect(canTransition('draft', 'active')).toBe(false);
    expect(canTransition('retired', 'active')).toBe(false);
    expect(canTransition('merged', 'active')).toBe(false);
  });

  it('refuses activation before validation', async () => {
    const agent = f.runtime.registry.createDraft(
      {
        display_name: 'Unvalidated',
        role_level: 'specialist',
        mission: 'A mission long enough to satisfy the minimum length requirement.',
        parent_agent_id: f.hardwareMaster.agent_id,
        contract: {
          project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
          data_scope: { memory_layers: ['working', 'episodic', 'project'], domains: [], excluded_domains: [] },
          allowed_tools: ['memory.read'],
          access_level: 'write',
          activation_mode: 'manual',
        },
      },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(() => f.runtime.registry.activate(agent.agent_id, 'owner'), 'CONTRACT_INVALID');
  });

  it('refuses activation after validation but before the required tests', async () => {
    const agent = f.runtime.registry.createDraft(
      {
        display_name: 'Untested',
        role_level: 'specialist',
        mission: 'A mission long enough to satisfy the minimum length requirement.',
        parent_agent_id: f.hardwareMaster.agent_id,
        contract: {
          project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
          data_scope: { memory_layers: ['working', 'episodic', 'project'], domains: [], excluded_domains: [] },
          allowed_tools: ['memory.read'],
          access_level: 'write',
          activation_mode: 'manual',
        },
      },
      { type: 'owner', id: 'owner' },
    );
    expect(f.runtime.registry.validate(agent.agent_id).valid).toBe(true);
    await expectDenial(() => f.runtime.registry.activate(agent.agent_id, 'owner'), 'REQUIRED_TESTS_NOT_PASSED');
  });

  it('activates once validation and tests both pass', () => {
    const agent = f.runtime.registry.createDraft(
      {
        display_name: 'Complete',
        role_level: 'specialist',
        mission: 'A mission long enough to satisfy the minimum length requirement.',
        parent_agent_id: f.hardwareMaster.agent_id,
        contract: {
          project_scope: { project_ids: [f.projects.hardware.project_id], all_projects: false },
          data_scope: { memory_layers: ['working', 'episodic', 'project'], domains: [], excluded_domains: [] },
          allowed_tools: ['memory.read'],
          quality_gates: ['gate.standard_delivery'],
          access_level: 'write',
          activation_mode: 'manual',
        },
      },
      { type: 'owner', id: 'owner' },
    );
    expect(f.runtime.registry.validate(agent.agent_id).valid).toBe(true);
    expect(f.runtime.registry.runTests(agent.agent_id).passed).toBe(true);
    expect(f.runtime.registry.activate(agent.agent_id, 'owner').status).toBe('active');
  });

  it('drops an agent back to draft when its contract is revised', () => {
    const before = f.runtime.registry.getAgent(f.hardwareMaster.agent_id);
    expect(before.status).toBe('active');

    f.runtime.registry.reviseContract(
      f.hardwareMaster.agent_id,
      { concurrency_limit: 5 },
      { type: 'owner', id: 'owner' },
    );

    const after = f.runtime.registry.getAgent(f.hardwareMaster.agent_id);
    expect(after.status).toBe('draft');
    expect(after.current_version).toBe(before.current_version + 1);
  });

  it('refuses to let an agent revise its own contract', async () => {
    await expectDenial(
      () =>
        f.runtime.registry.reviseContract(
          f.hardwareMaster.agent_id,
          { access_level: 'admin' },
          { type: 'agent', id: f.hardwareMaster.agent_id },
        ),
      'DENIED_SELF_MUTATION',
    );
  });

  it('keeps every contract version immutable', () => {
    const versions = f.runtime.repos.agents.listContractVersions(f.chief.agent_id);
    expect(versions.length).toBeGreaterThan(0);
    expect(() =>
      f.runtime.db.run("UPDATE agent_contract_versions SET contract = '{}' WHERE agent_id = ?", f.chief.agent_id),
    ).toThrow(/immutable/);
  });

  it('ends live instances when an agent is paused', () => {
    const analyst = f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
      template_key: 'research-analyst',
      project_id: f.projects.hardware.project_id,
    }).agent;
    f.runtime.registry.acquireInstance({ agentId: analyst.agent_id });
    expect(f.runtime.repos.agents.countLiveInstances(analyst.agent_id)).toBe(1);

    f.runtime.registry.pause(analyst.agent_id, 'owner', 'test');
    expect(f.runtime.repos.agents.countLiveInstances(analyst.agent_id)).toBe(0);
  });
});
