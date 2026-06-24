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


def _normalize_minus(s: str) -> str:
    """Map typographic minus/dashes to ASCII '-' so a label like '−2' (U+2212) parses as a negative."""
    return s.replace("−", "-").replace("–", "-").replace("—", "-")


def axis_label_anchors(words: list[tuple], frame: tuple[float, float, float, float], axis: str) -> Anchors:
    """Numeric tick labels just outside the frame -> [(pt_pos, value)]. Allows negatives (logH axes).

    axis='x': numbers in a band just below the frame, within its x-span.
    axis='y': numbers just left of the frame, within its y-span.
    """
    x0, y0, x1, y1 = frame
    anchors: Anchors = []
    for w in words:
        wx0, wy0, wx1, wy1, txt = w[0], w[1], w[2], w[3], _normalize_minus(str(w[4]).strip())
        if not _NUMERIC.fullmatch(txt):
            continue
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        if axis == "x" and y1 < cy < y1 + 30 and x0 - 10 <= cx <= x1 + 10:
            anchors.append((cx, float(txt)))
        elif axis == "y" and x0 - 40 < cx < x0 and y0 - 10 <= cy <= y1 + 10:
            anchors.append((cy, float(txt)))
    return sorted(anchors)


def unfold_symmetric(anchors: Anchors, axis: str) -> Anchors:
    """Recover lost signs on a ±-symmetric (folded) axis.

    A film log-sensitivity / log-H axis labelled e.g. `2 1 0 1 2` top->bottom has true values `+2 +1 0 −1 −2`;
    if the minus signs were stripped (detached glyph, or a font we couldn't read) the labels read as a V in
    |value| and the axis silently collapses. Detect that V and restore alternating signs about the near-zero
    turning point. Which arm is negative is chosen from GEOMETRY, not domain: for a y-axis the arm lower on
    the plot (larger source-y) is negative; for an x-axis the arm to the left (smaller source-x). No-op on a
    normal monotone axis, or one that already carries signs.
    """
    a = sorted(anchors)
    vals = [v for _, v in a]
    n = len(vals)
    if n < 5 or any(v < 0 for v in vals):
        return anchors
    ti = min(range(n), key=lambda i: vals[i])                       # turning point = smallest |value|
    if ti == 0 or ti == n - 1 or vals[ti] > 0.25 * max(vals):
        return anchors                                              # turning point not interior / not ~0
    left, right = vals[:ti + 1], vals[ti:]
    is_v = (all(left[i] >= left[i + 1] for i in range(len(left) - 1))
            and all(right[i] <= right[i + 1] for i in range(len(right) - 1)))
    if not is_v:
        return anchors
    # a genuine ±-fold has MIRROR arms (comparable magnitudes + lengths). If the arms are wildly different
    # it's a stray outlier label faking a V (e.g. an x-axis number bleeding into the y-band), not a fold.
    lmax, rmax = max(left), max(right)
    if min(lmax, rmax) < 0.5 * max(lmax, rmax) or abs(len(left) - len(right)) > 2:
        return anchors
    out: Anchors = []
    for i, (pos, v) in enumerate(a):
        neg = (axis == "y" and i > ti) or (axis == "x" and i < ti)
        out.append((pos, -v if neg else v))
    return out


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
        scale, offset, r_out, n_dropped = float(mm), float(bb), abs(r), int((~keep).sum())
        gpos, gval = pk, vk
    else:
        scale, offset, r_out, n_dropped = m, b, abs(float(np.corrcoef(pos, val)[0, 1])), 0
        gpos, gval = pos, val
    # Degenerate-fit guard: labels vary but the map is near-constant (scale~0) — the folded-axis signature
    # (median of mixed-sign slopes ~ 0). Measured over the INLIERS, so a single dropped outlier label (e.g. an
    # x-axis number bleeding into the y-band) doesn't inflate the range and false-trip the guard.
    val_range = float(gval.max() - gval.min())
    pos_span = float(gpos.max() - gpos.min())
    if val_range > 1e-9 and abs(scale) * pos_span < 0.05 * val_range:
        raise CalibrationError(
            "axis labels vary but the fit is near-constant (scale~0) — likely a folded ±-symmetric axis "
            "whose minus signs were lost; sign recovery did not apply. Refusing to return a flat axis.")
    return scale, offset, r_out, n_dropped


def calibrate_axis(words: list[tuple], frame: tuple[float, float, float, float], axis: str,
                   explicit: Anchors | None = None) -> AxisCalibration:
    """Build an AxisCalibration from auto-detected labels, or from explicit (pt,value) anchors."""
    anchors = explicit if explicit is not None else axis_label_anchors(words, frame, axis)
    anchors = unfold_symmetric(anchors, axis)
    scale, offset, r, n_dropped = robust_fit(anchors)
    return AxisCalibration(scale=scale, offset=offset, r=r,
                           anchors=tuple((float(p), float(v)) for p, v in sorted(anchors)),
                           n_dropped=n_dropped)
