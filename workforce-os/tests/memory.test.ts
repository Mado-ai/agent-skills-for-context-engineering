import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, expectDenial, makeAnalyst, type Fixture } from './helpers.js';

describe('memory layers, precedence and scope', () => {
  let f: Fixture;
  beforeEach(() => {
    f = createFixture();
  });
  afterEach(() => f.close());

  it('lets an agent write and read its own working memory', () => {
    const analyst = makeAnalyst(f);
    const record = f.runtime.memory.write(analyst.agent_id, {
      layer: 'working',
      key: 'scratch.note',
      content: { text: 'interim finding' },
      scope_project_id: f.projects.hardware.project_id,
      confidence: 0.7,
    });
    expect(record.layer).toBe('working');
    expect(record.ttl_expires_at).not.toBeNull();

    const read = f.runtime.memory.read(analyst.agent_id, { key: 'scratch.note' });
    expect(read).toHaveLength(1);
  });

  it('ranks authoritative above every inferred layer', () => {
    const analyst = makeAnalyst(f);
    const project = f.projects.hardware.project_id;

    f.runtime.memory.write(analyst.agent_id, {
      layer: 'episodic',
      key: 'retention.policy',
      content: { value: 3 },
      scope_project_id: project,
      confidence: 0.9,
    });
    f.runtime.repos.memory.insert({
      layer: 'authoritative',
      scope_project_id: project,
      agent_id: null,
      key: 'retention.policy',
      content: { value: 7 },
      source: 'owner',
      provenance: { origin: 'human', origin_id: 'owner', trace_id: null, task_id: null, evidence_refs: [], note: '' },
      confidence: null,
      authoritative: true,
      supersedes_id: null,
      ttl_expires_at: null,
    });

    const winner = f.runtime.memory.resolve(analyst.agent_id, 'retention.policy', project);
    expect(winner?.layer).toBe('authoritative');
    expect(winner?.content).toEqual({ value: 7 });
  });

  it('refuses a write to a layer outside the memory policy', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.memory.write(analyst.agent_id, {
          layer: 'project',
          key: 'k',
          content: {},
          scope_project_id: f.projects.hardware.project_id,
          confidence: 0.9,
        }),
      'DENIED_DATA_SCOPE',
    );
  });

  it('refuses an authoritative write from an agent without the grant', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.memory.write(analyst.agent_id, {
          layer: 'authoritative',
          key: 'policy.forged',
          content: { value: true },
          scope_project_id: f.projects.hardware.project_id,
        }),
      'DENIED_DATA_SCOPE',
    );
  });

  it('refuses an authoritative write with agent-inferred provenance, even from a granted agent', async () => {
    // The Chief holds may_write_authoritative, but provenance still has to be
    // human-sourced or carry a granted Owner approval.
    await expectDenial(
      () =>
        f.runtime.memory.write(f.chief.agent_id, {
          layer: 'authoritative',
          key: 'policy.inferred',
          content: { value: 'I worked this out myself' },
          provenance: { origin: 'agent', origin_id: f.chief.agent_id },
        }),
      'DENIED_FORBIDDEN_ACTION',
    );
  });

  it('permits an authoritative write backed by a granted Owner approval', () => {
    const approval = f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'memory.promote',
      args: { key: 'policy.new_standard' },
      justification: 'Owner confirmed this standard applies.',
      risk_class: 'high',
    });
    f.runtime.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });

    const record = f.runtime.memory.write(f.chief.agent_id, {
      layer: 'authoritative',
      key: 'policy.new_standard',
      content: { value: 'approved standard' },
      source: 'owner',
      provenance: { origin: 'agent', origin_id: f.chief.agent_id, evidence_refs: [approval.approval_id] },
    });
    expect(record.authoritative).toBe(true);
    expect(record.confidence).toBeNull();
  });

  it('denies a cross-project read', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () => f.runtime.memory.read(analyst.agent_id, { project_id: f.projects.content.project_id }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('denies a cross-project write', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.memory.write(analyst.agent_id, {
          layer: 'working',
          key: 'k',
          content: {},
          scope_project_id: f.projects.content.project_id,
          confidence: 0.9,
        }),
      'DENIED_PROJECT_SCOPE',
    );
  });

  it('hides another project’s records from a scoped read', () => {
    const analyst = makeAnalyst(f);
    // Seeded authoritative record scoped to the hardware project only.
    const visible = f.runtime.memory.read(analyst.agent_id, { limit: 100 });
    for (const record of visible) {
      expect(record.scope_project_id === null || record.scope_project_id === f.projects.hardware.project_id).toBe(true);
    }
  });

  it('refuses a lower layer superseding a higher one', async () => {
    const analyst = makeAnalyst(f);
    const authoritative = f.runtime.repos.memory.insert({
      layer: 'authoritative',
      scope_project_id: f.projects.hardware.project_id,
      agent_id: null,
      key: 'standard.x',
      content: { value: 1 },
      source: 'owner',
      provenance: { origin: 'human', origin_id: 'owner', trace_id: null, task_id: null, evidence_refs: [], note: '' },
      confidence: null,
      authoritative: true,
      supersedes_id: null,
      ttl_expires_at: null,
    });

    await expectDenial(
      () =>
        f.runtime.memory.write(analyst.agent_id, {
          layer: 'episodic',
          key: 'standard.x',
          content: { value: 2 },
          scope_project_id: f.projects.hardware.project_id,
          confidence: 0.9,
          supersedes_id: authoritative.memory_id,
        }),
      'DENIED_FORBIDDEN_ACTION',
    );
  });

  it('links a supersession chain in both directions', () => {
    const analyst = makeAnalyst(f);
    const first = f.runtime.memory.write(analyst.agent_id, {
      layer: 'episodic',
      key: 'finding.a',
      content: { value: 1 },
      scope_project_id: f.projects.hardware.project_id,
      confidence: 0.6,
    });
    const second = f.runtime.memory.write(analyst.agent_id, {
      layer: 'episodic',
      key: 'finding.a',
      content: { value: 2 },
      scope_project_id: f.projects.hardware.project_id,
      confidence: 0.9,
      supersedes_id: first.memory_id,
    });

    expect(f.runtime.memory.get(first.memory_id)?.superseded_by_id).toBe(second.memory_id);
    const live = f.runtime.memory.read(analyst.agent_id, { key: 'finding.a' });
    expect(live.map((r) => r.memory_id)).toEqual([second.memory_id]);
  });

  it('refuses a write below the contract’s minimum confidence', async () => {
    const analyst = makeAnalyst(f);
    await expectDenial(
      () =>
        f.runtime.memory.write(analyst.agent_id, {
          layer: 'working',
          key: 'low.confidence',
          content: {},
          scope_project_id: f.projects.hardware.project_id,
          confidence: 0.1,
        }),
      'VALIDATION_FAILED',
    );
  });

  it('sweeps expired working memory', () => {
    const analyst = makeAnalyst(f);
    f.runtime.memory.write(analyst.agent_id, {
      layer: 'working',
      key: 'ephemeral',
      content: {},
      scope_project_id: f.projects.hardware.project_id,
      confidence: 0.9,
      ttl_seconds: 1,
    });
    f.runtime.db.run(
      "UPDATE memory_records SET ttl_expires_at = ? WHERE key = 'ephemeral'",
      new Date(Date.now() - 1000).toISOString(),
    );
    expect(f.runtime.memory.sweepExpired()).toBe(1);
  });

  it('records provenance on every write', () => {
    const analyst = makeAnalyst(f);
    const record = f.runtime.memory.write(analyst.agent_id, {
      layer: 'episodic',
      key: 'observed',
      content: { value: true },
      scope_project_id: f.projects.hardware.project_id,
      confidence: 0.8,
    });
    expect(record.provenance.origin).toBe('agent');
    expect(record.provenance.origin_id).toBe(analyst.agent_id);
  });
});
