import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Row } from '@/config/types';
import { formatCompactNum } from '@/lib/format';
import { correlation, niceTicks, scaleY, seriesColor } from './util';

export interface Point { x: number; y: number; label: string; rows: Row[] }

/**
 * Relationship between two measures.
 *
 * Prints Pearson r with an explicit caveat, and refuses to compute it below six
 * paired points. Correlation shown without sample size is how a dashboard talks
 * someone into a bad decision.
 */
export function ScatterChart({
  points, height = 260, xLabel, yLabel, xFormat = formatCompactNum, yFormat = formatCompactNum, onPointClick,
}: {
  points: Point[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xFormat?: (n: number) => string;
  yFormat?: (n: number) => string;
  onPointClick?: (p: Point) => void;
}) {
  const [tip, setTip] = useState<{ cx: number; cy: number; p: Point } | null>(null);
  const W = 800, PAD = { t: 12, r: 14, b: 40, l: 56 };
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;

  const xt = niceTicks(0, Math.max(1, ...points.map(p => p.x)));
  const yt = niceTicks(0, Math.max(1, ...points.map(p => p.y)));
  const xMax = xt.at(-1) ?? 1, yMax = yt.at(-1) ?? 1;
  const r = correlation(points.map(p => p.x), points.map(p => p.y));

  const strength = r === null ? null
    : Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'weak';

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          <g className="chart__grid">
            {yt.map(t => <line key={`y${t}`} x1={0} x2={iw} y1={scaleY(t, 0, yMax, ih)} y2={scaleY(t, 0, yMax, ih)} />)}
            {xt.map(t => <line key={`x${t}`} y1={0} y2={ih} x1={(t / xMax) * iw} x2={(t / xMax) * iw} />)}
          </g>
          <g className="chart__axis">
            {yt.map(t => <text key={t} x={-8} y={scaleY(t, 0, yMax, ih) + 3.5} textAnchor="end">{yFormat(t)}</text>)}
            {xt.map(t => <text key={t} x={(t / xMax) * iw} y={ih + 16} textAnchor="middle">{xFormat(t)}</text>)}
            <line x1={0} x2={iw} y1={ih} y2={ih} />
            <text x={iw / 2} y={ih + 33} textAnchor="middle" style={{ fontSize: 10.5 }}>{xLabel}</text>
            <text x={-42} y={-2} style={{ fontSize: 10.5 }}>{yLabel}</text>
          </g>
          {points.map((p, i) => (
            <circle key={i} cx={(p.x / xMax) * iw} cy={scaleY(p.y, 0, yMax, ih)} r={4.5}
              fill={seriesColor(0)} opacity={0.62} style={{ cursor: onPointClick ? 'pointer' : 'default' }}
              onMouseEnter={e => { const b = (e.target as SVGCircleElement).getBoundingClientRect(); setTip({ cx: b.left, cy: b.top, p }); }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onPointClick?.(p)} />
          ))}
        </g>
      </svg>

      <div className="legend" style={{ justifyContent: 'space-between' }}>
        <span className="legend__item">
          {r === null
            ? `Correlation not shown — needs at least 6 paired points, has ${points.length}.`
            : `Pearson r = ${r.toFixed(2)} (${strength}), n = ${points.length}. Association only, not cause.`}
        </span>
      </div>

      {tip && createPortal(
        <div className="tip ctip" style={{ left: tip.cx + 14, top: tip.cy - 4 }}>
          <div className="ctip__hd">{tip.p.label}</div>
          <div className="ctip__row">{xLabel}<span className="ctip__v">{xFormat(tip.p.x)}</span></div>
          <div className="ctip__row">{yLabel}<span className="ctip__v">{yFormat(tip.p.y)}</span></div>
        </div>, document.body)}
    </div>
  );
}
