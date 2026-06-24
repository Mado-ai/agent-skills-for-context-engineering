"""Jersey-number OCR — reads a player's shirt number from a detection crop.

Used to map anonymous tracker IDs onto roster players automatically (no manual
assignment). The default backend is dependency-free: threshold the bright
number, segment digits, and classify each against rendered 0-9 templates. For
real footage, set ``PLAYMETRICS_OCR=easyocr`` to swap in a learned recogniser.

``read_number`` returns an int (1-2 digits) or None. Per-track voting across
frames (in analytics) makes the final number robust to per-frame misses.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

_TEMPLATES: dict[int, np.ndarray] = {}


def _build_templates() -> None:
    for d in range(10):
        img = np.zeros((48, 40), np.uint8)
        cv2.putText(img, str(d), (6, 38), cv2.FONT_HERSHEY_SIMPLEX, 1.2, 255, 3,
                    cv2.LINE_AA)
        cnts, _ = cv2.findContours(img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        x, y, w, h = cv2.boundingRect(np.vstack(cnts))
        _TEMPLATES[d] = cv2.resize(img[y:y + h, x:x + w], (20, 20))


_build_templates()


def _classify(digit_bin: np.ndarray) -> tuple[int, float]:
    crop = cv2.resize(digit_bin, (20, 20))
    best, score = -1, -1.0
    for d, tmpl in _TEMPLATES.items():
        s = float(cv2.matchTemplate(crop, tmpl, cv2.TM_CCOEFF_NORMED)[0, 0])
        if s > score:
            best, score = d, s
    return best, score


def read_number_color(frame: np.ndarray, bbox: tuple[int, int, int, int],
                      max_digits: int = 2, min_score: float = 0.35) -> int | None:
    x, y, w, h = bbox
    crop = frame[max(0, y):y + h, max(0, x):x + w]
    if crop.size == 0 or crop.shape[0] < 8:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    ch = crop.shape[0]
    boxes = []
    for c in cnts:
        bx, by, bw, bh = cv2.boundingRect(c)
        if bh < 0.30 * ch or bh > 1.05 * ch or bw < 2 or bw > 0.8 * crop.shape[1]:
            continue
        boxes.append((bx, by, bw, bh))
    if not boxes:
        return None
    boxes.sort(key=lambda b: b[0])
    digits = []
    for bx, by, bw, bh in boxes[:max_digits]:
        d, s = _classify(mask[by:by + bh, bx:bx + bw])
        if s < min_score:
            return None
        digits.append(str(d))
    try:
        n = int("".join(digits))
    except ValueError:
        return None
    return n if 0 < n <= 99 else None


class _EasyOCR:
    def __init__(self):
        import easyocr  # noqa: PLC0415

        self._reader = easyocr.Reader(["en"], gpu=False)

    def read(self, frame, bbox):
        x, y, w, h = bbox
        crop = frame[max(0, y):y + h, max(0, x):x + w]
        if crop.size == 0:
            return None
        for _, txt, conf in self._reader.readtext(crop, allowlist="0123456789"):
            if conf > 0.4 and txt.isdigit() and 0 < int(txt) <= 99:
                return int(txt)
        return None


_easy = None


def read_number(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> int | None:
    if os.environ.get("PLAYMETRICS_OCR", "color") == "easyocr":
        global _easy
        if _easy is None:
            _easy = _EasyOCR()
        return _easy.read(frame, bbox)
    return read_number_color(frame, bbox)
