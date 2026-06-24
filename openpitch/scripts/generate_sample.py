"""Generate a synthetic panoramic soccer clip for end-to-end testing.

Draws a green pitch with markings, 22 players (11 red "Home", 11 blue
"Away") that drift toward the ball, and a white ball that is passed around
and driven into both attacking thirds. The colours match the defaults in
``openpitch.config`` so the colour detector picks everything up.

Usage:
    python scripts/generate_sample.py --out sample.mp4 --seconds 12
"""

from __future__ import annotations

import argparse

import cv2
import numpy as np

PITCH = (40, 120, 40)  # BGR green
RED = (60, 60, 220)
BLUE = (220, 90, 60)
WHITE = (255, 255, 255)


def draw_pitch(w: int, h: int) -> np.ndarray:
    img = np.full((h, w, 3), PITCH, np.uint8)
    cv2.rectangle(img, (40, 40), (w - 40, h - 40), WHITE, 3)
    cv2.line(img, (w // 2, 40), (w // 2, h - 40), WHITE, 3)
    cv2.circle(img, (w // 2, h // 2), 90, WHITE, 3)
    for sx in (40, w - 40 - 160):  # penalty boxes
        cv2.rectangle(img, (sx, h // 2 - 160), (sx + 160, h // 2 + 160), WHITE, 3)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="sample.mp4")
    ap.add_argument("--seconds", type=int, default=12)
    ap.add_argument("--fps", type=int, default=20)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=540)
    args = ap.parse_args()

    rng = np.random.default_rng(7)
    w, h, fps = args.width, args.height, args.fps
    n_frames = args.seconds * fps
    base = draw_pitch(w, h)

    # Initialise player formations.
    def formation(x_center):
        ys = np.linspace(90, h - 90, 11)
        xs = x_center + rng.normal(0, 30, 11)
        return np.stack([xs, ys], axis=1)

    home = formation(w * 0.32)
    away = formation(w * 0.68)
    ball = np.array([w / 2, h / 2], float)
    # Ball waypoints sweep across both attacking thirds.
    waypoints = np.array(
        [[w * 0.5, h * 0.5], [w * 0.85, h * 0.4], [w * 0.2, h * 0.6],
         [w * 0.8, h * 0.5], [w * 0.15, h * 0.45], [w * 0.5, h * 0.5]]
    )

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, fps, (w, h))

    for f in range(n_frames):
        frame = base.copy()
        # Ball follows piecewise-linear waypoints with bursts of speed.
        seg = (f / n_frames) * (len(waypoints) - 1)
        i = int(seg)
        t = seg - i
        target = waypoints[i] * (1 - t) + waypoints[i + 1] * t
        ball += (target - ball) * 0.18 + rng.normal(0, 1.5, 2)
        ball = np.clip(ball, [45, 45], [w - 45, h - 45])

        # Players drift toward the ball, keeping team shape. Each wears a
        # jersey number (1..11) so the pipeline's OCR can read it.
        for squad, color in ((home, RED), (away, BLUE)):
            squad += (ball - squad) * 0.02 + rng.normal(0, 1.2, squad.shape)
            squad[:] = np.clip(squad, [45, 45], [w - 45, h - 45])
            for idx, (x, y) in enumerate(squad):
                cx, cy = int(x), int(y)
                cv2.circle(frame, (cx, cy), 17, color, -1)
                cv2.circle(frame, (cx, cy), 17, (20, 20, 20), 1)
                num = str(idx + 1)
                (tw, th), _ = cv2.getTextSize(num, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                cv2.putText(frame, num, (cx - tw // 2, cy + th // 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, WHITE, 2, cv2.LINE_AA)

        cv2.circle(frame, (int(ball[0]), int(ball[1])), 6, WHITE, -1)
        writer.write(frame)

    writer.release()
    print(f"wrote {args.out} ({n_frames} frames, {args.seconds}s @ {fps}fps)")


if __name__ == "__main__":
    main()
