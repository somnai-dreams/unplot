/**
 * Crossing separation for vector paths — TS port of the Python `separate/separate.py`. Turn RawPaths into
 * distinct candidate curves.
 *
 * Two strategies:
 *   - 'style': each distinct stroke style (dash + colour) is its own curve — merge its path fragments. Works
 *     when the plot distinguishes curves by line style/colour; crossing-tangle can't happen.
 *   - 'defan': curves share a style and are drawn as continuous pen strokes. De-fan each path into
 *     monotone-x runs, chain them by endpoint continuity, optionally split shared-stroke lobes.
 *
 * Returns candidates in SOURCE coords (unordered); extract() calibrates, then orders in data space.
 */
import { chainCurves, monoXSegments, type Pt, splitLobes, xSorted } from "./curves/vectorpaths.ts";
import type { RawPath } from "./io/vector.ts";

export type Candidate = [string | null, [number, number, number] | null, Pt[]]; // (dash, color, pts_src)
export type Method = "auto" | "style" | "defan";
export type DefanCfg = { minSeg: number; minCurve: number; minPathSegs: number };

// Continuous-stroke polyline plots (one pen stroke tracing all lobes) need this recipe; dash/colour-keyed
// plots use the 'style' path and ignore defan entirely.
export const DEFAN_DEFAULT: DefanCfg = { minSeg: 12, minCurve: 16, minPathSegs: 0 };
export const DEFAN_POLYLINE: DefanCfg = { minSeg: 20, minCurve: 20, minPathSegs: 40 };

const styleKey = (rp: RawPath): string => `${rp.dash}|${rp.color ? rp.color.join(",") : ""}`;

function byStyle(rawpaths: RawPath[]): Candidate[] {
  const groups = new Map<string, { dash: string | null; color: [number, number, number] | null; pts: Pt[] }>();
  for (const rp of rawpaths) {
    const k = styleKey(rp);
    const g = groups.get(k) ?? { dash: rp.dash, color: rp.color, pts: [] };
    for (const p of rp.pts) g.pts.push([p[0], p[1]]);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => [g.dash, g.color, xSorted(g.pts)] as Candidate);
}

function byDefan(rawpaths: RawPath[], split: boolean, cfg: DefanCfg): Candidate[] {
  let segs: Pt[][] = [];
  for (const rp of rawpaths) {
    if (rp.nSegs < cfg.minPathSegs) continue; // keep only the big curve polylines (drop annotations)
    segs = segs.concat(monoXSegments(rp.pts as Pt[]).filter((s) => s.length >= cfg.minSeg));
  }
  let curves = chainCurves(segs).filter((c) => c.length >= cfg.minCurve);
  if (split) {
    const out: Pt[][] = [];
    for (const c of curves) for (const lobe of splitLobes(c)) if (lobe.length >= cfg.minCurve) out.push(lobe);
    curves = out;
  }
  return curves.map((c) => [null, null, xSorted(c)] as Candidate);
}

/** Return [candidates, methodUsed]. Does NOT truncate to expectedCurves — confidence isn't known until the
 *  curves are calibrated + scored against the prior (in extract.buildCurves), and selecting by raw amplitude
 *  lets a tall malformed fragment evict a real lobe. The confidence-aware selection happens downstream. */
export function separate(
  rawpaths: RawPath[],
  opts: { expectedCurves?: number | null; method?: Method; split?: boolean; defan?: Partial<DefanCfg> } = {},
): [Candidate[], Method] {
  const { expectedCurves = null, split = false } = opts;
  const cfg: DefanCfg = { ...DEFAN_DEFAULT, ...(opts.defan ?? {}) };
  const nStyles = new Set(rawpaths.map(styleKey)).size;
  let method = opts.method ?? "auto";
  if (method === "auto") {
    if (expectedCurves && nStyles >= expectedCurves) method = "style";
    else if (expectedCurves == null && nStyles > 1) method = "style";
    else method = "defan";
  }
  const cands = method === "style" ? byStyle(rawpaths) : byDefan(rawpaths, split, cfg);
  return [cands, method];
}
