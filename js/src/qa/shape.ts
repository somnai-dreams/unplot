/**
 * Pure shape-QA metrics on (x, y) point arrays. TS port of the Python `qa/shape.py`. No domain knowledge,
 * no I/O. Each returns a scalar violation (0 = clean) plus the x where the worst violation sits. The
 * ShapePrior wrappers turn these into Violations; extract() folds them into per-curve confidence.
 */
import type { Pt } from "../curves/vectorpaths.ts";
import { argmax, diff, maxOf, minOf } from "../num.ts";

function xySorted(points: Pt[]): { xs: number[]; ys: number[] } {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  return { xs: p.map((q) => q[0]), ys: p.map((q) => q[1]) };
}

/** Largest reversal against the rise-to-peak-then-fall direction, as a fraction of amplitude. Shallow
 *  within-lobe substructure (double-humps, asymmetric shoulders) yields a small fraction. -> [violation, xAt]. */
export function flankViolation(points: Pt[]): [number, number | null] {
  const { xs, ys } = xySorted(points);
  if (ys.length < 4) return [0, null];
  const amp = maxOf(ys) - minOf(ys);
  if (amp <= 1e-6) return [0, null];
  const pk = argmax(ys);
  let rv = 0, rmax = -1e9, rvAt: number | null = null;
  for (let i = 0; i <= pk; i++) { // rising flank: should be non-decreasing
    rmax = Math.max(rmax, ys[i]!);
    if (rmax - ys[i]! > rv) { rv = rmax - ys[i]!; rvAt = xs[i]!; }
  }
  let fv = 0, rmin = 1e9, fvAt: number | null = null;
  for (let i = pk; i < ys.length; i++) { // falling flank: should be non-increasing
    rmin = Math.min(rmin, ys[i]!);
    if (ys[i]! - rmin > fv) { fv = ys[i]! - rmin; fvAt = xs[i]!; }
  }
  return rv >= fv ? [rv / amp, rvAt] : [fv / amp, fvAt];
}

/** Largest run of motion against the dominant monotone direction, normalised by y-range. direction in
 *  {"auto","up","down"}; "auto" picks whichever the curve mostly does. A monotone curve scores 0. */
export function backtrack(points: Pt[], direction: "auto" | "up" | "down" = "auto"): [number, number | null] {
  const { xs, ys } = xySorted(points);
  const d = diff(ys);
  if (d.length === 0) return [0, null];
  const rng = maxOf(ys) - minOf(ys);
  if (rng <= 1e-9) return [0, null];
  let dir = direction;
  if (dir === "auto") {
    const up = d.filter((s) => s > 1e-9).length, down = d.filter((s) => s < -1e-9).length;
    dir = up >= down ? "up" : "down";
  }
  let worst = 0, worstAt: number | null = null, run = 0;
  for (let i = 0; i < d.length; i++) {
    const against = (dir === "up" && d[i]! < 0) || (dir === "down" && d[i]! > 0);
    run = against ? run + Math.abs(d[i]!) : 0;
    if (run > worst) { worst = run; worstAt = xs[i + 1]!; }
  }
  return [worst / rng, worstAt];
}

/** Max absolute second difference of y, normalised by y-range — a roughness probe. Spikes score high. */
export function curvature(points: Pt[]): [number, number | null] {
  const { xs, ys } = xySorted(points);
  if (ys.length < 3) return [0, null];
  const rng = maxOf(ys) - minOf(ys);
  if (rng <= 1e-9) return [0, null];
  const d2 = diff(diff(ys)).map(Math.abs);
  const j = argmax(d2);
  return [d2[j]! / rng, xs[j + 1]!];
}

/** Total vertical variation relative to y-range — how many times the curve reverses direction. A coherent
 *  single curve is ~1-3 (monotone ≈1, one lobe ≈2); several overlapping same-style curves merged into one
 *  tangle is dozens+. A separation-quality probe, NOT a shape prior: it flags a candidate that isn't a real
 *  single curve regardless of the expected shape. */
export function roughness(points: Pt[]): number {
  const { ys } = xySorted(points);
  if (ys.length < 2) return 0;
  const rng = maxOf(ys) - minOf(ys);
  if (rng <= 1e-9) return 0;
  let tv = 0;
  for (let i = 1; i < ys.length; i++) tv += Math.abs(ys[i]! - ys[i - 1]!);
  return tv / rng;
}

/** Largest gap between consecutive x values (data units) — a coverage-hole signal. */
export function maxGapX(points: Pt[]): number {
  const { xs } = xySorted(points);
  if (xs.length < 2) return 0;
  return maxOf(diff(xs));
}

/** True if x is strictly increasing after sorting (no duplicate-x folds). */
export function isXMonotonic(points: Pt[]): boolean {
  const { xs } = xySorted(points);
  return xs.length > 1 ? diff(xs).every((d) => d > 0) : true;
}
