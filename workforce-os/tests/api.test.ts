import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type Fixture } from './helpers.js';
import { createApiServer } from '../src/api/server.js';

/**
 * API regression tests. These pin the response envelope and status codes the
 * Control Center depends on: a denial must arrive as a 4xx with the runtime's
 * own error code, never as a 200 with an empty body.
 */

describe('HTTP API', () => {
  let f: Fixture;
  let server: ReturnType<typeof createApiServer>;
  let base: string;

  beforeAll(async () => {
    f = createFixture();
    server = createApiServer({ runtime: f.runtime, port: 0, host: '127.0.0.1' });
    const { port } = await server.listen();
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.close();
    f.close();
  });

  // Response bodies are asserted structurally here rather than typed: these
  // tests exist to pin the wire shape, so re-declaring it in TypeScript would
  // only assert that the test agrees with itself.
  type JsonBody = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  async function get(path: string): Promise<{ status: number; body: JsonBody }> {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: (await res.json()) as JsonBody };
  }

  async function post(path: string, body: unknown): Promise<{ status: number; body: JsonBody }> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as JsonBody };
  }

  it('reports health with real counts', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.counts.active_agents).toBeGreaterThanOrEqual(4);
    expect(body.database.migrations.length).toBeGreaterThanOrEqual(3);
  });

  it('serves the Control Center', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('AI Workforce OS');
  });

  it('returns a consistent error envelope for an unknown route', async () => {
    const { status, body } = await get('/api/does-not-exist');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).toHaveProperty('trace_id');
  });

  it('refuses to serve files outside the UI directory', async () => {
    const res = await fetch(`${base}/../package.json`);
    expect(res.status).toBe(404);
  });

  it('lists agents with their lifecycle state', async () => {
    const { body } = await get('/api/registry/agents');
    expect(body.agents.length).toBeGreaterThanOrEqual(4);
    expect(body.agents.every((a: { status: string }) => typeof a.status === 'string')).toBe(true);
  });

  it('exposes the delegation graph with scope and permissions', async () => {
    const { body } = await get('/api/registry/graph');
    const chief = body.nodes.find((n: { role_level: string }) => n.role_level === 'chief');
    expect(chief.project_scope.all_projects).toBe(true);
    expect(chief.allowed_tools.length).toBeGreaterThan(0);
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it('marks owner-gated tools in the catalogue', async () => {
    const { body } = await get('/api/tools');
    const payment = body.tools.find((t: { tool_name: string }) => t.tool_name === 'finance.commit_payment');
    expect(payment.owner_gated).toBe(true);
    const read = body.tools.find((t: { tool_name: string }) => t.tool_name === 'memory.read');
    expect(read.owner_gated).toBe(false);
  });

  it('returns 403 with a denial code for an unauthorised call', async () => {
    const analyst = f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
      template_key: 'research-analyst',
      project_id: f.projects.hardware.project_id,
    }).agent;

    const { status, body } = await post('/api/tools/call', {
      agent_id: analyst.agent_id,
      tool_name: 'policy.update',
      args: { target_agent_id: f.chief.agent_id, change: {} },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe('DENIED_TOOL_NOT_ALLOWED');
  });

  it('returns 428 when an Owner approval is required', async () => {
    const { status, body } = await post('/api/tools/call', {
      agent_id: f.chief.agent_id,
      tool_name: 'publish.external',
      project_id: f.projects.content.project_id,
      args: { project_id: f.projects.content.project_id, channel: 'blog', artifact_id: 'art_x' },
    });
    expect(status).toBe(428);
    expect(body.error.code).toBe('APPROVAL_REQUIRED');
  });

  it('returns 400 with field detail for invalid input', async () => {
    const { status, body } = await post('/api/projects', { key: 'Not A Valid Key', name: 'x' });
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('rejects a body that is not a JSON object', async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"not an object"',
    });
    expect(res.status).toBe(400);
  });

  it('runs a dry-run authorization without recording a call', async () => {
    const before = f.runtime.gateway.listCalls({ limit: 500 }).length;
    const { status, body } = await post('/api/tools/dry-run', {
      agent_id: f.chief.agent_id,
      tool_name: 'finance.commit_payment',
      project_id: f.projects.hardware.project_id,
    });
    expect(status).toBe(200);
    expect(body.requiresApproval).toBe(true);
    expect(f.runtime.gateway.listCalls({ limit: 500 }).length).toBe(before);
  });

  it('returns the execution token exactly once, on approval', async () => {
    const approval = f.runtime.approvals.request({
      requested_by_agent_id: f.chief.agent_id,
      action: 'tool.finance.commit_payment',
      tool_name: 'finance.commit_payment',
      project_id: f.projects.hardware.project_id,
      args: { project_id: f.projects.hardware.project_id, amount: 10, currency: 'USD', payee: 'x' },
      justification: 'test',
      risk_class: 'critical',
    });

    const decided = await post(`/api/approvals/${approval.approval_id}/decide`, {
      decision: 'approved',
      decided_by: 'owner',
    });
    expect(decided.status).toBe(200);
    expect(decided.body.execution_token).toMatch(/^wtok_/);

    // Re-reading the approval must never echo the plaintext token again.
    const reread = await get(`/api/approvals/${approval.approval_id}`);
    expect(JSON.stringify(reread.body)).not.toContain(decided.body.execution_token);
    expect(reread.body.tokens[0]).not.toHaveProperty('token_hash');
  });

  it('exposes policy so the enforced rules can be checked, not assumed', async () => {
    const { body } = await get('/api/policy');
    expect(body.owner_gated_action_classes.length).toBe(7);
    expect(body.defaults.authorization).toContain('deny by default');
    expect(body.defaults.shell_access).toContain('no shell');
    expect(body.secret_handling.storage).toContain('only references');
  });

  it('never exposes a secret value through the policy endpoint', async () => {
    const { body } = await get('/api/policy');
    const serialized = JSON.stringify(body.secret_handling);
    expect(serialized).not.toContain('token_value');
    for (const ref of body.secret_handling.references as { env_var: string }[]) {
      expect(ref).not.toHaveProperty('value');
      expect(ref.env_var).toMatch(/^WORKFORCE_/);
    }
  });

  it('threads a trace through task, packets, tool calls and events', async () => {
    const analyst = f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
      template_key: 'research-analyst',
      project_id: f.projects.hardware.project_id,
    }).agent;
    const task = f.runtime.execution.createTask(
      { project_id: f.projects.hardware.project_id, title: 'Traced work' },
      { type: 'owner', id: 'owner' },
    );
    const packet = f.runtime.delegation.delegate(f.hardwareMaster.agent_id, {
      task_id: task.task_id,
      receiver_agent_id: analyst.agent_id,
      intent: 'research',
      objective: 'Trace this work end to end.',
    });
    await f.runtime.execution.executePacket(packet.packet_id);

    const { body } = await get(`/api/traces/${task.trace_id}`);
    expect(body.packets.length).toBeGreaterThan(0);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.tasks[0].task_id).toBe(task.task_id);
  });

  it('requires an agent id on a memory write, so every write is attributed', async () => {
    const { status, body } = await post('/api/memory', {
      layer: 'working',
      key: 'anonymous',
      content: {},
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain('agent_id');
  });

  it('scopes an agent-attributed memory read', async () => {
    const analyst = f.runtime.delegation.instantiateSpecialist(f.hardwareMaster.agent_id, {
      template_key: 'research-analyst',
      project_id: f.projects.hardware.project_id,
    }).agent;
    const { status, body } = await get(
      `/api/memory?agent_id=${analyst.agent_id}&project_id=${f.projects.content.project_id}`,
    );
    expect(status).toBe(403);
    expect(body.error.code).toBe('DENIED_PROJECT_SCOPE');
  });

  it('lists every registered route', async () => {
    const { body } = await get('/api/routes');
    const paths = body.routes.map((r: { path: string }) => r.path);
    for (const expected of [
      '/api/health',
      '/api/registry/agents',
      '/api/projects',
      '/api/tasks',
      '/api/packets',
      '/api/quality/gates',
      '/api/capa',
      '/api/memory',
      '/api/tools',
      '/api/approvals',
      '/api/budgets',
      '/api/telemetry/events',
      '/api/policy',
      '/api/chief/report',
    ]) {
      expect(paths).toContain(expected);
    }
  });
});

describe('API authentication posture', () => {
  it('refuses a non-loopback bind without a token', () => {
    const f = createFixture();
    try {
      expect(() => createApiServer({ runtime: f.runtime, host: '0.0.0.0', port: 0 })).toThrow(
        /WORKFORCE_API_TOKEN/,
      );
    } finally {
      f.close();
    }
  });

  it('requires the bearer token when one is configured', async () => {
    const f = createFixture();
    const server = createApiServer({ runtime: f.runtime, port: 0, host: '127.0.0.1', apiToken: 'secret-token' });
    const { port } = await server.listen();
    try {
      const unauthorized = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { authorization: 'Bearer secret-token' },
      });
      expect(authorized.status).toBe(200);
    } finally {
      await server.close();
      f.close();
    }
  });
});
