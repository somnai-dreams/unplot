"""Regression: a grid drawn as ONE stroke (every segment axis-aligned, bbox = the whole frame) must be
dropped by the ruled-path filter, not extracted as a curve and tangled with the data. The thin-bbox check
can't catch it because its bounding box spans the frame."""
from __future__ import annotations

import numpy as np

from unplot import Lobe, extract
from unplot.io import vector as iov
from make_synthetic import build_gridded


def test_grid_drawn_as_one_stroke_is_ignored(tmp_path):
    path = str(tmp_path / "gridded.pdf")
    meta = build_gridded(path)
    cs = extract(path, frame=meta["frame"], prior=Lobe(0.08), expected_curves=3, order_by="peak-x")

    assert len(cs.curves) == 3
    assert all(c.qa.confidence > 0.9 for c in cs.curves), [c.qa.confidence for c in cs.curves]
    peaks = [float(c.points[np.argmax(c.points[:, 1]), 0]) for c in cs.curves]
    for got, want in zip(peaks, meta["peaks"].values()):
        assert abs(got - want) <= 6.0, f"peak {got} vs {want}"

    # the grey grid path must not survive paths_in_frame — its bbox spans the frame, so min_wh can't catch it
    vp = iov.load(path)
    raw = iov.paths_in_frame(vp, meta["frame"])
    fw = meta["frame"][2] - meta["frame"][0]
    assert not any(rp.color is None and rp.width > 0.8 * fw for rp in raw), "the grid leaked through the filter"


def test_is_ruled_distinguishes_grid_from_curve():
    class P:
        def __init__(self, x, y):
            self.x, self.y = x, y

    # every segment axis-aligned -> a grid / ruled path
    grid = {"items": [("l", P(0, 0), P(100, 0)), ("l", P(0, 10), P(100, 10)), ("l", P(50, 0), P(50, 90))]}
    assert iov._is_ruled(grid) is True
    # a diagonal line segment -> could be real data
    diag = {"items": [("l", P(0, 0), P(100, 0)), ("l", P(0, 0), P(80, 60))]}
    assert iov._is_ruled(diag) is False
    # a Bezier segment -> a real curve
    bez = {"items": [("l", P(0, 0), P(100, 0)), ("c", P(0, 0), P(10, 10), P(20, 5), P(30, 0))]}
    assert iov._is_ruled(bez) is False
