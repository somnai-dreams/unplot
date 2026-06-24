/**
 * The output contract: a CurveSet is N calibrated curves + per-curve metadata + a QA/confidence report.
 * Neutral units throughout (numbers). No domain knowledge: no axis-unit names, no channel names. The library
 * hands back neutral handles (`c0`, `c1`, ...) ordered deterministically; the caller maps order -> meaning.
 */
import type { Pt } from "./curves/vectorpaths.ts";

export type Ingest = "vector" | "raster";
export type Method = "vector-path" | "vector-defan-chain" | "raster-march" | "raster-color";
export type OrderBy = "peak-x" | "mean-y" | "first-x";
export type Dash = "solid" | "dashed" | "dashdot";

export type Source = {
  path: string;
  ingest: Ingest;
  frameSrc: [number, number, number, number]; // x0,y0,x1,y1 in source coords (PDF pt or px)
  page: number | null; // vector page index; null for a raster image
  dpi: number | null; // raster only
};

/** data = scale * source + offset. LINEAR only — log-spaced axes are unsupported (see README scope). */
export type AxisCalibration = {
  scale: number;
  offset: number;
  r: number; // |corr| of the label-anchor fit; ~1.0 = clean linear axis
  anchors: [number, number][]; // (source_pos, data_value) pairs used
  nDropped: number; // outlier anchors the robust fit rejected
};

export const toData = (c: AxisCalibration, src: number): number => c.scale * src + c.offset;

export type CurveStyle = {
  dash: Dash | null; // null when not dash-distinguished
  color: [number, number, number] | null; // stroke RGB 0..1 if colour-keyed, else null
  width: number | null;
};

export type CurveQA = {
  prior: string; // the ShapePrior the curve was scored against
  violation: number; // shape-prior violation magnitude (0 = clean)
  violationKind: string; // "flank" | "backtrack" | "curvature" | "none"
  violationAt: number | null; // x (data units) of the worst violation
  passed: boolean; // violation < prior.tolerance
  nPoints: number;
  xMonotonic: boolean; // x strictly increasing after sort + dedupe
  maxGapX: number; // largest x gap (data units) — coverage-hole signal
  confidence: number; // 0..1 composite
  notes: string[];
};

export type Curve = {
  id: string; // stable neutral handle ("c0"...) — never a channel name
  orderIndex: number; // position under the chosen ordering
  style: CurveStyle;
  points: Pt[]; // (N,2) in DATA space, x-sorted + deduped
  pointsSrc: Pt[]; // (N,2) in SOURCE space (overlay / round-trip)
  method: Method;
  qa: CurveQA;
};

export type CurveSetQA = {
  confidence: number; // set-level 0..1
  nCurves: number;
  crossings: number; // x-overlapping crossings detected between curves
  roundtripRms: number | null; // source-ink vs re-rasterized-curve RMS (px), if round-trip QA ran
  warnings: string[];
};

export type CurveSet = {
  curves: Curve[];
  xAxis: AxisCalibration;
  yAxis: AxisCalibration;
  source: Source;
  prior: string; // ShapePrior.name used
  qa: CurveSetQA;
};

/** Caller convenience: turn orderIndex -> label (e.g. {0:'blue',1:'green',2:'red'}) into a label->Curve map.
 *  The library never assigns these names; the caller owns the map. */
export function labeled(cs: CurveSet, mapping: Record<number, string>): Record<string, Curve> {
  const out: Record<string, Curve> = {};
  for (const c of cs.curves) if (c.orderIndex in mapping) out[mapping[c.orderIndex]] = c;
  return out;
}
