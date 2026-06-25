"""Generate the demo's sample PDF — synthetic colour-keyed lobe plots so the demo's page navigation,
'extract all pages', and region-select features have something to show. Three single-plot pages plus a
fourth page with TWO plots side by side (a mini multi-plot datasheet page) to demonstrate drag-to-select.
Synthetic only, no copyrighted content. Run with the unplot venv (PyMuPDF):
`python js/demo/make_sample.py`."""
import math

import fitz  # PyMuPDF

NM0, NM1, VMAX = 400.0, 700.0, 2.0
BLUE, GREEN, RED = (0, 0, 1), (0, 0.6, 0), (0.9, 0, 0)


def gauss(nm, centre, amp, sigma):
    return [amp * math.exp(-0.5 * ((x - centre) / sigma) ** 2) for x in nm]


def draw_plot(pg, fx0, fy0, fx1, fy1, curves):
    """One framed plot inside [fx0..fx1] x [fy0..fy1]: frame, numeric tick labels, colour polylines."""
    def x_px(nm): return fx0 + (nm - NM0) / (NM1 - NM0) * (fx1 - fx0)
    def y_px(v): return fy1 - v / VMAX * (fy1 - fy0)
    box = [fitz.Point(fx0, fy0), fitz.Point(fx1, fy0), fitz.Point(fx1, fy1), fitz.Point(fx0, fy1), fitz.Point(fx0, fy0)]
    sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0.6, 0.6, 0.6), width=1.0, closePath=False); sh.commit()
    for tick in (400, 500, 600, 700):
        pg.insert_text(fitz.Point(x_px(tick) - 7, fy1 + 13), str(tick), fontsize=8)
    for tick in (0, 1, 2):
        pg.insert_text(fitz.Point(fx0 - 16, y_px(tick) + 3), str(tick), fontsize=8)
    nm = [NM0 + i for i in range(int(NM1 - NM0) + 1)]
    for centre, amp, sigma, rgb in curves:
        pts = [fitz.Point(x_px(x), y_px(v)) for x, v in zip(nm, gauss(nm, centre, amp, sigma))]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=rgb, width=1.3, closePath=False); sh.commit()


# single-plot pages: (centre, amp, sigma, rgb) per curve
SINGLE = [
    [(450, 1.65, 26, BLUE), (550, 1.7, 26, GREEN), (650, 1.6, 26, RED)],
    [(480, 1.5, 30, BLUE), (560, 1.75, 24, GREEN), (640, 1.55, 28, RED)],
    [(500, 1.8, 34, BLUE), (620, 1.5, 30, RED)],
]


def main():
    doc = fitz.open()
    for curves in SINGLE:                       # pages 1-3: one plot each
        pg = doc.new_page(width=460, height=320)
        draw_plot(pg, 60, 30, 400, 260, curves)
    pg = doc.new_page(width=580, height=320)    # page 4: two plots side by side (drag-to-select one)
    draw_plot(pg, 60, 30, 270, 260, [(460, 1.7, 26, BLUE), (600, 1.6, 28, RED)])
    draw_plot(pg, 350, 30, 560, 260, [(480, 1.65, 24, GREEN), (560, 1.55, 26, BLUE), (650, 1.5, 24, RED)])

    out = __file__.rsplit("/", 1)[0] + "/sample.pdf"
    doc.save(out, deflate=True)
    print(f"wrote {out}  ({doc.page_count} pages)")


if __name__ == "__main__":
    main()
