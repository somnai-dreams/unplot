"""Colour-keyed raster separation: curves drawn in distinct colours separate by hue, so crossings and shared
baselines don't tangle (the failure mode of greyscale tracing on multi-curve plots)."""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("cv2")

import fitz

from getmapped import Lobe, extract
from make_synthetic import FRAME, _v_to_py, _x_to_px, build


def test_colour_keyed_raster_separates_crossing(tmp_path):
    pdf = str(tmp_path / "s.pdf")
    meta = build(pdf)                                   # 3 colour-keyed crossing lobes (blue/green/red)
    pix = fitz.open(pdf)[0].get_pixmap(dpi=200)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3].copy()
    s = 200 / 72.0

    cs = extract(img, ingest="raster", frame=tuple(v * s for v in FRAME),
                 x_axis=[(_x_to_px(400) * s, 400.0), (_x_to_px(700) * s, 700.0)],
                 y_axis=[(_v_to_py(0) * s, 0.0), (_v_to_py(2) * s, 2.0)],
                 prior=Lobe(0.08), order_by="peak-x", expected_curves=3)

    assert len(cs.curves) == 3
    assert all(c.method == "raster-color" for c in cs.curves)
    peaks = [float(c.points[np.argmax(c.points[:, 1]), 0]) for c in cs.curves]
    for got, want in zip(peaks, [meta["peaks"]["blue"], meta["peaks"]["green"], meta["peaks"]["red"]]):
        assert abs(got - want) <= 6.0, f"peak {got} vs {want}"
