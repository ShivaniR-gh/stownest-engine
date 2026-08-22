import { areaPath, linePath } from './util';

/** Bare trend shape inside a metric card. No axes by design — this shows
 *  direction, and the card's own value carries the magnitude. */
export function Sparkline({ values, tone = 'var(--accent)', height = 26 }: {
  values: number[]; tone?: string; height?: number;
}) {
  if (values.length < 2) return null;
  const W = 120, min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    height - 2 - ((v - min) / span) * (height - 4),
  ] as [number, number]);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="metric__spark" aria-hidden="true">
      <path d={areaPath(pts, height, true)} fill={tone} opacity={0.1} />
      <path d={linePath(pts, true)} fill="none" stroke={tone} strokeWidth={1.4}
        strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
