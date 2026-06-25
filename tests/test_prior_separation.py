"""Prior-driven crossing separation: the injected ShapePrior resolves a crossing a neutral prior can't.

Two lines form an X. A neutral (Free) prior chains by nearest endpoint and swaps the curves at the crossing
(both come out as tangled V/^ shapes). A direction-aware Monotone prior keeps each line on its own flank, so
they separate into one clean rising and one clean falling curve. This is the payoff of separation_bias.
"""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("cv2")   # raster extra

from unplot import Free, Monotone, extract
from make_synthetic import build_raster_crossing


def _nets(prior):
    fx = build_raster_crossing(dpi=200)
    cs = extract(fx["img"], ingest="raster", frame=fx["frame_px"],
                 x_axis=fx["x_anchors"], y_axis=fx["y_anchors"],
                 prior=prior, order_by="first-x", expected_curves=2)
    return cs, [float(c.points[-1, 1] - c.points[0, 1]) for c in cs.curves]


def _is_clean_split(nets):
    """One clearly rising (+) and one clearly falling (-) curve."""
    return len(nets) == 2 and max(nets) > 1.2 and min(nets) < -1.2


def test_monotone_prior_separates_crossing():
    cs, nets = _nets(Monotone("auto"))
    assert _is_clean_split(nets), f"Monotone should separate the X, got nets {nets}"
    assert all(c.qa.violation < 0.05 for c in cs.curves)   # both come out monotone


def test_neutral_prior_tangles_crossing():
    # demonstrates the prior is necessary: without it, the crossing is NOT cleanly separated.
    _, nets = _nets(Free())
    assert not _is_clean_split(nets), f"neutral prior unexpectedly separated the X (nets {nets})"
