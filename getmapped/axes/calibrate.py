"""Axis calibration: detect numeric tick labels, fit a robust LINEAR pt->value map.

LINEAR ONLY. The datasheet 'log' axes (log exposure, log sensitivity) are drawn linearly — the pixel->value
map is linear even though the value is a log quantity, so a linear fit is correct for them. Genuinely
log-*spaced* axes are out of scope (README 'future').

`robust_fit` uses a median-consecutive-slope estimate, so it is immune to high-leverage stray labels (e.g. a
number that leaked in from a neighbouring plot) that an OLS or greedy-drop fit would chase.
"""
from __future__ import annotations

import re

import numpy as np

from ..curveset import AxisCalibration

Anchors = list[tuple[float, float]]   # (source_pos, data_value)

_NUMERIC = re.compile(r"-?\d+(\.\d+)?")


class CalibrationError(ValueError):
    pass


def axis_label_anchors(words: list[tuple], frame: tuple[float, float, float, float], axis: str) -> Anchors:
    """Numeric tick labels just outside the frame -> [(pt_pos, value)]. Allows negatives (logH axes).

    axis='x': numbers in a band just below the frame, within its x-span.
    axis='y': numbers just left of the frame, within its y-span.
    """
    x0, y0, x1, y1 = frame
    anchors: Anchors = []
    for w in words:
        wx0, wy0, wx1, wy1, txt = w[0], w[1], w[2], w[3], str(w[4]).strip()
        if not _NUMERIC.fullmatch(txt):
            continue
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        if axis == "x" and y1 < cy < y1 + 30 and x0 - 10 <= cx <= x1 + 10:
            anchors.append((cx, float(txt)))
        elif axis == "y" and x0 - 40 < cx < x0 and y0 - 10 <= cy <= y1 + 10:
            anchors.append((cy, float(txt)))
    return sorted(anchors)


def robust_fit(anchors: Anchors) -> tuple[float, float, float, int]:
    """Median-consecutive-slope linear fit, dropping labels that leaked from a neighbouring plot.

    Returns (scale, offset, |r|, n_dropped). The median slope + median intercept are immune to a stray
    high-leverage label; we then OLS-refit on the inliers for a tight map.
    """
    a = sorted(anchors)
    if len(a) < 2:
        raise CalibrationError(f"need >=2 numeric anchors to calibrate an axis, got {len(a)}")
    pos = np.array([p[0] for p in a], float)
    val = np.array([p[1] for p in a], float)
    if len(a) == 2:
        m = (val[1] - val[0]) / (pos[1] - pos[0])
        return float(m), float(val[0] - m * pos[0]), 1.0, 0
    m = float(np.median(np.diff(val) / np.diff(pos)))
    b = float(np.median(val - m * pos))
    span = max(float(val.max() - val.min()), 1e-9)
    keep = np.abs(val - (m * pos + b)) < 0.1 * span + 1e-6
    if int(keep.sum()) >= 2:
        pk, vk = pos[keep], val[keep]
        mm, bb = np.polyfit(pk, vk, 1)
        r = float(np.corrcoef(pk, vk)[0, 1]) if int(keep.sum()) > 2 else 1.0
        return float(mm), float(bb), abs(r), int((~keep).sum())
    r = float(np.corrcoef(pos, val)[0, 1])
    return m, b, abs(r), 0


def calibrate_axis(words: list[tuple], frame: tuple[float, float, float, float], axis: str,
                   explicit: Anchors | None = None) -> AxisCalibration:
    """Build an AxisCalibration from auto-detected labels, or from explicit (pt,value) anchors."""
    anchors = explicit if explicit is not None else axis_label_anchors(words, frame, axis)
    scale, offset, r, n_dropped = robust_fit(anchors)
    return AxisCalibration(scale=scale, offset=offset, r=r,
                           anchors=tuple((float(p), float(v)) for p, v in sorted(anchors)),
                           n_dropped=n_dropped)
