"""Score the manual head-to-head: unplot (vector + raster) vs whatever competitor CSVs you've dropped in.

Runs unplot on each plot automatically; loads competitor exports from compare/submissions/<tool>/ if
present. Matches each extracted curve to ground truth by peak, reports mean peak error (nm) + mean y-RMS.

    python compare/score.py        # works with zero submissions (shows the unplot baseline)
"""
from __future__ import annotations

import glob
import json
import os

import numpy as np
from PIL import Image

from unplot import Lobe, extract

HERE = os.path.dirname(__file__)
PLOTS = os.path.join(HERE, "plots")
SUB = os.path.join(HERE, "submissions")
GT = json.load(open(os.path.join(HERE, "ground_truth.json")))
AX = GT["axis"]
FRAME = tuple(AX["frame_pt"]); DPI = AX["dpi"]; S = DPI / 72.0
XR, YR = AX["x_range"], AX["y_range"]
TOOLS = ["wpd", "engauge"]


def x2px(x):
    return FRAME[0] + (x - XR[0]) / (XR[1] - XR[0]) * (FRAME[2] - FRAME[0])


def v2py(v):
    return FRAME[3] - (v - YR[0]) / (YR[1] - YR[0]) * (FRAME[3] - FRAME[1])


def peak(arr):
    a = np.asarray(arr, float)
    return float(a[np.argmax(a[:, 1]), 0])


def score(extracted, truth_curves):
    """Match each truth curve to the nearest extracted curve by peak; return {cid: (peak_err, y_rms)}."""
    ex = [np.asarray(e, float) for e in extracted if len(e) >= 2]
    res, used = {}, set()
    for cid, tv in sorted(truth_curves.items(), key=lambda kv: peak(kv[1])):
        tv = np.asarray(tv, float)
        tpk = peak(tv)
        cand = [(abs(peak(ev) - tpk), i) for i, ev in enumerate(ex) if i not in used]
        if not cand:
            res[cid] = (None, None); continue
        _, i = min(cand); used.add(i)
        ev = ex[i][np.argsort(ex[i][:, 0])]; tv = tv[np.argsort(tv[:, 0])]
        lo, hi = max(tv[:, 0].min(), ev[:, 0].min()), min(tv[:, 0].max(), ev[:, 0].max())
        g = np.linspace(lo, hi, 80)
        rms = float(np.sqrt(np.mean((np.interp(g, ev[:, 0], ev[:, 1]) - np.interp(g, tv[:, 0], tv[:, 1])) ** 2)))
        res[cid] = (abs(peak(ev) - tpk), rms)
    return res


def load_submission(tool, plot):
    curves = []
    for f in sorted(glob.glob(os.path.join(SUB, tool, f"{plot}__*.csv"))):
        rows = []
        for line in open(f):
            parts = [p for p in line.strip().replace(",", " ").split() if p]
            if len(parts) < 2:
                continue
            try:
                rows.append([float(parts[0]), float(parts[1])])
            except ValueError:
                continue                            # header line
        if len(rows) >= 2:
            curves.append(np.array(rows))
    return curves


def unplot(plot, n):
    pdf = os.path.join(PLOTS, f"{plot}.pdf")
    img = np.asarray(Image.open(os.path.join(PLOTS, f"{plot}.png")).convert("RGB"))
    cv = extract(pdf, frame=FRAME, prior=Lobe(0.08), expected_curves=n, order_by="peak-x")
    cr = extract(img, ingest="raster", frame=tuple(c * S for c in FRAME),
                 x_axis=[(x2px(XR[0]) * S, XR[0]), (x2px(XR[1]) * S, XR[1])],
                 y_axis=[(v2py(YR[0]) * S, YR[0]), (v2py(YR[1]) * S, YR[1])],
                 prior=Lobe(0.08), expected_curves=n, order_by="peak-x")
    return [c.points for c in cv.curves], [c.points for c in cr.curves]


def main():
    print("Head-to-head vs ground truth — mean peak error (nm) and mean y-RMS per curve\n")
    for plot, info in GT["plots"].items():
        n = info["n_curves"]
        gv, gr = unplot(plot, n)
        rows = {"unplot · vector": gv, "unplot · raster": gr}
        for t in TOOLS:
            sub = load_submission(t, plot)
            if sub:
                rows[t] = sub
        print(f"{plot}  ({n} curve{'s' if n > 1 else ''})")
        for tool, curves in rows.items():
            r = score(curves, info["curves"])
            pes = [v[0] for v in r.values() if v[0] is not None]
            rmss = [v[1] for v in r.values() if v[1] is not None]
            pe = f"{np.mean(pes):5.1f} nm" if pes else "    — "
            rms = f"{np.mean(rmss):.3f}" if rmss else "  —  "
            print(f"   {tool:20} curves {len(curves)}/{n}   peak {pe}   y-RMS {rms}")
        print()


if __name__ == "__main__":
    main()
