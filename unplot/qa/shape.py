"""Pure shape-QA metrics on (x, y) point arrays. No domain knowledge, no I/O.

These are the validated, ships-now half of the extraction QA. Each returns a scalar violation
(0 = clean) plus the x where the worst violation sits. The `ShapePrior` classes wrap these into
`Violation` objects; `extract()` folds them into per-curve confidence.
"""
from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def _xy_sorted(points: NDArray) -> tuple[NDArray, NDArray]:
    p = np.asarray(points, dtype=float)
    order = np.argsort(p[:, 0])
    return p[order, 0], p[order, 1]


def flank_violation(points: NDArray) -> tuple[float, float | None]:
    """Largest reversal against the rise-to-peak-then-fall direction, as a fraction of amplitude.

    A clean lobe rises monotonically to its peak then falls monotonically. A crossing-tangle injects a
    secondary bump/dip on a flank. We tolerate shallow within-lobe substructure (real double-humps,
    asymmetric shoulders) implicitly: a small bump yields a small fraction. Returns (violation, x_at).
    """
    xs, ys = _xy_sorted(points)
    if len(ys) < 4:
        return 0.0, None
    amp = float(ys.max() - ys.min())
    if amp <= 1e-6:
        return 0.0, None
    pk = int(np.argmax(ys))
    rv, rmax, rv_at = 0.0, -1e9, None
    for i in range(pk + 1):                 # rising flank: should be non-decreasing
        rmax = max(rmax, ys[i])
        if rmax - ys[i] > rv:
            rv, rv_at = rmax - ys[i], xs[i]
    fv, rmin, fv_at = 0.0, 1e9, None
    for i in range(pk, len(ys)):            # falling flank: should be non-increasing
        rmin = min(rmin, ys[i])
        if ys[i] - rmin > fv:
            fv, fv_at = ys[i] - rmin, xs[i]
    if rv >= fv:
        return rv / amp, (float(rv_at) if rv_at is not None else None)
    return fv / amp, (float(fv_at) if fv_at is not None else None)


def backtrack(points: NDArray, direction: str = "auto") -> tuple[float, float | None]:
    """Largest run of motion against the dominant monotone direction, normalised by y-range.

    direction in {"auto","up","down"}. "auto" picks whichever of up/down the curve mostly does.
    Returns (violation, x_at). A perfectly monotone curve scores 0.
    """
    xs, ys = _xy_sorted(points)
    d = np.diff(ys)
    if len(d) == 0:
        return 0.0, None
    rng = float(ys.max() - ys.min())
    if rng <= 1e-9:
        return 0.0, None
    if direction == "auto":
        direction = "up" if int((d > 1e-9).sum()) >= int((d < -1e-9).sum()) else "down"
    worst, worst_at, run = 0.0, None, 0.0
    for i, step in enumerate(d):
        against = (direction == "up" and step < 0) or (direction == "down" and step > 0)
        run = run + abs(step) if against else 0.0
        if run > worst:
            worst, worst_at = run, xs[i + 1]
    return worst / rng, (float(worst_at) if worst_at is not None else None)


def curvature(points: NDArray) -> tuple[float, float | None]:
    """Max absolute second difference of y, normalised by y-range — a roughness/smoothness probe.

    Cheap stand-in for 'is this curve smooth'. Returns (violation, x_at). Spikes (a stray jump from a
    mis-traced pixel) score high; a smooth curve scores near 0.
    """
    xs, ys = _xy_sorted(points)
    if len(ys) < 3:
        return 0.0, None
    rng = float(ys.max() - ys.min())
    if rng <= 1e-9:
        return 0.0, None
    d2 = np.abs(np.diff(ys, 2))
    j = int(np.argmax(d2))
    return float(d2[j] / rng), float(xs[j + 1])


def roughness(points: NDArray) -> float:
    """Total vertical variation relative to y-range — how many times the curve reverses direction.

    A coherent single curve is ~1-3 (monotone ~1, one lobe ~2); several overlapping same-style curves
    merged into one tangle is dozens+. A separation-quality probe, NOT a shape prior: it flags a candidate
    that isn't a real single curve regardless of the expected shape.
    """
    _, ys = _xy_sorted(points)
    if len(ys) < 2:
        return 0.0
    rng = float(ys.max() - ys.min())
    if rng <= 1e-9:
        return 0.0
    return float(np.abs(np.diff(ys)).sum() / rng)


def max_gap_x(points: NDArray) -> float:
    """Largest gap between consecutive x values (data units) — a coverage-hole signal."""
    xs, _ = _xy_sorted(points)
    if len(xs) < 2:
        return 0.0
    return float(np.max(np.diff(xs)))


def is_x_monotonic(points: NDArray) -> bool:
    """True if x is strictly increasing after sorting (no duplicate-x folds)."""
    xs, _ = _xy_sorted(points)
    return bool(np.all(np.diff(xs) > 0)) if len(xs) > 1 else True
