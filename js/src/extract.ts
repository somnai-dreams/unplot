/**
 * Top-level entry point — TS port of the Python `extract.py` (vector path). extract(data) -> CurveSet.
 *
 * One frame = one CurveSet. A datasheet page with sens + char + dye plots is three extract() calls. The
 * library knows nothing about the domain: the caller passes a ShapePrior and, after the fact, maps orderIndex ->
 * channel via labeled(...). Raster ingest is not yet ported — vector only.
 */
import { calibrateAxis } from "./axes/calibrate.ts";
import type { AxisCalibration, Curve, CurveSet, Method, OrderBy, Source } from "./curveset.ts";
import { toData } from "./curveset.ts";
import type { Pt } from "./curves/vectorpaths.ts";
import { curvePathsBbox, loadVectorPage, pathsInFrame, type VectorPage } from "./io/vector.ts";
import { argmax, maxOf, mean, minOf } from "./num.ts";
import { free, type ShapePrior } from "./priors.ts";
import { curveQA, setQA } from "./qa/confidence.ts";
import { type Candidate, type DefanCfg, separate } from "./separate.ts";

export type AxisSpec = "auto" | [number, number][];

export type ExtractOpts = {
  path?: string; // recorded in Source.path; PDFs have no path here, so caller may supply one
  frame?: [number, number, number, number];
  xAxis?: AxisSpec;
  yAxis?: AxisSpec;
  prior?: ShapePrior;
  orderBy?: OrderBy;
  expectedCurves?: number | null;
  split?: boolean;
  minSegs?: number;
  defan?: Partial<DefanCfg>;
};

/** Map source -> data, x-sort, and drop folds (non-increasing x) so the curve is single-valued. Keeps source
 *  coords aligned to the surviving data points (for overlay / round-trip). -> [pointsData, pointsSrc]. */
function finalize(pSrc: Pt[], xAxis: AxisCalibration, yAxis: AxisCalibration): [Pt[], Pt[]] {
  const rows = pSrc.map((p) => ({ sx: p[0], sy: p[1], xd: toData(xAxis, p[0]), yd: toData(yAxis, p[1]) }));
  rows.sort((a, b) => a.xd - b.xd);
  const out: typeof rows = []; // keep strictly-increasing x against the last KEPT row (drop folds)
  for (const r of rows) if (!out.length || r.xd > out[out.length - 1]!.xd + 1e-9) out.push(r);
  return [out.map((r) => [r.xd, r.yd] as Pt), out.map((r) => [r.sx, r.sy] as Pt)];
}

function orderKey(pointsData: Pt[], orderBy: OrderBy): number {
  const x = pointsData.map((p) => p[0]), y = pointsData.map((p) => p[1]);
  if (orderBy === "peak-x") return x[argmax(y)]!;
  if (orderBy === "mean-y") return mean(y);
  return minOf(x); // first-x
}

const amplitude = (pointsData: Pt[]): number => maxOf(pointsData.map((p) => p[1])) - minOf(pointsData.map((p) => p[1]));

function buildCurves(
  cands: Candidate[], xAxis: AxisCalibration, yAxis: AxisCalibration,
  orderBy: OrderBy, prior: ShapePrior, methodLabel: Method, expectedCurves: number | null,
): Curve[] {
  let built = cands
    .map(([dash, color, pSrc]) => {
      const [pdata, psrc] = finalize(pSrc, xAxis, yAxis);
      return { dash, color, pdata, psrc, qa: curveQA(pdata, prior) };
    })
    .filter((b) => b.pdata.length >= 2);
  // Confidence-aware selection: keep the `expectedCurves` best by confidence * amplitude. A real curve scores
  // high on BOTH; a tall malformed fragment has confidence ~0, and a tiny degenerate stub has amplitude ~0, so
  // either failure mode scores ~0 and can't displace a genuine lobe. (Selecting by amplitude alone was the bug.)
  if (expectedCurves && built.length > expectedCurves) {
    built = [...built].sort((a, b) => b.qa.confidence * amplitude(b.pdata) - a.qa.confidence * amplitude(a.pdata));
    built = built.slice(0, expectedCurves);
  }
  built.sort((a, b) => orderKey(a.pdata, orderBy) - orderKey(b.pdata, orderBy));
  return built.map((b, k) => ({
    id: `c${k}`,
    orderIndex: k,
    style: { dash: b.dash, color: b.color, width: null },
    points: b.pdata,
    pointsSrc: b.psrc,
    method: methodLabel,
    qa: b.qa,
  }));
}

/** Synchronous core: extract a CurveSet from an already-loaded VectorPage. Vector path only. */
export function extractFromPage(page: VectorPage, opts: ExtractOpts = {}): CurveSet {
  const prior = opts.prior ?? free();
  const orderBy = opts.orderBy ?? "peak-x";
  const expectedCurves = opts.expectedCurves ?? null;
  const minSegs = opts.minSegs ?? 3;
  const frame = opts.frame ?? curvePathsBbox(page, minSegs);
  if (frame === null) throw new Error("no curve paths found on page; pass an explicit `frame`");

  const xCal = calibrateAxis(page.words, frame, "x", opts.xAxis === "auto" || opts.xAxis === undefined ? undefined : opts.xAxis);
  const yCal = calibrateAxis(page.words, frame, "y", opts.yAxis === "auto" || opts.yAxis === undefined ? undefined : opts.yAxis);
  const raw = pathsInFrame(page, frame, minSegs);
  const [cands, method] = separate(raw, {
    expectedCurves, split: opts.split ?? false, ...(opts.defan ? { defan: opts.defan } : {}),
  });
  const label: Method = method === "style" ? "vector-path" : "vector-defan-chain";
  const curves = buildCurves(cands, xCal, yCal, orderBy, prior, label, expectedCurves);

  const warnings: string[] = [];
  if (Math.abs(xCal.r) < 0.999 || Math.abs(yCal.r) < 0.999)
    warnings.push(`axis fit r below 0.999 (x=${xCal.r.toFixed(4)}, y=${yCal.r.toFixed(4)})`);
  if (expectedCurves && curves.length !== expectedCurves)
    warnings.push(`expected ${expectedCurves} curves, recovered ${curves.length}`);
  const source: Source = {
    path: opts.path ?? "<buffer>", ingest: "vector",
    frameSrc: [frame[0], frame[1], frame[2], frame[3]], page: 0, dpi: null,
  };
  return { curves, xAxis: xCal, yAxis: yCal, source, prior: prior.name, qa: setQA(curves, xCal, yCal, null, warnings) };
}

/** Load a PDF page and extract a CurveSet. */
export async function extract(data: Uint8Array, opts: ExtractOpts & { page?: number } = {}): Promise<CurveSet> {
  const page = await loadVectorPage(data, opts.page ?? 0);
  return extractFromPage(page, opts);
}
