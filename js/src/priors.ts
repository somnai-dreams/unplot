/**
 * ShapePrior: the pluggable shape knowledge the caller injects — TS port of the Python `priors`.
 *
 * A prior does two jobs:
 *   - qaViolation(points)            : score how far a finished curve departs from the expected shape
 *   - separationBias(prefix, cand)   : at a crossing, prefer the continuation that fits the shape
 *
 * Shipped priors: free (no assumption), monotone, lobe (approximately-unimodal), smooth. A caller selects
 * and parameterises these for its domain and maps recovered curve order to its own labels; no domain
 * knowledge lives here. Priors are plain objects built by the factory functions below.
 */
import type { Pt } from "./curves/vectorpaths.ts";
import { argmax } from "./num.ts";
import * as shape from "./qa/shape.ts";

export type Violation = {
  magnitude: number; // 0 = clean
  kind: string; // "flank" | "backtrack" | "curvature" | "none"
  at: number | null; // x (data units) of worst violation
};

export type ShapePrior = {
  name: string;
  tolerance: number;
  qaViolation: (points: Pt[]) => Violation;
  separationBias: (prefix: Pt[], cand: Pt) => number;
};

// Separation runs in SOURCE pixel coords (y increases downward), so "visual up" = decreasing y. The
// shape-aware priors score a candidate continuation by height h = -y, matching standard plot orientation.
const TREND = 40; // window for the established-direction estimate — long enough to survive a flat crossing blob

/** [established height trend, candidate height step, peak index] in visual-height (h = -y). `trend` spans the
 *  last TREND points — deliberately longer than a crossing's merged blob, so direction survives the flat. */
function heightStep(prefix: Pt[], cand: Pt): [number, number, number] {
  const h = prefix.map((p) => -p[1]);
  const win = h.slice(-TREND);
  const trend = win[win.length - 1]! - win[0]!;
  const step = -cand[1] - h[h.length - 1]!;
  return [trend, step, argmax(h)];
}

/** No shape assumption — raw recovered geometry. Everything passes. */
export const free = (): ShapePrior => ({
  name: "free",
  tolerance: Infinity,
  qaViolation: () => ({ magnitude: 0, kind: "none", at: null }),
  separationBias: () => 0,
});

/** Curve should be monotone in one direction (e.g. a characteristic D-vs-logE curve). Violation = largest
 *  backtrack against that direction / y-range. */
export const monotone = (direction: "auto" | "up" | "down" = "auto", tolerance = 0.05): ShapePrior => ({
  name: "monotone",
  tolerance,
  qaViolation: (points) => {
    const [v, at] = shape.backtrack(points, direction);
    return { magnitude: v, kind: "backtrack", at };
  },
  // reward continuing the prefix's established direction; penalise a reversal (a monotone curve should never
  // turn back). Disambiguates a crossing where the other curve runs the opposite way.
  separationBias: (prefix, cand) => {
    if (prefix.length < 2) return 0;
    const [trend, step] = heightStep(prefix, cand);
    if (trend === 0) return 0;
    return (trend > 0 ? 1 : -1) * step;
  },
});

/** Curve should be an approximately-unimodal lobe: rise to a peak, then fall. 'Approximately' is
 *  load-bearing — real lobes carry within-lobe substructure; `tolerance` (fraction of amplitude) is how much
 *  flank reversal is allowed before flagging, NOT a demand for strict unimodality. Violation = flank reversal. */
export const lobe = (tolerance = 0.08): ShapePrior => ({
  name: "lobe",
  tolerance,
  qaViolation: (points) => {
    const [v, at] = shape.flankViolation(points);
    return { magnitude: v, kind: "flank", at };
  },
  // before the prefix's peak reward a rising candidate; after it reward a falling one. Where two lobes cross
  // they run opposite flanks, so this keeps each curve single-peaked instead of swapping curves.
  separationBias: (prefix, cand) => {
    if (prefix.length < 3) return 0;
    const [, step, pk] = heightStep(prefix, cand);
    const pastPeak = (prefix.length - 1 - pk) > 2;
    return pastPeak ? -step : step;
  },
});

/** Curve should be smooth (no spikes). Violation = max normalised second difference. */
export const smooth = (tolerance = 0.25): ShapePrior => ({
  name: "smooth",
  tolerance,
  qaViolation: (points) => {
    const [v, at] = shape.curvature(points);
    return { magnitude: v, kind: "curvature", at };
  },
  separationBias: () => 0,
});
