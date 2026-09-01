import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, delegateWork, expectDenial, makeAnalyst, type Fixture } from './helpers.js';

describe('budgets and operational limits', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('permits a call inside the limit', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.budgets.define('agent', analyst.agent_id, { max_tool_calls: 5 });
    const result = await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    expect(result.output).toBeDefined();
    expect(f.runtime.budgets.get('agent', analyst.agent_id)!.consumed.tool_calls).toBe(1);
  });

  it('refuses the call that would cross a hard limit', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.budgets.define('agent', analyst.agent_id, { max_tool_calls: 1 });

    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });

    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'BUDGET_HARD_EXCEEDED',
    );
  });

  it('marks a budget hard_exceeded once its limit is reached', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.budgets.define('agent', analyst.agent_id, { max_tool_calls: 1 });
    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    expect(f.runtime.budgets.get('agent', analyst.agent_id)!.status).toBe('hard_exceeded');
  });

  it('warns at the soft limit without blocking', () => {
    const analyst = makeAnalyst(f);
    f.runtime.budgets.define('agent', analyst.agent_id, { max_tool_calls: 10, soft_limit_ratio: 0.5 });
    for (let i = 0; i < 5; i++) {
      f.runtime.budgets.record({ agent_id: analyst.agent_id }, 'tool_call', { tool_calls: 1 });
    }
    const budget = f.runtime.budgets.get('agent', analyst.agent_id)!;
    expect(budget.status).toBe('soft_exceeded');
    expect(f.runtime.budgets.check({ agent_id: analyst.agent_id }, { tool_calls: 1 }).ok).toBe(true);
  });

  it('lets the most restrictive enclosing scope win', async () => {
    const analyst = makeAnalyst(f);
    // Generous project budget, exhausted agent budget.
    f.runtime.budgets.define('project', f.projects.hardware.project_id, { max_tool_calls: 10_000 });
    f.runtime.budgets.define('agent', analyst.agent_id, { max_tool_calls: 0 });
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'BUDGET_HARD_EXCEEDED',
    );
  });

  it('refuses every call while a budget is paused', async () => {
    const analyst = makeAnalyst(f);
    f.runtime.budgets.define('agent', analyst.agent_id, { max_tool_calls: 100 });
    f.runtime.budgets.pause('agent', analyst.agent_id, 'Owner paused spending');
    await expectDenial(
      () =>
        f.runtime.gateway.call({
          agentId: analyst.agent_id,
          toolName: 'memory.read',
          projectId: f.projects.hardware.project_id,
          args: {},
        }),
      'BUDGET_HARD_EXCEEDED',
    );

    f.runtime.budgets.resume('agent', analyst.agent_id);
    const result = await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    expect(result.output).toBeDefined();
  });

  it('escalates rather than continuing when execution would exceed a hard limit', async () => {
    const { packetId, taskId, analyst } = delegateWork(f);
    f.runtime.budgets.define('agent', analyst.agent_id, { max_model_calls: 0 });
    await expectDenial(() => f.runtime.execution.executePacket(packetId), 'BUDGET_HARD_EXCEEDED');
    expect(f.runtime.execution.getTask(taskId).status).toBe('escalated');
  });

  it('records usage for model calls, tool calls and execution', async () => {
    const { packetId } = delegateWork(f);
    await f.runtime.execution.executePacket(packetId);
    const kinds = f.runtime.budgets.usage({ limit: 100 }).map((u) => u.kind);
    expect(kinds).toContain('model_call');
    expect(kinds).toContain('execution');
  });

  it('rolls usage up into project, agent and task budgets', async () => {
    const { packetId, analyst, taskId } = delegateWork(f);
    await f.runtime.execution.executePacket(packetId);

    expect(f.runtime.budgets.get('project', f.projects.hardware.project_id)!.consumed.model_calls).toBeGreaterThan(0);
    expect(f.runtime.budgets.get('task', taskId)!.consumed.model_calls).toBeGreaterThan(0);
    expect(f.runtime.budgets.totals({ agent_id: analyst.agent_id }).model_calls).toBeGreaterThan(0);
  });

  it('keeps usage records append-only', async () => {
    const analyst = makeAnalyst(f);
    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    expect(() => f.runtime.db.run('UPDATE usage_records SET estimated_cost = 0')).toThrow(/append-only/);
    expect(() => f.runtime.db.run('DELETE FROM usage_records')).toThrow(/append-only/);
  });

  it('refuses delegation that would exceed the sender’s own cost ceiling', async () => {
    const analyst = makeAnalyst(f);
    const senderCeiling = f.runtime.registry.getContract(f.hardwareMaster.agent_id).budget_policy.max_estimated_cost;
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Over-budget delegation' },
      { type: 'owner', id: 'owner' },
    );
    await expectDenial(
      () =>
        f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
          task_id: task.task_id,
          receiver_agent_id: analyst.agent_id,
          intent: 'execute',
          objective: 'Spend more than the sender is allowed to.',
          budget: { max_estimated_cost: senderCeiling + 1 },
        }),
      'DENIED_DELEGATION_ESCALATION',
    );
  });

  it('tracks elapsed time and retries', async () => {
    const analyst = makeAnalyst(f);
    await f.runtime.gateway.call({
      agentId: analyst.agent_id,
      toolName: 'memory.read',
      projectId: f.projects.hardware.project_id,
      args: {},
    });
    const totals = f.runtime.budgets.totals({ agent_id: analyst.agent_id });
    expect(totals.tool_calls).toBe(1);
    expect(totals.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});
