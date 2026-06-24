"""Vector-PDF ingest: read drawn path geometry + numeric text labels straight from the file.

This is the headline path — for vector PDFs the exact drawn curves are *in* the file, so there is no pixel
re-detection and crossing-tangle is impossible by construction. All PyMuPDF (fitz) coupling lives here;
downstream modules see only numpy arrays + plain tuples.
"""
from __future__ import annotations

from dataclasses import dataclass

import fitz  # pymupdf
import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class RawPath:
    pts: NDArray                              # (N,2) flattened path points, SOURCE coords (PDF pt), as drawn
    dash: str                                # "solid" | "dashed" | "dashdot"
    color: tuple[float, ...] | None          # stroke RGB (rounded) if non-grey, else None
    width: float                             # bbox width (pt)
    height: float                            # bbox height (pt)
    n_segs: int                              # drawn line/curve segment count (for polyline prefiltering)


@dataclass(frozen=True)
class VectorPage:
    path: str
    page: int
    drawings: list[dict]
    words: list[tuple]                       # (x0,y0,x1,y1,text,...) per word
    rect: tuple[float, float, float, float]
    has_raster: bool


def load(path: str, page: int = 0) -> VectorPage:
    doc = fitz.open(path)
    pg = doc[page]
    r = pg.rect
    return VectorPage(path, page, pg.get_drawings(), pg.get_text("words"),
                      (r.x0, r.y0, r.x1, r.y1), len(pg.get_images()) > 0)


def is_vector(path: str, page: int = 0) -> bool:
    """A page is 'vector' if it carries drawn paths and no embedded raster image."""
    doc = fitz.open(path)
    pg = doc[page]
    return len(pg.get_images()) == 0 and len(pg.get_drawings()) > 0


def _bez(p0, p1, p2, p3, n: int = 24) -> NDArray:
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3) * [p0.x, p0.y] + 3 * ((1 - t) ** 2) * t * [p1.x, p1.y] \
        + 3 * (1 - t) * t * t * [p2.x, p2.y] + t ** 3 * [p3.x, p3.y]


def _flatten(d: dict, n: int = 24) -> NDArray:
    pts: list[list[float]] = []
    for it in d["items"]:
        if it[0] == "l":
            pts += [[it[1].x, it[1].y], [it[2].x, it[2].y]]
        elif it[0] == "c":
            pts += _bez(it[1], it[2], it[3], it[4], n).tolist()
    return np.array(pts) if pts else np.empty((0, 2))


def _dash_style(dash: str | None) -> str:
    """Map a PDF stroke dash array to solid|dashed|dashdot by element count."""
    d = (dash or "").strip()
    if d.startswith("[]"):
        return "solid"
    nums = [x for x in d.strip("[] 0").split() if x]
    if len(nums) >= 4:
        return "dashdot"
    if len(nums) >= 2:
        return "dashed"
    return "solid"


def _is_box(P: NDArray, r, frac: float = 0.9, tol: float = 3.0) -> bool:
    """True if (nearly) all points hug the bbox border — i.e. this path is the plot frame, not a curve.
    A full-span diagonal curve has interior points, so it survives; a rectangle's points are all on edges."""
    near = ((np.abs(P[:, 0] - r.x0) < tol) | (np.abs(P[:, 0] - r.x1) < tol)
            | (np.abs(P[:, 1] - r.y0) < tol) | (np.abs(P[:, 1] - r.y1) < tol))
    return float(near.mean()) > frac


def paths_in_frame(page: VectorPage, frame: tuple[float, float, float, float],
                   min_segs: int = 3, color_sat: float = 0.15,
                   drop_frame: bool = True, min_wh: float = 6.0) -> list[RawPath]:
    """Flatten every stroked CURVE path whose bbox sits inside `frame` into a RawPath (source coords).

    Rejects non-curve geometry:
      - the plot frame box (fills the frame and hugs its border) when `drop_frame`,
      - axis ticks / gridlines (bbox thinner than `min_wh` in either dimension).
    `color_sat`: a stroke counts as colour-keyed when max(rgb)-min(rgb) exceeds it (non-grey).
    """
    x0, y0, x1, y1 = frame
    fw, fh = x1 - x0, y1 - y0
    out: list[RawPath] = []
    for d in page.drawings:
        nseg = sum(1 for it in d["items"] if it[0] in ("c", "l"))
        if nseg < min_segs:
            continue
        r = d["rect"]
        if not (x0 - 2 <= r.x0 and r.x1 <= x1 + 2 and y0 - 2 <= r.y0 and r.y1 <= y1 + 2):
            continue
        if r.width < min_wh or r.height < min_wh:          # axis tick / gridline
            continue
        P = _flatten(d)
        if not len(P):
            continue
        if drop_frame and r.width > 0.9 * fw and r.height > 0.9 * fh and _is_box(P, r):
            continue                                       # the plot box
        col = d.get("color")
        color = tuple(round(c, 3) for c in col) if (col and (max(col) - min(col) > color_sat)) else None
        out.append(RawPath(P, _dash_style(d.get("dashes")), color, r.width, r.height, nseg))
    return out


def curve_paths_bbox(page: VectorPage, min_segs: int = 3) -> tuple[float, float, float, float] | None:
    """Bounding box of all curve-like stroked paths on the page — the auto-frame for a single-plot page.
    For multi-plot pages, pass an explicit `frame` to extract() instead."""
    boxes = [d["rect"] for d in page.drawings
             if sum(1 for it in d["items"] if it[0] in ("c", "l")) >= min_segs]
    if not boxes:
        return None
    x0 = min(b.x0 for b in boxes); y0 = min(b.y0 for b in boxes)
    x1 = max(b.x1 for b in boxes); y1 = max(b.y1 for b in boxes)
    return (x0, y0, x1, y1)
