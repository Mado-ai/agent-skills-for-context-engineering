"""Command line interface.

    agent-reach install     pick, install and verify internet access for an agent
    agent-reach doctor      re-verify what is installed, live
    agent-reach plan        show what install would do, and why
    agent-reach detect      runtimes, keys and agent clients on this machine
    agent-reach providers   the catalog
    agent-reach remove      remove entries Agent Reach installed
    agent-reach update      refresh the catalog from a URL or file
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from . import __version__
from .clients import (
    Client,
    discover_clients,
    install_providers,
    is_managed,
    read_servers,
    remove_providers,
    server_name,
    unresolved_keys,
)
from .console import FAIL, PASS, SKIP, WARN, dim, heading, line, status_label, table
from .health import DEFAULT_TIMEOUT, check_provider
from .registry import (
    Provider,
    Registry,
    RegistryError,
    load_document,
    load_registry,
    overlay_path,
)
from .runtime import probe_runtimes, readiness
from .selection import Plan, build_plan
from .state import load_state, record_install, record_removal

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_USAGE = 2


class CommandError(RuntimeError):
    """A user-facing error: printed without a traceback."""


# --- helpers -----------------------------------------------------------------


def _emit(data: dict[str, Any]) -> None:
    print(json.dumps(data, indent=2))


def _load(args: argparse.Namespace) -> Registry:
    if args.registry:
        return load_registry(replace=Path(args.registry).expanduser())
    return load_registry(use_overlay=not args.no_overlay)


def _project_dir(args: argparse.Namespace) -> Path:
    return Path(args.project).expanduser().resolve() if args.project else Path.cwd()


def _resolve_client(args: argparse.Namespace, registry_clients: list[Client]) -> Client:
    """Pick the target client: the named one, or the single obvious one."""
    by_id = {c.id: c for c in registry_clients}
    if args.client:
        if args.client not in by_id:
            raise CommandError(
                f"unknown client '{args.client}'. Known: {', '.join(sorted(by_id))}"
            )
        return by_id[args.client]

    detected = [c for c in registry_clients if c.detected]
    if not detected:
        raise CommandError(
            "no agent client detected here. Pass --client explicitly "
            f"(one of: {', '.join(sorted(by_id))}), or run `agent-reach detect`."
        )
    if len(detected) > 1:
        names = ", ".join(c.id for c in detected)
        raise CommandError(
            f"several clients detected ({names}). Choose one with --client, "
            "or pass --all to install into every detected client."
        )
    return detected[0]


def _targets(args: argparse.Namespace) -> list[Client]:
    clients = discover_clients(_project_dir(args))
    if getattr(args, "all", False):
        detected = [c for c in clients if c.detected]
        if not detected:
            raise CommandError("no agent client detected here — nothing to install into.")
        return detected
    return [_resolve_client(args, clients)]


def _plan_from_args(args: argparse.Namespace, registry: Registry) -> Plan:
    capabilities = tuple(args.capability) if args.capability else None
    if capabilities:
        unknown = [c for c in capabilities if not registry.by_capability(c)]
        if unknown:
            raise CommandError(f"no provider offers capability: {', '.join(unknown)}")
    profile = args.profile if not capabilities else None
    try:
        return build_plan(
            registry,
            capabilities=capabilities,
            profile=profile,
            include=tuple(args.provider or ()),
            exclude=tuple(args.exclude or ()),
            allow_blocked=getattr(args, "allow_blocked", False),
        )
    except (RegistryError, ValueError) as exc:
        raise CommandError(str(exc)) from exc


def _print_plan(plan: Plan, registry: Registry) -> None:
    label = plan.profile or "custom"
    print(heading(f"Plan ({label}: {', '.join(plan.capabilities)})"))
    print()
    if not plan.selected:
        print(line(FAIL, "nothing selected — no provider can start here"))
    else:
        rows = []
        for provider in plan.selected:
            covers = [c for c, pid in plan.coverage.items() if pid == provider.id]
            keys = ", ".join(k.env for k in provider.keys) or "none"
            rows.append(
                [
                    provider.id,
                    ", ".join(covers) or "-",
                    str(provider.stability),
                    provider.cost,
                    keys,
                ]
            )
        print(table(rows, ["provider", "covers", "stability", "cost", "keys"]))

    if plan.rejected:
        print()
        print(dim("Considered and skipped:"))
        for rejection in plan.rejected:
            print(dim(f"  {rejection.provider.id:14} {rejection.reason}"))

    if plan.gaps:
        print()
        for gap in plan.gaps:
            print(line(WARN, f"no provider for '{gap.capability}'", gap.remedy))


def _print_health(results: list, verbose: bool = True) -> None:
    for result in results:
        headline = f"{result.provider_id}"
        if result.server:
            headline += dim(f"  ({result.server}, {result.duration:.1f}s)")
        print(f"{status_label(result.status)} {headline}")
        if verbose:
            for check in result.checks:
                print(f"       {status_label(check.status)} {check.name}: {check.detail}")
            if result.status == FAIL and result.stderr_tail:
                print(dim("       server stderr:"))
                for stderr_line in result.stderr_tail.splitlines()[-4:]:
                    print(dim(f"         {stderr_line}"))


# --- commands ----------------------------------------------------------------


def cmd_detect(args: argparse.Namespace) -> int:
    registry = _load(args)
    runtimes = probe_runtimes()
    clients = discover_clients(_project_dir(args))
    keys = {
        key.env: bool(os.environ.get(key.env))
        for provider in registry.providers
        for key in provider.keys
    }

    if args.json:
        _emit(
            {
                "runtimes": {
                    name: {"present": t.present, "path": t.path, "version": t.version}
                    for name, t in runtimes.items()
                },
                "clients": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "detected": c.detected,
                        "reason": c.reason,
                        "config_path": str(c.path),
                        "config_exists": c.exists,
                    }
                    for c in clients
                ],
                "api_keys": keys,
            }
        )
        return EXIT_OK

    print(heading("Runtimes"))
    for name, tool in runtimes.items():
        status = PASS if tool.present else WARN
        version = tool.version or ("not found" if not tool.present else "")
        print(line(status, f"{name:8} {version}"))

    print()
    print(heading("Agent clients"))
    for client in clients:
        status = PASS if client.detected else SKIP
        detail = f"{client.path}" + ("" if client.exists else dim("  (no config yet)"))
        print(line(status, f"{client.id:22} {client.reason}", detail))

    print()
    print(heading("API keys in environment"))
    for env_name, present in sorted(keys.items()):
        shown = "set" if present else "not set"
        print(line(PASS if present else SKIP, f"{env_name:24} {shown}"))
    return EXIT_OK


def cmd_providers(args: argparse.Namespace) -> int:
    registry = _load(args)
    providers = list(registry.providers)
    if args.capability:
        providers = [p for p in providers if any(p.covers(c) for c in args.capability)]
    providers.sort(key=lambda p: -p.stability)

    if args.json:
        _emit(
            {
                "revision": registry.revision,
                "providers": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "summary": p.summary,
                        "capabilities": list(p.capabilities),
                        "runtime": p.runtime,
                        "command": p.command.as_list(),
                        "keys": [k.env for k in p.keys],
                        "stability": p.stability,
                        "cost": p.cost,
                        "ready": readiness(p).ready,
                        "blocker": readiness(p).blocker,
                        "docs": p.docs,
                    }
                    for p in providers
                ],
            }
        )
        return EXIT_OK

    print(heading(f"Catalog revision {registry.revision}"))
    print()
    rows = []
    for provider in providers:
        state = readiness(provider)
        rows.append(
            [
                provider.id,
                ", ".join(provider.capabilities),
                str(provider.stability),
                provider.cost,
                "ready" if state.ready else state.blocker,
            ]
        )
    print(table(rows, ["provider", "capabilities", "stability", "cost", "status"]))
    if args.verbose:
        print()
        for provider in providers:
            print(f"{heading(provider.id)} — {provider.name}")
            print(f"  {provider.summary}")
            print(dim(f"  run: {provider.command.display()}"))
            if provider.docs:
                print(dim(f"  docs: {provider.docs}"))
    return EXIT_OK


def cmd_plan(args: argparse.Namespace) -> int:
    registry = _load(args)
    plan = _plan_from_args(args, registry)
    if args.json:
        _emit(_plan_json(plan))
    else:
        _print_plan(plan, registry)
    # The exit code reports coverage, and must not depend on the output format.
    return EXIT_OK if plan.complete else EXIT_FAILED


def _plan_json(plan: Plan) -> dict[str, Any]:
    return {
        "profile": plan.profile,
        "capabilities": list(plan.capabilities),
        "selected": [
            {
                "id": p.id,
                "name": p.name,
                "capabilities": list(p.capabilities),
                "command": p.command.as_list(),
                "stability": p.stability,
            }
            for p in plan.selected
        ],
        "coverage": plan.coverage,
        "gaps": [
            {"capability": g.capability, "reason": g.reason, "remedy": g.remedy} for g in plan.gaps
        ],
        "rejected": [{"id": r.provider.id, "reason": r.reason} for r in plan.rejected],
        "complete": plan.complete,
    }


def cmd_install(args: argparse.Namespace) -> int:
    registry = _load(args)
    plan = _plan_from_args(args, registry)
    clients = _targets(args)

    if not plan.selected:
        raise CommandError(
            "nothing to install: no provider in the catalog can start here. "
            "Run `agent-reach detect` to see what is missing."
        )

    if not args.json:
        _print_plan(plan, registry)
        print()
        print(heading("Targets"))
        for client in clients:
            print(line(PASS, f"{client.id:22} {client.path}"))
        print()

    if args.dry_run:
        if args.json:
            _emit(
                {
                    "dry_run": True,
                    "plan": _plan_json(plan),
                    "targets": [{"id": c.id, "config_path": str(c.path)} for c in clients],
                    "entries": {
                        c.id: {
                            server_name(p, not args.no_prefix): _entry_preview(c, p, args)
                            for p in plan.selected
                        }
                        for c in clients
                    },
                }
            )
        else:
            print(line(SKIP, "dry run — no files written"))
            for client in clients:
                from .clients import build_entry

                preview = {
                    server_name(p, not args.no_prefix): build_entry(p, client.spec)
                    for p in plan.selected
                }
                print(dim(f"  would write to {client.path}:"))
                for entry_line in json.dumps(preview, indent=2).splitlines():
                    print(dim(f"    {entry_line}"))
        return EXIT_OK

    if not args.yes and sys.stdin.isatty() and not args.json:
        targets = ", ".join(c.id for c in clients)
        answer = input(f"Write {len(plan.selected)} server(s) to {targets}? [Y/n] ").strip().lower()
        if answer not in ("", "y", "yes"):
            print(line(SKIP, "aborted — nothing written"))
            return EXIT_OK

    written: list[dict[str, Any]] = []
    for client in clients:
        entries, backup = install_providers(
            client, list(plan.selected), prefix=not args.no_prefix, backup=not args.no_backup
        )
        record_install(
            client_id=client.id,
            config_path=str(client.path),
            provider_ids=list(plan.provider_ids),
            server_names=list(entries),
            registry_revision=registry.revision,
        )
        written.append(
            {
                "client": client.id,
                "config_path": str(client.path),
                "servers": list(entries),
                "backup": str(backup) if backup else None,
            }
        )
        if not args.json:
            print(line(PASS, f"wrote {len(entries)} server(s) to {client.path}"))
            if backup:
                print(dim(f"       backup: {backup}"))
            for provider in plan.selected:
                unresolved = unresolved_keys(provider, client.spec)
                if unresolved:
                    print(
                        line(
                            WARN,
                            f"{client.id} does not expand config placeholders",
                            f"export {', '.join(unresolved)} in the environment "
                            f"{client.spec.name} launches from",
                        )
                    )

    results = []
    if not args.no_verify:
        if not args.json:
            print()
            print(heading("Health check"))
        results = [
            check_provider(provider, timeout=args.timeout, probe=args.probe)
            for provider in plan.selected
        ]
        if not args.json:
            _print_health(results)

    failed = [r for r in results if r.status == FAIL]
    warned = [r for r in results if r.status == WARN]
    if args.json:
        _emit(
            {
                "installed": written,
                "plan": _plan_json(plan),
                "health": [r.as_dict() for r in results],
                "warnings": [r.provider_id for r in warned],
                "ok": not failed,
            }
        )
    else:
        print()
        if failed:
            print(
                line(
                    FAIL,
                    f"{len(failed)} server(s) failed their health check",
                    "the config was still written — fix the cause above and "
                    "re-run `agent-reach doctor`",
                )
            )
        elif warned:
            print(
                line(
                    WARN,
                    f"installed, with warnings on {', '.join(r.provider_id for r in warned)}",
                    "the servers start and respond — see the warnings above before relying on them",
                )
            )
            print(dim("       restart your agent client to pick up the new servers"))
        else:
            print(line(PASS, "internet capability installed and verified"))
            print(dim("       restart your agent client to pick up the new servers"))
    return EXIT_FAILED if failed else EXIT_OK


def _entry_preview(client: Client, provider: Provider, args: argparse.Namespace) -> dict[str, Any]:
    from .clients import build_entry

    return build_entry(provider, client.spec)


def cmd_doctor(args: argparse.Namespace) -> int:
    registry = _load(args)
    clients = discover_clients(_project_dir(args))
    state = load_state()

    if args.client:
        clients = [c for c in clients if c.id == args.client]
        if not clients:
            raise CommandError(f"unknown client '{args.client}'")
    else:
        clients = [c for c in clients if c.detected or c.id in state]

    report: dict[str, Any] = {"clients": [], "health": [], "ok": True}
    provider_ids: list[str] = []

    if not args.json:
        print(heading("Configured servers"))
    for client in clients:
        try:
            servers = read_servers(client)
        except ValueError as exc:
            report["ok"] = False
            report["clients"].append({"id": client.id, "error": str(exc)})
            if not args.json:
                print(line(FAIL, f"{client.id}: unreadable config", str(exc)))
            continue

        managed = {name: entry for name, entry in servers.items() if is_managed(name)}
        others = [name for name in servers if not is_managed(name)]
        report["clients"].append(
            {
                "id": client.id,
                "config_path": str(client.path),
                "managed_servers": list(managed),
                "other_servers": others,
            }
        )
        provider_ids.extend(name.removeprefix("agent-reach-") for name in managed)

        if not args.json:
            if managed:
                print(line(PASS, f"{client.id}: {', '.join(managed)}", str(client.path)))
            elif client.exists:
                print(
                    line(SKIP, f"{client.id}: no Agent Reach servers", str(client.path))
                )
            else:
                print(line(SKIP, f"{client.id}: no config file yet", str(client.path)))
            if others:
                joined = ", ".join(others[:6])
                print(dim(f"       (also present, not managed here: {joined})"))

    unique_ids = list(dict.fromkeys(provider_ids))
    if args.all_providers:
        unique_ids = [p.id for p in registry.providers]

    if not unique_ids:
        if not args.json:
            print()
            print(
                line(
                    WARN,
                    "nothing installed by Agent Reach yet",
                    "run `agent-reach install`",
                )
            )
        else:
            _emit(report)
        return EXIT_OK

    results = []
    if not args.json:
        print()
        print(heading("Health check"))
    for pid in unique_ids:
        try:
            provider = registry.get(pid)
        except RegistryError:
            if not args.json:
                print(
                    line(
                        WARN,
                        f"{pid}: not in the catalog",
                        "installed by hand, or the catalog rolled over",
                    )
                )
            continue
        results.append(check_provider(provider, timeout=args.timeout, probe=args.probe))

    if not args.json:
        _print_health(results)

    failed = [r for r in results if r.status == FAIL]
    report["health"] = [r.as_dict() for r in results]
    report["ok"] = not failed

    if args.json:
        _emit(report)
    else:
        print()
        warned = [r for r in results if r.status == WARN]
        summary = f"{len(results) - len(failed) - len(warned)}/{len(results)} healthy"
        if warned:
            summary += f", {len(warned)} with warnings"
        if failed:
            summary += f", {len(failed)} failing"
        print(line(FAIL if failed else (WARN if warned else PASS), summary))
    return EXIT_FAILED if failed else EXIT_OK


def cmd_remove(args: argparse.Namespace) -> int:
    clients = _targets(args)
    removed_any = False
    for client in clients:
        servers = read_servers(client)
        managed = [n for n in servers if is_managed(n)]
        wanted = args.provider or [n.removeprefix("agent-reach-") for n in managed]
        removed, backup = remove_providers(client, list(wanted), backup=not args.no_backup)
        if removed:
            removed_any = True
            record_removal(client.id, [r.removeprefix("agent-reach-") for r in removed])
            if not args.json:
                print(line(PASS, f"removed {', '.join(removed)} from {client.path}"))
                if backup:
                    print(dim(f"       backup: {backup}"))
        elif not args.json:
            print(line(SKIP, f"{client.id}: nothing managed by Agent Reach to remove"))
    if args.json:
        _emit({"removed": removed_any})
    return EXIT_OK


def cmd_update(args: argparse.Namespace) -> int:
    source = args.source or os.environ.get("AGENT_REACH_REGISTRY_URL")
    if not source:
        raise CommandError(
            "no catalog source given. Pass `--from <url|path>` or set "
            "AGENT_REACH_REGISTRY_URL. The bundled catalog is used until then."
        )

    if source.startswith(("http://", "https://")):
        if not source.startswith("https://") and not args.allow_insecure:
            raise CommandError("refusing to fetch a catalog over plain HTTP (use --allow-insecure)")
        try:
            with urllib.request.urlopen(source, timeout=30) as response:
                payload = response.read().decode("utf-8")
        except (urllib.error.URLError, OSError, UnicodeDecodeError) as exc:
            raise CommandError(f"could not fetch {source}: {exc}") from exc
        destination = overlay_path()
        destination.parent.mkdir(parents=True, exist_ok=True)
        staging = destination.with_suffix(".incoming")
        staging.write_text(payload, encoding="utf-8")
    else:
        staging = Path(source).expanduser()
        if not staging.exists():
            raise CommandError(f"no such file: {staging}")
        destination = overlay_path()
        destination.parent.mkdir(parents=True, exist_ok=True)

    # Validate before adopting: a broken overlay must never replace a working one.
    try:
        load_document(staging)
        merged = load_registry(overlay=staging)
    except RegistryError as exc:
        if staging != Path(source).expanduser():
            staging.unlink(missing_ok=True)
        raise CommandError(f"catalog rejected: {exc}") from exc

    destination.write_text(staging.read_text(encoding="utf-8"), encoding="utf-8")
    if staging.suffix == ".incoming":
        staging.unlink(missing_ok=True)

    if args.json:
        _emit(
            {
                "source": source,
                "overlay": str(destination),
                "revision": merged.revision,
                "providers": [p.id for p in merged.providers],
            }
        )
    else:
        print(line(PASS, f"catalog updated to revision {merged.revision}", str(destination)))
        names = ", ".join(p.id for p in merged.providers)
        print(dim(f"       {len(merged.providers)} providers: {names}"))
        print(dim("       run `agent-reach doctor` to re-verify installed servers"))
    return EXIT_OK


# --- argument parsing --------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent-reach",
        description="Give an AI agent internet capability in one command: "
        "pick the access method, install it, verify it live.",
    )
    parser.add_argument("--version", action="version", version=f"agent-reach {__version__}")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--project", help="project directory for project-scoped configs")
    parser.add_argument(
        "--registry", help="use this file as the entire catalog (no bundled merge)"
    )
    parser.add_argument(
        "--no-overlay", action="store_true", help="ignore ~/.agent-reach/registry.json"
    )

    # The same global flags are accepted after the subcommand too — `install
    # --json` is what people type. SUPPRESS keeps an omitted sub-level flag from
    # overwriting the value already parsed at the top level.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    common.add_argument("--project", default=argparse.SUPPRESS)
    common.add_argument("--registry", default=argparse.SUPPRESS)
    common.add_argument("--no-overlay", action="store_true", default=argparse.SUPPRESS)

    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_selection_flags(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--profile", default=None, help="minimal | standard | research | browser")
        sub.add_argument(
            "--capability", action="append", help="request a capability (repeatable)"
        )
        sub.add_argument(
            "--provider", action="append", help="force a specific provider (repeatable)"
        )
        sub.add_argument("--exclude", action="append", help="never pick this provider (repeatable)")
        sub.add_argument(
            "--allow-blocked",
            action="store_true",
            help="select providers whose key or runtime is missing",
        )

    detect = subparsers.add_parser(
        "detect", help="show runtimes, clients and keys", parents=[common]
    )
    detect.set_defaults(func=cmd_detect)

    providers = subparsers.add_parser(
        "providers", help="list the catalog", parents=[common]
    )
    providers.add_argument("--capability", action="append", help="filter by capability")
    providers.add_argument("-v", "--verbose", action="store_true", help="include summaries")
    providers.set_defaults(func=cmd_providers)

    plan = subparsers.add_parser(
        "plan", help="show what install would do, and why", parents=[common]
    )
    add_selection_flags(plan)
    plan.set_defaults(func=cmd_plan)

    install = subparsers.add_parser(
        "install", help="install and verify internet access", parents=[common]
    )
    add_selection_flags(install)
    install.add_argument("--client", help="target client id (see `agent-reach detect`)")
    install.add_argument("--all", action="store_true", help="install into every detected client")
    install.add_argument(
        "-n", "--dry-run", action="store_true", help="print changes, write nothing"
    )
    install.add_argument("-y", "--yes", action="store_true", help="do not prompt")
    install.add_argument("--no-verify", action="store_true", help="skip the health check")
    install.add_argument("--probe", action="store_true", help="also call one real tool")
    install.add_argument("--no-backup", action="store_true", help="do not back up the config")
    install.add_argument(
        "--no-prefix", action="store_true", help="name servers without the agent-reach- prefix"
    )
    install.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="seconds per check")
    install.set_defaults(func=cmd_install)

    doctor = subparsers.add_parser(
        "doctor", help="re-verify installed servers, live", parents=[common]
    )
    doctor.add_argument("--client", help="only this client")
    doctor.add_argument("--probe", action="store_true", help="also call one real tool")
    doctor.add_argument(
        "--all-providers", action="store_true", help="check every provider in the catalog"
    )
    doctor.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="seconds per check")
    doctor.set_defaults(func=cmd_doctor)

    remove = subparsers.add_parser(
        "remove", help="remove servers Agent Reach installed", parents=[common]
    )
    remove.add_argument("--client", help="target client id")
    remove.add_argument("--all", action="store_true", help="every detected client")
    remove.add_argument("--provider", action="append", help="only this provider (repeatable)")
    remove.add_argument("--no-backup", action="store_true", help="do not back up the config")
    remove.set_defaults(func=cmd_remove)

    update = subparsers.add_parser(
        "update", help="refresh the catalog from a URL or file", parents=[common]
    )
    update.add_argument("--from", dest="source", help="https URL or local path")
    update.add_argument("--allow-insecure", action="store_true", help="permit http:// sources")
    update.set_defaults(func=cmd_update)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except CommandError as exc:
        print(f"{status_label(FAIL)} {exc}", file=sys.stderr)
        return EXIT_USAGE
    except RegistryError as exc:
        print(f"{status_label(FAIL)} catalog error: {exc}", file=sys.stderr)
        return EXIT_USAGE
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
