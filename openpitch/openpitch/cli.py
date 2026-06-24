"""Command-line entrypoint.

    python -m openpitch.cli process input.mp4 --out runs/match1
    python -m openpitch.cli demo                 # generate sample + process
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .config import Config
from .pipeline import process_video


def _progress(p: float, msg: str) -> None:
    bar = "#" * int(p * 30)
    print(f"\r[{bar:<30}] {p * 100:5.1f}%  {msg:<40}", end="", flush=True)
    if p >= 1.0:
        print()


def cmd_process(args: argparse.Namespace) -> int:
    cfg = Config(detector=args.detector)
    result = process_video(args.input, args.out, cfg, progress=_progress)
    print(json.dumps(result.analytics["possession"], indent=2))
    print(f"\nBroadcast : {result.broadcast}")
    print(f"Highlights: {len(result.highlights)}")
    print(f"Outputs   : {Path(args.out).resolve()}")
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sample = out / "sample.mp4"
    script = Path(__file__).resolve().parent.parent / "scripts" / "generate_sample.py"
    print("generating synthetic sample clip...")
    subprocess.run(
        [sys.executable, str(script), "--out", str(sample), "--seconds",
         str(args.seconds)],
        check=True,
    )
    args.input = str(sample)
    return cmd_process(args)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="openpitch")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("process", help="process a panoramic video")
    pr.add_argument("input")
    pr.add_argument("--out", default="runs/match")
    pr.add_argument("--detector", default="color", choices=["color", "yolo"])
    pr.set_defaults(func=cmd_process)

    dm = sub.add_parser("demo", help="generate a sample clip and process it")
    dm.add_argument("--out", default="runs/demo")
    dm.add_argument("--detector", default="color", choices=["color", "yolo"])
    dm.add_argument("--seconds", type=int, default=12)
    dm.set_defaults(func=cmd_demo)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
