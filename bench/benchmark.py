"""Accuracy benchmark: GetMapped extraction error across difficulty tiers on synthetic ground truth.

No competitor here — these are absolute numbers. Each tier generates K randomized plots with known peaks
(via PyMuPDF), extracts them, and reports the recovery rate (got the expected curve count) and the median
peak error over recovered cases. Deterministic (fixed seed). Run: python bench/benchmark.py
"""
from __future__ import annotations

import os
import tempfile

import fitz
import numpy as np

from getmapped import Lobe, extract

FRAME = (60.0, 40.0, 360.0, 240.0)
XR, YR = (400.0, 700.0), (0.0, 2.0)
COLORS = [(0, 0, 1), (0, 0.6, 0), (0.9, 0, 0), (0.6, 0, 0.6)]


def x2px(x: float) -> float:
    return FRAME[0] + (x - XR[0]) / (XR[1] - XR[0]) * (FRAME[2] - FRAME[0])


def v2py(v: float) -> float:
    return FRAME[3] - (v - YR[0]) / (YR[1] - YR[0]) * (FRAME[3] - FRAME[1])


def make_pdf(peaks, sigma, amp, path, mono=False):
    doc = fitz.open()
    pg = doc.new_page(width=420, height=300)
    nm = np.arange(400.0, 700.01, 2.0)
    for k, (pk, a, s) in enumerate(zip(peaks, amp, sigma)):
        v = a * np.exp(-0.5 * ((nm - pk) / s) ** 2)
        pts = [fitz.Point(x2px(x), v2py(val)) for x, val in zip(nm, v)]
        col = (0, 0, 0) if mono else COLORS[k % 4]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=col, width=1.4, closePath=False); sh.commit()
    for lbl in (400, 500, 600, 700):
        pg.insert_text(fitz.Point(x2px(lbl) - 6, FRAME[3] + 12), str(lbl), fontsize=8)
    for lbl in (0, 1, 2):
        pg.insert_text(fitz.Point(FRAME[0] - 16, v2py(lbl) + 3), str(lbl), fontsize=8)
    doc.save(path); doc.close()


def render(path, dpi, noise, rng):
    pix = fitz.open(path)[0].get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3].copy()
    if noise > 0:
        img = np.clip(img.astype(float) + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    return img


def gen_peaks(n, mode, rng):
    # fixed lobe width across tiers (so only spacing/amplitude vary, not the argmax-jitter from width)
    sigma = [26.0] * n
    spacing = 95.0 if mode == "separated" else 68.0      # crossing/occluded pack the lobes closer
    start = rng.uniform(440, 460)
    peaks = sorted(min(start + i * rng.uniform(spacing - 8, spacing + 8), 686.0) for i in range(n))
    amp = [rng.uniform(1.5, 1.9) for _ in range(n)]
    if mode == "occluded":                               # one weak lobe buried under its taller neighbours
        amp[int(rng.integers(0, n))] *= 0.4
    return peaks, sigma, amp


def peak_errors(cs, truth):
    """Per-curve |recovered peak - true peak| (nm), pairing both sorted by peak. expected_curves is set so
    the count always matches; the error distribution is the real quality signal."""
    rec = sorted(float(c.points[np.argmax(c.points[:, 1]), 0]) for c in cs.curves)
    return [abs(a - b) for a, b in zip(rec, sorted(truth))]


TIERS = [
    ("vector · 3 separated", dict(ingest="vector", n=3, mode="separated")),
    ("vector · 3 crossing", dict(ingest="vector", n=3, mode="crossing")),
    ("vector · 4 crossing", dict(ingest="vector", n=4, mode="crossing")),
    ("raster colour · 3 crossing", dict(ingest="raster", n=3, mode="crossing", dpi=200, noise=0, mono=False)),
    ("raster colour · 3 crossing · noisy", dict(ingest="raster", n=3, mode="crossing", dpi=200, noise=18, mono=False)),
    ("raster mono · 3 crossing", dict(ingest="raster", n=3, mode="crossing", dpi=200, noise=0, mono=True)),
    ("raster mono · 3 occluded", dict(ingest="raster", n=3, mode="occluded", dpi=200, noise=0, mono=True)),
]
K = 20


def run_tier(cfg, rng, tmp):
    errs = []
    for t in range(K):
        peaks, sigma, amp = gen_peaks(cfg["n"], cfg["mode"], rng)
        p = os.path.join(tmp, f"p{t}.pdf"); make_pdf(peaks, sigma, amp, p, cfg.get("mono", False))
        if cfg["ingest"] == "vector":
            cs = extract(p, frame=FRAME, prior=Lobe(0.08), expected_curves=cfg["n"], order_by="peak-x")
        else:
            s = cfg["dpi"] / 72.0
            img = render(p, cfg["dpi"], cfg["noise"], rng)
            cs = extract(img, ingest="raster", frame=tuple(v * s for v in FRAME),
                         x_axis=[(x2px(400) * s, 400.0), (x2px(700) * s, 700.0)],
                         y_axis=[(v2py(0) * s, 0.0), (v2py(2) * s, 2.0)],
                         prior=Lobe(0.08), expected_curves=cfg["n"], order_by="peak-x")
        errs += peak_errors(cs, peaks)
    return errs


def main():
    rng = np.random.default_rng(7)
    tmp = tempfile.mkdtemp()
    print(f"GetMapped accuracy benchmark (K={K} plots/tier, synthetic ground truth, seed 7)")
    print("peak error per curve, nm  (vector = exact geometry; raster = pixel floor)\n")
    print(f"{'tier':32}{'median':>10}{'p90':>10}")
    print("-" * 52)
    for name, cfg in TIERS:
        errs = np.array(run_tier(cfg, rng, tmp))
        print(f"{name:32}{np.median(errs):>8.1f}  {np.percentile(errs, 90):>8.1f}")


if __name__ == "__main__":
    main()
