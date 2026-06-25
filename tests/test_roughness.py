"""The roughness metric is a separation-quality probe: ~1-3 for a real curve, dozens+ for several overlapping
same-style curves chained into one tangle. extract() drops candidates above max_roughness (default 12) so a
tangled blob is not returned as a confident curve."""
from __future__ import annotations

import numpy as np

from unplot.qa.shape import roughness


def test_monotone_is_about_one():
    mono = np.column_stack([np.arange(20.0), np.arange(20.0)])
    assert roughness(mono) == 1.0


def test_single_lobe_is_about_two():
    x = np.arange(0.0, 41.0)
    y = 50.0 - np.abs(x - 20.0) * 2.0   # rise to a peak, then fall
    assert abs(roughness(np.column_stack([x, y])) - 2.0) < 0.1


def test_tangle_scores_in_the_tens():
    x = np.arange(200.0)
    y = np.where(np.arange(200) % 2 == 0, 0.0, 10.0)   # y flips every step (a merged tangle)
    assert roughness(np.column_stack([x, y])) > 50.0


def test_flat_curve_is_zero():
    flat = np.column_stack([np.arange(5.0), np.full(5, 3.0)])
    assert roughness(flat) == 0.0
