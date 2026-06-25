"""Fold shape-prior violations + calibration + coverage into per-curve and set-level confidence."""
from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from ..curveset import AxisCalibration, Curve, CurveQA, CurveSetQA
from ..priors import ShapePrior
from . import shape


def _confidence(violation: float, tolerance: float, x_monotonic: bool) -> float:
    if math.isinf(tolerance):
        c = 1.0
    elif tolerance > 0:
        c = max(0.0, 1.0 - violation / tolerance)   # 1 at clean, 0 once violation reaches tolerance
    else:
        c = 1.0 if violation <= 0 else 0.0
    if not x_monotonic:
        c *= 0.5                                     # a folded curve is suspect even if it "passes"
    return round(c, 3)


def curve_qa(points_data: NDArray, prior: ShapePrior, notes: tuple[str, ...] = ()) -> CurveQA:
    v = prior.qa_violation(points_data)
    xmono = shape.is_x_monotonic(points_data)
    passed = v.magnitude < prior.tolerance
    return CurveQA(
        prior=prior.name, violation=round(v.magnitude, 4), violation_kind=v.kind, violation_at=v.at,
        passed=passed, n_points=len(points_data), x_monotonic=xmono,
        roughness=round(shape.roughness(points_data), 2),
        max_gap_x=round(shape.max_gap_x(points_data), 4),
        confidence=_confidence(v.magnitude, prior.tolerance, xmono), notes=notes,
    )


def _crosses(A: NDArray, B: NDArray) -> bool:
    lo = max(float(A[:, 0].min()), float(B[:, 0].min()))
    hi = min(float(A[:, 0].max()), float(B[:, 0].max()))
    if hi <= lo:
        return False
    xs = np.linspace(lo, hi, 32)
    diff = np.interp(xs, A[:, 0], A[:, 1]) - np.interp(xs, B[:, 0], B[:, 1])
    s = np.sign(diff)
    s = s[s != 0]
    return bool(len(s) > 1 and np.any(np.diff(s) != 0))


def count_crossings(curves: tuple[Curve, ...]) -> int:
    n = 0
    for i in range(len(curves)):
        for j in range(i + 1, len(curves)):
            if _crosses(curves[i].points, curves[j].points):
                n += 1
    return n


def set_qa(curves: tuple[Curve, ...], x_axis: AxisCalibration, y_axis: AxisCalibration,
           roundtrip_rms: float | None, warnings: tuple[str, ...]) -> CurveSetQA:
    base = float(np.mean([c.qa.confidence for c in curves])) if curves else 0.0
    r = min(abs(x_axis.r), abs(y_axis.r))             # a poor axis fit drags the whole set down
    return CurveSetQA(
        confidence=round(base * r, 3), n_curves=len(curves),
        crossings=count_crossings(curves), roundtrip_rms=roundtrip_rms, warnings=warnings,
    )
