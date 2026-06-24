"""Round-trip QA: how well does a recovered curve trace the actual ink on the source plot?

This is the honesty differentiator vs existing digitizers — but it is only meaningful when there IS a
source raster to compare against. For a vector PDF there is no ink image (the geometry came straight from
the file), so `extract()` reports `roundtrip_rms = None` for vector ingest. For raster ingest we measure
how far the source ink sits from the recovered polyline.
"""
from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def ink_rms(polyline_src: NDArray, ink_xy: NDArray, sample: int = 4000) -> float:
    """RMS distance (px) from each ink pixel to the nearest vertex of the recovered polyline.

    polyline_src: (M,2) recovered curve in source/pixel coords.
    ink_xy:       (K,2) coordinates of curve-ink pixels in the plot region (gridlines/text removed).
    Sampled to `sample` ink pixels for speed. Lower is better; a faithful trace hugs the ink.
    """
    if len(polyline_src) == 0 or len(ink_xy) == 0:
        return float("nan")
    ink = ink_xy
    if len(ink) > sample:
        idx = np.linspace(0, len(ink) - 1, sample).astype(int)
        ink = ink[idx]
    # nearest-vertex distance; polylines here are dense (flattened), so vertex distance ~ point-to-curve.
    d2 = ((ink[:, None, 0] - polyline_src[None, :, 0]) ** 2
          + (ink[:, None, 1] - polyline_src[None, :, 1]) ** 2)
    nearest = np.sqrt(d2.min(axis=1))
    return float(np.sqrt(np.mean(nearest ** 2)))
