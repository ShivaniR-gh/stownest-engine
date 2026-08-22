export const SERIES_VARS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
export const seriesColor = (i: number) => `var(${SERIES_VARS[i % SERIES_VARS.length]})`;

/** "Nice" axis ticks — round numbers a human would choose, always including 0. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [0, max || 1];
  const lo = Math.min(0, min);
  const span = max - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= max + step * 0.5; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

export const scaleY = (v: number, min: number, max: number, h: number) =>
  max === min ? h / 2 : h - ((v - min) / (max - min)) * h;

/** Monotone-ish smoothing. Deliberately mild — a trend line that overshoots
 *  invents movement that isn't in the data. */
export function linePath(pts: [number, number][], smooth = false): string {
  if (!pts.length) return '';
  if (!smooth || pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

export const areaPath = (pts: [number, number][], baseY: number, smooth = false) =>
  pts.length ? `${linePath(pts, smooth)} L${pts[pts.length - 1][0]},${baseY} L${pts[0][0]},${baseY} Z` : '';

export function arcPath(cx: number, cy: number, r: number, rInner: number, a0: number, a1: number): string {
  const p = (a: number, rad: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r);
  const [x2, y2] = p(a1, rInner), [x3, y3] = p(a0, rInner);
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rInner},${rInner} 0 ${large} 0 ${x3},${y3} Z`;
}

/** Pearson r. Returned only when there are enough paired points to mean
 *  anything — below 6 the coefficient is noise. */
export function correlation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 6) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d === 0 ? null : sxy / d;
}
