"""Generate unplot's demo sample PDF — synthetic plots covering the cases the engine actually handles, so
the demo shows more than a single clean lobe:

  page 1  heavily crossing colour curves        -> separation by colour
  page 2  monotone characteristic S-curves       -> a different prior + different axes (log-E / density)
  page 3  one continuous pen-stroke, three humps  -> de-fan / "split shared-stroke lobes"
  page 4  two plots side by side                  -> drag-to-select region

Synthetic only, no copyrighted content. Run with the unplot venv (PyMuPDF): `python js/demo/make_sample.py`."""
import math

import fitz  # PyMuPDF

BLUE, GREEN, RED, INK = (0, 0, 1), (0, 0.55, 0), (0.85, 0, 0), (0.12, 0.12, 0.14)


def _lin(v, a, b, p0, p1):
    return p0 + (v - a) / (b - a) * (p1 - p0)


def draw_plot(pg, box, xr, yr, xticks, yticks, curves):
    """A framed plot in `box` (fx0,fy0,fx1,fy1) with data ranges xr/yr, tick labels, and polyline curves.
    `curves` = list of (points_in_data_xy, rgb, width)."""
    fx0, fy0, fx1, fy1 = box

    def X(x): return _lin(x, xr[0], xr[1], fx0, fx1)
    def Y(y): return _lin(y, yr[0], yr[1], fy1, fy0)   # data-y up -> page-y down

    frame = [fitz.Point(fx0, fy0), fitz.Point(fx1, fy0), fitz.Point(fx1, fy1), fitz.Point(fx0, fy1), fitz.Point(fx0, fy0)]
    sh = pg.new_shape(); sh.draw_polyline(frame); sh.finish(color=(0.6, 0.6, 0.6), width=1.0, closePath=False); sh.commit()
    for t in xticks:
        pg.insert_text(fitz.Point(X(t) - (6 if t >= 0 else 9), fy1 + 13), str(t), fontsize=8)
    for t in yticks:
        pg.insert_text(fitz.Point(fx0 - 18, Y(t) + 3), str(t), fontsize=8)
    for pts_xy, rgb, width in curves:
        pts = [fitz.Point(X(x), Y(y)) for x, y in pts_xy]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=rgb, width=width, closePath=False); sh.commit()


def _xs(a, b, step=0.5):
    n = int(round((b - a) / step))
    return [a + i * step for i in range(n + 1)]


def gauss(centre, amp, sigma, xs):
    return [(x, amp * math.exp(-0.5 * ((x - centre) / sigma) ** 2)) for x in xs]


def sigmoid(x0, lo, hi, k, xs):
    return [(x, lo + (hi - lo) / (1 + math.exp(-k * (x - x0)))) for x in xs]


def multilobe(centres, xs):
    return [(x, max(a * math.exp(-0.5 * ((x - c) / s) ** 2) for c, a, s in centres)) for x in xs]


def main():
    doc = fitz.open()

    # page 1 — heavily crossing colour curves (separation by colour)
    pg = doc.new_page(width=480, height=320)
    xs = _xs(400, 700)
    draw_plot(pg, (62, 30, 420, 262), (400, 700), (0, 2), [400, 500, 600, 700], [0, 1, 2], [
        (gauss(478, 1.75, 42, xs), BLUE, 1.3),
        (gauss(536, 1.85, 44, xs), GREEN, 1.3),
        (gauss(596, 1.65, 42, xs), RED, 1.3),
    ])

    # page 2 — monotone characteristic S-curves (log exposure -> density)
    pg = doc.new_page(width=480, height=320)
    xs = _xs(0, 4, 0.02)
    draw_plot(pg, (62, 30, 420, 262), (0, 4), (0, 3), [0, 1, 2, 3, 4], [0, 1, 2, 3], [
        (sigmoid(1.7, 0.12, 2.85, 2.4, xs), BLUE, 1.3),
        (sigmoid(2.0, 0.12, 2.65, 2.2, xs), GREEN, 1.3),
        (sigmoid(2.3, 0.12, 2.45, 2.0, xs), RED, 1.3),
    ])

    # page 3 — one continuous pen-stroke tracing three humps (de-fan / split-lobes)
    pg = doc.new_page(width=480, height=320)
    xs = _xs(400, 700, 0.4)
    draw_plot(pg, (62, 30, 420, 262), (400, 700), (0, 2), [400, 500, 600, 700], [0, 1, 2], [
        (multilobe([(460, 1.7, 17), (545, 1.85, 17), (630, 1.6, 17)], xs), INK, 1.5),
    ])

    # page 4 — two plots side by side (region select)
    pg = doc.new_page(width=600, height=320)
    xs = _xs(400, 700)
    draw_plot(pg, (62, 30, 280, 262), (400, 700), (0, 2), [400, 500, 600, 700], [0, 1, 2], [
        (gauss(470, 1.7, 24, xs), BLUE, 1.3), (gauss(600, 1.6, 26, xs), RED, 1.3),
    ])
    draw_plot(pg, (350, 30, 568, 262), (400, 700), (0, 2), [400, 500, 600, 700], [0, 1, 2], [
        (gauss(480, 1.7, 22, xs), GREEN, 1.3), (gauss(560, 1.6, 24, xs), BLUE, 1.3), (gauss(650, 1.5, 22, xs), RED, 1.3),
    ])

    out = __file__.rsplit("/", 1)[0] + "/sample.pdf"
    doc.save(out, deflate=True)
    print(f"wrote {out}  ({doc.page_count} pages)")


if __name__ == "__main__":
    main()
