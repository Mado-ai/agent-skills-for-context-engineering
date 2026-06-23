#!/usr/bin/env python3
"""Validate the analytics core against real open-source tracking data.

Feeds Metrica Sports' public Sample_Game_1 tracking CSVs through the same
``Analytics`` engine the video pipeline uses, so the movement / possession /
pass / event metrics can be sanity-checked against ground-truth player
positions instead of our synthetic clip. The fetch/parse/feed logic lives in
``openpitch.metrica`` (shared with the demo seeder).

    python scripts/analyze_metrica.py            # ~5 min window (7500 frames)
    python scripts/analyze_metrica.py --frames 0 # whole match
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpitch.metrica import FPS, build_analytics  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=7500,
                    help="frame window to analyse (0 = whole match)")
    ap.add_argument("--cache", type=Path,
                    default=Path(tempfile.gettempdir()) / "openpitch-metrica",
                    help="directory to cache the downloaded CSVs")
    args = ap.parse_args()

    a, n = build_analytics(args.frames, args.cache)
    print(f"frames analysed: {n} (~{n / FPS / 60:.1f} min at {FPS} fps)")

    poss = a.possession_pct()
    ts = a.team_stats()
    players = a.player_stats()

    print(f"\nPossession:  Home {poss[0]:.1f}%   Away {poss[1]:.1f}%")
    print("\nTeam stats:")
    for name, t in ts.items():
        print(f"  {name:5} dist {t['distance_km']:5} km  sprints {t['sprints']:3}  "
              f"passes {t['passes']:3}  acc {t['pass_accuracy']}%  "
              f"turnovers {t['turnovers']:3}  top {t['top_speed_ms']} m/s")
    print("\nTeam event model (xT / progression / shots → xG):")
    for name, t in ts.items():
        print(f"  {name:5} xT {t['xt_added']:5}  progressive {t['progressive_passes']:3}  "
              f"final-third {t['final_third_passes']:3}  shots {t['shots']:2}  "
              f"xG {t['xg']}")

    print("\nTop movers (real players):")
    for p in players[:10]:
        print(f"  {p['team'][:4]:4} #{str(p['jersey']):<3} "
              f"{p['distance_m'] / 1000:.2f} km  top {p['top_speed_ms']} m/s  "
              f"avg {p['avg_speed_ms']}  sprints {p['sprints']}  "
              f"passes {p['passes']} ({p['pass_accuracy']}%)")

    print("\nTop creators (by expected threat added):")
    for p in sorted(players, key=lambda r: r["xt_added"], reverse=True)[:8]:
        print(f"  {p['team'][:4]:4} #{str(p['jersey']):<3} "
              f"xT {p['xt_added']:+.3f}  progressive {p['progressive_passes']}  "
              f"final-third {p['final_third_passes']}  shots {p['shots']}  "
              f"xG {p['xg']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
