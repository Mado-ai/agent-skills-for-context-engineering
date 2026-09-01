"""The built-in tool catalogue.

v0.4 ships only pure, local tools. Nothing here opens a socket, spawns a process, or
drives a browser — that is a deliberate capability boundary, not an oversight, and
`test_security.py` asserts it stays true.

Each tool declares the action type and data domains it needs, so the gateway can check
an agent's contract against the *declared* requirements rather than trusting arguments.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

from ..errors import ValidationError
from ..schemas import require


@dataclass(frozen=True)
class ToolResult:
    """A tool's return value.

    `confirmed` is the runtime's honesty flag: it is True only when the tool actually
    performed the work it describes. A tool that merely records an intent returns False,
    and the gateway will never report that call as a completed external action.
    """

    output: dict
    confirmed: bool = True
    cost_usd: float = 0.0
    tokens: int = 0
    note: str = ""


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    action_type: str
    data_domains: tuple[str, ...]
    handler: Callable[[dict, dict], ToolResult]
    declared_risk: str = "low"
    estimated_cost_usd: float = 0.0
    parameters: dict = field(default_factory=dict)

    def describe(self) -> dict:
        return {"name": self.name, "description": self.description,
                "action_type": self.action_type, "data_domains": list(self.data_domains),
                "declared_risk": self.declared_risk,
                "estimated_cost_usd": self.estimated_cost_usd,
                "parameters": self.parameters}


def _require_str(args: dict, key: str, *, max_len: int = 20000) -> str:
    value = args.get(key)
    require(isinstance(value, str) and value.strip(), f"{key} must be a non-empty string", key)
    require(len(value) <= max_len, f"{key} exceeds {max_len} characters", key)
    return value


# ------------------------------------------------------------------ tool handlers


def _echo(args: dict, context: dict) -> ToolResult:
    message = _require_str(args, "message", max_len=4000)
    return ToolResult(output={"echoed": message}, confirmed=True)


def _text_stats(args: dict, context: dict) -> ToolResult:
    text = _require_str(args, "text", max_len=100_000)
    words = re.findall(r"\b[\w'-]+\b", text)
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    return ToolResult(output={
        "characters": len(text), "words": len(words), "sentences": len(sentences),
        "unique_words": len({w.lower() for w in words}),
        "average_word_length": round(sum(len(w) for w in words) / len(words), 2) if words else 0.0,
    }, confirmed=True)


def _summarize(args: dict, context: dict) -> ToolResult:
    """Deterministic extractive summary — leading sentences up to a sentence budget."""
    text = _require_str(args, "text", max_len=100_000)
    max_sentences = args.get("max_sentences", 3)
    require(isinstance(max_sentences, int) and 1 <= max_sentences <= 20,
            "max_sentences must be between 1 and 20", "max_sentences")
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
    summary = " ".join(sentences[:max_sentences])
    return ToolResult(output={"summary": summary, "sentences_used": min(len(sentences), max_sentences),
                              "sentences_available": len(sentences)},
                      confirmed=True, tokens=len(text.split()))


def _draft_document(args: dict, context: dict) -> ToolResult:
    title = _require_str(args, "title", max_len=200)
    sections = args.get("sections", [])
    require(isinstance(sections, list) and sections, "sections must be a non-empty list", "sections")
    body = []
    for index, section in enumerate(sections, start=1):
        require(isinstance(section, dict), "each section must be an object", "sections")
        heading = _require_str(section, "heading", max_len=200)
        content = _require_str(section, "content", max_len=20000)
        body.append(f"## {index}. {heading}\n\n{content}")
    document = f"# {title}\n\n" + "\n\n".join(body)
    return ToolResult(output={"document": document, "sections": len(sections),
                              "characters": len(document)}, confirmed=True)


def _record_decision(args: dict, context: dict) -> ToolResult:
    decision = _require_str(args, "decision", max_len=2000)
    rationale = _require_str(args, "rationale", max_len=8000)
    return ToolResult(output={"decision": decision, "rationale": rationale,
                              "recorded_by": context.get("agent_id")}, confirmed=True)


def _request_external_publication(args: dict, context: dict) -> ToolResult:
    """High-risk by declaration, and deliberately *not* an external action.

    v0.4 performs no outbound execution. This tool records a reviewed intent and returns
    `confirmed=False`, so the runtime reports it as attempted rather than done. That is
    the honest answer until a real adapter exists.
    """
    destination = _require_str(args, "destination", max_len=200)
    content = _require_str(args, "content", max_len=20000)
    return ToolResult(
        output={"status": "recorded_intent", "destination": destination,
                "content_length": len(content),
                "notice": "v0.4 performs no external execution; nothing was published."},
        confirmed=False,
        note="No external call was made; this records an approved intent only.")


BUILTIN_TOOLS: dict[str, ToolSpec] = {
    spec.name: spec for spec in (
        ToolSpec(name="echo", description="Return the supplied message unchanged.",
                 action_type="read", data_domains=("public",), handler=_echo,
                 parameters={"message": "string"}),
        ToolSpec(name="text_stats", description="Compute counts and averages over a text.",
                 action_type="analyze", data_domains=("public",), handler=_text_stats,
                 parameters={"text": "string"}),
        ToolSpec(name="summarize", description="Extractive summary of the leading sentences.",
                 action_type="analyze", data_domains=("public",), handler=_summarize,
                 parameters={"text": "string", "max_sentences": "int (1-20, optional)"}),
        ToolSpec(name="draft_document", description="Assemble a titled markdown document.",
                 action_type="write", data_domains=("internal",), handler=_draft_document,
                 parameters={"title": "string", "sections": "list of {heading, content}"}),
        ToolSpec(name="record_decision", description="Record a decision and its rationale.",
                 action_type="write", data_domains=("internal",), handler=_record_decision,
                 parameters={"decision": "string", "rationale": "string"}),
        ToolSpec(name="request_external_publication",
                 description="Record an Owner-approved intent to publish externally. "
                             "Performs no outbound call in v0.4.",
                 action_type="transact", data_domains=("public",),
                 handler=_request_external_publication, declared_risk="high",
                 estimated_cost_usd=0.0,
                 parameters={"destination": "string", "content": "string"}),
    )
}


class ToolRegistry:
    """The set of tools the gateway will consider. Nothing outside it is callable."""

    def __init__(self, tools: dict[str, ToolSpec] | None = None):
        self._tools = dict(BUILTIN_TOOLS if tools is None else tools)

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def names(self) -> set[str]:
        return set(self._tools)

    def describe_all(self) -> list[dict]:
        return [spec.describe() for spec in sorted(self._tools.values(), key=lambda s: s.name)]

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValidationError(f"Tool {spec.name!r} is already registered",
                                  details={"field": "name"})
        self._tools[spec.name] = spec
