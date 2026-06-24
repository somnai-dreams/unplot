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

export interface RawPath {
  pts: number[][]; // [[x, y], ...] flattened, source coords (pt, y-down)
  dash: Dash;
  color: [number, number, number] | null; // 0..1 RGB if non-grey, else null
  width: number; // bbox width
  height: number; // bbox height
  nSegs: number; // drawn segment count
}

export interface Word {
  x0: number; y0: number; x1: number; y1: number; text: string;
}

export interface VectorPage {
  paths: RawPath[];
  words: Word[];
  rect: [number, number, number, number]; // x0,y0,x1,y1 (pt)
}

type Mat = [number, number, number, number, number, number]; // a,b,c,d,e,f

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function bezier(p0: number[], p1: number[], p2: number[], p3: number[], n = 24): number[][] {
  const out: number[][] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
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
function flatten(OPS: Record<string, number>, subOps: number[], coords: number[], ctm: Mat, H: number): number[][] {
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
      push(coords[i], coords[i + 1]); i += 2;
    } else if (op === OPS.curveTo) {
      const p0 = cur, p1 = [coords[i], coords[i + 1]], p2 = [coords[i + 2], coords[i + 3]], p3 = [coords[i + 4], coords[i + 5]];
      for (const [x, y] of bezier(p0, p1, p2, p3)) { const [dx, dy] = apply(ctm, x, y); pts.push([dx, H - dy]); }
      cur = p3; i += 6;
    } else if (op === OPS.curveTo2) {
      const p0 = cur, p1 = cur, p2 = [coords[i], coords[i + 1]], p3 = [coords[i + 2], coords[i + 3]];
      for (const [x, y] of bezier(p0, p1, p2, p3)) { const [dx, dy] = apply(ctm, x, y); pts.push([dx, H - dy]); }
      cur = p3; i += 4;
    } else if (op === OPS.curveTo3) {
      const p0 = cur, p1 = [coords[i], coords[i + 1]], p2 = [coords[i + 2], coords[i + 3]], p3 = p2;
      for (const [x, y] of bezier(p0, p1, p2, p3)) { const [dx, dy] = apply(ctm, x, y); pts.push([dx, H - dy]); }
      cur = p3; i += 4;
    } else if (op === OPS.rectangle) {
      const x = coords[i], y = coords[i + 1], w = coords[i + 2], h = coords[i + 3]; i += 4;
      for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]) { const [dx, dy] = apply(ctm, px, py); pts.push([dx, H - dy]); }
      cur = [x, y];
    } // closePath: no coords
  }
  return pts;
}

function rgbObj(a: any): [number, number, number] {
  if (Array.isArray(a)) return [a[0], a[1], a[2]];
  return [a[0] ?? a["0"], a[1] ?? a["1"], a[2] ?? a["2"]];
}

export async function loadVectorPage(data: Uint8Array, pageNum = 0, colorSat = 0.15): Promise<VectorPage> {
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNum + 1);
  const view = page.view as number[]; // [x0,y0,x1,y1] in pt
  const H = view[3] - view[1];
  const OPS = (pdfjs as any).OPS as Record<string, number>;
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
    const args = ops.argsArray[k];
    if (fn === OPS.save) stack.push({ ctm, color: strokeColor, dash, width });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) ({ ctm, color: strokeColor, dash, width } = s); }
    else if (fn === OPS.transform) ctm = mul(ctm, args as Mat);
    else if (fn === OPS.setLineWidth) width = args[0];
    else if (fn === OPS.setStrokeRGBColor) strokeColor = rgbObj(args).map((c: number) => c / 255) as [number, number, number];
    else if (fn === OPS.setDash) dash = args[0];
    else if (fn === OPS.constructPath) {
      // a path may be built by several constructPath ops before it's painted — accumulate, don't overwrite
      if (!pending) pending = { subOps: [], coords: [] };
      pending.subOps.push(...(args[0] as number[]));
      pending.coords.push(...(args[1] as number[]));
    } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.endPath) pending = null; // discard non-stroked paths
    else if (fn === OPS.stroke || fn === OPS.closeStroke) {
      if (pending) {
        const pts = flatten(OPS, pending.subOps, pending.coords, ctm, H);
        if (pts.length) {
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          const [mn, mx] = [Math.min(...strokeColor), Math.max(...strokeColor)];
          paths.push({
            pts, dash: dashStyle(dash),
            color: mx - mn > colorSat ? strokeColor : null,
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            nSegs: pending.subOps.filter((o) => o !== OPS.moveTo).length,
          });
        }
        pending = null;
      }
    }
  }

  const tc = await page.getTextContent();
  const words: Word[] = [];
  for (const item of tc.items as any[]) {
    if (!item.str || !item.str.trim()) continue;
    const [, , , , e, f] = item.transform as number[];
    const w = item.width ?? 0, h = item.height ?? 8;
    words.push({ x0: e, y0: H - (f + h), x1: e + w, y1: H - f, text: item.str.trim() });
  }
  return { paths, words, rect: [view[0], 0, view[2], H] };
}
