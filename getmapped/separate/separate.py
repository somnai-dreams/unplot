"""Crossing separation for vector paths: turn RawPaths into distinct candidate curves.

Two strategies:
  - 'style': each distinct stroke style (dash + colour) is its own curve — merge its path fragments. Works
    when the plot distinguishes curves by line style/colour. Crossing-tangle can't happen: each curve is
    already its own object.
  - 'defan': curves share a style and are drawn as continuous pen strokes (one polyline per plot). De-fan
    each path into monotone-x runs, chain them by endpoint continuity, optionally split shared-stroke lobes.

Returns candidates in SOURCE coords (unordered); extract() calibrates, then orders in data space.
"""
from __future__ import annotations

from typing import Literal

import numpy as np
from numpy.typing import NDArray

from ..curves.vectorpaths import chain_curves, mono_x_segments, split_lobes, x_sorted
from ..io.vector import RawPath

Candidate = tuple[str | None, tuple[float, ...] | None, NDArray]   # (dash, color, pts_src)
Method = Literal["auto", "style", "defan"]


def _by_style(rawpaths: list[RawPath]) -> list[Candidate]:
    groups: dict[tuple[str | None, tuple[float, ...] | None], list[NDArray]] = {}
    for rp in rawpaths:
        groups.setdefault((rp.dash, rp.color), []).append(rp.pts)
    return [(dash, color, x_sorted(np.vstack(plist))) for (dash, color), plist in groups.items()]


def _by_defan(rawpaths: list[RawPath], split: bool,
              min_seg: int, min_curve: int, min_path_segs: int) -> list[Candidate]:
    segs: list[NDArray] = []
    for rp in rawpaths:
        if rp.n_segs < min_path_segs:                # keep only the big curve polylines (drop annotations)
            continue
        segs += [s for s in mono_x_segments(rp.pts) if len(s) >= min_seg]
    curves = [c for c in chain_curves(segs) if len(c) >= min_curve]
    if split:
        out: list[NDArray] = []
        for c in curves:
            out += [lobe for lobe in split_lobes(c) if len(lobe) >= min_curve]
        curves = out
    return [(None, None, x_sorted(c)) for c in curves]


# Continuous-stroke polyline plots (one pen stroke tracing all lobes) need this recipe; dash/colour-keyed
# plots use the 'style' path and ignore defan entirely.
DEFAN_DEFAULT = {"min_seg": 12, "min_curve": 16, "min_path_segs": 0}
DEFAN_POLYLINE = {"min_seg": 20, "min_curve": 20, "min_path_segs": 40}


def separate(rawpaths: list[RawPath], *, expected_curves: int | None = None,
             method: Method = "auto", split: bool = False,
             defan: dict | None = None) -> tuple[list[Candidate], str]:
    """Return (candidates, method_used). `defan` tunes the polyline path (see DEFAN_POLYLINE). When more
    candidates than `expected_curves`, keep the most prominent (largest y-amplitude)."""
    d = {**DEFAN_DEFAULT, **(defan or {})}
    n_styles = len({(rp.dash, rp.color) for rp in rawpaths})
    if method == "auto":
        if expected_curves and n_styles >= expected_curves:
            method = "style"
        elif expected_curves is None and n_styles > 1:
            method = "style"
        else:
            method = "defan"
    if method == "style":
        cands = _by_style(rawpaths)
    else:
        cands = _by_defan(rawpaths, split, d["min_seg"], d["min_curve"], d["min_path_segs"])
    cands.sort(key=lambda c: -(c[2][:, 1].max() - c[2][:, 1].min()))   # most prominent (tallest) first
    if expected_curves:
        cands = cands[:expected_curves]
    return cands, method
