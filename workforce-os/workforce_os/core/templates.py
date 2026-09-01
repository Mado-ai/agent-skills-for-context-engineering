"""Agent templates and dynamic specialist instantiation.

A template is a parameterised contract. Instantiating one produces a fully validated
agent whose scope is capped by the template and, when instantiated by another agent,
further attenuated to that agent's own scope. This is how the system scales to many
specialist definitions while only creating what demand requires.
"""

from __future__ import annotations

import json
import re

from ..errors import NotFoundError, PolicyDenied, ValidationError
from ..schemas import (
    Budget, Scope, canonical_json, new_id, require, utcnow, _NAME_RE,
)

_PLACEHOLDER = re.compile(r"\{\{\s*([a-z0-9_]+)\s*\}\}")


class TemplateService:
    def __init__(self, db, events, registry, config):
        self.db = db
        self.events = events
        self.registry = registry
        self.config = config

    # ------------------------------------------------------------------ authoring

    def create(self, data: dict, *, actor_id: str, project_id: str | None = None) -> dict:
        name = (data.get("name") or "").strip()
        require(bool(_NAME_RE.match(name)), "template name must be 2-64 valid characters", "name")

        role = (data.get("role") or "").strip()
        require(role in ("specialist", "evaluator", "operator", "project_lead"),
                "templates may only define specialist, evaluator, operator or project_lead roles", "role")

        prompt_template = (data.get("prompt_template") or "").strip()
        require(len(prompt_template) >= 10, "prompt_template must be at least 10 characters",
                "prompt_template")

        parameters = data.get("parameters") or []
        require(isinstance(parameters, list) and all(isinstance(p, str) for p in parameters),
                "parameters must be a list of strings", "parameters")

        # Every placeholder in the prompt must be a declared parameter.
        undeclared = sorted(set(_PLACEHOLDER.findall(prompt_template)) - set(parameters))
        require(not undeclared, f"prompt_template uses undeclared parameters: {undeclared}",
                "prompt_template")

        scope = Scope.parse(data.get("allowed_tools"), data.get("data_domains"),
                            data.get("action_types"))
        budget = Budget.parse(data.get("budget"))

        level = data.get("level", 2)
        require(isinstance(level, int) and 1 <= level <= 4, "template level must be 1-4", "level")

        template = {"id": new_id("tpl"), "project_id": project_id, "name": name, "role": role,
                    "level": level, "prompt_template": prompt_template,
                    "allowed_tools": canonical_json(list(scope.allowed_tools)),
                    "data_domains": canonical_json(list(scope.data_domains)),
                    "action_types": canonical_json(list(scope.action_types)),
                    "budget": canonical_json(budget.to_dict()),
                    "parameters": canonical_json(parameters),
                    "provider_model": (data.get("provider_model") or "local-echo").strip(),
                    "created_at": utcnow()}
        try:
            self.db.execute(
                """INSERT INTO agent_templates (id, project_id, name, role, level, prompt_template,
                       allowed_tools, data_domains, action_types, budget, parameters,
                       provider_model, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(template[k] for k in ("id", "project_id", "name", "role", "level",
                                            "prompt_template", "allowed_tools", "data_domains",
                                            "action_types", "budget", "parameters",
                                            "provider_model", "created_at")))
        except Exception as exc:
            if "UNIQUE" in str(exc):
                raise ValidationError(f"A template named {name!r} already exists",
                                      details={"field": "name"}) from exc
            raise
        self.events.append("template.created", actor_type="owner", actor_id=actor_id,
                           project_id=project_id, payload={"template_id": template["id"], "name": name})
        return self.get(template["id"])

    # -------------------------------------------------------------- instantiation

    def instantiate(self, template_id: str, project_id: str, params: dict, *, actor_id: str,
                    instantiated_by_agent_id: str | None = None, agent_name: str | None = None,
                    activate: bool = True) -> dict:
        """Create a live specialist from a template.

        When an agent (rather than the Owner) instantiates, the result is additionally
        attenuated to that agent's own scope — an agent can never spawn a subordinate
        more powerful than itself.
        """
        template = self.get(template_id)
        if template["project_id"] and template["project_id"] != project_id:
            raise PolicyDenied("Template belongs to a different project", code="project_isolation")

        declared = json.loads(template["parameters"])
        require(isinstance(params, dict), "params must be an object", "params")
        missing = sorted(set(declared) - set(params))
        require(not missing, f"missing required template parameter(s): {missing}", "params")
        unknown = sorted(set(params) - set(declared))
        require(not unknown, f"unknown template parameter(s): {unknown}", "params")
        for key, value in params.items():
            require(isinstance(value, str), f"params.{key} must be a string", f"params.{key}")

        system_prompt = _PLACEHOLDER.sub(lambda m: params[m.group(1)], template["prompt_template"])

        scope = Scope(tuple(json.loads(template["allowed_tools"])),
                      tuple(json.loads(template["data_domains"])),
                      tuple(json.loads(template["action_types"])))
        budget = Budget.parse(json.loads(template["budget"]))
        level = template["level"]

        if instantiated_by_agent_id:
            parent_agent = self.registry.get(instantiated_by_agent_id)
            if parent_agent["project_id"] != project_id:
                raise PolicyDenied("Cannot instantiate an agent into another project",
                                   code="project_isolation")
            if parent_agent["status"] != "active":
                raise PolicyDenied(f"Instantiating agent is {parent_agent['status']!r}, not active",
                                   code="agent_not_active")
            parent_contract = self.registry.get_contract(instantiated_by_agent_id)
            scope = scope.intersect(parent_contract.scope)
            budget = budget.intersect(parent_contract.budget)
            if level >= parent_agent["level"]:
                level = parent_agent["level"] - 1
            if level < 1:
                raise PolicyDenied(
                    "Instantiating agent is too junior to create a subordinate",
                    code="delegation_upward_denied",
                    details={"parent_level": parent_agent["level"]})

        base_name = agent_name or f"{template['name']} {new_id('')[1:7]}"
        spec = {"name": base_name[:64], "role": template["role"], "level": level,
                "system_prompt": system_prompt, "allowed_tools": list(scope.allowed_tools),
                "data_domains": list(scope.data_domains), "action_types": list(scope.action_types),
                "budget": budget.to_dict(), "provider_model": template["provider_model"],
                "template_id": template_id}

        agent = self.registry.build(project_id, spec, actor_id=actor_id,
                                    parent_agent_id=instantiated_by_agent_id)
        if activate:
            agent = self.registry.set_status(agent["id"], "active", actor_id=actor_id,
                                             actor_type="agent" if instantiated_by_agent_id else "owner")

        self.events.append("agent.instantiated", actor_type="agent" if instantiated_by_agent_id else "owner",
                           actor_id=actor_id, project_id=project_id,
                           payload={"agent_id": agent["id"], "template_id": template_id,
                                    "instantiated_by": instantiated_by_agent_id, "level": level})
        return agent

    # ----------------------------------------------------------------------- reads

    def get(self, template_id: str) -> dict:
        row = self.db.query_one("SELECT * FROM agent_templates WHERE id = ?", (template_id,))
        if not row:
            raise NotFoundError(f"Template {template_id} not found")
        return row

    def hydrate(self, template: dict) -> dict:
        out = dict(template)
        for key in ("allowed_tools", "data_domains", "action_types", "budget", "parameters"):
            out[key] = json.loads(template[key])
        return out

    def list(self, *, project_id: str | None = None) -> list[dict]:
        if project_id:
            return self.db.query(
                "SELECT * FROM agent_templates WHERE project_id IS NULL OR project_id = ? ORDER BY name",
                (project_id,))
        return self.db.query("SELECT * FROM agent_templates ORDER BY name")
