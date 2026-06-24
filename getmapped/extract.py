"""Top-level entry point: extract(plot) -> CurveSet.

One frame = one CurveSet. A datasheet page with sens + char + dye plots is three extract() calls. The
library knows nothing about film: the caller passes a ShapePrior and, after the fact, maps order_index ->
channel via CurveSet.labeled(...).
"""
from __future__ import annotations

from typing import Literal

import numpy as np
from numpy.typing import NDArray

from .axes.calibrate import calibrate_axis
from .curveset import AxisCalibration, Curve, CurveSet, CurveStyle, OrderBy, Source
from .io import vector as iov
from .priors import Free, ShapePrior
from .qa.confidence import count_crossings, curve_qa, set_qa
from .separate.separate import separate

Anchors = list[tuple[float, float]]
AxisSpec = Literal["auto"] | Anchors


def _finalize(P_src: NDArray, x_axis: AxisCalibration, y_axis: AxisCalibration) -> tuple[NDArray, NDArray]:
    """Map source -> data, x-sort, and drop folds (non-increasing x) so the curve is single-valued.
    Keeps source coords aligned to the surviving data points (for overlay / round-trip)."""
    xd = x_axis.to_data(P_src[:, 0])
    yd = y_axis.to_data(P_src[:, 1])
    M = np.column_stack([P_src[:, 0], P_src[:, 1], xd, yd])
    M = M[np.argsort(M[:, 2])]
    keep = [0]
    for i in range(1, len(M)):
        if M[i, 2] > M[keep[-1], 2] + 1e-9:
            keep.append(i)
    M = M[keep]
    return M[:, 2:4].copy(), M[:, 0:2].copy()


def _order_key(points_data: NDArray, order_by: OrderBy) -> float:
    x, y = points_data[:, 0], points_data[:, 1]
    if order_by == "peak-x":
        return float(x[int(np.argmax(y))])
    if order_by == "mean-y":
        return float(np.mean(y))
    return float(x.min())   # first-x


def extract(source: str | NDArray, *, page: int = 0,
            frame: tuple[float, float, float, float] | None = None,
            x_axis: AxisSpec = "auto", y_axis: AxisSpec = "auto",
            prior: ShapePrior = Free(), order_by: OrderBy = "peak-x",
            expected_curves: int | None = None,
            ingest: Literal["auto", "vector", "raster"] = "auto",
            split: bool = False, min_segs: int = 3, defan: dict | None = None) -> CurveSet:
    """`defan` tunes the polyline (de-fan/chain) separation; pass separate.DEFAN_POLYLINE for
    continuous-stroke polyline sheets. `split=True` separates lobes a sheet draws as one stroke."""
    if ingest == "auto":
        ingest = "vector" if (isinstance(source, str) and iov.is_vector(source, page)) else "raster"
    if ingest == "vector":
        return _extract_vector(source, page, frame, x_axis, y_axis, prior, order_by,
                               expected_curves, split, min_segs, defan)
    return _extract_raster(source, page, frame, x_axis, y_axis, prior, order_by, expected_curves)


def _build_curves(cands, x_axis, y_axis, order_by, prior, method_label):
    built = []
    for dash, color, P_src in cands:
        pdata, psrc = _finalize(P_src, x_axis, y_axis)
        if len(pdata) >= 2:
            built.append((dash, color, pdata, psrc))
    built.sort(key=lambda t: _order_key(t[2], order_by))
    curves = []
    for k, (dash, color, pdata, psrc) in enumerate(built):
        style = CurveStyle(dash=dash, color=tuple(color) if color else None, width=None)
        curves.append(Curve(id=f"c{k}", order_index=k, style=style, points=pdata,
                            points_src=psrc, method=method_label, qa=curve_qa(pdata, prior)))
    return tuple(curves)


def _extract_vector(path, page, frame, x_axis, y_axis, prior, order_by, expected_curves, split, min_segs, defan):
    vp = iov.load(path, page)
    if frame is None:
        frame = iov.curve_paths_bbox(vp, min_segs)
        if frame is None:
            raise ValueError("no curve paths found on page; pass an explicit `frame`")
    x_cal = calibrate_axis(vp.words, frame, "x", None if x_axis == "auto" else x_axis)
    y_cal = calibrate_axis(vp.words, frame, "y", None if y_axis == "auto" else y_axis)
    raw = iov.paths_in_frame(vp, frame, min_segs)
    cands, method = separate(raw, expected_curves=expected_curves, split=split, defan=defan)
    label = "vector-path" if method == "style" else "vector-defan-chain"
    curves = _build_curves(cands, x_cal, y_cal, order_by, prior, label)

    warnings: list[str] = []
    if abs(x_cal.r) < 0.999 or abs(y_cal.r) < 0.999:
        warnings.append(f"axis fit r below 0.999 (x={x_cal.r:.4f}, y={y_cal.r:.4f})")
    if expected_curves and len(curves) != expected_curves:
        warnings.append(f"expected {expected_curves} curves, recovered {len(curves)}")
    src = Source(path=path, ingest="vector", frame_src=tuple(map(float, frame)), page=page, dpi=None)
    return CurveSet(curves=curves, x_axis=x_cal, y_axis=y_cal, source=src,
                    prior=prior.name, qa=set_qa(curves, x_cal, y_cal, None, tuple(warnings)))


def _extract_raster(source, page, frame, x_axis, y_axis, prior, order_by, expected_curves,
                    dpi: int = 300, dark: int = 160):
    """Carved raster primitives wired into fragment-then-chain separation under the injected prior. Clean
    crossings separate (tests/test_raster_monotone.py, test_prior_separation.py); many curves overlapping
    over a range are not fully solved and the QA reports it. Needs an explicit `frame` (px) and explicit
    axis anchors (no vector text layer to read)."""
    from .curves import rasterpaths as rp
    from .io import raster as ior
    from .qa.roundtrip import ink_rms

    if isinstance(source, str) and source.lower().endswith(".pdf"):
        img = ior.rasterize_pdf(source, page, dpi)
    elif isinstance(source, str):
        img = ior.load_image(source)
    else:
        img = np.asarray(source)
    if frame is None:
        raise ValueError("raster ingest needs an explicit `frame` (px); auto frame detection is per-sheet "
                         "specific and stays caller-side")
    if x_axis == "auto" or y_axis == "auto":
        raise ValueError("raster ingest needs explicit axis anchors (no vector text layer to read)")

    gray = rp.to_gray(img)
    left, top, right, bottom = (int(v) for v in frame)
    ifr = (left, top, right, bottom)
    x_cal = calibrate_axis([], frame, "x", x_axis)
    y_cal = calibrate_axis([], frame, "y", y_axis)
    mask = rp.ink_mask(gray, ifr, dark=dark)
    cols = rp.column_centres(mask, ifr)

    # fragment-then-chain: break runs into crossing-free fragments, then let the prior pick which fragment
    # continues which at each crossing (neutral prior -> nearest-endpoint chaining).
    want = expected_curves or 1
    frags = rp.raster_fragments(cols, left, right)
    chained = rp.chain_fragments(frags, prior=prior)
    chained.sort(key=lambda c: -(c[:, 0].max() - c[:, 0].min()))   # widest span first
    cands = [(None, None, c) for c in chained[:want]]

    curves = _build_curves(cands, x_cal, y_cal, order_by, prior, "raster-march")
    warnings: list[str] = []
    if count_crossings(curves) > 0:
        warnings.append("raster: recovered curves cross — separation may have tangled them at a crossing; "
                        "verify, or use vector ingest / per-family anchors")
    if expected_curves and len(curves) != expected_curves:
        warnings.append(f"expected {expected_curves} curves, recovered {len(curves)}")
    rt = ink_rms(np.vstack([c.points_src for c in curves]), rp.ink_xy(mask)) if curves else None
    src = Source(path=source if isinstance(source, str) else "<array>", ingest="raster",
                 frame_src=tuple(map(float, frame)), page=page, dpi=dpi)
    return CurveSet(curves=curves, x_axis=x_cal, y_axis=y_cal, source=src,
                    prior=prior.name, qa=set_qa(curves, x_cal, y_cal, rt, tuple(warnings)))
