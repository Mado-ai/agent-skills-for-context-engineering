#!/usr/bin/env python3
"""Seed the database with rich, realistic demo data (CLI wrapper).

Seeds a real-data dashboard analysis (Metrica sample) plus two fully-named
squads with timestamped matches and realistic per-player stats. The logic lives
in ``openpitch.demo_seed`` so the server can auto-seed a fresh deployment too
(set PLAYMETRICS_SEED_DEMO=1).

Run with the same PLAYMETRICS_* env vars the server uses:

    python scripts/seed_demo.py
    python scripts/seed_demo.py --no-teams    # dashboard job only
    python scripts/seed_demo.py --frames 0    # whole match (slower)

Idempotent: re-running replaces the demo job and the demo teams.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpitch import demo_seed  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=7500,
                    help="frame window to analyse (0 = whole match)")
    ap.add_argument("--cache", type=Path, default=demo_seed.DEFAULT_CACHE,
                    help="directory to cache the downloaded Metrica CSVs")
    ap.add_argument("--email", default=os.environ.get(
        "PLAYMETRICS_ADMIN_EMAIL", "yazanalshuibe14@gmail.com"))
    ap.add_argument("--no-teams", action="store_true",
                    help="seed only the dashboard job, not the demo squads")
    args = ap.parse_args()

    ok = demo_seed.seed_all(args.email, args.frames, args.cache,
                            with_teams=not args.no_teams)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
