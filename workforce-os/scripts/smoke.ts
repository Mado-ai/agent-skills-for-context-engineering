/**
 * Local smoke test.
 *
 * Boots a throwaway runtime, seeds it, and drives one governed piece of work
 * from creation to acceptance — plus the denial paths that matter. Prints real
 * pass/fail per step and exits non-zero on the first failure.
 *
 *   npm run smoke
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, type Runtime } from '../src/runtime.js';
import { seed } from '../src/db/seed.js';
import { DeterministicMockProvider } from '../src/llm/provider.js';
import { createApiServer } from '../src/api/server.js';
import { RuntimeError } from '../src/domain/index.js';

const steps: { name: string; ok: boolean; detail: string }[] = [];
let failed = false;

async function step(name: string, fn: () => Promise<string> | string): Promise<void> {
  if (failed) {
    steps.push({ name, ok: false, detail: 'skipped after an earlier failure' });
    return;
  }
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail });
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed = true;
    const message = err instanceof RuntimeError ? `${err.code}: ${err.message}` : (err as Error).message;
    steps.push({ name, ok: false, detail: message });
    console.log(`  FAIL  ${name} — ${message}`);
  }
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** Deterministic responses shaped to satisfy the seeded acceptance criteria. */
function provider(): DeterministicMockProvider {
  return new DeterministicMockProvider({
    'agent.execute': () => ({
      text: 'ok',
      json: {
        summary: 'Evidence assembled for the requested question.',
        findings: [
          { claim: 'Test evidence is retained under version control.', support: 'compliance.iso9001.records' },
        ],
      },
    }),
    'chief.propose_team': () => ({
      text: 'ok',
      json: {
        workflow_loops: [{ key: 'evidence-capture', name: 'Evidence Capture', rationale: 'Recurring, not one-off.' }],
        roles: [{ template_key: 'research-analyst', display_name: 'Research Analyst', rationale: 'Gathers cited evidence.' }],
        narrative: 'One reusable loop and one analyst; nothing else is justified by the evidence.',
      },
    }),
  });
}

const dir = mkdtempSync(join(tmpdir(), 'workforce-smoke-'));
const dbPath = join(dir, 'smoke.db');
let runtime: Runtime | undefined;
let api: ReturnType<typeof createApiServer> | undefined;

console.log('AI Workforce OS v0.4 — local smoke test\n');

try {
  let chiefId = '';
  let masterId = '';
  let analystId = '';
  let taskId = '';
  let packetId = '';

  await step('runtime boots and applies migrations', () => {
    runtime = createRuntime({ dbPath, provider: provider() });
    const applied = runtime.db.all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY version');
    expect(applied.length >= 3, 'expected at least 3 migrations');
    return `${applied.length} migrations applied`;
  });

  await step('seed creates a governed organisation', () => {
    const result = seed(runtime!);
    expect(result.seeded, 'seed reported nothing seeded');
    chiefId = runtime!.repos.agents.listAgents({ role_level: 'chief' })[0]!.agent_id;
    const master = runtime!.repos.agents
      .listAgents({ role_level: 'master' })
      .find((m) => m.display_name.includes('Hardware'))!;
    masterId = master.agent_id;
    return `${result.agents.length} agents, ${result.projects} projects, all active`;
  });

  await step('every seeded agent passed validation and required tests', () => {
    for (const agent of runtime!.repos.agents.listAgents({ status: 'active' })) {
      const version = runtime!.repos.agents.getContractVersion(agent.agent_id, agent.current_version)!;
      const validation = version.validation as { valid?: boolean; tests?: { passed?: boolean } };
      expect(validation.valid === true, `${agent.display_name} has no passing validation`);
      expect(validation.tests?.passed === true, `${agent.display_name} has no passing test run`);
    }
    return 'activation gate held for every agent';
  });

  await step('Chief assessment surfaces state-derived findings', () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    const findings = runtime!.chief.assess({ project_id: project.project_id, objective: 'x' });
    expect(findings.some((f) => f.kind === 'weak_objective'), 'expected the thin objective to be challenged');
    return `${findings.length} finding(s), including weak_objective`;
  });

  await step('Master instantiates a specialist from an allowed template', () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    const result = runtime!.delegation.instantiateSpecialist(masterId, {
      template_key: 'research-analyst',
      project_id: project.project_id,
    });
    expect(result.agent.status === 'active', `expected active, got ${result.agent.status}`);
    analystId = result.agent.agent_id;
    return `${result.agent.display_name} is active after validation + tests`;
  });

  await step('instantiating a template outside the parent contract is refused', () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    try {
      runtime!.delegation.instantiateSpecialist(masterId, {
        template_key: 'content-producer',
        project_id: project.project_id,
      });
      throw new Error('expected a denial');
    } catch (err) {
      expect(
        err instanceof RuntimeError && err.code === 'DENIED_DELEGATION_ESCALATION',
        `expected DENIED_DELEGATION_ESCALATION, got ${(err as RuntimeError).code}`,
      );
      return 'DENIED_DELEGATION_ESCALATION';
    }
  });

  await step('task created and delegated as a typed WorkPacket', () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    const task = runtime!.execution.createTask(
      {
        project_id: project.project_id,
        title: 'Capture test evidence for the actuator specification',
        description: 'Assemble cited evidence against the controlling specification.',
      },
      { type: 'owner', id: 'owner' },
    );
    taskId = task.task_id;

    const packet = runtime!.delegation.delegate(masterId, {
      task_id: taskId,
      receiver_agent_id: analystId,
      intent: 'research',
      objective: 'Assemble cited evidence for the actuator specification.',
      allowed_tools: ['memory.read'],
      acceptance_criteria: [
        { id: 'has_summary', description: 'A summary is present', check: { kind: 'field_present', path: 'summary' } },
        { id: 'has_findings', description: 'At least one finding', check: { kind: 'min_items', path: 'findings', min: 1 } },
      ],
      quality_gate_ids: ['gate.acceptance', 'gate.schema'],
    });
    packetId = packet.packet_id;
    return `packet ${packet.packet_id} on trace ${packet.trace_id}`;
  });

  await step('delegating a tool the sender does not hold is refused', () => {
    try {
      runtime!.delegation.delegate(masterId, {
        task_id: taskId,
        receiver_agent_id: analystId,
        intent: 'execute',
        objective: 'Commit a payment for the parts order.',
        allowed_tools: ['finance.commit_payment'],
      });
      throw new Error('expected a denial');
    } catch (err) {
      expect(
        err instanceof RuntimeError && err.code === 'DENIED_DELEGATION_ESCALATION',
        `expected DENIED_DELEGATION_ESCALATION, got ${(err as RuntimeError).code}`,
      );
      return 'DENIED_DELEGATION_ESCALATION';
    }
  });

  await step('execute → evaluate → accept completes the quality loop', async () => {
    const result = await runtime!.execution.runToCompletion({
      packet_id: packetId,
      evaluator_agent_id: masterId,
    });
    expect(result.outcome.action === 'accepted', `expected accepted, got ${result.outcome.action}`);
    const task = runtime!.execution.getTask(taskId);
    expect(task.status === 'completed', `expected completed, got ${task.status}`);
    return `accepted after ${result.cycles} cycle(s), ${result.outcome.evaluations.length} gate(s) passed`;
  });

  await step('an owner-gated tool without a token reports APPROVAL_REQUIRED', async () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    try {
      await runtime!.gateway.call({
        agentId: chiefId,
        toolName: 'finance.commit_payment',
        projectId: project.project_id,
        args: { project_id: project.project_id, amount: 2500, currency: 'USD', payee: 'Parts Supplier' },
      });
      throw new Error('expected APPROVAL_REQUIRED');
    } catch (err) {
      expect(
        err instanceof RuntimeError && err.code === 'APPROVAL_REQUIRED',
        `expected APPROVAL_REQUIRED, got ${(err as RuntimeError).code}`,
      );
      return 'APPROVAL_REQUIRED';
    }
  });

  await step('approval + token executes once, and the replay is refused', async () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    const args = { project_id: project.project_id, amount: 2500, currency: 'USD', payee: 'Parts Supplier' };

    const approval = runtime!.approvals.request({
      requested_by_agent_id: chiefId,
      action: 'tool.finance.commit_payment',
      tool_name: 'finance.commit_payment',
      project_id: project.project_id,
      args,
      justification: 'Parts order for the actuator test rig.',
      risk_class: 'critical',
    });

    const decision = runtime!.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
      decision_note: 'Approved for the test rig only.',
    });
    expect(decision.token, 'no execution token was minted');

    const call = await runtime!.gateway.call({
      agentId: chiefId,
      toolName: 'finance.commit_payment',
      projectId: project.project_id,
      args,
      approvalToken: decision.token!,
    });
    expect(call.output.committed === true, 'payment did not report committed');

    try {
      await runtime!.gateway.call({
        agentId: chiefId,
        toolName: 'finance.commit_payment',
        projectId: project.project_id,
        args,
        approvalToken: decision.token!,
      });
      throw new Error('expected the replay to be refused');
    } catch (err) {
      expect(
        err instanceof RuntimeError && err.code === 'APPROVAL_TOKEN_CONSUMED',
        `expected APPROVAL_TOKEN_CONSUMED, got ${(err as RuntimeError).code}`,
      );
    }
    return 'executed once; replay refused with APPROVAL_TOKEN_CONSUMED';
  });

  await step('a token cannot be reused for different arguments', async () => {
    const project = runtime!.repos.projects.getByKey('hardware-lab')!;
    const args = { project_id: project.project_id, amount: 100, currency: 'USD', payee: 'Supplier A' };
    const approval = runtime!.approvals.request({
      requested_by_agent_id: chiefId,
      action: 'tool.finance.commit_payment',
      tool_name: 'finance.commit_payment',
      project_id: project.project_id,
      args,
      justification: 'Small parts order.',
      risk_class: 'critical',
    });
    const decision = runtime!.approvals.decide({
      approval_id: approval.approval_id,
      decision: 'approved',
      decided_by: 'owner',
    });
    try {
      await runtime!.gateway.call({
        agentId: chiefId,
        toolName: 'finance.commit_payment',
        projectId: project.project_id,
        args: { ...args, amount: 999999 },
        approvalToken: decision.token!,
      });
      throw new Error('expected a fingerprint mismatch');
    } catch (err) {
      expect(
        err instanceof RuntimeError && err.code === 'APPROVAL_TOKEN_MISMATCH',
        `expected APPROVAL_TOKEN_MISMATCH, got ${(err as RuntimeError).code}`,
      );
      return 'APPROVAL_TOKEN_MISMATCH';
    }
  });

  await step('cross-project memory access is denied by default', () => {
    const other = runtime!.repos.projects.getByKey('content-engine')!;
    try {
      runtime!.memory.read(analystId, { project_id: other.project_id });
      throw new Error('expected a scope denial');
    } catch (err) {
      expect(
        err instanceof RuntimeError && err.code === 'DENIED_PROJECT_SCOPE',
        `expected DENIED_PROJECT_SCOPE, got ${(err as RuntimeError).code}`,
      );
      return 'DENIED_PROJECT_SCOPE';
    }
  });

  await step('the audit log refuses to be rewritten', () => {
    try {
      runtime!.db.run("UPDATE events SET kind = 'tampered' WHERE 1=1");
      throw new Error('expected the append-only trigger to fire');
    } catch (err) {
      expect(String((err as Error).message).includes('append-only'), `unexpected error: ${(err as Error).message}`);
      return 'events is append-only at the database level';
    }
  });

  await step('HTTP API serves real runtime state', async () => {
    const server = createApiServer({ runtime: runtime!, port: 0, host: '127.0.0.1' });
    api = server;
    const { port } = await server.listen();

    const health = (await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json())) as {
      status: string;
      counts: { active_agents: number };
    };
    expect(health.status === 'ok', 'health did not report ok');
    expect(health.counts.active_agents >= 4, 'health reported too few active agents');

    // Well-formed arguments, so this tests authorization rather than schema.
    const denied = await fetch(`http://127.0.0.1:${port}/api/tools/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_id: analystId,
        tool_name: 'policy.update',
        args: { target_agent_id: chiefId, change: { access_level: 'admin' } },
      }),
    });
    const body = (await denied.json()) as { error: { code: string } };
    expect(denied.status === 403, `expected 403, got ${denied.status}`);
    expect(body.error.code.startsWith('DENIED_'), `expected a denial code, got ${body.error.code}`);

    const ui = await fetch(`http://127.0.0.1:${port}/`);
    expect(ui.status === 200, 'Control Center did not serve');
    return `health ok, privilege escalation refused with ${body.error.code}, UI served`;
  });
} finally {
  if (api) await api.close();
  if (runtime) (runtime as Runtime).close();
  rmSync(dir, { recursive: true, force: true });
}

const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed}/${steps.length} steps passed.`);
if (failed) {
  console.log('SMOKE TEST FAILED');
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
