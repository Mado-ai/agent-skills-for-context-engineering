#!/usr/bin/env python3
"""Validate the analytics core against real open-source tracking data.

Feeds Metrica Sports' public Sample_Game_1 tracking CSVs through the same
``Analytics`` engine the video pipeline uses, so the movement/possession/pass
metrics can be sanity-checked against ground-truth player positions instead of
our own synthetic clip.

The CSVs (~32 MB) are NOT committed — they're fetched on demand from GitHub and
cached under ``--cache`` (default: a temp dir). Only GitHub raw is required, so
this runs in restricted-network environments where other CDNs are blocked.

    python scripts/analyze_metrica.py            # ~5 min window (7500 frames)
    python scripts/analyze_metrica.py --frames 0 # whole match

Format notes (Metrica RawTrackingData): 3 header rows (team / jersey / names),
then per-frame rows of ``Period,Frame,Time,<x,y per player...>,Ball x,Ball y``.
Coordinates are normalised to [0, 1]; capture is 25 fps. Ball columns are the
same in both files, so we read the ball from the Home file only.
"""

from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

# Make the package importable when run from the repo root or scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpitch.analytics import Analytics  # noqa: E402
from openpitch.config import Config  # noqa: E402
from openpitch.track import FrameState, PlayerTrack  # noqa: E402

FPS = 25
BASE = (
    "https://raw.githubusercontent.com/metrica-sports/sample-data/master/"
    "data/Sample_Game_1/Sample_Game_1_RawTrackingData_{}_Team.csv"
)


def fetch(side: str, cache: Path) -> Path:
    dest = cache / f"metrica_{side.lower()}.csv"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = BASE.format(side)
    print(f"downloading {side} tracking data…", file=sys.stderr)
    cache.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    return dest


def parse(path: Path, window: int) -> tuple[list[tuple[int, int]], list[list[str]]]:
    """Return (columns, rows). columns is a list of (x_index, jersey_number)."""
    with open(path) as f:
        rows_iter = csv.reader(f)
        next(rows_iter)  # team row
        next(rows_iter)  # jersey-number row
        names = next(rows_iter)  # Period,Frame,Time,Player11,,...,Ball,
        cols: list[tuple[int, int]] = []
        i = 3
        while i < len(names):
            nm = names[i].strip()
            if nm.lower().startswith("player"):
                cols.append((i, int(nm[6:])))
            i += 2
        ball_x = next(
            (j for j, nm in enumerate(names) if nm.strip().lower() == "ball"), None
        )
        rows: list[list[str]] = []
        for row in rows_iter:
            if not row or row[1] == "":
                continue
            if window and int(float(row[1])) >= window:
                break
            rows.append(row)
    return cols, rows, ball_x


def fnum(v: str) -> float | None:
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=7500,
                    help="frame window to analyse (0 = whole match)")
    ap.add_argument("--cache", type=Path,
                    default=Path(tempfile.gettempdir()) / "openpitch-metrica",
                    help="directory to cache the downloaded CSVs")
    args = ap.parse_args()

    home_csv = fetch("Home", args.cache)
    away_csv = fetch("Away", args.cache)

    hc, hrows, hball = parse(home_csv, args.frames)
    ac, arows, _ = parse(away_csv, args.frames)
    n = min(len(hrows), len(arows))
    print(f"frames analysed: {n} (~{n / FPS / 60:.1f} min at {FPS} fps)")

    a = Analytics(Config(), fps=FPS)
    for k in range(n):
        players: list[PlayerTrack] = []
        ball = None
        for cols, row, team, tag in ((hc, hrows[k], 0, "H"), (ac, arows[k], 1, "A")):
            for xi, num in cols:
                x, y = fnum(row[xi]), fnum(row[xi + 1])
                if x is None or y is None:
                    continue
                players.append(PlayerTrack(
                    id=hash((tag, num)) & 0xFFFFFF, team=team, cx=x, cy=y, number=num))
        if hball is not None:
            x, y = fnum(hrows[k][hball]), fnum(hrows[k][hball + 1])
            if x is not None and y is not None:
                ball = (x, y)
        a.update(FrameState(frame=k, players=players, ball=ball))

    poss = a.possession_pct()
    ts = a.team_stats()
    players = a.player_stats()

    print(f"\nPossession:  Home {poss[0]:.1f}%   Away {poss[1]:.1f}%")
    print("\nTeam stats:")
    for name, t in ts.items():
        print(f"  {name:5} dist {t['distance_km']:5} km  sprints {t['sprints']:3}  "
              f"passes {t['passes']:3}  acc {t['pass_accuracy']}%  "
              f"turnovers {t['turnovers']:3}  top {t['top_speed_ms']} m/s")

    print("\nTop movers (real players):")
    for p in players[:10]:
        print(f"  {p['team'][:4]:4} #{str(p['jersey']):<3} "
              f"{p['distance_m'] / 1000:.2f} km  top {p['top_speed_ms']} m/s  "
              f"avg {p['avg_speed_ms']}  sprints {p['sprints']}  "
              f"passes {p['passes']} ({p['pass_accuracy']}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
