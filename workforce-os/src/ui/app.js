/**
 * Control Center.
 *
 * Every value rendered here comes from an API response. There is no seeded
 * client state, no optimistic update, and no placeholder content: an action
 * re-reads from the backend before it changes what the screen says, and a
 * failure renders the runtime's own error code rather than a generic message.
 */

// ---------------------------------------------------------------- utilities

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const json = (value) => `<pre class="json">${esc(JSON.stringify(value, null, 2))}</pre>`;

function shortTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function relTime(iso) {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return '—';
  const s = Math.round(delta / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const STATUS_TONE = {
  active: 'ok', approved: 'ok', completed: 'ok', accepted_final: 'ok', ok: 'ok', passed: 'ok',
  validated: 'accent', testing: 'accent', running: 'accent', in_progress: 'accent',
  dispatched: 'accent', accepted: 'accent', delivered: 'accent', assigned: 'accent', pending: 'accent',
  draft: '', idle: '', manual: '',
  paused: 'warn', rework: 'warn', rework_requested: 'warn', awaiting_review: 'warn',
  awaiting_approval: 'warn', blocked: 'warn', soft_exceeded: 'warn', open: 'warn',
  investigating: 'warn', action_proposed: 'warn', verifying: 'warn',
  failed: 'bad', escalated: 'bad', denied: 'bad', deny: 'bad', expired: 'bad',
  revoked: 'bad', hard_exceeded: 'bad', rejected: 'bad', retired: 'bad', cancelled: 'bad',
};

const tag = (text, tone) =>
  `<span class="tag ${tone ?? STATUS_TONE[text] ?? ''}">${esc(text)}</span>`;

const idCell = (id, view) =>
  id ? `<a class="id" href="#/${view ?? 'telemetry'}${view ? `/${encodeURIComponent(id)}` : ''}">${esc(id)}</a>` : '<span class="faint">—</span>';

const plainId = (id) => (id ? `<span class="id">${esc(id)}</span>` : '<span class="faint">—</span>');

function table(columns, rows, emptyMessage) {
  if (!rows || rows.length === 0) return `<div class="empty">${esc(emptyMessage ?? 'Nothing to show.')}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function stat(label, value, sub, tone) {
  return `<div class="stat">
    <div class="label">${esc(label)}</div>
    <div class="value ${tone ?? ''}">${esc(value)}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </div>`;
}

function meter(used, limit) {
  if (limit == null || limit === 0) return '<span class="faint">no limit</span>';
  const ratio = Math.min(1, used / limit);
  const tone = ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : '';
  return `<div class="mono">${esc(used)} / ${esc(limit)}</div>
    <div class="meter"><span class="${tone}" style="width:${(ratio * 100).toFixed(1)}%"></span></div>`;
}

// ------------------------------------------------------------------ the API

let lastError = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = payload.error ?? { code: `HTTP_${res.status}`, message: res.statusText };
    lastError = err;
    const error = new Error(err.message);
    error.code = err.code;
    error.details = err.details;
    error.traceId = err.trace_id;
    throw error;
  }
  return payload;
}

function flash(kind, message, extra) {
  const el = document.getElementById('flash');
  const node = document.createElement('div');
  node.className = `flash ${kind}`;
  node.innerHTML = `<span class="dismiss" data-dismiss>✕</span>${message}${extra ? `<div class="faint" style="margin-top:4px">${extra}</div>` : ''}`;
  node.querySelector('[data-dismiss]').addEventListener('click', () => node.remove());
  el.prepend(node);
  if (kind === 'ok') setTimeout(() => node.remove(), 6000);
}

/** Run a backend action, then re-render from the backend's own state. */
async function act(label, fn) {
  try {
    const result = await fn();
    flash('ok', `${esc(label)} — confirmed by the runtime.`);
    await render();
    return result;
  } catch (err) {
    flash(
      'err',
      `${esc(label)} was refused: <code>${esc(err.code ?? 'ERROR')}</code> ${esc(err.message)}`,
      err.traceId ? `trace ${esc(err.traceId)}` : '',
    );
    await render();
    return null;
  }
}

// ------------------------------------------------------------------- views

const views = {};

// 1 -------------------------------------------------------- Command Center
views.command = {
  title: 'Command Center',
  sub: 'Live runtime state across every project, agent and governance surface.',
  group: 'Overview',
  async render() {
    const [health, report, telemetry] = await Promise.all([
      api('/api/health'),
      api('/api/chief/report'),
      api('/api/telemetry/summary'),
    ]);

    const blockers = [];
    if (report.approvals.pending > 0) blockers.push(`${report.approvals.pending} approval(s) awaiting the Owner`);
    if (report.budgets.hard_exceeded > 0) blockers.push(`${report.budgets.hard_exceeded} budget(s) exhausted`);
    if (report.quality.open_capa > 0) blockers.push(`${report.quality.open_capa} open CAPA record(s)`);
    const escalated = report.projects.reduce((n, p) => n + p.escalated_tasks, 0);
    if (escalated > 0) blockers.push(`${escalated} escalated task(s)`);

    return `
      ${blockers.length ? `<div class="notice" style="margin-bottom:14px"><strong>Owner attention required.</strong> ${esc(blockers.join(' · '))}</div>` : ''}
      <div class="grid c4" style="margin-bottom:16px">
        ${stat('Projects', report.projects.length, `${report.projects.filter((p) => p.status === 'active').length} active`)}
        ${stat('Agent definitions', report.agents.total, `${report.agents.by_status.active ?? 0} active`)}
        ${stat('Live instances', report.live_instances, 'elastic execution', report.live_instances > 0 ? 'ok' : '')}
        ${stat('Open tasks', report.projects.reduce((n, p) => n + p.open_tasks, 0), `${escalated} escalated`, escalated ? 'warn' : '')}
        ${stat('Pending approvals', report.approvals.pending, 'Owner-gated', report.approvals.pending ? 'warn' : '')}
        ${stat('Quality failures', report.quality.failures, `of ${report.quality.evaluations} evaluations`, report.quality.failures ? 'warn' : '')}
        ${stat('Denied tool calls', telemetry.tool_calls.denied, `of ${telemetry.tool_calls.total} calls`, telemetry.tool_calls.denied ? 'warn' : '')}
        ${stat('Estimated spend', telemetry.usage.estimated_cost.toFixed(4), `${telemetry.usage.model_calls} model calls`)}
      </div>

      <div class="grid c2">
        <div class="panel">
          <h2>Projects</h2>
          ${table(
            ['Project', 'Status', 'Open', 'Escalated'],
            report.projects.map((p) => [
              `<a class="id" href="#/projects">${esc(p.name)}</a><div class="faint">${esc(p.key)}</div>`,
              tag(p.status),
              `<span class="mono">${p.open_tasks}</span>`,
              p.escalated_tasks ? tag(`${p.escalated_tasks}`, 'bad') : '<span class="faint">0</span>',
            ]),
            'No projects yet.',
          )}
        </div>

        <div class="panel">
          <h2>Most recent policy denials</h2>
          ${table(
            ['Tool', 'Code', 'Agent', 'When'],
            report.recent_denials.map((d) => [
              `<span class="mono">${esc(d.tool_name)}</span>`,
              tag(d.denial_code ?? 'DENIED', 'bad'),
              plainId(d.agent_id),
              `<span class="faint">${esc(relTime(d.started_at))}</span>`,
            ]),
            'No calls have been denied.',
          )}
        </div>

        <div class="panel">
          <h2>Runtime</h2>
          <div class="panel-body">
            <dl class="kv">
              <dt>Version</dt><dd>${esc(health.version)} <span class="tag warn">${esc(health.build)}</span></dd>
              <dt>Model provider</dt><dd><span class="mono">${esc(health.provider.name)}</span> <span class="faint">${esc(health.provider.model)}</span></dd>
              <dt>Database</dt><dd><span class="mono">${esc(health.database.path)}</span></dd>
              <dt>Migrations</dt><dd><span class="mono">${health.database.migrations.length}</span> applied — latest <span class="mono">${esc(health.database.migrations.at(-1)?.name ?? 'none')}</span></dd>
              <dt>Scheduler</dt><dd><span class="mono">${esc(health.scheduler.worker_id)}</span><div class="faint">${esc(health.scheduler.handlers.join(', '))}</div></dd>
            </dl>
          </div>
        </div>

        <div class="panel">
          <h2>Tool call latency</h2>
          <div class="panel-body">
            <div class="grid" style="grid-template-columns:repeat(3,1fr)">
              ${stat('p50', `${telemetry.tool_calls.latency_ms.p50} ms`)}
              ${stat('p95', `${telemetry.tool_calls.latency_ms.p95} ms`)}
              ${stat('max', `${telemetry.tool_calls.latency_ms.max} ms`)}
            </div>
            <div class="muted" style="margin-top:10px">${telemetry.tool_calls.errors} call(s) ended in error or timeout.</div>
          </div>
        </div>
      </div>`;
  },
};

// 2 -------------------------------------------------- Chief Agent Architect
views.chief = {
  title: 'Chief Agent Architect',
  sub: 'The only agent with system-wide visibility. Its findings are derived from runtime state, not from a model’s opinion.',
  group: 'Overview',
  async render(param, state) {
    const [report, consolidation, projects] = await Promise.all([
      api('/api/chief/report'),
      api('/api/chief/consolidation'),
      api('/api/projects'),
    ]);

    const proposal = state?.proposal ?? null;
    const findings = state?.findings ?? null;

    return `
      <div class="grid c2">
        <div class="panel">
          <h2>Ask the Chief</h2>
          <div class="panel-body">
            <div class="field">
              <label for="chief-project">Project</label>
              <select id="chief-project">${projects.projects
                .map((p) => `<option value="${esc(p.project_id)}">${esc(p.name)} (${esc(p.key)})</option>`)
                .join('')}</select>
            </div>
            <div class="field">
              <label for="chief-objective">Objective</label>
              <textarea id="chief-objective" placeholder="What outcome do you want this project to produce repeatedly?">${esc(state?.objective ?? '')}</textarea>
            </div>
            <div class="btnrow">
              <button class="btn" data-action="chief-assess">Assess (state only)</button>
              <button class="btn primary" data-action="chief-propose">Propose a team</button>
            </div>
            <div class="faint" style="margin-top:8px">
              Assess reads registry, budget, quality and approval state. Propose additionally consults the model provider
              and filters every suggestion against what this Chief is contractually allowed to instantiate.
            </div>
          </div>
        </div>

        <div class="panel">
          <h2>Standing findings</h2>
          <div class="panel-body">
            ${
              findings
                ? findings.length
                  ? findings
                      .map(
                        (f) => `<div class="finding ${esc(f.severity)}">
                          <div class="kind">${esc(f.severity)} · ${esc(f.kind)}</div>
                          <div>${esc(f.message)}</div>
                        </div>`,
                      )
                      .join('')
                  : '<div class="empty">No findings. The Chief has nothing to object to.</div>'
                : '<div class="empty">Run an assessment to see what the Chief objects to.</div>'
            }
          </div>
        </div>
      </div>

      ${
        proposal
          ? `<div class="panel" style="margin-top:14px">
              <h2>Proposed team — ${esc(proposal.objective)}</h2>
              <div class="panel-body">
                ${
                  proposal.requires_owner_decision.length
                    ? `<div class="notice" style="margin-bottom:12px"><strong>Owner decision required before this can proceed:</strong> ${esc(proposal.requires_owner_decision.join(', '))}</div>`
                    : ''
                }
                <p class="muted">${esc(proposal.narrative)}</p>
                ${table(
                  ['Template', 'Display name', 'Tools it would hold', 'Gates', ''],
                  proposal.roles.map((r) => [
                    `<span class="mono">${esc(r.template_key)}</span>`,
                    esc(r.display_name),
                    `<div class="taglist">${r.allowed_tools.map((t) => tag(t)).join('') || '<span class="faint">none</span>'}</div>`,
                    `<div class="taglist">${r.quality_gates.map((g) => tag(g, 'accent')).join('') || '<span class="faint">none</span>'}</div>`,
                    `<button class="btn sm primary" data-action="chief-instantiate" data-template="${esc(r.template_key)}" data-project="${esc(proposal.project_id)}">Instantiate</button>`,
                  ]),
                  'No role in this proposal survived the Chief’s own permission filter.',
                )}
                ${
                  proposal.workflow_loops.length
                    ? `<h3 class="muted" style="margin:14px 0 6px">Suggested workflow loops</h3>${table(
                        ['Key', 'Name', 'Rationale'],
                        proposal.workflow_loops.map((l) => [
                          `<span class="mono">${esc(l.key)}</span>`,
                          esc(l.name),
                          `<span class="muted">${esc(l.rationale)}</span>`,
                        ]),
                      )}`
                    : ''
                }
              </div>
            </div>`
          : ''
      }

      <div class="grid c2" style="margin-top:14px">
        <div class="panel">
          <h2>Merge recommendations</h2>
          ${table(
            ['Keep', 'Merge', 'Reason'],
            consolidation.merges.map((m) => [
              plainId(m.keep),
              plainId(m.merge),
              `<span class="muted">${esc(m.reason)}</span>`,
            ]),
            'No duplicate capability detected.',
          )}
        </div>
        <div class="panel">
          <h2>Retirement recommendations</h2>
          ${table(
            ['Agent', 'Reason'],
            consolidation.retirements.map((r) => [plainId(r.agent_id), `<span class="muted">${esc(r.reason)}</span>`]),
            'No idle agents to retire.',
          )}
        </div>
      </div>

      <div class="panel" style="margin-top:14px">
        <h2>Situation report</h2>
        <div class="panel-body">${json(report)}</div>
      </div>`;
  },
  bind(root, rerender) {
    const projectEl = () => root.querySelector('#chief-project');
    const objectiveEl = () => root.querySelector('#chief-objective');

    root.querySelector('[data-action="chief-assess"]')?.addEventListener('click', async (e) => {
      const objective = objectiveEl().value;
      e.target.disabled = true;
      try {
        const result = await api('/api/chief/assess', {
          method: 'POST',
          body: { project_id: projectEl().value, objective },
        });
        rerender({ findings: result.findings, objective });
      } catch (err) {
        flash('err', `Assessment failed: <code>${esc(err.code)}</code> ${esc(err.message)}`);
        e.target.disabled = false;
      }
    });

    root.querySelector('[data-action="chief-propose"]')?.addEventListener('click', async (e) => {
      const objective = objectiveEl().value;
      if (!objective.trim()) {
        flash('err', 'An objective is required. The Chief will not propose against an empty brief.');
        return;
      }
      e.target.disabled = true;
      e.target.textContent = 'Consulting…';
      try {
        const proposal = await api('/api/chief/propose-team', {
          method: 'POST',
          body: { project_id: projectEl().value, objective },
        });
        rerender({ proposal, findings: proposal.findings, objective });
      } catch (err) {
        flash('err', `Proposal failed: <code>${esc(err.code)}</code> ${esc(err.message)}`);
        e.target.disabled = false;
        e.target.textContent = 'Propose a team';
      }
    });

    root.querySelectorAll('[data-action="chief-instantiate"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await act('Instantiate specialist', () =>
          api('/api/chief/instantiate', {
            method: 'POST',
            body: { project_id: btn.dataset.project, template_keys: [btn.dataset.template] },
          }),
        );
        const outcome = result?.results?.[0];
        if (outcome?.error) flash('err', `Template ${esc(btn.dataset.template)} was refused: ${esc(outcome.error)}`);
      });
    });
  },
};

// 3 ------------------------------------------------------------ Agent Factory
views.factory = {
  title: 'Agent Factory',
  sub: 'Draft a contract, validate it, run its required tests, then activate. No agent executes until validation and tests both pass.',
  group: 'Workforce',
  async render() {
    const [agents, templates, tools, gates, projects] = await Promise.all([
      api('/api/registry/agents'),
      api('/api/registry/templates'),
      api('/api/tools'),
      api('/api/quality/gates'),
      api('/api/projects'),
    ]);

    const pipeline = agents.agents.filter((a) => ['draft', 'validated', 'testing', 'approved'].includes(a.status));

    return `
      <div class="panel" style="margin-bottom:14px">
        <h2>Activation pipeline</h2>
        ${table(
          ['Agent', 'Role', 'Stage', 'Version', 'Next step'],
          pipeline.map((a) => [
            `<a class="id" href="#/registry/${esc(a.agent_id)}">${esc(a.display_name)}</a><div class="faint">${esc(a.agent_id)}</div>`,
            tag(a.role_level),
            tag(a.status),
            `<span class="mono">v${a.current_version}</span>`,
            `<div class="btnrow">
              <button class="btn sm" data-step="validate" data-id="${esc(a.agent_id)}" ${a.status !== 'draft' ? 'disabled' : ''}>Validate</button>
              <button class="btn sm" data-step="test" data-id="${esc(a.agent_id)}" ${a.status !== 'validated' ? 'disabled' : ''}>Run tests</button>
              <button class="btn sm primary" data-step="activate" data-id="${esc(a.agent_id)}" ${a.status !== 'approved' ? 'disabled' : ''}>Activate</button>
            </div>`,
          ]),
          'Nothing in the pipeline. Every registered agent is past activation.',
        )}
      </div>

      <div class="grid c2">
        <div class="panel">
          <h2>Draft a new agent</h2>
          <div class="panel-body">
            <div class="field-row">
              <div class="field"><label>Display name</label><input id="nf-name" placeholder="Research Analyst — Hardware"></div>
              <div class="field"><label>Role level</label>
                <select id="nf-role">
                  <option value="specialist">specialist</option>
                  <option value="master">master</option>
                  <option value="ephemeral">ephemeral</option>
                </select>
              </div>
            </div>
            <div class="field"><label>Mission</label><textarea id="nf-mission" placeholder="What this agent is for, in one or two sentences."></textarea></div>
            <div class="field-row">
              <div class="field"><label>Parent agent</label>
                <select id="nf-parent">${agents.agents
                  .filter((a) => a.status === 'active' && a.role_level !== 'specialist')
                  .map((a) => `<option value="${esc(a.agent_id)}">${esc(a.display_name)}</option>`)
                  .join('')}</select>
              </div>
              <div class="field"><label>Project scope</label>
                <select id="nf-project">${projects.projects
                  .map((p) => `<option value="${esc(p.project_id)}">${esc(p.name)}</option>`)
                  .join('')}</select>
              </div>
            </div>
            <div class="field-row">
              <div class="field"><label>Access level</label>
                <select id="nf-access"><option>read</option><option selected>write</option><option>admin</option></select>
              </div>
              <div class="field"><label>Concurrency limit</label><input id="nf-concurrency" type="number" value="1" min="1"></div>
            </div>
            <div class="field">
              <label>Allowed tools — a child can never hold a tool its parent lacks</label>
              <div class="taglist" id="nf-tools">
                ${tools.tools
                  .map(
                    (t) => `<label class="tag ${t.owner_gated ? 'security' : ''}" style="cursor:pointer">
                      <input type="checkbox" value="${esc(t.tool_name)}" style="width:auto;margin-right:4px">${esc(t.tool_name)}${t.owner_gated ? ' ⚿' : ''}
                    </label>`,
                  )
                  .join('')}
              </div>
            </div>
            <div class="field">
              <label>Quality gates</label>
              <div class="taglist" id="nf-gates">
                ${gates.gates
                  .map(
                    (g) => `<label class="tag accent" style="cursor:pointer">
                      <input type="checkbox" value="${esc(g.key)}" style="width:auto;margin-right:4px" ${g.key === 'gate.standard_delivery' ? 'checked' : ''}>${esc(g.key)}
                    </label>`,
                  )
                  .join('')}
              </div>
            </div>
            <button class="btn primary" data-action="draft">Create draft</button>
            <div class="faint" style="margin-top:8px">A draft cannot execute. It must pass validation and its required tests first.</div>
          </div>
        </div>

        <div class="panel">
          <h2>Templates — definitions, not running agents</h2>
          ${table(
            ['Key', 'Role', 'Description', 'Status'],
            templates.templates.map((t) => [
              `<span class="mono">${esc(t.key)}</span>`,
              tag(t.role_level),
              `<span class="muted">${esc(t.description)}</span>`,
              tag(t.status),
            ]),
            'No templates registered.',
          )}
          <div class="panel-body">
            <div class="notice">A template is a reusable definition. It consumes nothing until an authorised parent
            instantiates it against real work, and the instance is clamped to that parent’s scope and tools.</div>
          </div>
        </div>
      </div>`;
  },
  bind(root) {
    root.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const step = btn.dataset.step;
        btn.disabled = true;
        if (step === 'validate') {
          const result = await act('Contract validation', () =>
            api(`/api/registry/agents/${id}/validate`, { method: 'POST' }),
          );
          if (result && !result.valid) {
            flash('err', `Validation failed: ${esc(result.issues.map((i) => `${i.field}: ${i.message}`).join(' · '))}`);
          }
        } else if (step === 'test') {
          const result = await act('Required tests', () => api(`/api/registry/agents/${id}/test`, { method: 'POST' }));
          if (result && !result.passed) {
            flash('err', `Tests failed: ${esc(result.cases.filter((c) => !c.passed).map((c) => c.name).join(', '))}`);
          }
        } else {
          await act('Activation', () => api(`/api/registry/agents/${id}/activate`, { method: 'POST' }));
        }
      });
    });

    root.querySelector('[data-action="draft"]')?.addEventListener('click', async (btn) => {
      const pick = (sel) => [...root.querySelectorAll(`${sel} input:checked`)].map((i) => i.value);
      const value = (id) => root.querySelector(id).value;
      btn.target.disabled = true;
      await act('Draft creation', () =>
        api('/api/registry/agents', {
          method: 'POST',
          body: {
            display_name: value('#nf-name'),
            role_level: value('#nf-role'),
            mission: value('#nf-mission'),
            parent_agent_id: value('#nf-parent'),
            contract: {
              project_scope: { project_ids: [value('#nf-project')], all_projects: false },
              allowed_tools: pick('#nf-tools'),
              quality_gates: pick('#nf-gates'),
              access_level: value('#nf-access'),
              concurrency_limit: Number(value('#nf-concurrency')),
              activation_mode: 'manual',
            },
          },
        }),
      );
    });
  },
};

// 4 ----------------------------------------------------------- Agent Registry
views.registry = {
  title: 'Agent Registry',
  sub: 'Every agent definition, its contract version, its permissions and its live instances.',
  group: 'Workforce',
  async render(agentId) {
    if (agentId) return renderAgentDetail(agentId);

    const [agents, duplicates] = await Promise.all([
      api('/api/registry/agents'),
      api('/api/registry/duplicates'),
    ]);
    const graph = await api('/api/registry/graph');
    const byId = new Map(graph.nodes.map((n) => [n.agent_id, n]));

    return `
      ${
        duplicates.duplicates.length
          ? `<div class="notice" style="margin-bottom:14px"><strong>${duplicates.duplicates.length} duplicate capability pair(s)</strong> detected. See Chief Agent Architect for merge recommendations.</div>`
          : ''
      }
      <div class="panel">
        <h2>Agents <span class="faint">${agents.agents.length} definitions</span></h2>
        ${table(
          ['Agent', 'Role', 'Status', 'Origin', 'Scope', 'Access', 'Tools', 'Instances'],
          agents.agents.map((a) => {
            const node = byId.get(a.agent_id);
            const scope = node?.project_scope;
            return [
              `<a class="id" href="#/registry/${esc(a.agent_id)}">${esc(a.display_name)}</a><div class="faint">${esc(a.agent_id)}</div>`,
              tag(a.role_level),
              tag(a.status),
              a.template_id ? tag('instantiated', 'accent') : tag('declared'),
              scope?.all_projects
                ? tag('all projects', 'security')
                : `<div class="taglist">${(node?.project_keys ?? []).map((p) => tag(p)).join('') || '<span class="faint">none</span>'}</div>`,
              node?.access_level ? tag(node.access_level) : '<span class="faint">—</span>',
              `<span class="mono">${node?.allowed_tools.length ?? 0}</span>`,
              `<span class="mono">${node?.live_instances ?? 0}</span><span class="faint"> / ${node?.concurrency_limit ?? '—'}</span>`,
            ];
          }),
          'No agents registered.',
        )}
      </div>`;
  },
};

async function renderAgentDetail(agentId) {
  const [detail, projects] = await Promise.all([
    api(`/api/registry/agents/${encodeURIComponent(agentId)}`),
    api('/api/projects'),
  ]);
  const projectKey = new Map(projects.projects.map((p) => [p.project_id, p.key]));
  const c = detail.contract;
  const budget = await api(`/api/budgets?scope_type=agent&scope_id=${encodeURIComponent(agentId)}`);
  const b = budget.budgets[0];

  return `
    <div class="btnrow" style="margin-bottom:12px">
      <a class="btn sm" href="#/registry">← All agents</a>
      <button class="btn sm" data-lifecycle="pause" data-id="${esc(agentId)}" ${detail.agent.status !== 'active' ? 'disabled' : ''}>Pause</button>
      <button class="btn sm" data-lifecycle="activate" data-id="${esc(agentId)}" ${!['approved', 'paused'].includes(detail.agent.status) ? 'disabled' : ''}>Activate</button>
      <button class="btn sm danger" data-lifecycle="retire" data-id="${esc(agentId)}" ${['retired', 'merged'].includes(detail.agent.status) ? 'disabled' : ''}>Retire</button>
    </div>

    <div class="grid c2">
      <div class="panel">
        <h2>${esc(detail.agent.display_name)}</h2>
        <div class="panel-body">
          <dl class="kv">
            <dt>Agent ID</dt><dd class="mono">${esc(detail.agent.agent_id)}</dd>
            <dt>Role</dt><dd>${tag(detail.agent.role_level)}</dd>
            <dt>Status</dt><dd>${tag(detail.agent.status)}</dd>
            <dt>Contract</dt><dd class="mono">v${detail.agent.current_version} of ${detail.versions.length}</dd>
            <dt>Parent</dt><dd>${detail.agent.parent_agent_id ? `<a class="id" href="#/registry/${esc(detail.agent.parent_agent_id)}">${esc(detail.agent.parent_agent_id)}</a>` : '<span class="faint">reports to the Owner</span>'}</dd>
            <dt>Origin</dt><dd>${detail.agent.template_id ? tag('instantiated from template', 'accent') : tag('declared definition')}</dd>
            <dt>Mission</dt><dd>${esc(c?.mission ?? '—')}</dd>
          </dl>
        </div>
      </div>

      <div class="panel">
        <h2>Permissions</h2>
        <div class="panel-body">
          <dl class="kv">
            <dt>Access level</dt><dd>${c ? tag(c.access_level) : '—'}</dd>
            <dt>Project scope</dt><dd>${
              c?.project_scope.all_projects
                ? tag('all projects', 'security')
                : `<div class="taglist">${(c?.project_scope.project_ids ?? []).map((p) => tag(projectKey.get(p) ?? p)).join('') || '<span class="faint">none</span>'}</div>`
            }</dd>
            <dt>Allowed tools</dt><dd><div class="taglist">${(c?.allowed_tools ?? []).map((t) => tag(t)).join('') || '<span class="faint">none</span>'}</div></dd>
            <dt>Forbidden</dt><dd><div class="taglist">${(c?.forbidden_actions ?? []).map((t) => tag(t, 'bad')).join('') || '<span class="faint">none</span>'}</div></dd>
            <dt>Approval at</dt><dd>${c ? tag(c.human_approval_requirements.approval_required_at_or_above, 'warn') : '—'} <span class="faint">risk and above</span></dd>
            <dt>Memory write</dt><dd><div class="taglist">${(c?.memory_policy.writable_layers ?? []).map((l) => tag(l)).join('')}${c?.memory_policy.may_write_authoritative ? tag('authoritative ⚿', 'security') : ''}</div></dd>
            <dt>Child templates</dt><dd><div class="taglist">${(c?.allowed_child_templates ?? []).map((t) => tag(t, 'accent')).join('') || '<span class="faint">cannot instantiate</span>'}</div></dd>
          </dl>
        </div>
      </div>

      <div class="panel">
        <h2>Live instances <span class="faint">definition vs runtime</span></h2>
        ${table(
          ['Instance', 'Status', 'Mode', 'Task', 'Last active'],
          detail.instances.slice(0, 20).map((i) => [
            `<span class="id">${esc(i.instance_id)}</span>`,
            tag(i.status),
            tag(i.activation_mode),
            plainId(i.task_id),
            `<span class="faint">${esc(relTime(i.last_active_at))}</span>`,
          ]),
          'No instances have run. The definition exists; nothing is executing.',
        )}
      </div>

      <div class="panel">
        <h2>Budget and limits</h2>
        <div class="panel-body">
          ${
            b
              ? `<dl class="kv">
                  <dt>Status</dt><dd>${tag(b.status)}</dd>
                  <dt>Model calls</dt><dd>${meter(b.consumed.model_calls, b.limits.max_model_calls)}</dd>
                  <dt>Tool calls</dt><dd>${meter(b.consumed.tool_calls, b.limits.max_tool_calls)}</dd>
                  <dt>Est. cost</dt><dd>${meter(Number(b.consumed.estimated_cost.toFixed(4)), b.limits.max_estimated_cost)}</dd>
                </dl>`
              : '<div class="empty">No agent-level budget defined.</div>'
          }
          <div class="faint" style="margin-top:10px">Concurrency ${esc(c?.concurrency_limit ?? '—')} · task limit ${esc(c?.time_limits.max_task_seconds ?? '—')}s · idle timeout ${esc(c?.time_limits.idle_timeout_seconds ?? '—')}s</div>
        </div>
      </div>

      <div class="panel">
        <h2>Children</h2>
        ${table(
          ['Agent', 'Role', 'Status'],
          detail.children.map((c2) => [
            `<a class="id" href="#/registry/${esc(c2.agent_id)}">${esc(c2.display_name)}</a>`,
            tag(c2.role_level),
            tag(c2.status),
          ]),
          'No child agents.',
        )}
      </div>

      <div class="panel">
        <h2>Contract v${detail.agent.current_version}</h2>
        <div class="panel-body">${json(c)}</div>
      </div>
    </div>`;
}

// 5 ------------------------------------------------------------ Organization
views.org = {
  title: 'Organization',
  sub: 'The delegation graph. Authority only ever narrows on the way down.',
  group: 'Workforce',
  async render() {
    const graph = await api('/api/registry/graph');
    const children = new Map();
    for (const node of graph.nodes) {
      const key = node.parent_agent_id ?? '__root__';
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(node);
    }

    const renderNode = (node) => `
      <div class="orgnode">
        <div class="row1">
          <a class="id" href="#/registry/${esc(node.agent_id)}">${esc(node.display_name)}</a>
          ${tag(node.role_level)}
          ${tag(node.status)}
          ${node.is_instance_of_template ? tag('instantiated', 'accent') : ''}
          ${node.live_instances > 0 ? tag(`${node.live_instances} live`, 'ok') : `<span class="faint">idle</span>`}
        </div>
        <div class="row2">
          ${node.project_scope?.all_projects ? tag('all projects', 'security') : (node.project_keys ?? []).map((p) => tag(p)).join('')}
          ${node.access_level ? tag(node.access_level) : ''}
          <span class="faint">${node.allowed_tools.length} tool(s) · concurrency ${esc(node.concurrency_limit ?? '—')}</span>
        </div>
      </div>
      ${
        (children.get(node.agent_id) ?? []).length
          ? `<div class="orgchildren">${(children.get(node.agent_id) ?? []).map(renderNode).join('')}</div>`
          : ''
      }`;

    return `
      <div class="panel">
        <h2>Owner → Chief → Masters → Specialists</h2>
        <div class="panel-body">
          <div class="orgnode" style="border-color:var(--security)">
            <div class="row1"><strong>OWNER</strong>${tag('final authority', 'security')}</div>
            <div class="row2"><span class="faint">Approves every owner-gated action. No agent holds Owner access level.</span></div>
          </div>
          <div class="orgchildren orgtree">
            ${(children.get('__root__') ?? []).map(renderNode).join('') || '<div class="empty">No agents registered.</div>'}
          </div>
        </div>
      </div>`;
  },
};

// 6 ------------------------------------------------- Projects & workflow loops
views.projects = {
  title: 'Projects & Workflow Loops',
  sub: 'Project scope is the primary isolation boundary. Cross-project access is denied by default.',
  group: 'Work',
  async render() {
    const [projects, loops] = await Promise.all([api('/api/projects'), api('/api/loops')]);
    const loopsByProject = new Map();
    for (const l of loops.loops) {
      if (!loopsByProject.has(l.project_id)) loopsByProject.set(l.project_id, []);
      loopsByProject.get(l.project_id).push(l);
    }

    return projects.projects
      .map(
        (p) => `
      <div class="panel" style="margin-bottom:14px">
        <h2>${esc(p.name)} <span class="faint">${esc(p.key)}</span> ${tag(p.status)}</h2>
        <div class="panel-body">
          <p class="muted">${esc(p.description)}</p>
          <div class="grid c4" style="margin:10px 0">
            ${stat('Open tasks', p.open_tasks)}
            ${stat('Workflow loops', p.loops)}
            ${stat('Budget', p.budget ? p.budget.status : 'none', p.budget ? `${p.budget.consumed.model_calls} model calls` : 'unbounded', p.budget?.status === 'hard_exceeded' ? 'bad' : p.budget?.status === 'soft_exceeded' ? 'warn' : '')}
            ${stat('Est. spend', p.budget ? p.budget.consumed.estimated_cost.toFixed(4) : '—')}
          </div>
          ${table(
            ['Loop', 'Trigger', 'Status', 'Definition'],
            (loopsByProject.get(p.project_id) ?? []).map((l) => [
              `<span class="mono">${esc(l.key)}</span><div class="faint">${esc(l.name)}</div>`,
              `${tag(l.trigger_kind)}${l.event_key ? ` <span class="faint mono">${esc(l.event_key)}</span>` : ''}${l.schedule_expr ? ` <span class="faint mono">${(Number(l.schedule_expr) / 3600000).toFixed(1)}h</span>` : ''}`,
              tag(l.status),
              `<span class="faint">${esc((l.definition.steps ?? []).map((s) => s.intent).join(' → ') || '—')}</span>`,
            ]),
            'No workflow loops defined for this project.',
          )}
        </div>
      </div>`,
      )
      .join('');
  },
};

// 7 ------------------------------------------------------ Task queue / execution
views.tasks = {
  title: 'Task Queue',
  sub: 'Execution state, attempt counts and the rework chain behind each task.',
  group: 'Work',
  async render(taskId) {
    if (taskId) return renderTaskDetail(taskId);
    const tasks = await api('/api/tasks?limit=100');
    return `
      <div class="panel">
        <h2>Tasks <span class="faint">${tasks.tasks.length}</span></h2>
        ${table(
          ['Task', 'Status', 'Priority', 'Assigned', 'Attempt', 'Trace', 'Created'],
          tasks.tasks.map((t) => [
            `<a class="id" href="#/tasks/${esc(t.task_id)}">${esc(t.title)}</a><div class="faint">${esc(t.task_id)}</div>`,
            tag(t.status),
            tag(t.priority),
            plainId(t.assigned_agent_id),
            `<span class="mono">${t.attempt}/${t.max_attempts}</span>`,
            `<a class="id" href="#/trace/${esc(t.trace_id)}">${esc(t.trace_id)}</a>`,
            `<span class="faint">${esc(relTime(t.created_at))}</span>`,
          ]),
          'No tasks yet.',
        )}
      </div>`;
  },
};

async function renderTaskDetail(taskId) {
  const detail = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
  const agents = await api('/api/registry/agents?status=active');

  return `
    <div class="btnrow" style="margin-bottom:12px">
      <a class="btn sm" href="#/tasks">← Task queue</a>
      <a class="btn sm" href="#/trace/${esc(detail.task.trace_id)}">View trace</a>
    </div>

    <div class="grid c2">
      <div class="panel">
        <h2>${esc(detail.task.title)}</h2>
        <div class="panel-body">
          <dl class="kv">
            <dt>Task ID</dt><dd class="mono">${esc(detail.task.task_id)}</dd>
            <dt>Trace ID</dt><dd><a class="id" href="#/trace/${esc(detail.task.trace_id)}">${esc(detail.task.trace_id)}</a></dd>
            <dt>Status</dt><dd>${tag(detail.task.status)}</dd>
            <dt>Attempt</dt><dd class="mono">${detail.task.attempt} of ${detail.task.max_attempts}</dd>
            <dt>Assigned</dt><dd>${detail.task.assigned_agent_id ? `<a class="id" href="#/registry/${esc(detail.task.assigned_agent_id)}">${esc(detail.task.assigned_agent_id)}</a>` : '<span class="faint">unassigned</span>'}</dd>
            <dt>Created by</dt><dd class="mono">${esc(detail.task.created_by)}</dd>
            <dt>Description</dt><dd>${esc(detail.task.description || '—')}</dd>
          </dl>
        </div>
      </div>

      <div class="panel">
        <h2>Work packets</h2>
        ${table(
          ['Packet', 'Intent', 'Sender → Receiver', 'Status', ''],
          detail.packets.map((p) => [
            `<a class="id" href="#/trace/${esc(p.trace_id)}">${esc(p.packet_id)}</a>`,
            tag(p.intent),
            `<span class="id">${esc(p.sender_agent_id)}</span><br><span class="id">→ ${esc(p.receiver_agent_id)}</span>`,
            tag(p.status),
            `<button class="btn sm primary" data-run="${esc(p.packet_id)}" ${['accepted_final', 'expired', 'cancelled'].includes(p.status) ? 'disabled' : ''}>Run loop</button>`,
          ]),
          'No packets. Delegate work to this task from the Chief view.',
        )}
        <div class="panel-body">
          <div class="field">
            <label>Evaluator for the quality gate (must not be the author)</label>
            <select id="evaluator">${agents.agents
              .map((a) => `<option value="${esc(a.agent_id)}">${esc(a.display_name)}</option>`)
              .join('')}</select>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>Artifacts <span class="faint">rework chain</span></h2>
        ${table(
          ['Artifact', 'Attempt', 'Kind', 'Author', 'Evidence', 'Created'],
          detail.artifacts.map((a) => [
            `<span class="id">${esc(a.artifact_id)}</span>`,
            `<span class="mono">#${a.attempt}</span>`,
            tag(a.kind),
            plainId(a.agent_id),
            `<span class="mono">${(a.provenance?.evidence_refs ?? []).length}</span>`,
            `<span class="faint">${esc(relTime(a.created_at))}</span>`,
          ]),
          'Nothing delivered yet.',
        )}
      </div>

      <div class="panel">
        <h2>Quality evaluations</h2>
        ${table(
          ['Gate', 'Verdict', 'Score', 'Evaluator', 'Findings'],
          detail.evaluations.map((e) => [
            `<span class="mono">${esc(e.gate_id)}</span>`,
            e.passed ? tag('passed', 'ok') : tag('failed', 'bad'),
            `<span class="mono">${e.score.toFixed(2)}</span>`,
            plainId(e.evaluator_agent_id),
            `<span class="faint">${esc(
              e.results
                .filter((r) => !r.passed)
                .flatMap((r) => r.findings)
                .slice(0, 3)
                .join('; ') || '—',
            )}</span>`,
          ]),
          'Not evaluated yet.',
        )}
      </div>

      ${
        detail.capa.length
          ? `<div class="panel"><h2>CAPA raised by this task</h2>${table(
              ['CAPA', 'State', 'Issue'],
              detail.capa.map((c) => [
                `<a class="id" href="#/quality">${esc(c.capa_id)}</a>`,
                tag(c.state),
                `<span class="muted">${esc(c.issue)}</span>`,
              ]),
            )}</div>`
          : ''
      }

      <div class="panel">
        <h2>Tool calls on this task</h2>
        ${table(
          ['Tool', 'Decision', 'Status', 'Duration', 'Agent'],
          detail.tool_calls.map((c) => [
            `<span class="mono">${esc(c.tool_name)}</span>`,
            c.decision === 'deny' ? tag(c.denial_code ?? 'deny', 'bad') : tag('allow', 'ok'),
            c.status ? tag(c.status) : '<span class="faint">—</span>',
            `<span class="mono">${c.duration_ms ?? '—'} ms</span>`,
            plainId(c.agent_id),
          ]),
          'No tool calls recorded for this task.',
        )}
      </div>
    </div>`;
}

// 8 -------------------------------------------------------------- Trace viewer
views.trace = {
  title: 'Work-Packet Trace',
  sub: 'One trace ID threads a task, its packets, its tool calls, its audit events and its spend.',
  group: 'Work',
  async render(traceId) {
    if (!traceId) {
      const tasks = await api('/api/tasks?limit=50');
      return `<div class="panel"><h2>Pick a trace</h2>${table(
        ['Trace', 'Task', 'Status'],
        tasks.tasks.map((t) => [
          `<a class="id" href="#/trace/${esc(t.trace_id)}">${esc(t.trace_id)}</a>`,
          esc(t.title),
          tag(t.status),
        ]),
        'No traces yet.',
      )}</div>`;
    }

    const trace = await api(`/api/traces/${encodeURIComponent(traceId)}`);
    const usageTotal = trace.usage.reduce(
      (acc, u) => ({
        model_calls: acc.model_calls + u.model_calls,
        tool_calls: acc.tool_calls + u.tool_calls,
        tokens: acc.tokens + u.tokens_in + u.tokens_out,
        cost: acc.cost + u.estimated_cost,
      }),
      { model_calls: 0, tool_calls: 0, tokens: 0, cost: 0 },
    );

    return `
      <div class="grid c4" style="margin-bottom:14px">
        ${stat('Trace', traceId.slice(-8), `<span class="mono">${esc(traceId)}</span>`)}
        ${stat('Packets', trace.packets.length)}
        ${stat('Tool calls', trace.tool_calls.length, `${trace.tool_calls.filter((c) => c.decision === 'deny').length} denied`)}
        ${stat('Est. cost', usageTotal.cost.toFixed(6), `${usageTotal.model_calls} model calls · ${usageTotal.tokens} tokens`)}
      </div>

      <div class="grid c2">
        <div class="panel">
          <h2>Packet chain</h2>
          <div class="panel-body">
            ${
              trace.packets.length
                ? trace.packets
                    .map(
                      (p) => `<div class="tracestep ${p.status === 'rework_requested' || p.status === 'escalated' ? 'warn' : ''}">
                        <div><strong>${esc(p.intent)}</strong> ${tag(p.status)}</div>
                        <div class="muted">${esc(p.objective)}</div>
                        <div class="faint">${esc(p.sender_agent_id)} → ${esc(p.receiver_agent_id)}</div>
                        <div class="faint mono">${esc(p.packet_id)}${p.parent_packet_id ? ` ← ${esc(p.parent_packet_id)}` : ''}</div>
                        <div class="taglist" style="margin-top:4px">${p.allowed_tools.map((t) => tag(t)).join('') || '<span class="faint">receiver contract tools</span>'}</div>
                      </div>`,
                    )
                    .join('')
                : '<div class="empty">No packets on this trace.</div>'
            }
          </div>
        </div>

        <div class="panel">
          <h2>Events</h2>
          <div class="panel-body">
            ${
              trace.events.length
                ? trace.events
                    .slice()
                    .reverse()
                    .map(
                      (e) => `<div class="tracestep ${e.severity === 'security' ? 'security' : e.severity === 'error' ? 'deny' : e.severity === 'warn' ? 'warn' : ''}">
                        <div><span class="mono">${esc(e.kind)}</span> ${e.severity !== 'info' ? tag(e.severity, e.severity === 'security' ? 'security' : e.severity === 'error' ? 'bad' : 'warn') : ''}</div>
                        <div class="faint">${esc(e.actor_type)}${e.actor_id ? `:${esc(e.actor_id)}` : ''} · ${esc(shortTime(e.created_at))}</div>
                      </div>`,
                    )
                    .join('')
                : '<div class="empty">No events on this trace.</div>'
            }
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px">
        <h2>Tool calls</h2>
        ${table(
          ['Tool', 'Decision', 'Status', 'Duration', 'Token', 'Started'],
          trace.tool_calls.map((c) => [
            `<span class="mono">${esc(c.tool_name)}</span>`,
            c.decision === 'deny' ? tag(c.denial_code ?? 'deny', 'bad') : tag('allow', 'ok'),
            c.status ? tag(c.status) : '<span class="faint">—</span>',
            `<span class="mono">${c.duration_ms ?? '—'} ms</span>`,
            c.approval_token_id ? tag('owner token', 'security') : '<span class="faint">—</span>',
            `<span class="faint">${esc(shortTime(c.started_at))}</span>`,
          ]),
          'No tool calls on this trace.',
        )}
      </div>`;
  },
};

// 9 ------------------------------------------------------- Quality Control / CAPA
views.quality = {
  title: 'Quality Control & CAPA',
  sub: 'Gate definitions, evaluation verdicts, and the corrective/preventive record behind repeated failure.',
  group: 'Governance',
  async render() {
    const [gates, evaluations, capa] = await Promise.all([
      api('/api/quality/gates'),
      api('/api/quality/evaluations?limit=100'),
      api('/api/capa?limit=100'),
    ]);

    const failures = evaluations.evaluations.filter((e) => !e.passed);

    return `
      <div class="grid c4" style="margin-bottom:14px">
        ${stat('Gates', gates.gates.length, `${gates.gates.filter((g) => g.blocking).length} blocking`)}
        ${stat('Evaluations', evaluations.evaluations.length)}
        ${stat('Failures', failures.length, 'blocking + advisory', failures.length ? 'warn' : 'ok')}
        ${stat('Open CAPA', capa.capa.filter((c) => c.state !== 'closed' && c.state !== 'rejected').length, `${capa.capa.length} total`, capa.capa.length ? 'warn' : '')}
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h2>Quality gates</h2>
        ${table(
          ['Key', 'Name', 'Checks', 'Threshold', 'Blocking', 'Separation of duties'],
          gates.gates.map((g) => [
            `<span class="mono">${esc(g.key)}</span>`,
            esc(g.name),
            `<div class="taglist">${g.checks.map((c) => tag(c.kind)).join('')}</div>`,
            `<span class="mono">${g.threshold}</span>`,
            g.blocking ? tag('blocking', 'warn') : tag('advisory'),
            g.separation_of_duties ? tag('enforced', 'security') : '<span class="faint">not required</span>',
          ]),
        )}
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h2>Recent evaluations</h2>
        ${table(
          ['Task', 'Gate', 'Verdict', 'Score', 'Attempt', 'Failing checks', 'When'],
          evaluations.evaluations.slice(0, 40).map((e) => [
            `<a class="id" href="#/tasks/${esc(e.task_id)}">${esc(e.task_id)}</a>`,
            `<span class="mono">${esc(e.gate_id)}</span>`,
            e.passed ? tag('passed', 'ok') : tag('failed', 'bad'),
            `<span class="mono">${e.score.toFixed(2)}</span>`,
            `<span class="mono">#${e.attempt}</span>`,
            `<div class="taglist">${e.results
              .filter((r) => !r.passed)
              .map((r) => tag(r.kind, 'bad'))
              .join('') || '<span class="faint">—</span>'}</div>`,
            `<span class="faint">${esc(relTime(e.created_at))}</span>`,
          ]),
          'No evaluations recorded.',
        )}
      </div>

      <div class="panel">
        <h2>CAPA records</h2>
        ${table(
          ['CAPA', 'State', 'Issue', 'Root cause', 'Corrective', 'Preventive', 'Verified'],
          capa.capa.map((c) => [
            `<span class="id">${esc(c.capa_id)}</span>`,
            tag(c.state),
            `<span class="muted">${esc(c.issue)}</span>`,
            `<span class="faint">${esc(c.root_cause_hypothesis || '—')}</span>`,
            `<span class="faint">${esc(c.corrective_action || '—')}</span>`,
            `<span class="faint">${esc(c.preventive_action || '—')}</span>`,
            c.verification_result ? tag('verified', 'ok') : tag('outstanding', 'warn'),
          ]),
          'No CAPA records. Nothing has failed repeatedly enough to warrant one.',
        )}
        <div class="panel-body">
          <div class="notice">A CAPA cannot be closed without a root cause, both actions, and a verification result.
          The runtime refuses the transition rather than accepting an empty record.</div>
        </div>
      </div>`;
  },
};

// 10 ------------------------------------------------------- Memory & Knowledge
views.memory = {
  title: 'Memory & Knowledge',
  sub: 'Four layers with provenance. Authoritative outranks everything inferred, and agents cannot silently promote into it.',
  group: 'Governance',
  async render() {
    const memory = await api('/api/memory?limit=200');
    const byLayer = { authoritative: [], project: [], episodic: [], working: [] };
    for (const r of memory.records) (byLayer[r.layer] ??= []).push(r);

    return `
      <div class="grid c4" style="margin-bottom:14px">
        ${stat('Authoritative', byLayer.authoritative.length, 'verified, human-approved', 'ok')}
        ${stat('Project', byLayer.project.length, 'reusable knowledge')}
        ${stat('Episodic', byLayer.episodic.length, 'past events')}
        ${stat('Working', byLayer.working.length, 'short-lived, TTL swept')}
      </div>

      ${Object.entries(byLayer)
        .map(
          ([layer, records]) => `
        <div class="panel" style="margin-bottom:14px">
          <h2>${esc(layer)} <span class="faint">${records.length} record(s)</span></h2>
          ${table(
            ['Key', 'Scope', 'Source', 'Provenance', 'Confidence', 'Supersedes', 'TTL'],
            records.slice(0, 40).map((r) => [
              `<span class="mono">${esc(r.key)}</span>`,
              r.scope_project_id ? `<span class="id">${esc(r.scope_project_id)}</span>` : tag('global'),
              `<span class="faint">${esc(r.source)}</span>`,
              `${tag(r.provenance?.origin ?? 'unknown', r.provenance?.origin === 'human' ? 'security' : '')}${(r.provenance?.evidence_refs ?? []).length ? ` <span class="faint">${(r.provenance.evidence_refs ?? []).length} ref(s)</span>` : ''}`,
              r.confidence == null ? (r.authoritative ? tag('canonical', 'ok') : '<span class="faint">—</span>') : `<span class="mono">${r.confidence}</span>`,
              r.supersedes_id ? `<span class="id">${esc(r.supersedes_id)}</span>` : '<span class="faint">—</span>',
              r.ttl_expires_at ? `<span class="faint">${esc(relTime(r.ttl_expires_at))}</span>` : '<span class="faint">none</span>',
            ]),
            `No ${layer} records.`,
          )}
        </div>`,
        )
        .join('')}`;
  },
};

// 11 ------------------------------------------------------------- Tool Gateway
views.tools = {
  title: 'Tool Gateway',
  sub: 'Every tool an agent can reach, its risk class, its required scopes, and whether it needs an Owner decision.',
  group: 'Governance',
  async render() {
    const [tools, calls, agents] = await Promise.all([
      api('/api/tools'),
      api('/api/tool-calls?limit=60'),
      api('/api/registry/agents?status=active'),
    ]);

    return `
      <div class="panel" style="margin-bottom:14px">
        <h2>Tool catalogue <span class="faint">${tools.tools.length} registered</span></h2>
        ${table(
          ['Tool', 'Risk', 'Access', 'Scopes', 'Owner-gated', 'Timeout', 'Audit', 'Status'],
          tools.tools.map((t) => [
            `<span class="mono">${esc(t.tool_name)}</span><div class="faint">${esc(t.description)}</div>`,
            tag(t.risk_class, t.risk_class === 'critical' ? 'bad' : t.risk_class === 'high' ? 'warn' : ''),
            tag(t.required_access_level),
            `<div class="taglist">${t.required_scopes.map((s) => tag(s)).join('') || '<span class="faint">none</span>'}</div>`,
            t.owner_gated ? tag('approval + token', 'security') : '<span class="faint">no</span>',
            `<span class="mono">${t.timeout_ms}ms</span>`,
            tag(t.audit_policy),
            tag(t.status),
          ]),
        )}
        <div class="panel-body">
          <div class="notice"><strong>No shell, filesystem-write, or arbitrary-code tool is registered.</strong>
          Runtime agents in v0.4 have no route to a shell.</div>
        </div>
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h2>Authorization preview</h2>
        <div class="panel-body">
          <div class="field-row">
            <div class="field"><label>Agent</label><select id="dry-agent">${agents.agents
              .map((a) => `<option value="${esc(a.agent_id)}">${esc(a.display_name)}</option>`)
              .join('')}</select></div>
            <div class="field"><label>Tool</label><select id="dry-tool">${tools.tools
              .map((t) => `<option value="${esc(t.tool_name)}">${esc(t.tool_name)}</option>`)
              .join('')}</select></div>
          </div>
          <button class="btn" data-action="dry-run">Check authorization</button>
          <div id="dry-result" style="margin-top:10px"></div>
          <div class="faint" style="margin-top:8px">This runs the real policy engine without executing anything —
          the same verdict the live call would get.</div>
        </div>
      </div>

      <div class="panel">
        <h2>Recent tool calls</h2>
        ${table(
          ['Tool', 'Agent', 'Decision', 'Reason', 'Status', 'Duration', 'When'],
          calls.calls.map((c) => [
            `<span class="mono">${esc(c.tool_name)}</span>`,
            plainId(c.agent_id),
            c.decision === 'deny' ? tag(c.denial_code ?? 'deny', 'bad') : tag('allow', 'ok'),
            `<span class="faint">${esc(c.denial_reason ?? '—')}</span>`,
            c.status ? tag(c.status) : '<span class="faint">—</span>',
            `<span class="mono">${c.duration_ms ?? '—'} ms</span>`,
            `<span class="faint">${esc(relTime(c.started_at))}</span>`,
          ]),
          'No tool calls yet.',
        )}
      </div>`;
  },
  bind(root) {
    root.querySelector('[data-action="dry-run"]')?.addEventListener('click', async () => {
      const out = root.querySelector('#dry-result');
      out.innerHTML = '<span class="faint">checking…</span>';
      try {
        const result = await api('/api/tools/dry-run', {
          method: 'POST',
          body: {
            agent_id: root.querySelector('#dry-agent').value,
            tool_name: root.querySelector('#dry-tool').value,
          },
        });
        out.innerHTML = `
          <div class="finding ${result.allowed ? 'info' : result.requiresApproval ? 'caution' : 'blocker'}">
            <div class="kind">${result.allowed ? 'allowed' : result.requiresApproval ? 'owner approval required' : 'denied'}${result.code ? ` · ${esc(result.code)}` : ''}</div>
            <div>${esc(result.reason)}</div>
          </div>
          ${table(
            ['Check', 'Result', 'Detail'],
            (result.checks ?? []).map((c) => [
              `<span class="mono">${esc(c.name)}</span>`,
              c.passed ? tag('pass', 'ok') : tag('fail', 'bad'),
              `<span class="faint">${esc(c.detail)}</span>`,
            ]),
          )}`;
      } catch (err) {
        out.innerHTML = `<div class="finding blocker"><div class="kind">${esc(err.code)}</div><div>${esc(err.message)}</div></div>`;
      }
    });
  },
};

// 12 ---------------------------------------------------------------- Approvals
views.approvals = {
  title: 'Approvals',
  sub: 'Owner-gated actions. Approving mints one short-lived token bound to the exact action, arguments, actor and project.',
  group: 'Governance',
  async render() {
    const [approvals, policy] = await Promise.all([api('/api/approvals?limit=100'), api('/api/policy')]);
    const pending = approvals.approvals.filter((a) => a.status === 'pending');

    return `
      <div class="notice" style="margin-bottom:14px">
        <strong>Owner-gated action classes:</strong> ${esc(policy.owner_gated_action_classes.join(' · '))}
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h2>Awaiting your decision <span class="faint">${pending.length}</span></h2>
        ${table(
          ['Requested by', 'Action', 'Arguments', 'Risk', 'Expires', 'Decision'],
          pending.map((a) => [
            plainId(a.requested_by_agent_id),
            `<span class="mono">${esc(a.action)}</span><div class="faint">${esc(a.justification)}</div>`,
            `<details><summary class="faint">fingerprint ${esc(a.args_fingerprint.slice(0, 12))}…</summary>${json(a.args)}</details>`,
            tag(a.risk_class, a.risk_class === 'critical' ? 'bad' : 'warn'),
            `<span class="faint">${esc(relTime(a.expires_at))}</span>`,
            `<div class="btnrow">
              <button class="btn sm primary" data-decide="approved" data-id="${esc(a.approval_id)}">Approve</button>
              <button class="btn sm danger" data-decide="denied" data-id="${esc(a.approval_id)}">Deny</button>
            </div>`,
          ]),
          'Nothing is waiting on you.',
        )}
      </div>

      <div id="token-slot"></div>

      <div class="panel">
        <h2>Approval history</h2>
        ${table(
          ['Action', 'Status', 'Requested by', 'Decided by', 'Note', 'When'],
          approvals.approvals.map((a) => [
            `<span class="mono">${esc(a.action)}</span>`,
            tag(a.status),
            plainId(a.requested_by_agent_id),
            a.decided_by ? `<span class="mono">${esc(a.decided_by)}</span>` : '<span class="faint">—</span>',
            `<span class="faint">${esc(a.decision_note ?? '—')}</span>`,
            `<span class="faint">${esc(relTime(a.created_at))}</span>`,
          ]),
          'No approval requests have been made.',
        )}
      </div>`;
  },
  bind(root) {
    root.querySelectorAll('[data-decide]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const decision = btn.dataset.decide;
        try {
          const result = await api(`/api/approvals/${btn.dataset.id}/decide`, {
            method: 'POST',
            body: { decision, decided_by: 'owner', decision_note: `${decision} from the Control Center` },
          });
          if (result.execution_token) {
            // Shown once. The runtime stores only a hash and will never return it again.
            document.getElementById('token-slot').innerHTML = `
              <div class="panel" style="margin-bottom:14px;border-color:var(--security)">
                <h2>Execution token — shown once</h2>
                <div class="panel-body">
                  <p class="muted">${esc(result.note)}</p>
                  <pre class="json">${esc(result.execution_token)}</pre>
                  <div class="faint">token ${esc(result.token_id)} · expires ${esc(shortTime(result.expires_at))}</div>
                </div>
              </div>`;
            flash('ok', 'Approval granted and one execution token minted.');
          } else {
            flash('ok', `Approval ${esc(decision)} — recorded by the runtime.`);
          }
          await render();
        } catch (err) {
          flash('err', `Decision refused: <code>${esc(err.code)}</code> ${esc(err.message)}`);
          btn.disabled = false;
        }
      });
    });
  },
};

// 13 ---------------------------------------------------------- Budgets & Usage
views.budgets = {
  title: 'Budgets & Usage',
  sub: 'Limits at project, agent and task level. A hard limit pauses and escalates rather than continuing quietly.',
  group: 'Governance',
  async render() {
    const [budgets, usage] = await Promise.all([api('/api/budgets'), api('/api/usage?limit=60')]);

    return `
      <div class="grid c4" style="margin-bottom:14px">
        ${stat('Model calls', usage.totals.model_calls)}
        ${stat('Tokens', usage.totals.tokens.toLocaleString())}
        ${stat('Tool calls', usage.totals.tool_calls)}
        ${stat('Estimated cost', usage.totals.estimated_cost.toFixed(6), 'provider-neutral units')}
      </div>

      <div class="panel" style="margin-bottom:14px">
        <h2>Budgets</h2>
        ${table(
          ['Scope', 'Status', 'Model calls', 'Tool calls', 'Est. cost', 'Retries', ''],
          budgets.budgets.map((b) => [
            `${tag(b.scope_type)}<div class="id">${esc(b.scope_id)}</div>`,
            tag(b.status),
            meter(b.consumed.model_calls, b.limits.max_model_calls),
            meter(b.consumed.tool_calls, b.limits.max_tool_calls),
            meter(Number(b.consumed.estimated_cost.toFixed(4)), b.limits.max_estimated_cost),
            `<span class="mono">${b.consumed.retries}</span>`,
            `<button class="btn sm ${b.status === 'paused' ? '' : 'danger'}" data-budget="${b.status === 'paused' ? 'resume' : 'pause'}" data-type="${esc(b.scope_type)}" data-scope="${esc(b.scope_id)}">${b.status === 'paused' ? 'Resume' : 'Pause'}</button>`,
          ]),
          'No budgets defined.',
        )}
      </div>

      <div class="panel">
        <h2>Usage records <span class="faint">append-only</span></h2>
        ${table(
          ['Kind', 'Project', 'Agent', 'Model calls', 'Tokens', 'Cost', 'Elapsed', 'When'],
          usage.records.map((u) => [
            tag(u.kind),
            plainId(u.project_id),
            plainId(u.agent_id),
            `<span class="mono">${u.model_calls}</span>`,
            `<span class="mono">${u.tokens_in + u.tokens_out}</span>`,
            `<span class="mono">${u.estimated_cost.toFixed(6)}</span>`,
            `<span class="mono">${u.elapsed_ms} ms</span>`,
            `<span class="faint">${esc(relTime(u.created_at))}</span>`,
          ]),
          'No usage recorded.',
        )}
      </div>`;
  },
  bind(root) {
    root.querySelectorAll('[data-budget]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const action = btn.dataset.budget;
        await act(`Budget ${action}`, () =>
          api(`/api/budgets/${action}`, {
            method: 'POST',
            body: { scope_type: btn.dataset.type, scope_id: btn.dataset.scope, reason: 'set from the Control Center' },
          }),
        );
      });
    });
  },
};

// 14 ------------------------------------------------------------ Telemetry
views.telemetry = {
  title: 'Telemetry & Audit',
  sub: 'The append-only event log. There is no update or delete path through the application, and the database refuses one too.',
  group: 'Governance',
  async render() {
    const [events, summary] = await Promise.all([
      api('/api/telemetry/events?limit=150'),
      api('/api/telemetry/summary'),
    ]);

    const topKinds = Object.entries(summary.events.by_kind)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return `
      <div class="grid c4" style="margin-bottom:14px">
        ${stat('Events', summary.events.total)}
        ${stat('Security events', summary.events.by_severity.security ?? 0, 'permission and approval changes', (summary.events.by_severity.security ?? 0) ? 'security' : '')}
        ${stat('Warnings', summary.events.by_severity.warn ?? 0, '', (summary.events.by_severity.warn ?? 0) ? 'warn' : '')}
        ${stat('Errors', summary.events.by_severity.error ?? 0, '', (summary.events.by_severity.error ?? 0) ? 'bad' : '')}
      </div>

      <div class="grid c2" style="margin-bottom:14px">
        <div class="panel">
          <h2>Most frequent event kinds</h2>
          ${table(
            ['Kind', 'Count'],
            topKinds.map(([kind, count]) => [`<span class="mono">${esc(kind)}</span>`, `<span class="mono">${count}</span>`]),
          )}
        </div>
        <div class="panel">
          <h2>Tool call health</h2>
          <div class="panel-body">
            <dl class="kv">
              <dt>Total</dt><dd class="mono">${summary.tool_calls.total}</dd>
              <dt>Denied</dt><dd class="mono">${summary.tool_calls.denied}</dd>
              <dt>Errors</dt><dd class="mono">${summary.tool_calls.errors}</dd>
              <dt>p50 / p95</dt><dd class="mono">${summary.tool_calls.latency_ms.p50} ms / ${summary.tool_calls.latency_ms.p95} ms</dd>
            </dl>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>Audit log</h2>
        ${table(
          ['Event', 'Severity', 'Actor', 'Subject', 'Trace', 'When'],
          events.events.map((e) => [
            `<span class="mono">${esc(e.kind)}</span>`,
            e.severity === 'info' ? tag('info') : tag(e.severity, e.severity === 'security' ? 'security' : e.severity === 'error' ? 'bad' : 'warn'),
            `<span class="faint">${esc(e.actor_type)}</span>${e.actor_id ? `<div class="id">${esc(e.actor_id)}</div>` : ''}`,
            e.subject_id ? `<span class="faint">${esc(e.subject_type ?? '')}</span><div class="id">${esc(e.subject_id)}</div>` : '<span class="faint">—</span>',
            e.trace_id ? `<a class="id" href="#/trace/${esc(e.trace_id)}">${esc(e.trace_id.slice(-8))}</a>` : '<span class="faint">—</span>',
            `<span class="faint nowrap">${esc(shortTime(e.created_at))}</span>`,
          ]),
          'No events recorded.',
        )}
      </div>`;
  },
};

// 15 --------------------------------------------------- Settings / policy
views.settings = {
  title: 'Settings & Policy',
  sub: 'What the runtime enforces, stated so it can be checked rather than assumed.',
  group: 'Governance',
  async render() {
    const [policy, health, jobs] = await Promise.all([
      api('/api/policy'),
      api('/api/health'),
      api('/api/scheduler/jobs'),
    ]);

    return `
      <div class="grid c2">
        <div class="panel">
          <h2>Enforced defaults</h2>
          <div class="panel-body">
            <dl class="kv">
              ${Object.entries(policy.defaults)
                .map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(v)}</dd>`)
                .join('')}
            </dl>
          </div>
        </div>

        <div class="panel">
          <h2>Lifecycle</h2>
          <div class="panel-body">
            <dl class="kv">
              <dt>Agent</dt><dd class="mono">${esc(policy.lifecycle.agent)}</dd>
              <dt>Activation gate</dt><dd>${esc(policy.lifecycle.activation_gate)}</dd>
            </dl>
          </div>
        </div>

        <div class="panel">
          <h2>Owner-gated action classes</h2>
          <div class="panel-body">
            <div class="taglist">${policy.owner_gated_action_classes.map((c) => tag(c, 'security')).join('')}</div>
            <h3 class="muted" style="margin:12px 0 6px">Owner-only scopes</h3>
            <div class="taglist">${policy.owner_only_scopes.map((s) => tag(s, 'security')).join('')}</div>
            <h3 class="muted" style="margin:12px 0 6px">Scopes needing an explicit contract grant</h3>
            <div class="taglist">${policy.explicit_grant_scopes.map((s) => tag(s, 'warn')).join('')}</div>
          </div>
        </div>

        <div class="panel">
          <h2>Secret handling</h2>
          <div class="panel-body">
            <div class="notice" style="margin-bottom:10px">${esc(policy.secret_handling.storage)}</div>
            ${table(
              ['Key', 'Provider', 'Environment variable', 'Scope'],
              policy.secret_handling.references.map((r) => [
                `<span class="mono">${esc(r.key)}</span>`,
                tag(r.provider),
                `<span class="mono">${esc(r.env_var)}</span>`,
                r.project_id ? `<span class="id">${esc(r.project_id)}</span>` : tag('global'),
              ]),
              'No credential references registered.',
            )}
          </div>
        </div>

        <div class="panel">
          <h2>Scheduler</h2>
          ${table(
            ['Job', 'Kind', 'Schedule', 'Status', 'Attempts', 'Next run'],
            jobs.jobs.map((j) => [
              `<span class="id">${esc(j.job_id)}</span>`,
              `<span class="mono">${esc(j.kind)}</span>`,
              `${tag(j.schedule_kind)}${j.interval_ms ? ` <span class="faint mono">${(j.interval_ms / 3600000).toFixed(1)}h</span>` : ''}${j.event_key ? ` <span class="faint mono">${esc(j.event_key)}</span>` : ''}`,
              tag(j.status),
              `<span class="mono">${j.attempts}/${j.max_attempts}</span>`,
              `<span class="faint">${j.next_run_at ? esc(relTime(j.next_run_at)) : '—'}</span>`,
            ]),
            'No jobs scheduled.',
          )}
          <div class="panel-body"><button class="btn" data-action="tick">Run scheduler tick now</button></div>
        </div>

        <div class="panel">
          <h2>Build</h2>
          <div class="panel-body">
            <div class="notice" style="margin-bottom:10px">
              <strong>This is a pre-production build.</strong> There is no Owner authentication beyond an optional shared
              bearer token, and the owner-gated tool handlers record real governance but simulate their external effects.
              See <span class="mono">docs/V04_SECURITY.md</span> for the full list of production blockers.
            </div>
            <dl class="kv">
              <dt>Version</dt><dd class="mono">${esc(health.version)}</dd>
              <dt>Provider</dt><dd class="mono">${esc(health.provider.name)} · ${esc(health.provider.model)}</dd>
              <dt>Database</dt><dd class="mono">${esc(health.database.path)}</dd>
            </dl>
          </div>
        </div>
      </div>`;
  },
  bind(root) {
    root.querySelector('[data-action="tick"]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const result = await act('Scheduler tick', () => api('/api/scheduler/tick', { method: 'POST' }));
      if (result) flash('info', `Claimed ${result.claimed}, succeeded ${result.succeeded}, failed ${result.failed}.`);
    });
  },
};

// ------------------------------------------------------------------ routing

const NAV = [
  ['Overview', ['command', 'chief']],
  ['Workforce', ['factory', 'registry', 'org']],
  ['Work', ['projects', 'tasks', 'trace']],
  ['Governance', ['quality', 'memory', 'tools', 'approvals', 'budgets', 'telemetry', 'settings']],
];

const NAV_LABELS = {
  command: 'Command Center',
  chief: 'Chief Architect',
  factory: 'Agent Factory',
  registry: 'Agent Registry',
  org: 'Organization',
  projects: 'Projects & Loops',
  tasks: 'Task Queue',
  trace: 'Trace Viewer',
  quality: 'Quality & CAPA',
  memory: 'Memory',
  tools: 'Tool Gateway',
  approvals: 'Approvals',
  budgets: 'Budgets & Usage',
  telemetry: 'Telemetry & Audit',
  settings: 'Settings & Policy',
};

let viewState = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  return { name: views[name] ? name : 'command', param: param ? decodeURIComponent(param) : null };
}

function buildNav(badges = {}) {
  const list = document.getElementById('navlist');
  list.innerHTML = NAV.map(
    ([group, names]) =>
      `<li class="navgroup">${esc(group)}</li>` +
      names
        .map((name) => {
          const badge = badges[name];
          return `<li><a href="#/${name}" data-view="${name}">
            <span>${esc(NAV_LABELS[name])}</span>
            ${badge ? `<span class="count">${esc(badge)}</span>` : ''}
          </a></li>`;
        })
        .join(''),
  ).join('');
}

async function render(state) {
  const { name, param } = parseHash();
  const view = views[name];
  if (state !== undefined) viewState = state;

  document.getElementById('viewtitle').textContent = view.title;
  document.getElementById('viewsub').textContent = view.sub ?? '';
  document.querySelectorAll('#navlist a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === name);
  });

  const root = document.getElementById('view');
  root.innerHTML = '<div class="loading">Loading…</div>';

  try {
    root.innerHTML = await view.render(param, viewState);
    view.bind?.(root, (next) => render(next));
    bindGlobal(root);
    document.getElementById('lastsync').textContent = `synced ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    root.innerHTML = `<div class="panel"><h2>Could not load this view</h2><div class="panel-body">
      <div class="finding blocker">
        <div class="kind">${esc(err.code ?? 'ERROR')}</div>
        <div>${esc(err.message)}</div>
        ${err.traceId ? `<div class="faint">trace ${esc(err.traceId)}</div>` : ''}
      </div>
      ${err.details ? json(err.details) : ''}
    </div></div>`;
  }
}

/** Lifecycle buttons appear in several views; bind them once, centrally. */
function bindGlobal(root) {
  root.querySelectorAll('[data-lifecycle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const action = btn.dataset.lifecycle;
      await act(`Agent ${action}`, () =>
        api(`/api/registry/agents/${btn.dataset.id}/${action}`, {
          method: 'POST',
          body: { reason: 'set from the Control Center' },
        }),
      );
    });
  });

  root.querySelectorAll('[data-run]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const evaluator = root.querySelector('#evaluator')?.value;
      if (!evaluator) {
        flash('err', 'Select an evaluator first. A gate with separation of duties will refuse the author.');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Running…';
      const result = await act('Execute → evaluate → rework', () =>
        api(`/api/packets/${btn.dataset.run}/run`, {
          method: 'POST',
          body: { evaluator_agent_id: evaluator },
        }),
      );
      if (result) {
        flash(
          result.outcome.action === 'accepted' ? 'ok' : 'info',
          `Outcome: <strong>${esc(result.outcome.action)}</strong> after ${result.cycles} cycle(s).` +
            (result.outcome.capa ? ` A CAPA record was opened: <code>${esc(result.outcome.capa.capa_id)}</code>` : ''),
        );
      }
    });
  });
}

async function refreshHealth() {
  const dot = document.getElementById('healthdot');
  const text = document.getElementById('healthtext');
  try {
    const health = await api('/api/health');
    dot.className = 'dot ok';
    text.textContent = `${health.counts.active_agents} active · ${health.counts.live_instances} live`;
    buildNav({
      approvals: health.counts.pending_approvals || '',
      registry: health.counts.agents,
      projects: health.counts.projects,
    });
    document.querySelectorAll('#navlist a').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === parseHash().name);
    });
  } catch {
    dot.className = 'dot bad';
    text.textContent = 'runtime unreachable';
  }
}

window.addEventListener('hashchange', () => render(null));
document.getElementById('refresh').addEventListener('click', () => {
  void refreshHealth();
  void render(null);
});

buildNav();
await refreshHealth();
await render(null);
setInterval(refreshHealth, 15000);
