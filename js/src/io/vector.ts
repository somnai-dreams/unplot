/**
 * Vector-PDF ingest via pdf.js — the TS equivalent of the Python `io/vector.py`.
 *
 * pdf.js exposes drawn geometry only through the low-level operator list (`getOperatorList`), so we walk it
 * ourselves: track the graphics state (CTM, stroke colour, dash, line width), flatten each constructed path
 * (moveTo / lineTo / cubic curveTo), and emit one RawPath per `stroke`. Coords come out in PDF user space
 * (y-up, origin bottom-left); we apply the CTM and flip y to a top-left/y-down convention so the rest of the
 * port matches the reference behaviour.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export type Dash = "solid" | "dashed" | "dashdot";

export type RawPath = {
  pts: number[][]; // [[x, y], ...] flattened, source coords (pt, y-down)
  dash: Dash;
  color: [number, number, number] | null; // 0..1 RGB if non-grey, else null
  width: number; // bbox width
  height: number; // bbox height
  nSegs: number; // drawn segment count
  ruled: boolean; // every segment axis-aligned & straight -> grid / frame / ruled line, not a curve
};

export type Word = {
  x0: number; y0: number; x1: number; y1: number; text: string;
};

export type VectorPage = {
  paths: RawPath[];
  words: Word[];
  rect: [number, number, number, number]; // x0,y0,x1,y1 (pt)
};

// The subset of pdf.js operator codes the walker reads. pdf.js types `OPS` loosely, so we name the codes we
// use and cast through `unknown` once, rather than dot-accessing an index signature everywhere.
type PdfOps = {
  save: number; restore: number; transform: number;
  setLineWidth: number; setStrokeRGBColor: number; setDash: number;
  constructPath: number; fill: number; eoFill: number; endPath: number;
  stroke: number; closeStroke: number;
  moveTo: number; lineTo: number; curveTo: number; curveTo2: number; curveTo3: number; rectangle: number;
};
const OPS = (pdfjs as unknown as { OPS: PdfOps }).OPS;

type Mat = [number, number, number, number, number, number]; // a,b,c,d,e,f

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function bezier(p0: number[], p1: number[], p2: number[], p3: number[], n = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0]! + 3 * u * u * t * p1[0]! + 3 * u * t * t * p2[0]! + t * t * t * p3[0]!,
      u * u * u * p0[1]! + 3 * u * u * t * p1[1]! + 3 * u * t * t * p2[1]! + t * t * t * p3[1]!,
    ]);
  }
  return out;
}

function dashStyle(dashArray: number[] | null | undefined): Dash {
  if (!dashArray || dashArray.length === 0) return "solid";
  if (dashArray.length >= 4) return "dashdot";
  return "dashed";
}

/** Flatten a constructPath (subOps + flat coords) into device-space points under the current CTM. */
function flatten(subOps: number[], coords: number[], ctm: Mat, H: number): number[][] {
  const pts: number[][] = [];
  let i = 0;
  let cur: number[] = [0, 0];
  const push = (x: number, y: number) => {
    const [dx, dy] = apply(ctm, x, y);
    cur = [x, y];
    pts.push([dx, H - dy]); // flip y: user-space (y-up) -> top-left (y-down)
  };
  for (const op of subOps) {
    if (op === OPS.moveTo || op === OPS.lineTo) {
      push(coords[i]!, coords[i + 1]!); i += 2;
    } else if (op === OPS.curveTo) {
      const p0 = cur, p1 = [coords[i]!, coords[i + 1]!], p2 = [coords[i + 2]!, coords[i + 3]!], p3 = [coords[i + 4]!, coords[i + 5]!];
      for (const [x, y] of bezier(p0, p1, p2, p3)) { const [dx, dy] = apply(ctm, x, y); pts.push([dx, H - dy]); }
      cur = p3; i += 6;
    } else if (op === OPS.curveTo2) {
      const p0 = cur, p1 = cur, p2 = [coords[i]!, coords[i + 1]!], p3 = [coords[i + 2]!, coords[i + 3]!];
      for (const [x, y] of bezier(p0, p1, p2, p3)) { const [dx, dy] = apply(ctm, x, y); pts.push([dx, H - dy]); }
      cur = p3; i += 4;
    } else if (op === OPS.curveTo3) {
      const p0 = cur, p1 = [coords[i]!, coords[i + 1]!], p2 = [coords[i + 2]!, coords[i + 3]!], p3 = p2;
      for (const [x, y] of bezier(p0, p1, p2, p3)) { const [dx, dy] = apply(ctm, x, y); pts.push([dx, H - dy]); }
      cur = p3; i += 4;
    } else if (op === OPS.rectangle) {
      const x = coords[i]!, y = coords[i + 1]!, w = coords[i + 2]!, h = coords[i + 3]!; i += 4;
      const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
      for (const [px, py] of corners) { const [dx, dy] = apply(ctm, px, py); pts.push([dx, H - dy]); }
      cur = [x, y];
    } // closePath: no coords
  }
  return pts;
}

/** True if every drawn segment is an axis-aligned straight line (device space) — a grid / frame / ruled-line
 *  path, not a data curve. Mirrors the Python `_is_ruled`: a Bezier disqualifies immediately, a polyline curve
 *  has diagonal flank segments, and a curve's flat baseline survives (its stroke also rises/falls). Catches a
 *  grid drawn as ONE stroke, which the thin-bbox check misses. */
function isRuled(subOps: number[], coords: number[], ctm: Mat, ang = 0.08): boolean {
  let i = 0;
  let cur: [number, number] | null = null;
  let sawLine = false;
  for (const op of subOps) {
    if (op === OPS.moveTo) {
      cur = apply(ctm, coords[i]!, coords[i + 1]!); i += 2;
    } else if (op === OPS.lineTo) {
      const next = apply(ctm, coords[i]!, coords[i + 1]!); i += 2;
      if (cur) {
        const dx = Math.abs(cur[0] - next[0]), dy = Math.abs(cur[1] - next[1]);
        const hi = Math.max(dx, dy);
        if (hi >= 1e-3) {                                    // skip zero-length segments
          if (Math.min(dx, dy) > ang * hi) return false;     // a diagonal segment -> could be data
          sawLine = true;
        }
      }
      cur = next;
    } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
      return false; // a Bezier -> a real curve
    } else if (op === OPS.rectangle) {
      cur = apply(ctm, coords[i]!, coords[i + 1]!); i += 4; sawLine = true; // axis-aligned box (e.g. the frame)
    }
    // closePath: no coords
  }
  return sawLine;
}

/** Read a 3-component RGB out of a pdf.js colour arg (an array, or an object keyed 0/1/2). */
function rgbObj(a: unknown): [number, number, number] {
  const o = a as Record<number, number>;
  return [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0];
}

// The fields the walker reads off a pdf.js text item; cast through this rather than `any`.
type TextItemLite = { str?: string; transform?: number[]; width?: number; height?: number };

export async function loadVectorPage(data: Uint8Array, pageNum = 0, colorSat = 0.15): Promise<VectorPage> {
  // pdf.js TRANSFERS (detaches) the input buffer to its worker — pass a copy so the caller can reuse `data`
  // (e.g. render the same PDF and extract() from it without the buffer going detached).
  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNum + 1);
  const view = page.view; // [x0,y0,x1,y1] in pt
  const H = view[3]! - view[1]!;
  const ops = await page.getOperatorList();

  const paths: RawPath[] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: Mat; color: [number, number, number]; dash: number[] | null; width: number }[] = [];
  let strokeColor: [number, number, number] = [0, 0, 0];
  let dash: number[] | null = null;
  let width = 1;
  let pending: { subOps: number[]; coords: number[] } | null = null;

  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const args = ops.argsArray[k] as unknown[]; // pdf.js types these as any; narrow per-op below
    if (fn === OPS.save) stack.push({ ctm, color: strokeColor, dash, width });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) ({ ctm, color: strokeColor, dash, width } = s); }
    else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as Mat);
    else if (fn === OPS.setLineWidth) width = args[0] as number;
    else if (fn === OPS.setStrokeRGBColor) strokeColor = rgbObj(args).map((c) => c / 255) as [number, number, number];
    else if (fn === OPS.setDash) dash = args[0] as number[] | null;
    else if (fn === OPS.constructPath) {
      // a path may be built by several constructPath ops before it's painted — accumulate, don't overwrite
      pending ??= { subOps: [], coords: [] };
      pending.subOps.push(...(args[0] as number[]));
      pending.coords.push(...(args[1] as number[]));
    } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.endPath) pending = null; // discard non-stroked paths
    else if (fn === OPS.stroke || fn === OPS.closeStroke) {
      if (pending) {
        const pts = flatten(pending.subOps, pending.coords, ctm, H);
        if (pts.length) {
          const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
          const [mn, mx] = [Math.min(...strokeColor), Math.max(...strokeColor)];
          paths.push({
            pts, dash: dashStyle(dash),
            color: mx - mn > colorSat ? strokeColor : null,
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            nSegs: pending.subOps.filter((o) => o !== OPS.moveTo).length,
            ruled: isRuled(pending.subOps, pending.coords, ctm),
          });
        }
        pending = null;
      }
    }
  }

  const tc = await page.getTextContent();
  const words: Word[] = [];
  for (const item of tc.items as TextItemLite[]) {
    const transform = item.transform;
    const text = item.str?.trim() ?? "";
    if (text === "" || !transform) continue;
    const e = transform[4]!, f = transform[5]!;
    const w = item.width ?? 0, h = item.height ?? 8;
    words.push({ x0: e, y0: H - (f + h), x1: e + w, y1: H - f, text });
  }
  return { paths, words, rect: [view[0]!, 0, view[2]!, H] };
}

/** [x0,y0,x1,y1] bounding box of a flattened path's points. */
export function pathBbox(pts: number[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    const x = p[0]!, y = p[1]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** True if (nearly) all points hug the bbox border — i.e. this path is the plot frame, not a curve. A
 *  full-span diagonal curve has interior points, so it survives; a rectangle's points are all on edges. */
function isBox(pts: number[][], bb: [number, number, number, number], frac = 0.9, tol = 3.0): boolean {
  const [bx0, by0, bx1, by1] = bb;
  let near = 0;
  for (const p of pts) {
    const x = p[0]!, y = p[1]!;
    if (Math.abs(x - bx0) < tol || Math.abs(x - bx1) < tol || Math.abs(y - by0) < tol || Math.abs(y - by1) < tol) near++;
  }
  return pts.length > 0 && near / pts.length > frac;
}

/** Stroked CURVE paths whose bbox sits inside `frame`. Rejects the plot frame box (fills the frame and hugs
 *  its border) when `dropFrame`, and axis ticks / gridlines (bbox thinner than `minWh` in either dim). The
 *  TS adapter has already flattened strokes and computed colour/dash, so this just filters. */
export function pathsInFrame(
  page: VectorPage, frame: [number, number, number, number],
  minSegs = 3, dropFrame = true, minWh = 6.0,
): RawPath[] {
  const [x0, y0, x1, y1] = frame;
  const fw = x1 - x0, fh = y1 - y0;
  const out: RawPath[] = [];
  for (const p of page.paths) {
    if (p.nSegs < minSegs || p.pts.length === 0) continue;
    const bb = pathBbox(p.pts);
    const [bx0, by0, bx1, by1] = bb;
    if (!(x0 - 2 <= bx0 && bx1 <= x1 + 2 && y0 - 2 <= by0 && by1 <= y1 + 2)) continue;
    const bw = bx1 - bx0, bh = by1 - by0;
    if (bw < minWh || bh < minWh) continue; // axis tick / single gridline
    if (p.ruled) continue;                  // a grid / ruled-line path drawn as one stroke
    if (dropFrame && bw > 0.9 * fw && bh > 0.9 * fh && isBox(p.pts, bb)) continue; // the plot box
    out.push(p);
  }
  return out;
}

/** Bounding box of all curve-like stroked paths on the page — the auto-frame for a single-plot page. For
 *  multi-plot pages, pass an explicit `frame` to extract() instead. Returns null if no curve paths. */
export function curvePathsBbox(page: VectorPage, minSegs = 3): [number, number, number, number] | null {
  const boxes = page.paths.filter((p) => p.nSegs >= minSegs && p.pts.length > 0).map((p) => pathBbox(p.pts));
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
}
