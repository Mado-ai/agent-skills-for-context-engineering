import { newId, type AgentRecord } from '../domain/index.js';
import type { Runtime } from '../runtime.js';
import { bootstrapLoopJobs } from '../runtime.js';

/**
 * Bootstrap organisation.
 *
 * This is seed data, not schema: it lives outside the migrations so the shape
 * of a starting workforce can change without a schema version. It is
 * idempotent — if a Chief already exists, seeding is a no-op.
 *
 * The hierarchy it creates is the one the runtime is designed around:
 *
 *   OWNER -> Chief Agent Architect -> Master agents -> Specialists (on demand)
 */

export interface SeedResult {
  seeded: boolean;
  projects: number;
  loops: number;
  templates: number;
  agents: string[];
  memory_records: number;
}

const OWNER = 'owner';

export function seed(runtime: Runtime): SeedResult {
  const { repos, registry } = runtime;

  const existingChief = repos.agents.listAgents({ role_level: 'chief' })[0];
  if (existingChief) {
    return { seeded: false, projects: 0, loops: 0, templates: 0, agents: [], memory_records: 0 };
  }

  // ---- projects ----------------------------------------------------------

  const portfolio = repos.projects.insert({
    key: 'portfolio-ops',
    name: 'Portfolio Operations',
    description: 'Cross-business operating cadence: reporting, reviews, and standards enforcement.',
    parent_project_id: null,
    metadata: { domain: 'operations' },
  });

  const content = repos.projects.insert({
    key: 'content-engine',
    name: 'Content Engine',
    description: 'Research, drafting and publication pipeline for owned media properties.',
    parent_project_id: null,
    metadata: { domain: 'media' },
  });

  const hardware = repos.projects.insert({
    key: 'hardware-lab',
    name: 'Hardware Lab',
    description: 'Robotics and hardware programme: specification, test evidence and compliance records.',
    parent_project_id: null,
    metadata: { domain: 'hardware', compliance: ['ISO-9001'] },
  });

  const projects = [portfolio, content, hardware];

  // ---- workflow loops ----------------------------------------------------

  const loops = [
    repos.projects.insertLoop({
      project_id: portfolio.project_id,
      key: 'weekly-operating-review',
      name: 'Weekly Operating Review',
      description: 'Collect the week’s outcomes, quality failures and budget position; produce an Owner-facing brief.',
      trigger_kind: 'scheduled',
      // Milliseconds. A cron parser is a v0.5 concern; the interface already
      // carries the expression so the swap is local to the scheduler.
      schedule_expr: String(7 * 24 * 60 * 60 * 1000),
      event_key: null,
      definition: {
        steps: [
          { intent: 'research', role: 'specialist', objective: 'Gather task, quality and budget state for the period' },
          { intent: 'plan', role: 'master', objective: 'Identify the decisions the Owner actually has to make' },
          { intent: 'review', role: 'chief', objective: 'Challenge the brief before it reaches the Owner' },
        ],
      },
    }),
    repos.projects.insertLoop({
      project_id: content.project_id,
      key: 'research-to-draft',
      name: 'Research to Draft',
      description: 'Turn a validated research brief into a reviewed draft with cited evidence.',
      trigger_kind: 'event',
      schedule_expr: null,
      event_key: 'content.brief_approved',
      definition: {
        steps: [
          { intent: 'research', role: 'specialist', objective: 'Assemble sourced evidence for the brief' },
          { intent: 'execute', role: 'specialist', objective: 'Draft against the approved outline' },
          { intent: 'review', role: 'master', objective: 'Evaluate against the delivery gate' },
        ],
      },
    }),
    repos.projects.insertLoop({
      project_id: hardware.project_id,
      key: 'test-evidence-capture',
      name: 'Test Evidence Capture',
      description: 'Capture, verify and file test evidence against the controlling specification.',
      trigger_kind: 'manual',
      schedule_expr: null,
      event_key: null,
      definition: {
        steps: [
          { intent: 'execute', role: 'specialist', objective: 'Record test results with provenance' },
          { intent: 'verify', role: 'master', objective: 'Verify results against the controlling specification' },
        ],
      },
    }),
  ];

  // ---- agent templates ---------------------------------------------------

  const TEMPLATES = [
    {
      key: 'research-analyst',
      name: 'Research Analyst',
      role_level: 'specialist' as const,
      description: 'Gathers and cites evidence within a single project scope.',
      contract: {
        mission:
          'Assemble sourced, verifiable evidence for a stated question, and state plainly what the evidence does not cover.',
        allowed_tools: ['memory.read', 'memory.write', 'report.compose'],
        access_level: 'write' as const,
        activation_mode: 'ephemeral' as const,
        concurrency_limit: 3,
        quality_gates: ['gate.standard_delivery'],
        data_scope: { memory_layers: ['working', 'episodic', 'project', 'authoritative'], domains: [], excluded_domains: [] },
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project', 'authoritative'],
          writable_layers: ['working', 'episodic'],
          may_write_authoritative: false,
          min_write_confidence: 0.5,
        },
        persona: {
          tone: 'neutral, evidence-first',
          rules: ['Cite every claim.', 'Say what you could not establish.'],
          anti_patterns: ['Presenting inference as fact'],
        },
        kpis: [{ key: 'evidence_density', description: 'Cited claims per finding', unit: 'ratio', target: 1 }],
        rework_policy: { max_attempts: 3, on_exhaustion: 'capa_and_escalate', capa_after_failures: 2 },
      },
    },
    {
      key: 'content-producer',
      name: 'Content Producer',
      role_level: 'specialist' as const,
      description: 'Drafts against an approved outline using supplied evidence.',
      contract: {
        mission: 'Produce a draft that satisfies the stated acceptance criteria using only the evidence supplied to it.',
        allowed_tools: ['memory.read', 'memory.write', 'report.compose'],
        access_level: 'write' as const,
        activation_mode: 'ephemeral' as const,
        concurrency_limit: 2,
        quality_gates: ['gate.standard_delivery'],
        data_scope: { memory_layers: ['working', 'episodic', 'project'], domains: [], excluded_domains: [] },
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project'],
          writable_layers: ['working'],
          may_write_authoritative: false,
          min_write_confidence: 0.5,
        },
        persona: { tone: 'clear, plain', rules: ['Never invent a source.'], anti_patterns: ['Filler prose'] },
        rework_policy: { max_attempts: 2, on_exhaustion: 'capa_and_escalate', capa_after_failures: 1 },
      },
    },
    {
      key: 'quality-reviewer',
      name: 'Quality Reviewer',
      role_level: 'specialist' as const,
      description: 'Independent evaluator. Never reviews its own work.',
      contract: {
        mission: 'Evaluate delivered artifacts against their gates and record the evidence for every verdict.',
        allowed_tools: ['memory.read', 'quality.evaluate', 'registry.inspect'],
        access_level: 'write' as const,
        activation_mode: 'session' as const,
        concurrency_limit: 4,
        quality_gates: ['gate.standard_delivery'],
        data_scope: { memory_layers: ['working', 'episodic', 'project', 'authoritative'], domains: [], excluded_domains: [] },
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project', 'authoritative'],
          writable_layers: ['working'],
          may_write_authoritative: false,
        },
        persona: {
          tone: 'exacting',
          rules: ['A criterion you cannot check has not passed.'],
          anti_patterns: ['Approving to unblock a deadline'],
        },
      },
    },
    {
      key: 'ops-coordinator',
      name: 'Operations Coordinator',
      role_level: 'specialist' as const,
      description: 'Turns a loop definition into scheduled tasks and chases their state.',
      contract: {
        mission: 'Keep a workflow loop moving: create the tasks it needs and surface what is stuck.',
        allowed_tools: ['registry.inspect', 'memory.read', 'task.create', 'report.compose'],
        access_level: 'write' as const,
        activation_mode: 'scheduled' as const,
        concurrency_limit: 2,
        quality_gates: ['gate.schema'],
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project'],
          writable_layers: ['working', 'episodic'],
          may_write_authoritative: false,
        },
      },
    },
    {
      key: 'compliance-steward',
      name: 'Compliance Steward',
      role_level: 'specialist' as const,
      description: 'Maintains authoritative standards records under human approval.',
      contract: {
        mission:
          'Keep the authoritative record of standards and approved policy accurate, and refuse to promote anything a human has not approved.',
        allowed_tools: ['memory.read', 'memory.write', 'memory.write_authoritative', 'report.compose'],
        access_level: 'admin' as const,
        activation_mode: 'manual' as const,
        concurrency_limit: 1,
        quality_gates: ['gate.provenance', 'gate.standard_delivery'],
        data_scope: {
          memory_layers: ['working', 'episodic', 'project', 'authoritative'],
          domains: ['compliance.records'],
          excluded_domains: [],
        },
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project', 'authoritative'],
          writable_layers: ['working', 'episodic', 'project', 'authoritative'],
          may_write_authoritative: true,
        },
        persona: {
          tone: 'precise',
          rules: ['An unapproved fact stays inferred.'],
          anti_patterns: ['Promoting inference to policy'],
        },
      },
    },
  ];

  const templates = TEMPLATES.map((t) =>
    repos.agents.insertTemplate({
      template_id: newId('template'),
      key: t.key,
      name: t.name,
      role_level: t.role_level,
      version: 1,
      description: t.description,
      contract_template: t.contract as Record<string, unknown>,
      status: 'active',
    }),
  );

  // ---- Chief Agent Architect ---------------------------------------------

  const OWNER_GATED_TOOLS = [
    'finance.commit_payment',
    'contract.finalize',
    'secret.grant',
    'publish.external',
    'data.destructive_action',
    'policy.update',
  ];

  const chiefTools = [
    'registry.inspect',
    'memory.read',
    'memory.write',
    'memory.write_authoritative',
    'task.create',
    'packet.delegate',
    'agent.instantiate',
    'quality.evaluate',
    'report.compose',
    // Present so the Chief can *request* these. Executing any of them still
    // requires an Owner approval and a token bound to the exact action.
    ...OWNER_GATED_TOOLS,
  ];

  const chief = registry.createDraft(
    {
      display_name: 'Chief Agent Architect',
      role_level: 'chief',
      mission:
        'Hold system-wide understanding of the workforce, design reusable workflow loops, delegate governed work, ' +
        'challenge weak assumptions, and escalate every decision that belongs to the Owner.',
      parent_agent_id: null,
      contract: {
        owned_workflow_loops: [],
        allowed_child_templates: templates.map((t) => t.key),
        project_scope: { project_ids: [], all_projects: true },
        data_scope: {
          memory_layers: ['working', 'episodic', 'project', 'authoritative'],
          domains: ['compliance.records', 'finance.summary'],
          excluded_domains: [],
        },
        allowed_tools: chiefTools,
        forbidden_actions: [],
        access_level: 'admin',
        persona: {
          tone: 'neutral, evidence-first, systems-minded, concise',
          rules: [
            'Do not agree reflexively; state where the evidence is thin.',
            'Prefer a reusable loop to a one-off task.',
            'Name the Owner decision explicitly rather than working around it.',
            'Surface duplicate roles and permission risk before proposing more capacity.',
          ],
          anti_patterns: [
            'Agreeing with the Owner to avoid friction',
            'Proposing headcount where a loop would do',
            'Silently widening its own scope',
          ],
        },
        required_knowledge_sources: [
          { key: 'policy.governance', layer: 'authoritative', required: true, description: 'Owner-gated action classes' },
        ],
        memory_policy: {
          readable_layers: ['working', 'episodic', 'project', 'authoritative'],
          writable_layers: ['working', 'episodic', 'project', 'authoritative'],
          may_write_authoritative: true,
          min_write_confidence: 0.5,
        },
        budget_policy: {
          max_model_calls: 500,
          max_tokens: 5_000_000,
          max_estimated_cost: 200,
          max_tool_calls: 2000,
          max_retries: 3,
        },
        time_limits: { max_task_seconds: 1800, max_tool_call_seconds: 60, idle_timeout_seconds: 1800 },
        kpis: [
          { key: 'escalation_precision', description: 'Escalations the Owner acted on', unit: 'ratio', target: 0.8 },
          { key: 'duplicate_agents', description: 'Duplicate capability pairs outstanding', unit: 'count', target: 0, direction: 'lower_is_better' },
        ],
        quality_gates: ['gate.standard_delivery'],
        escalation_rules: [
          { condition: 'quality_failures>=2', escalate_to: 'owner', note: 'Repeated quality failure is an Owner decision.' },
          { condition: 'budget_hard_exceeded', escalate_to: 'owner', note: 'Only the Owner may raise a budget.' },
        ],
        rework_policy: { max_attempts: 2, on_exhaustion: 'capa_and_escalate', capa_after_failures: 1 },
        human_approval_requirements: {
          approval_required_at_or_above: 'high',
          always_require: OWNER_GATED_TOOLS,
          never_permitted: [],
        },
        concurrency_limit: 1,
        activation_mode: 'session',
        metadata: { reports_to: 'owner' },
      },
    },
    { type: 'owner', id: OWNER },
  );

  activate(runtime, chief.agent_id);

  // ---- master agents -----------------------------------------------------

  const masters: AgentRecord[] = [];

  const masterSpecs = [
    {
      name: 'Operations Master',
      project: portfolio,
      loops: [loops[0]!.loop_id],
      templates: ['ops-coordinator', 'research-analyst', 'quality-reviewer'],
      mission: 'Own the portfolio operating cadence and keep every loop in it running and evidenced.',
      domains: ['finance.summary'],
    },
    {
      name: 'Content Master',
      project: content,
      loops: [loops[1]!.loop_id],
      templates: ['research-analyst', 'content-producer', 'quality-reviewer'],
      mission: 'Own the research-to-publication pipeline and the standard every draft is held to.',
      domains: [],
    },
    {
      name: 'Hardware Programme Master',
      project: hardware,
      loops: [loops[2]!.loop_id],
      templates: ['research-analyst', 'quality-reviewer', 'compliance-steward'],
      mission: 'Own hardware programme evidence: specifications, test records and their compliance state.',
      domains: ['compliance.records'],
    },
  ];

  for (const spec of masterSpecs) {
    const master = registry.createDraft(
      {
        display_name: spec.name,
        role_level: 'master',
        mission: spec.mission,
        parent_agent_id: chief.agent_id,
        contract: {
          owned_workflow_loops: spec.loops,
          allowed_child_templates: spec.templates,
          project_scope: { project_ids: [spec.project.project_id], all_projects: false },
          data_scope: {
            memory_layers: ['working', 'episodic', 'project', 'authoritative'],
            domains: spec.domains,
            excluded_domains: [],
          },
          allowed_tools: [
            'registry.inspect',
            'memory.read',
            'memory.write',
            'task.create',
            'packet.delegate',
            'agent.instantiate',
            'quality.evaluate',
            'report.compose',
          ],
          forbidden_actions: OWNER_GATED_TOOLS,
          access_level: 'write',
          persona: {
            tone: 'operational, direct',
            rules: ['Escalate rather than widen your own scope.'],
            anti_patterns: ['Absorbing an Owner decision'],
          },
          required_knowledge_sources: [],
          memory_policy: {
            readable_layers: ['working', 'episodic', 'project', 'authoritative'],
            writable_layers: ['working', 'episodic', 'project'],
            may_write_authoritative: false,
            min_write_confidence: 0.5,
          },
          budget_policy: {
            max_model_calls: 200,
            max_tokens: 2_000_000,
            max_estimated_cost: 50,
            max_tool_calls: 800,
            max_retries: 3,
          },
          time_limits: { max_task_seconds: 1200, max_tool_call_seconds: 60, idle_timeout_seconds: 900 },
          kpis: [{ key: 'loop_completion', description: 'Loops completed without escalation', unit: 'ratio', target: 0.9 }],
          quality_gates: ['gate.standard_delivery'],
          escalation_rules: [{ condition: 'quality_failures>=2', escalate_to: chief.agent_id, note: '' }],
          rework_policy: { max_attempts: 3, on_exhaustion: 'capa_and_escalate', capa_after_failures: 2 },
          human_approval_requirements: {
            approval_required_at_or_above: 'high',
            always_require: [],
            never_permitted: OWNER_GATED_TOOLS,
          },
          concurrency_limit: 2,
          activation_mode: 'event',
          metadata: {},
        },
      },
      { type: 'owner', id: OWNER },
    );
    activate(runtime, master.agent_id);
    masters.push(master);
  }

  // ---- budgets -----------------------------------------------------------

  for (const project of projects) {
    runtime.budgets.define('project', project.project_id, {
      max_model_calls: 5000,
      max_tokens: 50_000_000,
      max_estimated_cost: 500,
      max_tool_calls: 20_000,
      soft_limit_ratio: 0.8,
    });
  }
  runtime.budgets.define('agent', chief.agent_id, {
    max_model_calls: 500,
    max_estimated_cost: 200,
    max_tool_calls: 2000,
  });
  for (const master of masters) {
    runtime.budgets.define('agent', master.agent_id, {
      max_model_calls: 200,
      max_estimated_cost: 50,
      max_tool_calls: 800,
    });
  }

  // ---- authoritative memory ----------------------------------------------
  //
  // Written directly through the repository, not through an agent: these are
  // Owner-supplied canonical facts, and the memory service would rightly
  // refuse an agent trying to author them.

  const authoritative = [
    {
      key: 'policy.governance',
      scope: null,
      content: {
        owner_gated_action_classes: [
          'financial commitments or payments',
          'binding contracts or legal finalization',
          'credential/secret grants',
          'destructive production actions',
          'public/external publishing where material risk exists',
          'critical policy/permission changes',
          'irreversible data actions',
        ],
        rule: 'An agent may request any of these. Execution requires an explicit Owner approval and a short-lived execution token bound to the exact action, arguments, actor, project and trace.',
      },
    },
    {
      key: 'policy.cross_project_access',
      scope: null,
      content: { rule: 'Cross-project access is denied by default. Scope is granted per agent contract and never inherited sideways.' },
    },
    {
      key: 'standard.delivery',
      scope: null,
      content: {
        rule: 'Delivered work must validate against its declared output schema, satisfy every acceptance criterion, carry resolvable evidence, and show no policy denials on its task.',
      },
    },
    {
      key: 'compliance.iso9001.records',
      scope: hardware.project_id,
      content: {
        standard: 'ISO 9001:2015',
        clause: '7.5 Documented information',
        requirement: 'Test evidence must be identifiable, traceable to the controlling specification, and retained under version control.',
      },
    },
  ];

  for (const record of authoritative) {
    repos.memory.insert({
      layer: 'authoritative',
      scope_project_id: record.scope,
      agent_id: null,
      key: record.key,
      content: record.content,
      source: 'owner',
      provenance: {
        origin: 'human',
        origin_id: OWNER,
        trace_id: null,
        task_id: null,
        evidence_refs: [],
        note: 'Supplied by the Owner at bootstrap.',
      },
      confidence: null,
      authoritative: true,
      supersedes_id: null,
      ttl_expires_at: null,
    });
  }

  // ---- credential references (never values) ------------------------------

  repos.governance.insertSecretRef({
    key: 'payments.provider',
    provider: 'env',
    env_var: 'WORKFORCE_PAYMENTS_TOKEN',
    description: 'Payment rail credential. Resolved from the process environment at call time; never stored.',
    project_id: null,
  });
  repos.governance.insertSecretRef({
    key: 'publishing.cms',
    provider: 'env',
    env_var: 'WORKFORCE_CMS_TOKEN',
    description: 'CMS publishing credential for the content engine.',
    project_id: content.project_id,
  });

  bootstrapLoopJobs(runtime);

  runtime.audit.append({
    kind: 'system.seeded',
    actor_type: 'owner',
    actor_id: OWNER,
    severity: 'security',
    payload: {
      projects: projects.map((p) => p.key),
      agents: [chief.agent_id, ...masters.map((m) => m.agent_id)],
    },
  });

  return {
    seeded: true,
    projects: projects.length,
    loops: loops.length,
    templates: templates.length,
    agents: [chief.agent_id, ...masters.map((m) => m.agent_id)],
    memory_records: authoritative.length,
  };
}

/** Walk an agent through the full activation gate. Throws if any step fails. */
function activate(runtime: Runtime, agentId: string): void {
  const validation = runtime.registry.validate(agentId);
  if (!validation.valid) {
    throw new Error(
      `seed: agent ${agentId} failed contract validation: ${validation.issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
    );
  }
  const tests = runtime.registry.runTests(agentId);
  if (!tests.passed) {
    throw new Error(
      `seed: agent ${agentId} failed required tests: ${tests.cases.filter((c) => !c.passed).map((c) => `${c.name} (${c.detail})`).join('; ')}`,
    );
  }
  runtime.registry.activate(agentId, OWNER);
}
