# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Skills for Context Engineering — an open collection of 14 Agent Skills teaching context engineering principles for production AI agent systems. Skills are platform-agnostic (Claude Code, Cursor, GitHub Copilot, any Open Plugins-conformant tool).

Context engineering is the discipline of curating everything that enters a model's context window (system prompts, tool definitions, retrieved documents, message history, tool outputs) to maximize signal within limited attention budget.

## Repository Structure

- `skills/` — 14 skill directories, each containing a `SKILL.md` with YAML frontmatter (`name`, `description`) and optional `references/` and `scripts/` subdirectories
- `examples/` — 5 complete demonstration projects (digital-brain-skill, llm-as-judge-skills, book-sft-pipeline, x-to-book-system, interleaved-thinking)
- `docs/` — Research materials and reference documentation
- `researcher/` — Research output examples
- `template/SKILL.md` — Canonical skill template (use when creating new skills)
- `SKILL.md` (root) — Collection-level metadata and skill map
- `.claude-plugin/marketplace.json` — Claude Code marketplace manifest (single `context-engineering` plugin bundling all 14 skills)
- `.plugin/plugin.json` — Open Plugins format manifest (kept version-synced with the marketplace manifest, currently v2.1.0)

## Build & Test Commands

No top-level build system — skills are pure markdown. Individual example projects have their own tooling:

### examples/llm-as-judge-skills (TypeScript, Node >= 18)
```
cd examples/llm-as-judge-skills
npm install
npm run build        # tsc
npm test             # vitest run (19 tests)
npx vitest run tests/<file>.test.ts   # single test file
npm run lint         # eslint src tests examples
npm run format       # prettier
npm run typecheck    # tsc --noEmit
```

### examples/interleaved-thinking (Python >= 3.10)
```
cd examples/interleaved-thinking
pip install -e ".[dev]"                   # installs the `rto` CLI entry point
pytest                                    # pytest + pytest-asyncio
pytest tests/test_models.py::<test_name>  # single test
ruff check .                              # linting (100 char line length)
```

### examples/digital-brain-skill (Node.js wrapper around Python scripts)
```
cd examples/digital-brain-skill
npm run setup            # node scripts/setup.js
npm run weekly-review    # python3 agents/scripts/weekly_review.py
npm run content-ideas
npm run stale-contacts
```

`book-sft-pipeline` and `x-to-book-system` are documentation/PRD examples with no build tooling.

## Skill Authoring Rules

When creating or editing skills:

1. **SKILL.md must stay under 500 lines** — move detailed content to `references/` directory
2. **YAML frontmatter is required** — must include `name` and `description` fields
3. **Folder naming**: lowercase with hyphens (e.g., `context-fundamentals`)
4. **Write in third person** — descriptions are injected into system prompts; inconsistent POV causes discovery issues
5. **Platform-agnostic** — no vendor-locked examples or platform-specific tool names without abstraction
6. **Token-conscious** — challenge each paragraph: "Does Claude really need this?" Assume advanced audience
7. **Include a Gotchas section** — experience-derived failure modes are the highest-signal content in any skill
8. **One focus per skill** — if a topic grows too large, split into multiple skills with clear dependencies
9. **Update root README.md** when adding new skills (skills tables, Skill Triggers table, and individual-skill list)
10. **Update both manifests** when adding skills: add the skill path to the plugin's `skills` array in `.claude-plugin/marketplace.json`, and keep `.plugin/plugin.json` version/description in sync

## Plugin Architecture

All 14 skills are distributed as a single plugin (`context-engineering`) in the marketplace manifest. This avoids cache duplication — Claude Code caches each plugin's `source` directory separately, so multiple plugins pointing to `source: "./"` would each cache a full copy of the repo.

Progressive disclosure pattern: only skill names/descriptions load at startup; full content loads on activation.

## Key Design Principles

- **Context quality over quantity** — attention scarcity and lost-in-middle phenomenon mean more context is not always better
- **Sub-agents isolate context** — they exist to manage attention budget, not simulate org roles
- **Skills reference each other** — use plain text skill names (not links) in Integration sections to avoid cross-directory reference issues
- **Examples use Python pseudocode** — conceptual demonstrations that work across environments, not production-ready implementations
