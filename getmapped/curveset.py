"""The output contract: a CurveSet is N calibrated curves + per-curve metadata + a QA/confidence report.

Neutral units throughout (floats). NO film knowledge — no nm, no density, no channel names. The library
hands back neutral handles (`c0`, `c1`, ...) ordered deterministically; the caller maps order -> meaning.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from numpy.typing import NDArray

Ingest = Literal["vector", "raster"]
Method = Literal["vector-path", "vector-defan-chain", "raster-march", "raster-color"]
OrderBy = Literal["peak-x", "mean-y", "first-x"]
Dash = Literal["solid", "dashed", "dashdot"]


@dataclass(frozen=True)
class Source:
    path: str
    ingest: Ingest
    frame_src: tuple[float, float, float, float]   # x0,y0,x1,y1 in source coords (PDF pt or px)
    page: int | None = None                        # vector page index; None for a raster image
    dpi: int | None = None                         # raster only


@dataclass(frozen=True)
class AxisCalibration:
    """data = scale * source + offset. LINEAR only — log-spaced axes are unsupported (see README scope)."""
    scale: float
    offset: float
    r: float                                       # |corr| of the label-anchor fit; ~1.0 = clean linear axis
    anchors: tuple[tuple[float, float], ...]       # (source_pos, data_value) pairs used
    n_dropped: int                                 # outlier anchors the robust fit rejected

    def to_data(self, src: float) -> float:
        return self.scale * src + self.offset


@dataclass(frozen=True)
class CurveStyle:
    dash: Dash | None                              # None when not dash-distinguished
    color: tuple[float, float, float] | None       # stroke RGB 0..1 if colour-keyed, else None
    width: float | None


@dataclass(frozen=True)
class CurveQA:
    prior: str                     # the ShapePrior the curve was scored against
    violation: float               # shape-prior violation magnitude (0 = clean)
    violation_kind: str            # "flank" | "backtrack" | "curvature" | "none"
    violation_at: float | None     # x (data units) of the worst violation
    passed: bool                   # violation < prior.tolerance
    n_points: int
    x_monotonic: bool              # x strictly increasing after sort + dedupe
    max_gap_x: float               # largest x gap (data units) — coverage-hole signal
    confidence: float              # 0..1 composite
    notes: tuple[str, ...]


@dataclass(frozen=True, eq=False)
class Curve:
    id: str                        # stable neutral handle ("c0"...) — never a channel name
    order_index: int               # position under the chosen ordering
    style: CurveStyle
    points: NDArray                # (N,2) in DATA space, x-sorted + deduped
    points_src: NDArray            # (N,2) in SOURCE space (overlay / round-trip)
    method: Method
    qa: CurveQA


@dataclass(frozen=True)
class CurveSetQA:
    confidence: float              # set-level 0..1
    n_curves: int
    crossings: int                 # x-overlapping crossings detected between curves
    roundtrip_rms: float | None    # source-ink vs re-rasterized-curve RMS (px), if round-trip QA ran
    warnings: tuple[str, ...]


@dataclass(frozen=True, eq=False)
class CurveSet:
    curves: tuple[Curve, ...]
    x_axis: AxisCalibration
    y_axis: AxisCalibration
    source: Source
    prior: str                     # ShapePrior.name used
    qa: CurveSetQA

    def labeled(self, mapping: dict[int, str]) -> dict[str, Curve]:
        """Caller convenience: turn order_index -> label (e.g. {0:'blue',1:'green',2:'red'}) into a
        name->Curve dict. The library never assigns these names; the caller owns the map."""
        return {mapping[c.order_index]: c for c in self.curves if c.order_index in mapping}
