"""Pure curve geometry: turn (possibly tangled) draw-order polylines into clean single-valued curves.

No fitz, no domain knowledge: numpy in, numpy out. These are the de-fan / chain / lobe-split operations
that recover individual curves when a PDF draws several lobes as one continuous pen stroke with jumps and
returns between them.

Orientation convention: source y increases DOWNWARD (PDF/image), so visual 'up' = decreasing y. `split_lobes`
treats `-y` as height accordingly.
"""
from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def x_sorted(P: NDArray) -> NDArray:
    return P[np.argsort(P[:, 0])]


def mono_x_segments(P: NDArray) -> list[NDArray]:
    """Split a draw-order polyline into maximal monotone-in-x runs; orient each x-increasing."""
    segs: list[NDArray] = []
    n = len(P)
    s = 0
    dirn = 0
    for i in range(1, n):
        d = P[i, 0] - P[i - 1, 0]
        if abs(d) < 1e-9:
            continue
        sd = 1 if d > 0 else -1
        if dirn == 0:
            dirn = sd
        elif sd != dirn:
            segs.append(P[s:i])
            s = i - 1
            dirn = sd
    segs.append(P[s:n])
    return [seg[::-1] if seg[-1, 0] < seg[0, 0] else seg for seg in segs]


def _is_valley_join(cur: NDArray, t: NDArray, k: int = 8, margin: float = 2.0) -> bool:
    """True if joining cur's END to t's START sits at a VALLEY — the join point is lower in data (higher
    source-y) than its neighbours a few points back in `cur` and forward in `t`. That's two lobes meeting at
    the baseline, not a broken stroke continuing the same way (where the neighbours straddle the join). Refusing
    valley joins stops adjacent lobes merging into one full-width curve, while still rejoining broken strokes."""
    n = len(cur)
    yb = float(np.mean(cur[max(0, n - k - 1):n - 1, 1])) if n > 1 else float(cur[-1, 1])
    ya = float(np.mean(t[1:k + 1, 1])) if len(t) > 1 else float(t[0, 1])
    ey = float(cur[-1, 1])
    return ey > yb + margin and ey > ya + margin


def chain_curves(segs: list[NDArray], xtol: float = 4.0, ytol: float = 6.0) -> list[NDArray]:
    """Chain x-increasing segments where one's END ~ next's START (both x and y). Rebuilds a curve whose
    stroke the PDF broke at a crossing (its descending tail orphaned into the next path object) — but refuses
    a join that sits at a valley, so two adjacent lobes meeting at the baseline are not merged into one."""
    segs = sorted(segs, key=lambda s: s[0, 0])
    used = [False] * len(segs)
    curves: list[NDArray] = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        cur = s.copy()
        used[i] = True
        ex, ey = cur[-1]
        ch = True
        while ch:
            ch = False
            for j, t in enumerate(segs):
                if used[j]:
                    continue
                if abs(t[0, 0] - ex) < xtol and abs(t[0, 1] - ey) < ytol and not _is_valley_join(cur, t):
                    cur = np.vstack([cur, t])
                    used[j] = True
                    ex, ey = cur[-1]
                    ch = True
                    break
        curves.append(cur)
    return curves


def split_lobes(curve: NDArray, depth_frac: float = 0.35, min_pts: int = 12) -> list[NDArray]:
    """Split a single-valued curve into separate lobes at DEEP inter-lobe valleys (near baseline), while
    keeping shallow within-lobe dips (real double-humps) intact. `h = -y` (visual height)."""
    h = -curve[:, 1]
    h = h - h.min()
    if h.max() <= 0:
        return [curve]
    peaks = [i for i in range(1, len(h) - 1)
             if h[i] >= h[i - 1] and h[i] >= h[i + 1] and h[i] > 0.15 * h.max()]
    if len(peaks) < 2:
        return [curve]
    splits: list[int] = []
    for a, b in zip(peaks, peaks[1:]):
        v = a + int(np.argmin(h[a:b + 1]))
        if h[v] < depth_frac * min(h[a], h[b]):
            splits.append(v)
    if not splits:
        return [curve]
    out: list[NDArray] = []
    prev = 0
    for v in splits:
        if v - prev >= min_pts:
            out.append(curve[prev:v + 1])
        prev = v
    if len(curve) - prev >= min_pts:
        out.append(curve[prev:])
    return out
