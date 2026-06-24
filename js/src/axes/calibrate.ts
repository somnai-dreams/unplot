/**
 * Axis calibration — TS port of the Python `axes/calibrate.py`. Detect numeric tick labels, fit a robust
 * LINEAR pt->value map.
 *
 * LINEAR ONLY. Datasheet 'log' axes (log exposure, log sensitivity) are drawn linearly — the pixel->value
 * map is linear even though the value is a log quantity, so a linear fit is correct. Genuinely log-*spaced*
 * axes are out of scope.
 *
 * robustFit uses a median-consecutive-slope estimate, so it is immune to high-leverage stray labels (e.g. a
 * number that leaked in from a neighbouring plot) that an OLS or greedy-drop fit would chase.
 */
import type { AxisCalibration } from "../curveset.ts";
import type { Word } from "../io/vector.ts";
import { diff, linfit, maxOf, median, minOf, pearson } from "../num.ts";

export type Anchors = [number, number][]; // (source_pos, data_value)

/** Thrown when an axis cannot be calibrated (too few anchors, or a degenerate near-constant fit). The
 *  Python lib raises CalibrationError here; extract() lets it propagate as a hard stop. */
export class CalibrationError extends Error {}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Map typographic minus/dashes to ASCII '-' so a label like '−2' (U+2212) parses as a negative. */
const normalizeMinus = (s: string): string => s.replace(/−/g, "-").replace(/–/g, "-").replace(/—/g, "-");

/** Numeric tick labels just outside the frame -> [(pt_pos, value)]. Allows negatives (logH axes).
 *  axis='x': numbers in a band just below the frame, within its x-span.
 *  axis='y': numbers just left of the frame, within its y-span. */
export function axisLabelAnchors(words: Word[], frame: [number, number, number, number], axis: "x" | "y"): Anchors {
  const [x0, y0, x1, y1] = frame;
  const anchors: Anchors = [];
  for (const w of words) {
    const txt = normalizeMinus(String(w.text).trim());
    if (!NUMERIC.test(txt)) continue;
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
    if (axis === "x" && y1 < cy && cy < y1 + 30 && x0 - 10 <= cx && cx <= x1 + 10) anchors.push([cx, parseFloat(txt)]);
    else if (axis === "y" && x0 - 40 < cx && cx < x0 && y0 - 10 <= cy && cy <= y1 + 10) anchors.push([cy, parseFloat(txt)]);
  }
  return anchors.sort((a, b) => a[0] - b[0]);
}

/** Recover lost signs on a ±-symmetric (folded) axis.
 *
 * A film log-sensitivity / log-H axis labelled e.g. `2 1 0 1 2` top->bottom has true values `+2 +1 0 −1 −2`;
 * if the minus signs were stripped the labels read as a V in |value| and the axis silently collapses. Detect
 * that V and restore alternating signs about the near-zero turning point. Which arm is negative is chosen
 * from GEOMETRY: for a y-axis the arm lower on the plot (larger source-y) is negative; for an x-axis the arm
 * to the left (smaller source-x). No-op on a normal monotone axis, or one that already carries signs.
 */
export function unfoldSymmetric(anchors: Anchors, axis: "x" | "y"): Anchors {
  const a = [...anchors].sort((p, q) => p[0] - q[0]);
  const vals = a.map((p) => p[1]);
  const n = vals.length;
  if (n < 5 || vals.some((v) => v < 0)) return anchors;
  let ti = 0;
  for (let i = 1; i < n; i++) if (vals[i] < vals[ti]) ti = i; // turning point = smallest |value|
  if (ti === 0 || ti === n - 1 || vals[ti] > 0.25 * maxOf(vals)) return anchors; // not interior / not ~0
  const left = vals.slice(0, ti + 1), right = vals.slice(ti);
  const nonInc = (arr: number[]): boolean => arr.every((v, i) => i === 0 || arr[i - 1] >= v);
  const nonDec = (arr: number[]): boolean => arr.every((v, i) => i === 0 || arr[i - 1] <= v);
  if (!(nonInc(left) && nonDec(right))) return anchors;
  // a genuine ±-fold has MIRROR arms (comparable magnitudes + lengths). If the arms are wildly different it's
  // a stray outlier label faking a V (e.g. an x-axis number bleeding into the y-band), not a fold.
  const lmax = maxOf(left), rmax = maxOf(right);
  if (Math.min(lmax, rmax) < 0.5 * Math.max(lmax, rmax) || Math.abs(left.length - right.length) > 2) return anchors;
  return a.map(([pos, v], i) => {
    const neg = (axis === "y" && i > ti) || (axis === "x" && i < ti);
    return [pos, neg ? -v : v] as [number, number];
  });
}

/** Median-consecutive-slope linear fit, dropping labels that leaked from a neighbouring plot. Returns
 *  [scale, offset, |r|, nDropped]. The median slope + median intercept are immune to a stray high-leverage
 *  label; we then OLS-refit on the inliers for a tight map. */
export function robustFit(anchors: Anchors): [number, number, number, number] {
  const a = [...anchors].sort((p, q) => p[0] - q[0]);
  if (a.length < 2) throw new CalibrationError(`need >=2 numeric anchors to calibrate an axis, got ${a.length}`);
  const pos = a.map((p) => p[0]), val = a.map((p) => p[1]);
  if (a.length === 2) {
    const m = (val[1] - val[0]) / (pos[1] - pos[0]);
    return [m, val[0] - m * pos[0], 1.0, 0];
  }
  const slopes = diff(val).map((dv, i) => dv / diff(pos)[i]);
  const m = median(slopes);
  const b = median(val.map((v, i) => v - m * pos[i]));
  const span = Math.max(maxOf(val) - minOf(val), 1e-9);
  const keep = val.map((v, i) => Math.abs(v - (m * pos[i] + b)) < 0.1 * span + 1e-6);
  const nKeep = keep.filter(Boolean).length;
  let scale: number, offset: number, rOut: number, nDropped: number, gpos: number[], gval: number[];
  if (nKeep >= 2) {
    const pk = pos.filter((_, i) => keep[i]), vk = val.filter((_, i) => keep[i]);
    const [mm, bb] = linfit(pk, vk);
    scale = mm; offset = bb;
    rOut = nKeep > 2 ? Math.abs(pearson(pk, vk)) : 1.0;
    nDropped = keep.filter((k) => !k).length;
    gpos = pk; gval = vk;
  } else {
    scale = m; offset = b; rOut = Math.abs(pearson(pos, val)); nDropped = 0;
    gpos = pos; gval = val;
  }
  // Degenerate-fit guard: labels vary but the map is near-constant (scale~0) — the folded-axis signature
  // (median of mixed-sign slopes ~ 0). Measured over the INLIERS, so a single dropped outlier label doesn't
  // inflate the range and false-trip the guard.
  const valRange = maxOf(gval) - minOf(gval);
  const posSpan = maxOf(gpos) - minOf(gpos);
  if (valRange > 1e-9 && Math.abs(scale) * posSpan < 0.05 * valRange) {
    throw new CalibrationError(
      "axis labels vary but the fit is near-constant (scale~0) — likely a folded ±-symmetric axis whose " +
      "minus signs were lost; sign recovery did not apply. Refusing to return a flat axis.");
  }
  return [scale, offset, rOut, nDropped];
}

/** Build an AxisCalibration from auto-detected labels, or from explicit (pt,value) anchors. */
export function calibrateAxis(
  words: Word[], frame: [number, number, number, number], axis: "x" | "y", explicit?: Anchors,
): AxisCalibration {
  let anchors = explicit !== undefined ? explicit : axisLabelAnchors(words, frame, axis);
  anchors = unfoldSymmetric(anchors, axis);
  const [scale, offset, r, nDropped] = robustFit(anchors);
  return {
    scale, offset, r, nDropped,
    anchors: [...anchors].sort((p, q) => p[0] - q[0]).map(([p, v]) => [p, v] as [number, number]),
  };
}
