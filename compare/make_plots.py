"""Generate the manual-comparison test set: fixed synthetic plots as PNG (for the GUI tools) AND vector PDF
(for GetMapped's vector path), plus ground_truth.json. Deterministic — no randomness. Run once:

    python compare/make_plots.py

Outputs into compare/plots/ : <name>.png, <name>.pdf, and compare/ground_truth.json.
"""
from __future__ import annotations

import json
import os

import fitz
import numpy as np

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "plots")
DPI = 200
FRAME = (60.0, 40.0, 360.0, 240.0)      # x0,y0,x1,y1 (pt)
XR, YR = (400.0, 700.0), (0.0, 2.0)     # data ranges at the frame edges
COLORS = {"c0": (0, 0, 1), "c1": (0, 0.6, 0), "c2": (0.9, 0, 0)}
NM = np.arange(400.0, 700.001, 2.0)


def x2px(x):
    return FRAME[0] + (x - XR[0]) / (XR[1] - XR[0]) * (FRAME[2] - FRAME[0])


def v2py(v):
    return FRAME[3] - (v - YR[0]) / (YR[1] - YR[0]) * (FRAME[3] - FRAME[1])


def lobe(peak, sigma, amp):
    return amp * np.exp(-0.5 * ((NM - peak) / sigma) ** 2)


# name -> list of (curve_id, peak, sigma, amp); single-curve plots use black, multi use R/G/B
PLOTS = {
    "p1_single": [("c0", 540, 26, 1.7)],
    "p2_three_separated": [("c0", 450, 20, 1.7), ("c1", 550, 20, 1.7), ("c2", 650, 20, 1.6)],
    "p3_three_crossing": [("c0", 470, 30, 1.7), ("c1", 540, 30, 1.7), ("c2", 610, 30, 1.6)],
    "p4_three_noisy": [("c0", 450, 22, 1.7), ("c1", 550, 22, 1.7), ("c2", 650, 22, 1.6)],
}
NOISY = {"p4_three_noisy"}


def build():
    os.makedirs(OUT, exist_ok=True)
    truth = {"axis": {"x_range": XR, "y_range": YR, "unit_x": "nm", "frame_pt": FRAME, "dpi": DPI,
                      "x_ticks": [400, 500, 600, 700], "y_ticks": [0, 1, 2]}, "plots": {}}
    for name, curves in PLOTS.items():
        doc = fitz.open()
        pg = doc.new_page(width=420, height=300)
        # frame box + axis tick labels (so the GUI tools have clickable calibration points)
        x0, y0, x1, y1 = FRAME
        box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
        sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()
        for t in (400, 500, 600, 700):
            pg.insert_text(fitz.Point(x2px(t) - 6, y1 + 12), str(t), fontsize=8)
        for t in (0, 1, 2):
            pg.insert_text(fitz.Point(x0 - 16, v2py(t) + 3), str(t), fontsize=8)
        single = len(curves) == 1
        gt = {}
        for cid, peak, sigma, amp in curves:
            v = lobe(peak, sigma, amp)
            col = (0, 0, 0) if single else COLORS[cid]
            pts = [fitz.Point(x2px(x), v2py(val)) for x, val in zip(NM, v)]
            sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=col, width=1.6, closePath=False); sh.commit()
            gt[cid] = [[float(x), float(val)] for x, val in zip(NM, v)]
        doc.save(os.path.join(OUT, f"{name}.pdf"))
        pix = pg.get_pixmap(dpi=DPI)
        if name in NOISY:
            img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n).copy()
            rng = np.random.default_rng(3)
            img[..., :3] = np.clip(img[..., :3].astype(float) + rng.normal(0, 14, img[..., :3].shape), 0, 255).astype(np.uint8)
            from PIL import Image
            Image.fromarray(img[..., :3]).save(os.path.join(OUT, f"{name}.png"))
        else:
            pix.save(os.path.join(OUT, f"{name}.png"))
        truth["plots"][name] = {"n_curves": len(curves), "single": single, "curves": gt}
        print(f"  {name}: {len(curves)} curve(s) -> {name}.png / .pdf")
    with open(os.path.join(HERE, "ground_truth.json"), "w") as f:
        json.dump(truth, f, indent=1)
    print(f"wrote ground_truth.json + {len(PLOTS)} plots to {OUT}/")


if __name__ == "__main__":
    build()
