"""Generate a synthetic vector 'datasheet' plot with known ground truth — no copyrighted source PDFs.

Draws a plot box, three colour-keyed gaussian lobes (crossing each other), and numeric axis labels, with a
known data<->page mapping. The test extracts it back and asserts the recovered peaks + calibration match.
"""
from __future__ import annotations

import fitz
import numpy as np

FRAME = (60.0, 40.0, 360.0, 240.0)   # x0, y0, x1, y1 (pt)
X_RANGE = (400.0, 700.0)             # data x at frame x0..x1 (e.g. nm)
Y_RANGE = (0.0, 2.0)                 # data y at frame bottom(y1)..top(y0)

LOBES = [   # (name, rgb, peak, amplitude, sigma) — peaks chosen so the lobes cross
    ("blue", (0.0, 0.0, 1.0), 450.0, 1.8, 28.0),
    ("green", (0.0, 0.6, 0.0), 550.0, 1.7, 30.0),
    ("red", (0.9, 0.0, 0.0), 650.0, 1.6, 32.0),
]


def _x_to_px(x: float) -> float:
    x0, _, x1, _ = FRAME
    a, b = X_RANGE
    return x0 + (x - a) / (b - a) * (x1 - x0)


def _v_to_py(v: float) -> float:
    _, y0, _, y1 = FRAME
    a, b = Y_RANGE
    return y1 - (v - a) / (b - a) * (y1 - y0)


def build(path: str) -> dict:
    doc = fitz.open()
    page = doc.new_page(width=420, height=300)
    x0, y0, x1, y1 = FRAME

    box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
    sh = page.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()

    truth: dict[str, float] = {}
    nm = np.arange(400.0, 700.001, 2.0)
    for name, color, peak, amp, sigma in LOBES:
        v = amp * np.exp(-0.5 * ((nm - peak) / sigma) ** 2)
        pts = [fitz.Point(_x_to_px(x), _v_to_py(val)) for x, val in zip(nm, v)]
        sh = page.new_shape(); sh.draw_polyline(pts); sh.finish(color=color, width=1.2, closePath=False); sh.commit()
        truth[name] = peak

    for lbl in (400, 500, 600, 700):
        page.insert_text(fitz.Point(_x_to_px(lbl) - 6, y1 + 12), str(lbl), fontsize=8)
    for lbl in (0, 1, 2):
        page.insert_text(fitz.Point(x0 - 16, _v_to_py(lbl) + 3), str(lbl), fontsize=8)

    doc.save(path)
    doc.close()
    return {"frame": FRAME, "x_range": X_RANGE, "y_range": Y_RANGE, "peaks": truth}


def build_gridded(path: str) -> dict:
    """The same 3-lobe plot, but with a GRID drawn as a single stroke (every segment axis-aligned). The grid's
    bbox spans the whole frame, so the thin-bbox check misses it; only the ruled-path filter drops it. Tests
    that the grid is removed without touching the curves."""
    doc = fitz.open()
    page = doc.new_page(width=420, height=300)
    x0, y0, x1, y1 = FRAME

    box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
    sh = page.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()

    grid = page.new_shape()                       # one shape, many axis-aligned segments = one ruled path
    for gx in range(400, 701, 50):
        grid.draw_line(fitz.Point(_x_to_px(gx), y0), fitz.Point(_x_to_px(gx), y1))
    for gv in (0.0, 0.5, 1.0, 1.5, 2.0):
        grid.draw_line(fitz.Point(x0, _v_to_py(gv)), fitz.Point(x1, _v_to_py(gv)))
    grid.finish(color=(0.7, 0.7, 0.7), width=0.5, closePath=False); grid.commit()

    truth: dict[str, float] = {}
    nm = np.arange(400.0, 700.001, 0.5)   # finely sampled: per-segment dx is sub-pixel (guards the ruled
    for name, color, peak, amp, sigma in LOBES:  # angle test against an absolute-tolerance regression)
        v = amp * np.exp(-0.5 * ((nm - peak) / sigma) ** 2)
        pts = [fitz.Point(_x_to_px(x), _v_to_py(val)) for x, val in zip(nm, v)]
        sh = page.new_shape(); sh.draw_polyline(pts); sh.finish(color=color, width=1.2, closePath=False); sh.commit()
        truth[name] = peak

    for lbl in (400, 500, 600, 700):
        page.insert_text(fitz.Point(_x_to_px(lbl) - 6, y1 + 12), str(lbl), fontsize=8)
    for lbl in (0, 1, 2):
        page.insert_text(fitz.Point(x0 - 16, _v_to_py(lbl) + 3), str(lbl), fontsize=8)

    doc.save(path)
    doc.close()
    return {"frame": FRAME, "x_range": X_RANGE, "y_range": Y_RANGE, "peaks": truth}


def build_raster_monotone(dpi: int = 200):
    """Render 3 non-crossing monotone (rising) curves to a raster image, with the known px frame + axis
    anchors + per-curve end values. Exercises the raster continuity-march on a clean, separable case
    (raster crossing separation is a known gap, so the curves are kept apart)."""
    doc = fitz.open()
    page = doc.new_page(width=420, height=300)
    x0, y0, x1, y1 = FRAME
    levels = {"red": 0.0, "green": 0.25, "blue": 0.5}      # vertical offsets -> parallel, never cross
    colors = {"red": (0.85, 0, 0), "green": (0, 0.55, 0), "blue": (0, 0, 0.85)}
    nm = np.arange(400.0, 700.001, 2.0)
    truth_end = {}
    for name, b in levels.items():
        v = b + 1.0 * (nm - 400.0) / 300.0                 # rises b -> b+1 across the axis
        pts = [fitz.Point(_x_to_px(x), _v_to_py(val)) for x, val in zip(nm, v)]
        sh = page.new_shape(); sh.draw_polyline(pts); sh.finish(color=colors[name], width=1.6, closePath=False); sh.commit()
        truth_end[name] = float(b + 1.0)
    pix = page.get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3].copy()
    s = dpi / 72.0
    frame_px = (x0 * s, y0 * s, x1 * s, y1 * s)
    x_anchors = [(_x_to_px(400.0) * s, 400.0), (_x_to_px(700.0) * s, 700.0)]
    y_anchors = [(_v_to_py(0.0) * s, 0.0), (_v_to_py(2.0) * s, 2.0)]
    return {"img": img, "frame_px": frame_px, "x_anchors": x_anchors, "y_anchors": y_anchors,
            "truth_end": truth_end}


def build_raster_crossing(dpi: int = 200):
    """Render two lines forming an X (one rising, one falling, crossing mid-axis) to a raster image.
    The canonical clean crossing: a neutral marcher swaps the curves at the crossing; a direction-aware
    prior keeps them apart. Returns img + px frame + axis anchors."""
    doc = fitz.open()
    page = doc.new_page(width=420, height=300)
    x0, y0, x1, y1 = FRAME
    nm = np.arange(400.0, 700.001, 2.0)
    for a, b in ((0.2, 1.8), (1.8, 0.2)):                 # rising, falling
        v = a + (b - a) * (nm - 400.0) / 300.0
        pts = [fitz.Point(_x_to_px(x), _v_to_py(val)) for x, val in zip(nm, v)]
        sh = page.new_shape(); sh.draw_polyline(pts); sh.finish(color=(0, 0, 0), width=1.6, closePath=False); sh.commit()
    pix = page.get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3].copy()
    s = dpi / 72.0
    return {"img": img, "frame_px": (x0 * s, y0 * s, x1 * s, y1 * s),
            "x_anchors": [(_x_to_px(400.0) * s, 400.0), (_x_to_px(700.0) * s, 700.0)],
            "y_anchors": [(_v_to_py(0.0) * s, 0.0), (_v_to_py(2.0) * s, 2.0)]}


def build_folded_axis(path: str, minus_style: str = "stripped") -> dict:
    """Plot with a ±-symmetric y-axis (+2…−2, labelled 2 1 0 … top→bottom) and one diagonal curve from
    y=+1.5 (left) to y=−1.5 (right). `minus_style`: 'stripped' (bare digits → a folded V, exercises the
    unfold) or 'unicode' (U+2212 minus, exercises minus normalization)."""
    fr = (60.0, 40.0, 360.0, 240.0)
    x0, y0, x1, y1 = fr

    def x2px(x):
        return x0 + (x - 400.0) / 300.0 * (x1 - x0)

    def y2py(v):
        return y0 + (2.0 - v) / 4.0 * (y1 - y0)        # +2 at top, −2 at bottom

    doc = fitz.open()
    pg = doc.new_page(width=420, height=300)
    box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
    sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()
    for t in (400, 500, 600, 700):
        pg.insert_text(fitz.Point(x2px(t) - 6, y1 + 12), str(t), fontsize=8)
    for k in (2, 1, 0, -1, -2):
        if k >= 0:
            lbl = str(k)
        elif minus_style == "unicode":
            lbl = "−" + str(abs(k))
        else:
            lbl = str(abs(k))                          # stripped: minus lost -> folded
        pg.insert_text(fitz.Point(x0 - 18, y2py(k) + 3), lbl, fontsize=8)
    nm = np.arange(400.0, 700.001, 4.0)
    yv = 1.5 - 3.0 * (nm - 400.0) / 300.0              # +1.5 -> -1.5, monotone
    pts = [fitz.Point(x2px(x), y2py(v)) for x, v in zip(nm, yv)]
    sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=(0, 0, 0), width=1.4, closePath=False); sh.commit()
    doc.save(path); doc.close()
    return {"frame": fr, "y_left": 1.5, "y_right": -1.5}


def build_skirted_crossing(path: str) -> dict:
    """Three MONO (single-colour) asymmetric lobes — sharp rise, long descending skirt — that overlap heavily
    and cross. This is the real datasheet shape (spectral-sensitivity / dye-density) and the one that trips
    amplitude-based curve selection: de-fan/chain leaves a tall peak-to-skirt fragment that out-ranks a real
    lobe. Single colour forces the de-fan path (no colour separation). Peaks ~440/550/640."""
    fr = (60.0, 40.0, 360.0, 240.0)
    x0, y0, x1, y1 = fr

    def x2px(x):
        return x0 + (x - 400.0) / 300.0 * (x1 - x0)

    def v2py(v):
        return y1 - v / 2.0 * (y1 - y0)

    doc = fitz.open()
    pg = doc.new_page(width=420, height=300)
    box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
    sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()
    for t in (400, 500, 600, 700):
        pg.insert_text(fitz.Point(x2px(t) - 6, y1 + 12), str(t), fontsize=8)
    for t in (0, 1, 2):
        pg.insert_text(fitz.Point(x0 - 16, v2py(t) + 3), str(t), fontsize=8)
    nm = np.arange(400.0, 700.001, 2.0)
    peaks = [440.0, 550.0, 640.0]
    amps = [1.7, 1.7, 1.6]
    for peak, amp in zip(peaks, amps):
        rise = np.exp(-0.5 * ((nm - peak) / 18.0) ** 2)        # sharp rise
        fall = np.exp(-0.5 * ((nm - peak) / 70.0) ** 2)        # long, heavily-overlapping skirt
        v = amp * np.where(nm < peak, rise, fall)
        pts = [fitz.Point(x2px(x), v2py(val)) for x, val in zip(nm, v)]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=(0, 0, 0), width=1.4, closePath=False); sh.commit()
    doc.save(path); doc.close()
    return {"frame": fr, "peaks": peaks}


def build_lobes_with_decoy(path: str) -> dict:
    """Three real mono lobes (440/550/640, well-formed -> high confidence) plus a TALL malformed 'W' decoy near
    the left edge (two peaks + a deep valley -> flank violation -> confidence ~0), drawn TALLER than the lobes.
    Amplitude-only selection ranks the decoy first and drops a real lobe; confidence-aware selection must keep
    the three lobes and reject the decoy."""
    fr = (60.0, 40.0, 360.0, 240.0)
    x0, y0, x1, y1 = fr

    def x2px(x):
        return x0 + (x - 400.0) / 300.0 * (x1 - x0)

    def v2py(v):
        return y1 - v / 2.0 * (y1 - y0)

    doc = fitz.open()
    pg = doc.new_page(width=420, height=300)
    box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
    sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()
    for t in (400, 500, 600, 700):
        pg.insert_text(fitz.Point(x2px(t) - 6, y1 + 12), str(t), fontsize=8)
    for t in (0, 1, 2):
        pg.insert_text(fitz.Point(x0 - 16, v2py(t) + 3), str(t), fontsize=8)
    nm = np.arange(400.0, 700.001, 2.0)
    for peak in (440.0, 550.0, 640.0):
        v = 1.6 * np.exp(-0.5 * ((nm - peak) / 22.0) ** 2)
        pts = [fitz.Point(x2px(x), v2py(val)) for x, val in zip(nm, v)]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=(0, 0, 0), width=1.4, closePath=False); sh.commit()
    # tall malformed decoy: a densely-sampled zigzag (multiple peaks/valleys -> flank violation -> conf ~0),
    # amplitude 1.8 > the lobes' 1.6, monotone in x so it survives de-fan as one candidate.
    wnm = np.arange(405.0, 444.0, 1.5)
    wv = 1.0 + 0.9 * np.sin((wnm - 405.0) * np.pi / 10.0)
    pts = [fitz.Point(x2px(x), v2py(val)) for x, val in zip(wnm, wv)]
    sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=(0, 0, 0), width=1.4, closePath=False); sh.commit()
    doc.save(path); doc.close()
    return {"frame": fr, "peaks": [440.0, 550.0, 640.0]}


def build_adjacent_band_lobes(path: str) -> dict:
    """Three MONO lobes, each drawn over its OWN adjacent x-band so their tails meet at the baseline (400-500,
    500-600, 600-700; peaks 450/550/650). Endpoint-continuity chaining merges all three into one full-width
    curve unless the valley-join is refused — the real datasheet shape behind the 'two lobes merged' tangle."""
    fr = (60.0, 40.0, 360.0, 240.0)
    x0, y0, x1, y1 = fr

    def x2px(x):
        return x0 + (x - 400.0) / 300.0 * (x1 - x0)

    def v2py(v):
        return y1 - v / 2.0 * (y1 - y0)

    doc = fitz.open()
    pg = doc.new_page(width=420, height=300)
    box = [fitz.Point(x0, y0), fitz.Point(x1, y0), fitz.Point(x1, y1), fitz.Point(x0, y1), fitz.Point(x0, y0)]
    sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0, 0, 0), width=0.8); sh.commit()
    for t in (400, 500, 600, 700):
        pg.insert_text(fitz.Point(x2px(t) - 6, y1 + 12), str(t), fontsize=8)
    for t in (0, 1, 2):
        pg.insert_text(fitz.Point(x0 - 16, v2py(t) + 3), str(t), fontsize=8)
    for lo, hi, peak in [(400, 500, 450), (500, 600, 550), (600, 700, 650)]:
        nm = np.arange(float(lo), hi + 0.01, 2.0)
        v = 1.6 * np.exp(-0.5 * ((nm - peak) / 22.0) ** 2)
        pts = [fitz.Point(x2px(x), v2py(val)) for x, val in zip(nm, v)]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=(0, 0, 0), width=1.4, closePath=False); sh.commit()
    doc.save(path); doc.close()
    return {"frame": fr, "peaks": [450.0, 550.0, 650.0]}


if __name__ == "__main__":
    import sys
    meta = build(sys.argv[1] if len(sys.argv) > 1 else "/tmp/unplot_synth.pdf")
    print(meta)
