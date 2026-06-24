/** Small numeric helpers — the bits of numpy the port leans on, written out so there are no deps. */

export const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
export const mean = (a: number[]): number => (a.length ? sum(a) / a.length : 0);

export function maxOf(a: number[]): number {
  let m = -Infinity;
  for (const x of a) if (x > m) m = x;
  return m;
}
export function minOf(a: number[]): number {
  let m = Infinity;
  for (const x of a) if (x < m) m = x;
  return m;
}

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function argmax(a: number[]): number {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i;
  return k;
}
export function argmin(a: number[]): number {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] < a[k]) k = i;
  return k;
}

/** First difference: out[i] = a[i+1] - a[i]. */
export const diff = (a: number[]): number[] => a.slice(1).map((x, i) => x - a[i]);

export function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * (i / (n - 1)));
  return out;
}

/** numpy.interp: piecewise-linear interpolation of (xp, fp) at each xs; xp ascending, ends clamped. */
export function interp(xs: number[], xp: number[], fp: number[]): number[] {
  return xs.map((x) => {
    if (x <= xp[0]) return fp[0];
    if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
    let i = 1;
    while (i < xp.length && xp[i] < x) i++;
    const t = (x - xp[i - 1]) / (xp[i] - xp[i - 1]);
    return fp[i - 1] + t * (fp[i] - fp[i - 1]);
  });
}

/** Least-squares line (numpy.polyfit deg 1) -> [slope, intercept]. */
export function linfit(xs: number[], ys: number[]): [number, number] {
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const m = den === 0 ? 0 : num / den;
  return [m, my - m * mx];
}

/** Pearson correlation coefficient (numpy.corrcoef[0,1]). */
export function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d === 0 ? 0 : sxy / d;
}

export const round = (x: number, n: number): number => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};
