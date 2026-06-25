/**
 * Pure curve geometry — TS port of the Python `curves/vectorpaths.py`. No dependencies, plain array math:
 * de-fan a draw-order polyline into monotone-x runs, chain runs back into curves (refusing valley joins so
 * adjacent lobes don't merge), and split a curve at deep inter-lobe valleys.
 *
 * Convention: points are [x, y] in source coords with y increasing DOWNWARD (so "visual up" = decreasing y),
 * matching the pdf.js adapter output.
 */
export type Pt = [number, number];

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;

export const xSorted = (P: Pt[]): Pt[] => [...P].sort((a, b) => a[0] - b[0]);

/** Split a draw-order polyline into maximal monotone-in-x runs; orient each x-increasing. */
export function monoXSegments(P: Pt[]): Pt[][] {
  const segs: Pt[][] = [];
  let s = 0, dir = 0;
  for (let i = 1; i < P.length; i++) {
    const d = P[i]![0] - P[i - 1]![0];
    if (Math.abs(d) < 1e-9) continue;
    const sd = d > 0 ? 1 : -1;
    if (dir === 0) dir = sd;
    else if (sd !== dir) { segs.push(P.slice(s, i)); s = i - 1; dir = sd; }
  }
  segs.push(P.slice(s));
  return segs.map((seg) => (seg[seg.length - 1]![0] < seg[0]![0] ? [...seg].reverse() : seg));
}

/** True if joining cur's END to t's START sits at a VALLEY (the join is lower in data than its neighbours both
 *  back and forward) — two lobes meeting at the baseline, not a broken stroke continuing the same way. */
function isValleyJoin(cur: Pt[], t: Pt[], k = 8, margin = 2.0): boolean {
  const n = cur.length;
  const yb = n > 1 ? mean(cur.slice(Math.max(0, n - k - 1), n - 1).map((p) => p[1])) : cur[n - 1]![1];
  const ya = t.length > 1 ? mean(t.slice(1, k + 1).map((p) => p[1])) : t[0]![1];
  const ey = cur[n - 1]![1];
  return ey > yb + margin && ey > ya + margin;
}

/** Chain x-increasing segments where one's END ~ next's START — rebuilds a broken stroke, but refuses a valley
 *  join so two adjacent lobes meeting at the baseline are not merged into one full-width curve. */
export function chainCurves(segs: Pt[][], xtol = 4, ytol = 6): Pt[][] {
  const s = [...segs].sort((a, b) => a[0]![0] - b[0]![0]);
  const used = new Array(s.length).fill(false);
  const curves: Pt[][] = [];
  for (let i = 0; i < s.length; i++) {
    if (used[i]) continue;
    let cur = [...s[i]!];
    used[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      const [ex, ey] = cur[cur.length - 1]!;
      for (let j = 0; j < s.length; j++) {
        if (used[j]) continue;
        const t = s[j]!;
        if (Math.abs(t[0]![0] - ex) < xtol && Math.abs(t[0]![1] - ey) < ytol && !isValleyJoin(cur, t)) {
          cur = cur.concat(t);
          used[j] = true;
          changed = true;
          break;
        }
      }
    }
    curves.push(cur);
  }
  return curves;
}

/** Split a single-valued curve into separate lobes at DEEP inter-lobe valleys; keep shallow within-lobe dips
 *  (real double-humps) intact. h = -y (visual height). */
export function splitLobes(curve: Pt[], depthFrac = 0.35, minPts = 12): Pt[][] {
  const h = curve.map((p) => -p[1]);
  const hmin = Math.min(...h);
  for (let i = 0; i < h.length; i++) h[i] = h[i]! - hmin;
  const hmax = Math.max(...h);
  if (hmax <= 0) return [curve];
  const peaks: number[] = [];
  for (let i = 1; i < h.length - 1; i++) if (h[i]! >= h[i - 1]! && h[i]! >= h[i + 1]! && h[i]! > 0.15 * hmax) peaks.push(i);
  if (peaks.length < 2) return [curve];
  const splits: number[] = [];
  for (let p = 0; p < peaks.length - 1; p++) {
    const a = peaks[p]!, b = peaks[p + 1]!;
    let v = a;
    for (let i = a; i <= b; i++) if (h[i]! < h[v]!) v = i;
    if (h[v]! < depthFrac * Math.min(h[a]!, h[b]!)) splits.push(v);
  }
  if (!splits.length) return [curve];
  const out: Pt[][] = [];
  let prev = 0;
  for (const v of splits) {
    if (v - prev >= minPts) out.push(curve.slice(prev, v + 1));
    prev = v;
  }
  if (curve.length - prev >= minPts) out.push(curve.slice(prev));
  return out;
}
