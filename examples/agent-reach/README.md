# Agent Reach

**Give an AI agent internet capability in one command — picked for you, installed for you, verified for you.**

*给你的 AI Agent 一键装上互联网能力：替你选好、装好、体检好。*

Agents without internet access are frozen at their training cutoff. The fix is a
web-search or fetch MCP server — but wiring one up means choosing between a dozen
providers of uneven quality, finding the right config file for your client,
getting its schema right, keeping your API key out of a file you might commit,
and discovering weeks later that the server silently stopped starting.

Agent Reach does all of it in one command, and then proves it works by speaking
MCP to the server it just installed.

```console
$ agent-reach install --profile research

Plan (research: search, fetch, extract, docs)

provider    covers         stability  cost      keys
----------  -------------  ---------  --------  ----------------
duckduckgo  search, fetch  72         free      none
context7    docs           78         freemium  CONTEXT7_API_KEY

Considered and skipped:
  tavily         missing TAVILY_API_KEY
  brave-search   missing BRAVE_API_KEY
  firecrawl      missing FIRECRAWL_API_KEY

[warn] no provider for 'extract'
       set TAVILY_API_KEY to use Tavily Search (sign up: https://app.tavily.com)

[ ok ] wrote 2 server(s) to ~/.cursor/mcp.json

Health check
[ ok ] duckduckgo  (ddg-search 1.29.1, 0.9s)
       [ ok ] handshake: connected to ddg-search 1.29.1
       [ ok ] tools: 2 tools: search, fetch_content
[ ok ] context7  (Context7 4.0.4, 5.0s)
       [skip] credentials: running keyless; CONTEXT7_API_KEY would raise the rate limit
       [ ok ] tools: 2 tools: resolve-library-id, query-docs

[ ok ] internet capability installed and verified
```

That run is real, and it shows the two things the tool is for: it told you which
key would close the `extract` gap instead of silently installing less than you
asked for, and it proved both servers actually start and answer before claiming
success.

## Install

Requires Python 3.10+. No runtime dependencies — this tool sets up everything
else, so it must not need a working setup itself.

```bash
pip install -e examples/agent-reach     # from a clone of this repo
agent-reach --version
```

`npx` (Node 18+) and/or `uvx` ([uv](https://docs.astral.sh/uv/)) must be on PATH
to *run* the servers themselves. `agent-reach detect` tells you what you have.

## Quickstart

```bash
agent-reach detect                     # runtimes, agent clients and API keys found here
agent-reach plan                       # what would be installed, and why
agent-reach install                    # write the config, then verify it live
agent-reach doctor --probe             # re-verify later, including one real tool call
```

No API key? `install` still works — it falls back to keyless providers and tells
you which key would upgrade the result:

```console
Considered and skipped:
  tavily         missing TAVILY_API_KEY
```

## Commands

| Command | What it does |
|---------|--------------|
| `detect` | Runtimes, agent clients, and API keys present on this machine |
| `providers` | The catalog, with each provider's live status |
| `plan` | The selection it would make, what it skipped, and why. Exit 1 if a capability can't be covered |
| `install` | Writes MCP server entries, then health-checks them. Exit 1 if a check fails |
| `doctor` | Re-runs the health checks against what is installed |
| `remove` | Removes only the entries Agent Reach wrote |
| `update` | Replaces the catalog from a URL or file, validating before adopting |

Useful flags: `--dry-run` (print the exact config, write nothing), `--probe`
(call one real tool — the only check that proves the key and network work),
`--profile minimal|standard|research|browser`, `--capability search`,
`--provider tavily` (force), `--exclude duckduckgo`, `--client cursor`,
`--all` (every detected client), `--json` (machine-readable, on every command).

## How it picks

Requested capabilities are covered one at a time. For each, the highest-stability
provider that can actually start on this machine wins — where "can start" means
its launcher is on PATH and its required key is in the environment.

Consolidation is a tie-break, not the goal: within a 10-point stability band, a
provider that closes several requested capabilities beats one that closes one
(fewer servers means fewer tool definitions competing for the agent's attention).
Across bands, quality wins — a second server is cheaper than a weak search.

Anything skipped is reported with its reason, because "tavily needs
`TAVILY_API_KEY`" is usually the most actionable line in the output.

Stability scores are **maintainer-curated heuristics** — packaging reliability,
breakage history, tool-surface churn — not benchmark results. Disagree by editing
your overlay (see below).

## What the health check actually does

A config file that *looks* right is worth little. Every check starts the real
server over stdio and runs the real MCP protocol against it:

1. **launcher** — the executable resolves on PATH (with fallbacks, e.g. `uvx` → `python -m`)
2. **credentials** — required keys are present, checked before anything spawns
3. **handshake** — `initialize` completes; the server's name and version are reported
4. **tools** — `tools/list` returns tools, and the ones the catalog expects are there
5. **probe** (`--probe`) — one real `tools/call`, which is what actually exercises the key and the network

A probe that returns a *successful* response whose body reads like a failure
("no results", "rate limit exceeded", "bot detection") is reported as a warning
rather than passed — a green check hiding a dead capability is the failure mode
this tool exists to prevent. Only short bodies are tested, so a real result set
that happens to discuss rate limits does not trip it.

A tool that upstream renamed is a **warning**, not a failure: the server works,
the catalog is stale. A server that won't start, returns no tools, or errors on a
probe is a **failure**, and the last lines of its stderr are printed with it.

## Supported clients

| Client | Scope | Config written |
|--------|-------|----------------|
| `claude-code` | user | `~/.claude.json` |
| `claude-code-project` | project | `.mcp.json` |
| `claude-desktop` | user | platform-specific `claude_desktop_config.json` |
| `cursor` / `cursor-project` | user / project | `~/.cursor/mcp.json`, `.cursor/mcp.json` |
| `windsurf` | user | `~/.codeium/windsurf/mcp_config.json` |
| `vscode` | project | `.vscode/mcp.json` (uses `servers` + `type: stdio`) |
| `gemini-cli` | user | `~/.gemini/settings.json` |
| `codex` | user | `~/.codex/config.toml` |

Detection uses the config file, then a home-directory marker, then the CLI on
PATH. With exactly one client detected it is used automatically; with several,
pass `--client` or `--all`.

## Your keys stay out of your config

Config files get committed, synced, and pasted into issues, so a real key value
is never written to one. Each client declares how it resolves placeholders and
gets the right syntax:

- `${TAVILY_API_KEY}` for clients that expand shell-style placeholders
- `${env:TAVILY_API_KEY}` for VS Code
- **no `env` block at all** for clients that expand nothing — instead you get a
  warning telling you to export the key where that client launches, because a
  placeholder those clients don't expand is worse than no placeholder: it fails
  as an unexplained auth error at run time

Other protections: entries are namespaced `agent-reach-<provider>`, so `remove`
never touches a server you wrote by hand; the file is backed up to
`<config>.agent-reach.bak` before any change; writes are atomic (temp file +
rename) so an interrupted run can't truncate your config; and unrelated settings
in the same file — including everything else in `~/.claude.json` — are preserved.
Malformed JSON or TOML is reported, never overwritten.

## When access methods turn over

Providers get renamed, deprecated, and replaced. The catalog is data, not code,
so it can roll over without a release:

```bash
agent-reach update --from https://example.com/registry.json   # or a local path
```

The incoming catalog is validated before it is adopted — a broken one is refused
and the working catalog stays in place. It is stored at
`~/.agent-reach/registry.json` and deep-merged over the bundled one, so an
overlay can patch a single field, add a provider, or retire one:

```json
{
  "schema_version": 1,
  "revision": "2026-10-01",
  "providers": [
    { "id": "tavily", "stability": 97 },
    { "id": "playwright", "removed": true },
    { "id": "my-internal-search",
      "name": "Internal Search",
      "capabilities": ["search"],
      "runtime": "node",
      "command": { "exec": "npx", "args": ["-y", "@acme/search-mcp"] },
      "keys": [{ "env": "ACME_KEY", "required": true }],
      "stability": 88 }
  ]
}
```

Use `--registry <file>` to pin one reviewed catalog as the whole truth (no merge
with whatever shipped in the package) — the right setting for CI.

## Why this belongs in a context-engineering repo

Installing internet access is a context decision, not just a setup step:

- **Every server costs attention budget.** Its tool definitions sit in the
  context window for the whole session, so the tool consolidates where quality
  allows rather than installing everything available.
- **Search that returns extracts beats search that returns links.** A provider
  that hands back page content saves the agent a fetch round-trip per result —
  which is why the catalog scores providers on what they return, not just breadth.
- **Verification beats configuration.** The failure modes that matter — package
  pulled, key rejected, tool renamed — are invisible in a config file and obvious
  in a handshake. `doctor` exists so the failure surfaces before the agent
  silently starts answering from memory.

Related skills in this repository: `tool-design`, `context-optimization`,
`evaluation`.

## Development

```bash
cd examples/agent-reach
python -m unittest discover -s tests -t .   # 93 tests, no network required
pytest                                      # same suite, if you prefer pytest
ruff check .
```

Health-check tests run against `tests/fake_mcp_server.py`, a stub MCP server that
can be told to rename its tools, crash during the handshake, hang, or fail a
probe — so every failure path is covered without touching the network.

## Gotchas

- **Restart your client after installing.** MCP servers are read at client
  startup; a green health check means the server works, not that your running
  client has picked it up yet.
- **First run is slow.** `npx`/`uvx` download the package on first launch, which
  is why the default check timeout is 90s. Later runs take a second or two.
- **`--probe` spends real quota.** It makes one real API call per provider. Fine
  occasionally, not something to loop.
- **A warning about renamed tools is usually upstream drift, not breakage.** The
  server still works; update your catalog when convenient.
- **Keyless search is a fallback, not a destination.** It exists so an agent is
  never stranded offline. A free Tavily or Brave key is a large upgrade for a few
  minutes of signup.
- **The catalog's keyed providers are unverified in this repo.** The four
  keyless providers (`fetch`, `duckduckgo`, `context7`, `playwright`) were
  health-checked live, and `context7`'s expected tool names were corrected from
  what the server actually reported. Entries for `tavily`, `brave-search`, `exa`
  and `firecrawl` come from upstream documentation and have not been run against
  a real key — `agent-reach doctor --probe` is how you confirm one on your machine.
- **Project-scoped configs follow `--project`,** which defaults to the current
  directory. Running from the wrong directory writes a valid config in a place
  your client never reads.
