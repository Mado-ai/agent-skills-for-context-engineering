"""Metrica Sports sample tracking data — fetch, parse, and feed to Analytics.

Public ground-truth tracking (Sample_Game_1) used to validate the analytics
core and to seed a real-data demo. CSVs (~32 MB) are fetched on demand from
GitHub raw and cached locally; only GitHub is required, so this works in
restricted-network environments where other CDNs are blocked.

Format (RawTrackingData): 3 header rows (team / jersey / column names), then
per-frame rows ``Period,Frame,Time,<x,y per player...>,Ball x,Ball y``.
Coordinates are normalised to [0, 1]; capture is 25 fps. Ball columns are the
same in both files, so the ball is read from the Home file only.
"""

from __future__ import annotations

import csv
import sys
import urllib.request
from pathlib import Path

from .analytics import Analytics
from .config import Config
from .track import FrameState, PlayerTrack

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


def parse(path: Path, window: int) -> tuple[list[tuple[int, int]], list[list[str]], int | None]:
    """Return (columns, rows, ball_x_index). columns = [(x_index, jersey)]."""
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


def build_analytics(frames: int, cache: Path) -> tuple[Analytics, int]:
    """Download + feed the Metrica sample through Analytics. Returns (engine, n)."""
    hc, hrows, hball = parse(fetch("Home", cache), frames)
    ac, arows, _ = parse(fetch("Away", cache), frames)
    n = min(len(hrows), len(arows))

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
    return a, n
