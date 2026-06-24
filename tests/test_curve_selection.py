"""Regression: multi-curve selection must be confidence-aware. A tall malformed fragment (high amplitude,
confidence ~0) must never displace a real, high-confidence lobe — selecting by amplitude alone was a silent
bug (the curve count looked right, but a genuine lobe was dropped for the fragment)."""
from __future__ import annotations

import numpy as np

from getmapped import Lobe, extract
from make_synthetic import build_adjacent_band_lobes, build_lobes_with_decoy, build_skirted_crossing


def test_selection_keeps_real_lobes_over_tall_decoy(tmp_path):
    path = str(tmp_path / "decoy.pdf")
    meta = build_lobes_with_decoy(path)   # 3 lobes + a TALLER conf-0 zigzag decoy near the left edge
    cs = extract(path, frame=meta["frame"], prior=Lobe(0.08), expected_curves=3, order_by="peak-x")

    assert len(cs.curves) == 3
    # all three returned curves are genuine, high-confidence lobes — the decoy (conf ~0) is rejected
    assert all(c.qa.confidence > 0.9 for c in cs.curves), [c.qa.confidence for c in cs.curves]
    peaks = [float(c.points[np.argmax(c.points[:, 1]), 0]) for c in cs.curves]
    for got, want in zip(peaks, meta["peaks"]):
        assert abs(got - want) <= 6.0, f"peak {got} vs {want}"
    assert all(p > 420.0 for p in peaks)  # the decoy peak (~409) must not be among them


def test_asymmetric_long_skirted_lobes(tmp_path):
    # the real datasheet shape: sharp rise, long descending skirt, heavily overlapping. All three lobes must
    # come back as high-confidence curves with peaks near truth (no conf-0 fragment standing in for a lobe).
    path = str(tmp_path / "skirt.pdf")
    meta = build_skirted_crossing(path)
    cs = extract(path, frame=meta["frame"], prior=Lobe(0.08), expected_curves=3, order_by="peak-x")
    assert len(cs.curves) == 3
    assert all(c.qa.confidence > 0.9 for c in cs.curves), [c.qa.confidence for c in cs.curves]
    peaks = [float(c.points[np.argmax(c.points[:, 1]), 0]) for c in cs.curves]
    for got, want in zip(peaks, meta["peaks"]):
        assert abs(got - want) <= 8.0, f"peak {got} vs {want}"


def test_adjacent_lobes_not_merged(tmp_path):
    # adjacent lobes meeting at the baseline must NOT chain into one full-width curve (the 'two lobes merged'
    # tangle). Expect three distinct lobes, each confined roughly to its own band.
    path = str(tmp_path / "bands.pdf")
    meta = build_adjacent_band_lobes(path)
    cs = extract(path, frame=meta["frame"], prior=Lobe(0.08), expected_curves=3, order_by="peak-x")
    assert len(cs.curves) == 3
    assert all(c.qa.confidence > 0.9 for c in cs.curves), [c.qa.confidence for c in cs.curves]
    peaks = [float(c.points[np.argmax(c.points[:, 1]), 0]) for c in cs.curves]
    for got, want in zip(peaks, meta["peaks"]):
        assert abs(got - want) <= 6.0, f"peak {got} vs {want}"
    # no single curve spans the whole axis (the merge signature)
    assert all((c.points[:, 0].max() - c.points[:, 0].min()) < 180.0 for c in cs.curves)
