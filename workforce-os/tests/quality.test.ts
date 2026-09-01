import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, delegateWork, expectDenial, type Fixture } from './helpers.js';

describe('quality gates and the rework loop', () => {
  let f: Fixture;
  afterEach(() => f?.close());

  it('accepts work that satisfies every criterion', async () => {
    f = createFixture();
    const { packetId } = delegateWork(f);
    const outcome = await f.runtime.execution.runToCompletion({
      packet_id: packetId,
      evaluator_agent_id: f.hardwareMaster.agent_id,
    });
    expect(outcome.outcome.action).toBe('accepted');
    expect(outcome.outcome.passed).toBe(true);
    expect(f.runtime.execution.getTask(outcome.outcome.task_id).status).toBe('completed');
  });

  it('requests rework when an acceptance criterion is unmet', async () => {
    // The agent returns a summary but no findings array.
    f = createFixture({
      'agent.execute': () => ({ text: 'ok', json: { summary: 'Only a summary.' } }),
    });
    const { packetId } = delegateWork(f, {
      acceptanceCriteria: [
        { id: 'has_findings', description: 'At least one finding', check: { kind: 'min_items', path: 'findings', min: 1 } },
      ],
      maxAttempts: 3,
    });

    const execution = await f.runtime.execution.executePacket(packetId);
    const outcome = await f.runtime.quality.reviewDelivery({
      task_id: execution.packet.task_id,
      artifact_id: execution.artifact.artifact_id,
      evaluator_agent_id: f.hardwareMaster.agent_id,
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.action).toBe('rework_requested');
    expect(f.runtime.execution.getTask(execution.packet.task_id).status).toBe('rework');
  });

  it('escalates and opens a CAPA once attempts are exhausted', async () => {
    f = createFixture({
      'agent.execute': () => ({ text: 'ok', json: { summary: 'Never satisfies the criterion.' } }),
    });
    const { packetId, taskId } = delegateWork(f, {
      acceptanceCriteria: [
        { id: 'has_findings', description: 'At least one finding', check: { kind: 'min_items', path: 'findings', min: 1 } },
      ],
      maxAttempts: 2,
    });

    const result = await f.runtime.execution.runToCompletion({
      packet_id: packetId,
      evaluator_agent_id: f.hardwareMaster.agent_id,
      max_cycles: 5,
    });

    expect(result.outcome.action).toBe('escalated');
    expect(f.runtime.execution.getTask(taskId).status).toBe('escalated');

    const capa = f.runtime.quality.listCapa({ task_id: taskId });
    expect(capa.length).toBeGreaterThan(0);
    expect(capa[0]!.state).toBe('open');
    expect(capa[0]!.issue).toContain('failed quality review');
  });

  it('fails the schema gate when output does not match the declared schema', async () => {
    f = createFixture({
      'agent.execute': () => ({ text: 'ok', json: { summary: 'A summary.' } }),
    });
    const { packetId } = delegateWork(f, {
      gates: ['gate.schema'],
      expectedOutputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' }, findings: { type: 'array' } },
        required: ['summary', 'findings'],
      },
    });

    const execution = await f.runtime.execution.executePacket(packetId);
    const evaluation = await f.runtime.quality.evaluate({
      task_id: execution.packet.task_id,
      artifact_id: execution.artifact.artifact_id,
      gate_key: 'gate.schema',
      evaluator_agent_id: f.hardwareMaster.agent_id,
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.results[0]!.findings.join(' ')).toContain('findings');
  });

  it('fails the provenance gate when evidence references do not resolve', async () => {
    f = createFixture();
    const { taskId } = delegateWork(f);
    const task = f.runtime.execution.getTask(taskId);
    const artifact = f.runtime.repos.tasks.insertArtifact({
      task_id: taskId,
      packet_id: null,
      agent_id: f.hardwareMaster.agent_id,
      project_id: task.project_id,
      trace_id: task.trace_id,
      kind: 'result',
      content: { summary: 'Claims with a dangling citation.' },
      provenance: { origin: 'agent', origin_id: f.hardwareMaster.agent_id, evidence_refs: ['art_does_not_exist'] },
      attempt: 1,
    });

    const evaluation = await f.runtime.quality.evaluate({
      task_id: taskId,
      artifact_id: artifact.artifact_id,
      gate_key: 'gate.provenance',
      evaluator_agent_id: f.chief.agent_id,
    });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.results[0]!.findings.join(' ')).toContain('does not resolve');
  });

  it('fails the provenance gate when there is no evidence at all', async () => {
    f = createFixture();
    const { taskId } = delegateWork(f);
    const task = f.runtime.execution.getTask(taskId);
    const artifact = f.runtime.repos.tasks.insertArtifact({
      task_id: taskId,
      packet_id: null,
      agent_id: f.hardwareMaster.agent_id,
      project_id: task.project_id,
      trace_id: task.trace_id,
      kind: 'result',
      content: { summary: 'Unsupported assertion.' },
      provenance: { origin: 'agent', origin_id: f.hardwareMaster.agent_id, evidence_refs: [] },
      attempt: 1,
    });

    const evaluation = await f.runtime.quality.evaluate({
      task_id: taskId,
      artifact_id: artifact.artifact_id,
      gate_key: 'gate.provenance',
      evaluator_agent_id: f.chief.agent_id,
    });
    expect(evaluation.passed).toBe(false);
  });

  it('flags an artifact that contradicts authoritative memory', async () => {
    f = createFixture();
    const { taskId } = delegateWork(f);
    const task = f.runtime.execution.getTask(taskId);

    f.runtime.repos.memory.insert({
      layer: 'authoritative',
      scope_project_id: task.project_id,
      agent_id: null,
      key: 'retention_years',
      content: { value: 7 },
      source: 'owner',
      provenance: { origin: 'human', origin_id: 'owner', trace_id: null, task_id: null, evidence_refs: [], note: '' },
      confidence: null,
      authoritative: true,
      supersedes_id: null,
      ttl_expires_at: null,
    });

    const artifact = f.runtime.repos.tasks.insertArtifact({
      task_id: taskId,
      packet_id: null,
      agent_id: f.hardwareMaster.agent_id,
      project_id: task.project_id,
      trace_id: task.trace_id,
      kind: 'result',
      content: { summary: 'Retention is three years.', claims: { retention_years: 3 } },
      provenance: { origin: 'agent', origin_id: f.hardwareMaster.agent_id, evidence_refs: [] },
      attempt: 1,
    });

    const evaluation = await f.runtime.quality.evaluate({
      task_id: taskId,
      artifact_id: artifact.artifact_id,
      gate_key: 'gate.duplication',
      evaluator_agent_id: f.chief.agent_id,
    });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.results[0]!.findings.join(' ')).toContain('contradicts authoritative memory');
  });

  it('enforces separation of duties on gates that require it', async () => {
    f = createFixture();
    const { packetId, analyst } = delegateWork(f);
    const execution = await f.runtime.execution.executePacket(packetId);
    await expectDenial(
      () =>
        f.runtime.quality.evaluate({
          task_id: execution.packet.task_id,
          artifact_id: execution.artifact.artifact_id,
          gate_key: 'gate.standard_delivery',
          evaluator_agent_id: analyst.agent_id,
        }),
      'DENIED_SEPARATION_OF_DUTIES',
    );
  });

  it('records evaluations append-only', async () => {
    f = createFixture();
    const { packetId } = delegateWork(f);
    await f.runtime.execution.runToCompletion({
      packet_id: packetId,
      evaluator_agent_id: f.hardwareMaster.agent_id,
    });
    expect(() => f.runtime.db.run('UPDATE quality_evaluations SET passed = 0')).toThrow(/append-only/);
    expect(() => f.runtime.db.run('DELETE FROM quality_evaluations')).toThrow(/append-only/);
  });

  it('refuses to close a CAPA with nothing recorded on it', async () => {
    f = createFixture();
    const capa = f.runtime.quality.openCapa({
      project_id: f.projects.hardware.project_id,
      issue: 'Repeated failure on evidence gathering',
    });
    await expectDenial(
      () => f.runtime.quality.updateCapa(capa.capa_id, { state: 'closed' }, 'owner'),
      'VALIDATION_FAILED',
    );
  });

  it('closes a CAPA once cause, actions and verification are recorded', () => {
    f = createFixture();
    const capa = f.runtime.quality.openCapa({
      project_id: f.projects.hardware.project_id,
      issue: 'Repeated failure on evidence gathering',
    });
    const closed = f.runtime.quality.updateCapa(
      capa.capa_id,
      {
        state: 'closed',
        root_cause_hypothesis: 'The packet declared no evidence requirement.',
        corrective_action: 'Added the provenance gate to the loop.',
        preventive_action: 'Template now ships with the provenance gate attached.',
        verification_result: 'Two subsequent runs passed the provenance gate.',
      },
      'owner',
    );
    expect(closed.state).toBe('closed');
  });

  it('uses the model evaluator only where a gate asks for one', async () => {
    f = createFixture();
    const { packetId } = delegateWork(f);
    const before = f.provider.calls.filter((c) => c.purpose === 'quality.model_evaluator').length;
    await f.runtime.execution.runToCompletion({
      packet_id: packetId,
      evaluator_agent_id: f.hardwareMaster.agent_id,
    });
    // gate.acceptance is fully deterministic; no model call should have happened.
    expect(f.provider.calls.filter((c) => c.purpose === 'quality.model_evaluator').length).toBe(before);
  });
});
