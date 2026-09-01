import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, expectDenial, makeAnalyst, type Fixture } from './helpers.js';

describe('Chief Agent Architect', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('reports across every project, not just one', () => {
    const report = f.runtime.chief.situationReport();
    expect(report.projects).toHaveLength(3);
    expect(report.agents.total).toBeGreaterThanOrEqual(4);
    expect(report.agents.by_role.chief).toBe(1);
  });

  it('is the only agent holding system-wide scope', () => {
    for (const agent of f.runtime.repos.agents.listAgents()) {
      if (agent.current_version === 0) continue;
      const contract = f.runtime.registry.getContract(agent.agent_id);
      if (contract.project_scope.all_projects) expect(contract.role_level).toBe('chief');
    }
  });

  it('challenges a thin objective instead of accepting it', () => {
    const findings = f.runtime.chief.assess({ project_id: f.projects.hardware.project_id, objective: 'do stuff' });
    expect(findings.map((x) => x.kind)).toContain('weak_objective');
  });

  it('blocks on a project that does not exist', () => {
    const findings = f.runtime.chief.assess({ project_id: 'prj_nope', objective: 'A perfectly reasonable objective.' });
    expect(findings[0]!.severity).toBe('blocker');
    expect(findings[0]!.kind).toBe('unknown_project');
  });

  it('flags an exhausted project budget as a blocker', () => {
    f.runtime.budgets.define('project', f.projects.hardware.project_id, { max_tool_calls: 1 });
    f.runtime.budgets.record({ project_id: f.projects.hardware.project_id }, 'tool_call', { tool_calls: 1 });
    const findings = f.runtime.chief.assess({
      project_id: f.projects.hardware.project_id,
      objective: 'A perfectly reasonable objective for this project.',
    });
    expect(findings.some((x) => x.kind === 'budget_exhausted' && x.severity === 'blocker')).toBe(true);
  });

  it('flags pending approvals as blocking work, not merely slowing it', () => {
    f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.publish.external',
      args: {},
      justification: 'waiting on the Owner',
    });
    const findings = f.runtime.chief.assess({
      project_id: f.projects.hardware.project_id,
      objective: 'A perfectly reasonable objective for this project.',
    });
    expect(findings.some((x) => x.kind === 'pending_approvals')).toBe(true);
  });

  it('flags duplicate capability before recommending more capacity', () => {
    makeAnalyst(f);
    makeAnalyst(f);
    const findings = f.runtime.chief.assess({
      project_id: f.projects.hardware.project_id,
      objective: 'A perfectly reasonable objective for this project.',
    });
    expect(findings.some((x) => x.kind === 'duplicate_capability')).toBe(true);
  });

  it('drops proposed roles whose templates it cannot instantiate', async () => {
    const proposal = await f.runtime.chief.proposeTeam({
      project_id: f.projects.hardware.project_id,
      objective: 'Establish a repeatable evidence-capture loop for the actuator programme.',
    });
    // The mock proposes a fabricated template alongside a real one.
    expect(proposal.roles.map((r) => r.template_key)).toEqual(['research-analyst']);
    expect(proposal.findings.some((x) => x.kind === 'proposal_filtered')).toBe(true);
  });

  it('names the Owner decisions a proposal depends on', async () => {
    f.runtime.budgets.define('project', f.projects.hardware.project_id, { max_tool_calls: 1 });
    f.runtime.budgets.record({ project_id: f.projects.hardware.project_id }, 'tool_call', { tool_calls: 1 });
    const proposal = await f.runtime.chief.proposeTeam({
      project_id: f.projects.hardware.project_id,
      objective: 'Establish a repeatable evidence-capture loop for the actuator programme.',
    });
    expect(proposal.requires_owner_decision).toContain('budget_exhausted');
  });

  it('instantiates through the Tool Gateway, so its own contract still binds', async () => {
    const results = await f.runtime.chief.instantiateRoles({
      project_id: f.projects.hardware.project_id,
      template_keys: ['research-analyst'],
    });
    expect(results[0]!.agent_id).toMatch(/^agt_/);

    const calls = f.runtime.gateway.listCalls({ agent_id: f.chief.agent_id });
    expect(calls.some((c) => c.tool_name === 'agent.instantiate' && c.decision === 'allow')).toBe(true);
  });

  it('cannot bypass an Owner gate, even as the Chief', async () => {
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: f.chief.agent_id,
          toolName: 'contract.finalize',
          projectId: f.projects.hardware.project_id,
          args: { project_id: f.projects.hardware.project_id, counterparty: 'Supplier', document_ref: 'doc-1' },
        }),
      'APPROVAL_REQUIRED',
    );
  });

  it('delegates a typed packet rather than free-form instructions', async () => {
    const analyst = makeAnalyst(f);
    // The Chief delegates to a specialist two levels down; still a descendant.
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Chief-delegated work' },
      { type: 'owner', id: 'owner' },
    );
    const packet = await f.runtime.chief.delegate({
      task_id: task.task_id,
      receiver_agent_id: analyst.agent_id,
      objective: 'Assemble the evidence pack for the actuator specification.',
      allowed_tools: ['memory.read'],
    });
    expect(packet.sender_agent_id).toBe(f.chief.agent_id);
    expect(packet.status).toBe('dispatched');
    expect(packet.allowed_tools).toEqual(['memory.read']);
  });

  it('reviews delivered work as an independent evaluator', async () => {
    const analyst = makeAnalyst(f);
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Chief review' },
      { type: 'owner', id: 'owner' },
    );
    const packet = await f.runtime.chief.delegate({
      task_id: task.task_id,
      receiver_agent_id: analyst.agent_id,
      objective: 'Assemble the evidence pack for the actuator specification.',
      allowed_tools: ['memory.read'],
      acceptance_criteria: [
        { id: 'has_summary', description: 'summary present', check: { kind: 'field_present', path: 'summary' } },
      ],
      quality_gate_ids: ['gate.acceptance'],
    });

    const execution = await f.runtime.execution.executePacket(packet.packet_id);
    const outcome = await f.runtime.chief.review({
      task_id: task.task_id,
      artifact_id: execution.artifact.artifact_id,
    });
    expect(outcome.action).toBe('accepted');
    expect(outcome.evaluations[0]!.evaluator_agent_id).toBe(f.chief.agent_id);
  });

  it('recommends a merge with the evidence behind it', () => {
    makeAnalyst(f);
    makeAnalyst(f);
    const consolidation = f.runtime.chief.recommendConsolidation();
    expect(consolidation.merges.length).toBeGreaterThan(0);
    expect(consolidation.merges[0]!.evidence).toHaveProperty('overlap');
    expect(consolidation.merges[0]!.keep).not.toBe(consolidation.merges[0]!.merge);
  });

  it('produces the same findings whether or not a model is consulted', () => {
    const a = f.runtime.chief.assess({ project_id: f.projects.hardware.project_id, objective: 'x' });
    const b = f.runtime.chief.assess({ project_id: f.projects.hardware.project_id, objective: 'x' });
    expect(a.map((x) => x.kind)).toEqual(b.map((x) => x.kind));
    // assess() is pure state analysis; it must not reach the provider at all.
    expect(f.provider.calls.filter((c) => c.purpose.startsWith('chief.'))).toHaveLength(0);
  });
});
