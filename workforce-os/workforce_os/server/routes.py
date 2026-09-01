"""Route table and handlers.

Each handler is `(runtime, principal, params, query, body) -> (status, payload)`. The
route table declares its own auth requirement, so authority is visible at a glance
rather than buried inside handler bodies.
"""

from __future__ import annotations

from ..core.budgets import Spend
from ..errors import ValidationError
from ..policy.authority import assert_can_view_project, require_owner
from ..schemas import require


def _int(query: dict, key: str, default: int) -> int:
    raw = query.get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValidationError(f"{key} must be an integer", details={"field": key}) from exc


# --------------------------------------------------------------------- meta

def health(rt, principal, params, query, body):
    return 200, rt.health()


def list_tools(rt, principal, params, query, body):
    return 200, {"tools": rt.tools.describe_all(), "packet_kinds": rt.packets.known_kinds()}


def verify_audit(rt, principal, params, query, body):
    return 200, rt.events.verify_chain()


def list_events(rt, principal, params, query, body):
    return 200, {"events": rt.events.list(project_id=query.get("project_id"),
                                          event_type=query.get("event_type"),
                                          limit=_int(query, "limit", 100))}


# ----------------------------------------------------------------- projects

def create_project(rt, principal, params, query, body):
    require_owner(principal, "create_project")
    project = rt.projects.create(body.get("name", ""), body.get("description", ""),
                                 actor_id=principal.id)
    return 201, project


def list_projects(rt, principal, params, query, body):
    return 200, {"projects": rt.projects.list()}


def get_project(rt, principal, params, query, body):
    assert_can_view_project(principal, params["project_id"])
    return 200, rt.projects.get(params["project_id"])


# ------------------------------------------------------------------- agents

def build_agent(rt, principal, params, query, body):
    require_owner(principal, "build_agent")
    project_id = body.get("project_id") or params.get("project_id")
    require(isinstance(project_id, str) and project_id, "project_id is required", "project_id")
    agent = rt.agents.build(project_id, body.get("contract") or {}, actor_id=principal.id,
                            parent_agent_id=body.get("parent_agent_id"))
    return 201, agent


def list_agents(rt, principal, params, query, body):
    return 200, {"agents": rt.agents.list(project_id=query.get("project_id"),
                                          status=query.get("status"))}


def get_agent(rt, principal, params, query, body):
    agent = rt.agents.get(params["agent_id"])
    assert_can_view_project(principal, agent["project_id"])
    contract = rt.agents.get_contract(agent["id"])
    return 200, {"agent": agent, "contract": contract.to_dict(),
                 "versions": rt.agents.contract_versions(agent["id"]),
                 "budget": rt.budgets.agent_status(agent["id"], contract.budget).to_dict()}


def revise_agent(rt, principal, params, query, body):
    require_owner(principal, "revise_agent")
    return 200, rt.agents.revise(params["agent_id"], body.get("contract") or {},
                                 actor_id=principal.id)


def rollback_agent(rt, principal, params, query, body):
    require_owner(principal, "rollback_agent")
    version = body.get("version")
    require(isinstance(version, int), "version must be an integer", "version")
    return 200, rt.agents.rollback(params["agent_id"], version, actor_id=principal.id)


def set_agent_status(rt, principal, params, query, body):
    # Retirement and every other lifecycle change is an Owner decision.
    require_owner(principal, "set_agent_status")
    status = body.get("status", "")
    return 200, rt.agents.set_status(params["agent_id"], status, actor_id=principal.id)


# ---------------------------------------------------------------- templates

def create_template(rt, principal, params, query, body):
    require_owner(principal, "create_template")
    return 201, rt.templates.create(body, actor_id=principal.id,
                                    project_id=body.get("project_id"))


def list_templates(rt, principal, params, query, body):
    return 200, {"templates": [rt.templates.hydrate(t)
                               for t in rt.templates.list(project_id=query.get("project_id"))]}


def instantiate_template(rt, principal, params, query, body):
    require_owner(principal, "instantiate_template")
    project_id = body.get("project_id")
    require(isinstance(project_id, str) and project_id, "project_id is required", "project_id")
    agent = rt.templates.instantiate(
        params["template_id"], project_id, body.get("params") or {}, actor_id=principal.id,
        instantiated_by_agent_id=body.get("instantiated_by_agent_id"),
        agent_name=body.get("agent_name"))
    return 201, agent


# -------------------------------------------------------------------- tasks

def create_task(rt, principal, params, query, body):
    project_id = body.get("project_id")
    require(isinstance(project_id, str) and project_id, "project_id is required", "project_id")
    assert_can_view_project(principal, project_id)
    task = rt.tasks.create(project_id, body, actor_id=principal.id,
                           parent_task_id=body.get("parent_task_id"))
    return 201, rt.tasks.hydrate(task)


def list_tasks(rt, principal, params, query, body):
    return 200, {"tasks": [rt.tasks.hydrate(t) for t in rt.tasks.list(
        project_id=query.get("project_id"), status=query.get("status"),
        assignee_agent_id=query.get("assignee_agent_id"), limit=_int(query, "limit", 100))]}


def get_task(rt, principal, params, query, body):
    task = rt.tasks.get(params["task_id"])
    assert_can_view_project(principal, task["project_id"])
    return 200, {"task": rt.tasks.hydrate(task),
                 "budget": rt.budgets.task_status(task["id"]).to_dict(),
                 "evaluations": rt.quality.evaluations_for(task["id"]),
                 "delegations": rt.delegation.for_task(task["id"]),
                 "telemetry": rt.telemetry.summary(task_id=task["id"])["totals"]}


def set_task_status(rt, principal, params, query, body):
    task = rt.tasks.get(params["task_id"])
    assert_can_view_project(principal, task["project_id"])
    return 200, rt.tasks.hydrate(rt.tasks.set_status(params["task_id"], body.get("status", ""),
                                                     actor_id=principal.id,
                                                     result=body.get("result")))


# --------------------------------------------------------------- delegation

def delegate(rt, principal, params, query, body):
    for field in ("parent_agent_id", "child_agent_id", "parent_task_id", "packet_kind"):
        require(isinstance(body.get(field), str) and body[field], f"{field} is required", field)
    result = rt.delegation.delegate(
        parent_agent_id=body["parent_agent_id"], child_agent_id=body["child_agent_id"],
        parent_task_id=body["parent_task_id"], packet_kind=body["packet_kind"],
        packet_payload=body.get("packet_payload") or {},
        packet_schema_version=body.get("packet_schema_version", 1),
        subtask=body.get("subtask"), actor_id=principal.id)
    return 201, {"delegation": result["delegation"], "task": rt.tasks.hydrate(result["task"]),
                 "packet": rt.packets.hydrate(result["packet"])}


def delegation_graph(rt, principal, params, query, body):
    project_id = query.get("project_id")
    require(isinstance(project_id, str) and project_id, "project_id is required", "project_id")
    assert_can_view_project(principal, project_id)
    return 200, rt.delegation.graph(project_id)


# ------------------------------------------------------------------ gateway

def call_tool(rt, principal, params, query, body):
    for field in ("agent_id", "tool_name"):
        require(isinstance(body.get(field), str) and body[field], f"{field} is required", field)
    result = rt.gateway.call(agent_id=body["agent_id"], tool_name=body["tool_name"],
                             arguments=body.get("arguments") or {}, task_id=body.get("task_id"),
                             approval_token=body.get("approval_token"))
    return 200, result


def list_tool_calls(rt, principal, params, query, body):
    return 200, {"tool_calls": rt.gateway.calls_for(
        agent_id=query.get("agent_id"), task_id=query.get("task_id"),
        project_id=query.get("project_id"), limit=_int(query, "limit", 100))}


# ---------------------------------------------------------------- approvals

def list_approvals(rt, principal, params, query, body):
    return 200, {"approvals": [rt.approvals.hydrate(a) for a in rt.approvals.list_requests(
        project_id=query.get("project_id"), status=query.get("status", "pending"))]}


def approve_request(rt, principal, params, query, body):
    # Owner-only, enforced again inside the service.
    grant = rt.approvals.approve(params["request_id"], principal=principal,
                                 note=body.get("note", ""))
    return 200, {"request": grant["request"], "token": grant["token"],
                 "token_id": grant["token_id"], "expires_at": grant["expires_at"],
                 "notice": "This token is single-use, expires, and is bound to the "
                           "approved agent, tool and arguments."}


def reject_request(rt, principal, params, query, body):
    return 200, rt.approvals.reject(params["request_id"], principal=principal,
                                    note=body.get("note", ""))


# ------------------------------------------------------------------- memory

def write_memory(rt, principal, params, query, body):
    project_id = body.get("project_id")
    require(isinstance(project_id, str) and project_id, "project_id is required", "project_id")
    assert_can_view_project(principal, project_id)
    record = rt.memory.write(
        project_id=project_id, layer=body.get("layer", ""), key=body.get("key", ""),
        content=body.get("content", ""), provenance=body.get("provenance") or {},
        agent_id=body.get("agent_id"), task_id=body.get("task_id"),
        tags=body.get("tags"), confidence=body.get("confidence", 1.0))
    return 201, record


def read_memory(rt, principal, params, query, body):
    project_id = query.get("project_id")
    require(isinstance(project_id, str) and project_id, "project_id is required", "project_id")
    return 200, {"records": rt.memory.read(
        principal, project_id=project_id, layer=query.get("layer"),
        agent_id=query.get("agent_id"), task_id=query.get("task_id"),
        key=query.get("key"), limit=_int(query, "limit", 100))}


# ------------------------------------------------------------------ quality

def evaluate_task(rt, principal, params, query, body):
    require(isinstance(body.get("evaluator_agent_id"), str), "evaluator_agent_id is required",
            "evaluator_agent_id")
    score = body.get("score")
    require(isinstance(score, (int, float)), "score is required", "score")
    outcome = rt.quality.evaluate(params["task_id"],
                                  evaluator_agent_id=body["evaluator_agent_id"],
                                  score=score, findings=body.get("findings"),
                                  threshold=body.get("threshold"))
    return 201, {"evaluation": outcome["evaluation"],
                 "rework_task": rt.tasks.hydrate(outcome["rework_task"]) if outcome["rework_task"] else None,
                 "capa": outcome["capa"]}


def list_capas(rt, principal, params, query, body):
    return 200, {"capas": rt.quality.open_capas(project_id=query.get("project_id"))}


def close_capa(rt, principal, params, query, body):
    return 200, rt.quality.close_capa(params["capa_id"], principal=principal,
                                      root_cause=body.get("root_cause", ""),
                                      corrective_action=body.get("corrective_action", ""),
                                      preventive_action=body.get("preventive_action", ""))


# ---------------------------------------------------------------- telemetry

def telemetry_summary(rt, principal, params, query, body):
    return 200, rt.telemetry.summary(project_id=query.get("project_id"),
                                     agent_id=query.get("agent_id"),
                                     task_id=query.get("task_id"))


# ---------------------------------------------------------------- architect

def architect_view(rt, principal, params, query, body):
    return 200, rt.architect.system_view(principal)


def architect_brief(rt, principal, params, query, body):
    question = body.get("question", "")
    require(isinstance(question, str) and question.strip(), "question is required", "question")
    return 200, rt.architect.brief(principal, question)


# ---------------------------------------------------------------- scheduler

def schedule_job(rt, principal, params, query, body):
    require_owner(principal, "schedule_job")
    return 201, rt.scheduler.schedule(kind=body.get("kind", ""),
                                      run_at=body.get("run_at"),
                                      delay_seconds=body.get("delay_seconds", 0),
                                      payload=body.get("payload"),
                                      project_id=body.get("project_id"))


def list_jobs(rt, principal, params, query, body):
    return 200, {"jobs": rt.scheduler.pending(project_id=query.get("project_id"))}


# (method, path, handler, auth)  —  auth: "owner" | "any" | "public"
ROUTES = [
    ("GET",   "/api/health",                      health,                "public"),
    ("GET",   "/api/tools",                       list_tools,            "any"),
    ("GET",   "/api/audit/verify",                verify_audit,          "owner"),
    ("GET",   "/api/events",                      list_events,           "owner"),

    ("POST",  "/api/projects",                    create_project,        "owner"),
    ("GET",   "/api/projects",                    list_projects,         "any"),
    ("GET",   "/api/projects/{project_id}",       get_project,           "any"),

    ("POST",  "/api/agents",                      build_agent,           "owner"),
    ("GET",   "/api/agents",                      list_agents,           "any"),
    ("GET",   "/api/agents/{agent_id}",           get_agent,             "any"),
    ("POST",  "/api/agents/{agent_id}/revise",    revise_agent,          "owner"),
    ("POST",  "/api/agents/{agent_id}/rollback",  rollback_agent,        "owner"),
    ("POST",  "/api/agents/{agent_id}/status",    set_agent_status,      "owner"),

    ("POST",  "/api/templates",                   create_template,       "owner"),
    ("GET",   "/api/templates",                   list_templates,        "any"),
    ("POST",  "/api/templates/{template_id}/instantiate", instantiate_template, "owner"),

    ("POST",  "/api/tasks",                       create_task,           "any"),
    ("GET",   "/api/tasks",                       list_tasks,            "any"),
    ("GET",   "/api/tasks/{task_id}",             get_task,              "any"),
    ("POST",  "/api/tasks/{task_id}/status",      set_task_status,       "any"),
    ("POST",  "/api/tasks/{task_id}/evaluate",    evaluate_task,         "any"),

    ("POST",  "/api/delegations",                 delegate,              "any"),
    ("GET",   "/api/delegations/graph",           delegation_graph,      "any"),

    ("POST",  "/api/tool-calls",                  call_tool,             "any"),
    ("GET",   "/api/tool-calls",                  list_tool_calls,       "any"),

    ("GET",   "/api/approvals",                   list_approvals,        "owner"),
    ("POST",  "/api/approvals/{request_id}/approve", approve_request,    "owner"),
    ("POST",  "/api/approvals/{request_id}/reject",  reject_request,     "owner"),

    ("POST",  "/api/memory",                      write_memory,          "any"),
    ("GET",   "/api/memory",                      read_memory,           "any"),

    ("GET",   "/api/capas",                       list_capas,            "any"),
    ("POST",  "/api/capas/{capa_id}/close",       close_capa,            "owner"),

    ("GET",   "/api/telemetry",                   telemetry_summary,     "any"),

    ("GET",   "/api/architect/system-view",       architect_view,        "owner"),
    ("POST",  "/api/architect/brief",             architect_brief,       "owner"),

    ("POST",  "/api/jobs",                        schedule_job,          "owner"),
    ("GET",   "/api/jobs",                        list_jobs,             "any"),
]
