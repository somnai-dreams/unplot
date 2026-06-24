"""Raster ingest on a synthetic, clean (non-crossing) plot.

Validates the carved raster path end-to-end: render -> ink mask -> column pick -> continuity march ->
calibrate -> QA, on three separable monotone curves. (Raster crossing separation is a known gap and is
covered by the vector path / a future prior, so the fixture keeps the curves apart.)
"""
from __future__ import annotations

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")   # raster extra

from getmapped import Monotone, extract
from make_synthetic import build_raster_monotone


@pytest.fixture()
def raster():
    return build_raster_monotone(dpi=200)


def test_three_monotone_curves_recovered(raster):
    cs = extract(raster["img"], ingest="raster", frame=raster["frame_px"],
                 x_axis=raster["x_anchors"], y_axis=raster["y_anchors"],
                 prior=Monotone("up"), order_by="mean-y", expected_curves=3)

    assert cs.source.ingest == "raster"
    assert len(cs.curves) == 3
    assert cs.qa.roundtrip_rms is not None        # raster ingest measures ink round-trip

    # ordered low->high by mean-y == red, green, blue; end value (~nm 700) matches truth within pixel tol
    truth = [raster["truth_end"]["red"], raster["truth_end"]["green"], raster["truth_end"]["blue"]]
    for c, want in zip(cs.curves, truth):
        got = float(c.points[np.argmax(c.points[:, 0]), 1])   # y at max x
        assert abs(got - want) <= 0.12, f"end value {got:.2f} vs {want:.2f}"


def test_monotone_curves_pass_qa(raster):
    cs = extract(raster["img"], ingest="raster", frame=raster["frame_px"],
                 x_axis=raster["x_anchors"], y_axis=raster["y_anchors"],
                 prior=Monotone("up"), order_by="mean-y", expected_curves=3)
    assert all(c.qa.passed for c in cs.curves)
    assert cs.qa.crossings == 0                    # parallel curves never cross
