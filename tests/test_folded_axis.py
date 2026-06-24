"""Regression: a ±-symmetric (folded) axis must calibrate to its true signed range, or fail loud — never
silently collapse to a flat axis with a falsely-perfect r. Covers both the stripped-minus (folded V ->
unfold) and Unicode-minus (U+2212 -> normalize) paths. See the bug report this fixes."""
from __future__ import annotations

import numpy as np
import pytest

from getmapped import Free, extract
from getmapped.axes.calibrate import robust_fit, unfold_symmetric
from make_synthetic import build_folded_axis


def _endpoints(cs):
    c = cs.curves[0]
    yl = float(c.points[np.argmin(c.points[:, 0]), 1])    # y at smallest x
    yr = float(c.points[np.argmax(c.points[:, 0]), 1])    # y at largest x
    return yl, yr


@pytest.mark.parametrize("minus_style", ["stripped", "unicode"])
def test_folded_axis_recovers_signed_range(tmp_path, minus_style):
    path = str(tmp_path / f"folded_{minus_style}.pdf")
    meta = build_folded_axis(path, minus_style)
    cs = extract(path, frame=meta["frame"], prior=Free(), expected_curves=1)

    assert abs(cs.y_axis.r) > 0.999                       # clean linear fit after sign recovery
    yl, yr = _endpoints(cs)
    assert abs(yl - meta["y_left"]) < 0.15, f"left y {yl} vs +1.5"      # +1.5, not collapsed/positive-only
    assert abs(yr - meta["y_right"]) < 0.15, f"right y {yr} vs -1.5"    # -1.5, the negative arm recovered


def test_stray_outlier_label_does_not_fake_a_fold():
    # a clean monotone axis (4 3 2 1 0) plus ONE stray outlier (e.g. an x-axis '350' bleeding into the y-band)
    # must NOT be read as a folded V, and the robust fit must drop the outlier rather than fail loud.
    anchors = [(327.0, 4.0), (363.0, 3.0), (400.0, 2.0), (438.0, 1.0), (477.0, 0.0), (484.0, 350.0)]
    assert unfold_symmetric(anchors, "y") == anchors          # arms not symmetric -> no unfold
    scale, offset, r, n_dropped = robust_fit(anchors)         # must not raise the degenerate guard
    assert n_dropped == 1                                     # the 350 outlier dropped
    assert abs(scale) > 1e-3 and abs(r) > 0.999               # a real, clean linear fit
