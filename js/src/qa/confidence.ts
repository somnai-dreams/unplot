/** Fold shape-prior violations + calibration + coverage into per-curve and set-level confidence.
 *  TS port of the Python `qa/confidence.py`. */
import type { AxisCalibration, Curve, CurveQA, CurveSetQA } from "../curveset.ts";
import type { Pt } from "../curves/vectorpaths.ts";
import type { ShapePrior } from "../priors.ts";
import { interp, linspace, maxOf, mean, minOf, round } from "../num.ts";
import * as shape from "./shape.ts";

function confidence(violation: number, tolerance: number, xMonotonic: boolean): number {
  let c: number;
  if (!Number.isFinite(tolerance)) c = 1.0;
  else if (tolerance > 0) c = Math.max(0, 1 - violation / tolerance); // 1 at clean, 0 once violation hits tolerance
  else c = violation <= 0 ? 1.0 : 0.0;
  if (!xMonotonic) c *= 0.5; // a folded curve is suspect even if it "passes"
  return round(c, 3);
}

export function curveQA(pointsData: Pt[], prior: ShapePrior, notes: string[] = []): CurveQA {
  const v = prior.qaViolation(pointsData);
  const xmono = shape.isXMonotonic(pointsData);
  return {
    prior: prior.name,
    violation: round(v.magnitude, 4),
    violationKind: v.kind,
    violationAt: v.at,
    passed: v.magnitude < prior.tolerance,
    nPoints: pointsData.length,
    xMonotonic: xmono,
    roughness: round(shape.roughness(pointsData), 2),
    maxGapX: round(shape.maxGapX(pointsData), 4),
    confidence: confidence(v.magnitude, prior.tolerance, xmono),
    notes,
  };
}

function crosses(A: Pt[], B: Pt[]): boolean {
  const ax = A.map((p) => p[0]), bx = B.map((p) => p[0]);
  const lo = Math.max(minOf(ax), minOf(bx));
  const hi = Math.min(maxOf(ax), maxOf(bx));
  if (hi <= lo) return false;
  const xs = linspace(lo, hi, 32);
  const ya = interp(xs, ax, A.map((p) => p[1]));
  const yb = interp(xs, bx, B.map((p) => p[1]));
  const s = xs.map((_, i) => Math.sign(ya[i]! - yb[i]!)).filter((v) => v !== 0);
  if (s.length <= 1) return false;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) return true;
  return false;
}

export function countCrossings(curves: Curve[]): number {
  let n = 0;
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++)
      if (crosses(curves[i]!.points, curves[j]!.points)) n++;
  return n;
}

export function setQA(
  curves: Curve[], xAxis: AxisCalibration, yAxis: AxisCalibration,
  roundtripRms: number | null, warnings: string[],
): CurveSetQA {
  const base = curves.length ? mean(curves.map((c) => c.qa.confidence)) : 0;
  const r = Math.min(Math.abs(xAxis.r), Math.abs(yAxis.r)); // a poor axis fit drags the whole set down
  return {
    confidence: round(base * r, 3),
    nCurves: curves.length,
    crossings: countCrossings(curves),
    roundtripRms,
    warnings,
  };
}
