"""End-to-end vector extraction against a synthetic plot with known ground truth.

This is the miniature of the Phase-4 reproduction gate: build a plot from a known mapping, extract it back,
assert the recovered peaks + calibration match within tight tolerance.
"""
from __future__ import annotations

import numpy as np
import pytest

from getmapped import Lobe, extract
from make_synthetic import FRAME, build


@pytest.fixture()
def synth(tmp_path):
    path = str(tmp_path / "synth.pdf")
    meta = build(path)
    return path, meta


def _peak_x(curve):
    return float(curve.points[int(np.argmax(curve.points[:, 1])), 0])


def test_three_lobes_recovered(synth):
    path, meta = synth
    cs = extract(path, frame=FRAME, prior=Lobe(0.08), expected_curves=3, order_by="peak-x")

    assert cs.source.ingest == "vector"
    assert len(cs.curves) == 3

    # peaks recovered in ascending order (blue < green < red), within 5 data-units of ground truth
    recovered = [_peak_x(c) for c in cs.curves]
    assert recovered == sorted(recovered)
    expected = [meta["peaks"]["blue"], meta["peaks"]["green"], meta["peaks"]["red"]]
    for got, want in zip(recovered, expected):
        assert abs(got - want) <= 5.0, f"peak {got} vs expected {want}"


def test_calibration_is_clean(synth):
    path, _ = synth
    cs = extract(path, frame=FRAME, prior=Lobe(0.08), expected_curves=3)
    assert abs(cs.x_axis.r) > 0.999
    assert abs(cs.y_axis.r) > 0.999
    # x maps frame edges 60->400, 360->700 (1 unit/pt)
    assert cs.x_axis.to_data(60.0) == pytest.approx(400.0, abs=2.0)
    assert cs.x_axis.to_data(360.0) == pytest.approx(700.0, abs=2.0)


def test_clean_lobes_pass_qa(synth):
    path, _ = synth
    cs = extract(path, frame=FRAME, prior=Lobe(0.08), expected_curves=3)
    assert all(c.qa.passed for c in cs.curves)
    assert all(c.qa.violation < 0.08 for c in cs.curves)
    assert cs.qa.confidence > 0.9
    # the lobes genuinely cross, and crossing separation handled it by colour
    assert cs.qa.crossings >= 1


def test_labeled_mapping(synth):
    path, _ = synth
    cs = extract(path, frame=FRAME, prior=Lobe(0.08), expected_curves=3)
    named = cs.labeled({0: "blue", 1: "green", 2: "red"})
    assert set(named) == {"blue", "green", "red"}
    assert _peak_x(named["blue"]) < _peak_x(named["green"]) < _peak_x(named["red"])
