import { createRuntime, type Runtime } from '../src/runtime.js';
import { seed } from '../src/db/seed.js';
import { DeterministicMockProvider, type MockResponder } from '../src/llm/provider.js';
import type { AgentRecord, ProjectRecord } from '../src/domain/index.js';

/**
 * Test fixtures.
 *
 * Every suite gets its own in-memory database and its own deterministic
 * provider, so nothing leaks between tests and nothing reaches the network.
 * `WORKFORCE_LLM_PROVIDER` is never consulted here: the provider is injected.
 */

export const DEFAULT_RESPONDERS: Record<string, MockResponder> = {
  'agent.execute': () => ({
    text: 'ok',
    json: {
      summary: 'A summary of the requested work, produced deterministically.',
      findings: [{ claim: 'A supported claim.', support: 'evidence' }],
    },
  }),
  'quality.model_evaluator': () => ({
    text: 'ok',
    json: { passed: true, reasons: [] },
  }),
  'chief.propose_team': () => ({
    text: 'ok',
    json: {
      workflow_loops: [{ key: 'proposed-loop', name: 'Proposed Loop', rationale: 'Recurring work.' }],
      roles: [
        { template_key: 'research-analyst', display_name: 'Research Analyst', rationale: 'Gathers evidence.' },
        { template_key: 'not-a-real-template', display_name: 'Fabricated Role', rationale: 'Should be filtered.' },
      ],
      narrative: 'One analyst is enough for this objective.',
    },
  }),
};

export interface Fixture {
  runtime: Runtime;
  provider: DeterministicMockProvider;
  chief: AgentRecord;
  masters: AgentRecord[];
  hardwareMaster: AgentRecord;
  contentMaster: AgentRecord;
  projects: Record<'portfolio' | 'content' | 'hardware', ProjectRecord>;
  close(): void;
}

export function createFixture(overrides: Record<string, MockResponder> = {}): Fixture {
  const provider = new DeterministicMockProvider({ ...DEFAULT_RESPONDERS, ...overrides });
  const runtime = createRuntime({ dbPath: ':memory:', provider });
  seed(runtime);

  const chief = runtime.repos.agents.listAgents({ role_level: 'chief' })[0]!;
  const masters = runtime.repos.agents.listAgents({ role_level: 'master' });

  return {
    runtime,
    provider,
    chief,
    masters,
    hardwareMaster: masters.find((m) => m.display_name.includes('Hardware'))!,
    contentMaster: masters.find((m) => m.display_name.includes('Content'))!,
    projects: {
      portfolio: runtime.repos.projects.getByKey('portfolio-ops')!,
      content: runtime.repos.projects.getByKey('content-engine')!,
      hardware: runtime.repos.projects.getByKey('hardware-lab')!,
    },
    close() {
      runtime.close();
    },
  };
}

/** Instantiate a research analyst under the hardware master. */
export function makeAnalyst(fixture: Fixture): AgentRecord {
  return fixture.runtime.delegation.instantiateSpecialist(fixture.hardwareMaster.agent_id, {
    template_key: 'research-analyst',
    project_id: fixture.projects.hardware.project_id,
  }).agent;
}

export interface DelegatedWork {
  taskId: string;
  packetId: string;
  analyst: AgentRecord;
}

/** A task delegated to a fresh analyst, ready to execute. */
export function delegateWork(
  fixture: Fixture,
  options: {
    acceptanceCriteria?: unknown[];
    gates?: string[];
    expectedOutputSchema?: Record<string, unknown>;
    maxAttempts?: number;
  } = {},
): DelegatedWork {
  const analyst = makeAnalyst(fixture);
  const task = fixture.runtime.execution.createTask(
    {
      project_id: fixture.projects.hardware.project_id,
      title: 'Assemble evidence for the actuator specification',
      description: 'Cited evidence against the controlling specification.',
      max_attempts: options.maxAttempts ?? 3,
    },
    { type: 'owner', id: 'owner' },
  );

  const packet = fixture.runtime.delegation.delegate(fixture.hardwareMaster.agent_id, {
    task_id: task.task_id,
    receiver_agent_id: analyst.agent_id,
    intent: 'research',
    objective: 'Assemble cited evidence for the actuator specification.',
    allowed_tools: ['memory.read'],
    acceptance_criteria: options.acceptanceCriteria ?? [
      { id: 'has_summary', description: 'A summary is present', check: { kind: 'field_present', path: 'summary' } },
    ],
    quality_gate_ids: options.gates ?? ['gate.acceptance'],
    expected_output_schema: options.expectedOutputSchema ?? {},
  });

  return { taskId: task.task_id, packetId: packet.packet_id, analyst };
}

/** Assert that a call throws a RuntimeError with a specific code. */
export async function expectDenial(fn: () => unknown | Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual !== code) {
      throw new Error(`expected ${code}, got ${actual ?? 'no code'}: ${(err as Error).message}`);
    }
    return;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
