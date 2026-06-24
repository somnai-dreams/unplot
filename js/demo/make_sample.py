"""Generate the demo's multi-page sample PDF — three pages of synthetic colour-keyed lobe plots so the
demo's page navigation and 'extract all pages' features have something to show. Synthetic only, no
copyrighted content. Run with the GetMapped venv (PyMuPDF): `python js/demo/make_sample.py`."""
import math

import fitz  # PyMuPDF

W, H = 460, 320
X0, Y0, X1, Y1 = 60, 30, 400, 260          # plot frame in page points
NM0, NM1, VMAX = 400.0, 700.0, 2.0


def x_px(nm: float) -> float:
    return X0 + (nm - NM0) / (NM1 - NM0) * (X1 - X0)


def y_px(v: float) -> float:
    return Y1 - v / VMAX * (Y1 - Y0)        # value 0..2, y increases downward


def gauss(nm, centre, amp, sigma):
    return [amp * math.exp(-0.5 * ((x - centre) / sigma) ** 2) for x in nm]


# (centre, amp, sigma, rgb) per curve — one tuple-list per page
BLUE, GREEN, RED = (0, 0, 1), (0, 0.6, 0), (0.9, 0, 0)
PAGES = [
    [(450, 1.65, 26, BLUE), (550, 1.7, 26, GREEN), (650, 1.6, 26, RED)],
    [(480, 1.5, 30, BLUE), (560, 1.75, 24, GREEN), (640, 1.55, 28, RED)],
    [(500, 1.8, 34, BLUE), (620, 1.5, 30, RED)],
]


def draw_page(doc, curves):
    pg = doc.new_page(width=W, height=H)
    box = [fitz.Point(X0, Y0), fitz.Point(X1, Y0), fitz.Point(X1, Y1), fitz.Point(X0, Y1), fitz.Point(X0, Y0)]
    sh = pg.new_shape(); sh.draw_polyline(box); sh.finish(color=(0.6, 0.6, 0.6), width=1.0, closePath=False); sh.commit()
    for tick in (400, 500, 600, 700):       # x tick labels just below the frame
        pg.insert_text(fitz.Point(x_px(tick) - 7, Y1 + 13), str(tick), fontsize=8)
    for tick in (0, 1, 2):                   # y tick labels just left of the frame
        pg.insert_text(fitz.Point(X0 - 16, y_px(tick) + 3), str(tick), fontsize=8)
    nm = [NM0 + i for i in range(int(NM1 - NM0) + 1)]
    for centre, amp, sigma, rgb in curves:
        pts = [fitz.Point(x_px(x), y_px(v)) for x, v in zip(nm, gauss(nm, centre, amp, sigma))]
        sh = pg.new_shape(); sh.draw_polyline(pts); sh.finish(color=rgb, width=1.3, closePath=False); sh.commit()


def main():
    doc = fitz.open()
    for curves in PAGES:
        draw_page(doc, curves)
    out = __file__.rsplit("/", 1)[0] + "/sample.pdf"
    doc.save(out, deflate=True)
    print(f"wrote {out}  ({doc.page_count} pages)")


if __name__ == "__main__":
    main()
