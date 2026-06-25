"""Raster fallback primitives: threshold + morphological grid removal + per-column run pick + continuity
march. Domain-agnostic — greyscale plot image in, curve fragments out.

Requires the `raster` extra (opencv). The end-to-end raster `extract()` wires `raster_fragments` +
`chain_fragments`: break runs into crossing-free fragments, then re-chain them under the injected prior so
clean crossings separate (tests/test_raster_monotone.py, tests/test_prior_separation.py). Many curves
overlapping over a range (a tight mono plot) are not fully solved — vector ingest is the better route there.
"""
from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray

Frame = tuple[int, int, int, int]   # left, top, right, bottom (px)


def to_gray(img: NDArray) -> NDArray:
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    return img


def ink_mask(gray: NDArray, frame: Frame, dark: int = 160, grid_len: int = 45) -> NDArray:
    """Dark pixels inside `frame`, with horizontal+vertical gridlines morphologically removed."""
    left, top, right, bottom = frame
    dark_m = (gray < dark).astype(np.uint8)
    m = np.zeros_like(dark_m)
    m[top:bottom + 1, left:right + 1] = dark_m[top:bottom + 1, left:right + 1]
    h = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (grid_len, 1)))
    v = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, grid_len)))
    grid = cv2.dilate((h | v).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    return (m & ~grid).astype(np.uint8)


def column_centres(mask: NDArray, frame: Frame, min_run: int = 1, max_run: int = 160) -> dict[int, list[int]]:
    """Per column x, the centre y of each contiguous ink run within [min_run, max_run] px tall."""
    left, top, right, bottom = frame
    cols: dict[int, list[int]] = {}
    for x in range(left, right + 1):
        ys = np.where(mask[top:bottom + 1, x] > 0)[0]
        if len(ys) == 0:
            continue
        runs: list[tuple[int, int]] = []
        s = p = int(ys[0])
        for y in ys[1:]:
            if y == p + 1:
                p = int(y)
                continue
            runs.append((s, p))
            s = p = int(y)
        runs.append((s, p))
        centres = [(a + b) // 2 + top for a, b in runs if min_run <= (b - a + 1) <= max_run]
        if centres:
            cols[x] = centres
    return cols


def ink_xy(mask: NDArray) -> NDArray:
    """All ink-pixel coordinates as (K,2) [x,y] — feeds round-trip QA."""
    ys, xs = np.where(mask > 0)
    return np.column_stack([xs, ys]).astype(float)


def color_curves(img: NDArray, gray: NDArray, frame: Frame, n: int,
                 dark: int = 160, sat: int = 45) -> list[NDArray] | None:
    """Separate colour-coded curves by hue: cluster the saturated ink pixels into `n` colour groups
    (cv2.kmeans on RGB), then take each group's per-column median y as a curve (source coords).

    Different colours never merge, so crossings and shared baselines can't tangle — this is the robust path
    for plots that colour-code their curves. Greyscale/black ink (frame, axis, labels) is excluded by the
    saturation gate. Returns `n` curves, or None if the plot isn't colour-keyed (too little saturated ink).
    """
    left, top, right, bottom = frame
    region = img[top:bottom + 1, left:right + 1].astype(np.int32)
    g = gray[top:bottom + 1, left:right + 1]
    saturation = region.max(2) - region.min(2)
    ys, xs = np.where((g < dark) & (saturation > sat))
    if len(xs) < n * 30:
        return None
    samples = region[ys, xs].astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, _ = cv2.kmeans(samples, n, None, crit, 5, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    out: list[NDArray] = []
    for k in range(n):
        m = labels == k
        if int(m.sum()) < 10:
            continue
        cx, cy = xs[m] + left, ys[m] + top
        order = np.argsort(cx, kind="stable")
        cx, cy = cx[order], cy[order]
        uniq, first = np.unique(cx, return_index=True)
        yv = np.array([np.median(s) for s in np.split(cy, first[1:])], float)
        yv = _rolling_median(yv, 5)                 # denoise the per-column trace (helps mis-clustered/noisy pixels)
        if len(uniq) >= 8:
            out.append(np.column_stack([uniq.astype(float), yv]))
    return out if len(out) == n else None


def _rolling_median(y: NDArray, w: int = 5) -> NDArray:
    if len(y) < w:
        return y
    h = w // 2
    return np.array([np.median(y[max(0, i - h): i + h + 1]) for i in range(len(y))], float)


def raster_fragments(cols: dict[int, list[int]], x_lo: int, x_hi: int,
                     max_dy: float = 8.0) -> list[NDArray]:
    """Trace connected run-fragments that BREAK cleanly at every merge/split (i.e. at crossings).

    A fragment extends to the next column only on an unambiguous one-to-one run match; where two curves
    merge into one run (or one splits into two) the involved fragments are closed and fresh ones start.
    The result is crossing-free pieces — the raster analogue of vector path objects — which `chain_fragments`
    then reconnects under the prior. This is what avoids the slope-corruption a march suffers at a crossing.
    """
    active: list[dict] = []
    done: list[dict] = []
    for x in range(x_lo, x_hi + 1):
        runs = cols.get(x, [])
        frag_runs = {i: [] for i in range(len(active))}
        run_frags = {j: [] for j in range(len(runs))}
        for i, f in enumerate(active):
            if x - f["last_x"] > 2:
                continue
            for j, yy in enumerate(runs):
                if abs(yy - f["y"]) <= max_dy:
                    frag_runs[i].append(j)
                    run_frags[j].append(i)
        used: set[int] = set()
        keep: list[dict] = []
        for i, f in enumerate(active):
            cand = frag_runs[i]
            if len(cand) == 1 and len(run_frags[cand[0]]) == 1:      # unambiguous 1-1 -> extend
                j = cand[0]; yy = float(runs[j]); used.add(j)
                f["pts"].append((x, yy)); f["y"] = yy; f["last_x"] = x
                keep.append(f)
            else:                                                    # ambiguous (merge/split) or lost -> close
                done.append(f)
        active = keep
        for j, yy in enumerate(runs):
            if j not in used:
                active.append({"pts": [(x, float(yy))], "y": float(yy), "last_x": x})
    done += active
    return [np.array(f["pts"], float) for f in done if len(f["pts"]) >= 3]


def chain_fragments(frags: list[NDArray], prior=None, xtol: float = 24.0, ytol: float = 22.0,
                    weight: float = 3.0) -> list[NDArray]:
    """Reconnect crossing-free fragments into full curves via GLOBAL join matching under the prior.

    Every feasible join (end of i -> start of j, with j to the right and nearby) gets a cost
    `-weight * prior.separation_bias(fragment_i, start_j)` (+ small distance terms). We then pick joins
    cheapest-first across ALL of them at once, each fragment getting at most one successor and one
    predecessor — so the most shape-consistent continuations win globally, rather than whichever chain
    reached the crossing first. Joins only ever go left->right in x, so chains cannot cycle. A neutral prior
    reduces this to nearest-endpoint matching.
    """
    frags = sorted(frags, key=lambda f: f[0, 0])
    edges: list[tuple[float, int, int]] = []
    for i, fi in enumerate(frags):
        ex, ey = fi[-1]
        for j, fj in enumerate(frags):
            if i == j:
                continue
            sx, sy = fj[0]
            if sx <= ex or sx - ex > xtol or abs(sy - ey) > ytol:
                continue
            bias = float(prior.separation_bias(fi, np.array((sx, sy), float))) if prior is not None else 0.0
            edges.append((-weight * bias + abs(sy - ey) * 0.1 + (sx - ex) * 0.05, i, j))
    edges.sort(key=lambda e: e[0])
    succ: dict[int, int] = {}
    used_src: set[int] = set()
    used_dst: set[int] = set()
    for _cost, i, j in edges:
        if i in used_src or j in used_dst:
            continue
        succ[i] = j; used_src.add(i); used_dst.add(j)
    out: list[NDArray] = []
    for i in range(len(frags)):
        if i in used_dst:
            continue                                    # not a chain head
        chain = [frags[i]]; cur = i
        while cur in succ:
            cur = succ[cur]; chain.append(frags[cur])
        out.append(np.vstack(chain))
    return out


def march(cols: dict[int, list[int]], x0: int, y0: float, x_end: int,
          max_delta: float = 48.0, slope0: float = 0.0, gap: int = 30) -> list[tuple[int, float]]:
    """Greedy continuity march from (x0,y0) rightward to x_end, picking the nearest run to the slope
    prediction each column. Standalone single-curve primitive; the multi-curve raster path uses
    `raster_fragments` + `chain_fragments` instead (which separate crossings under the prior)."""
    out = [(x0, y0)]
    x, y, slope, last = x0, float(y0), slope0, x0
    while x + 1 <= x_end:
        x += 1
        ys = cols.get(x, [])
        if not ys:
            if x - last > gap:
                break
            continue
        pred = y + slope
        cand = min(ys, key=lambda yy: abs(yy - pred))
        if abs(cand - pred) > max_delta:
            if x - last > gap:
                break
            continue
        slope = 0.65 * slope + 0.35 * (cand - y)
        y = float(cand)
        out.append((x, y))
        last = x
    return out
