import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Row } from '@/config/types';
import type { SeriesPoint } from '@/lib/analytics/aggregate';
import { formatCompactNum } from '@/lib/format';
import { areaPath, formatTick, linePath, niceTicks, scaleY, seriesColor } from './util';
import { ChartLegend } from './ChartFrame';
import { CategoryChartBase } from './CategoryChart';
import { DonutChartBase } from './DonutChart';
import { AsDesigned, isPercentFormat, useChartKind } from './chartKind';

export interface TrendSeries {
  id: string;
  label: string;
  /** 'line' | 'area' | 'bar' — mixing is intentional: revenue as bars with a
   *  collection-rate line over it reads better than two lines. */
  kind?: 'line' | 'area' | 'bar';
  colorIndex?: number;
  /** Plot on the right-hand axis. Use when units differ (₹ vs %). */
  axis?: 'left' | 'right';
  format?: (n: number) => string;
}

/**
 * Time-series chart. Hover moves a shared cursor across every series so values
 * at the same bucket are compared at a glance; clicking a bucket hands the
 * underlying rows back for drill-down.
 */
export function TrendChartBase({
  data, series, height = 240, onPointClick, valueFormat = formatCompactNum, smooth = false,
  legendStat = 'sum',
}: {
  data: SeriesPoint[];
  series: TrendSeries[];
  height?: number;
  onPointClick?: (p: SeriesPoint) => void;
  valueFormat?: (n: number) => string;
  smooth?: boolean;
  /**
   * What the legend figure beside each series name means.
   *
   * 'sum' is right for counts and money — the period total. It is WRONG for a
   * ratio: summing three months of a 70% valid rate reports 210%, which is not
   * a number that exists. Percentage and per-unit series must pass 'avg'.
   *
   * 'none' drops the figure entirely, leaving a colour key. Use it when the
   * chart is a comparison between series and the legend only needs to say
   * which colour is which — a restated total there competes with the KPI
   * cards for attention without adding anything.
   */
  legendStat?: 'sum' | 'avg' | 'none';
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const live = series.filter(s => !hidden.has(s.id));
  const showLabels = height >= 300;
  const W = 800, PAD = { t: showLabels ? 22 : 10, r: 46, b: 28, l: 52 };
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;

  const { leftTicks, rightTicks, lMax, rMax, hasRight } = useMemo(() => {
    const l = live.filter(s => s.axis !== 'right');
    const r = live.filter(s => s.axis === 'right');
    const maxOf = (ss: TrendSeries[]) =>
      Math.max(0, ...data.flatMap(d => ss.map(s => d.values[s.id] ?? 0)));
    const lm = maxOf(l) || 1, rm = maxOf(r) || 1;
    return {
      leftTicks: niceTicks(0, lm), rightTicks: niceTicks(0, rm),
      lMax: niceTicks(0, lm).at(-1) ?? 1, rMax: niceTicks(0, rm).at(-1) ?? 1,
      hasRight: r.length > 0,
    };
  }, [data, live]);

  const barSeries = live.filter(s => s.kind === 'bar');
  const bandW = data.length ? iw / data.length : iw;
  const xLine = (i: number) => (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const xBand = (i: number) => (i + 0.5) * bandW;
  const x = barSeries.length ? xBand : xLine;
  const yFor = (s: TrendSeries, v: number) => scaleY(v, 0, s.axis === 'right' ? rMax : lMax, ih);
  const groupW = Math.min(bandW * 0.72, 28 * Math.max(1, barSeries.length));
  const barW = Math.max(2, groupW / Math.max(1, barSeries.length));

  const move = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * iw;
    const i = barSeries.length
      ? Math.max(0, Math.min(data.length - 1, Math.floor((rel / iw) * data.length)))
      : Math.max(0, Math.min(data.length - 1, Math.round((rel / iw) * (data.length - 1))));
    setHover(i);
    setTip({ x: e.clientX, y: r.top });
  };

  const legend = series.map((s, i) => ({
    id: s.id, label: s.label, color: seriesColor(s.colorIndex ?? i),
    total: legendStat === 'none' ? undefined : valueFormat(
      legendStat === 'avg' && data.length
        ? data.reduce((a, d) => a + (d.values[s.id] ?? 0), 0) / data.length
        : data.reduce((a, d) => a + (d.values[s.id] ?? 0), 0)),
  }));

  const hp = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img"
        aria-label={`Trend chart: ${series.map(s => s.label).join(', ')}`}>
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          <g className="chart__grid">
            {leftTicks.map(t => (
              <line key={t} x1={0} x2={iw} y1={scaleY(t, 0, lMax, ih)} y2={scaleY(t, 0, lMax, ih)} />
            ))}
          </g>
          <g className="chart__axis">
            {leftTicks.map(t => (
              <text key={t} x={-8} y={scaleY(t, 0, lMax, ih) + 3.5} textAnchor="end">{formatTick(t, leftTicks, formatCompactNum)}</text>
            ))}
            {hasRight && rightTicks.map(t => (
              <text key={t} x={iw + 8} y={scaleY(t, 0, rMax, ih) + 3.5} textAnchor="start">{formatTick(t, rightTicks, formatCompactNum)}</text>
            ))}
            {data.map((d, i) => {
              const every = data.length <= 14 ? 1 : Math.ceil(data.length / 12);
              return i % every === 0 || i === data.length - 1
                ? <text key={d.key} x={x(i)} y={ih + 16} textAnchor="middle">{d.label}</text> : null;
            })}
            <line x1={0} x2={iw} y1={ih} y2={ih} />
          </g>

          {barSeries.map((s, si) => (
            <g key={s.id}>
              {data.map((d, i) => {
                const v = d.values[s.id] ?? 0;
                const y = yFor(s, v);
                const off = x(i) - (barW * barSeries.length) / 2 + si * barW;
                return (
                  <rect key={d.key} className="chart__bar" x={off} y={y} width={barW - 1}
                    height={Math.max(0, ih - y)} rx={1.5}
                    fill={seriesColor(s.colorIndex ?? series.indexOf(s))}
                    opacity={hover === null || hover === i ? 0.9 : 0.42}
                    onClick={() => onPointClick?.(d)} />
                );
              })}
            </g>
          ))}

          {live.filter(s => s.kind !== 'bar').map(s => {
            const pts = data.map((d, i) => [x(i), yFor(s, d.values[s.id] ?? 0)] as [number, number]);
            const c = seriesColor(s.colorIndex ?? series.indexOf(s));
            return (
              <g key={s.id}>
                {s.kind === 'area' && (
                  <path className="chart__area" d={areaPath(pts, ih, smooth)} fill={c} opacity={0.2} />
                )}
                <path className="chart__line" d={linePath(pts, smooth)} stroke={c} />
                {data.map((d, i) => (
                  <circle key={d.key} cx={x(i)} cy={pts[i][1]} r={showLabels ? 3.2 : 2.4} fill={c} />
                ))}
                {showLabels && live.filter(x => x.kind !== 'bar').length <= 2 && data.map((d, i) => (
                  <text key={`lb-${s.id}-${d.key}`} x={x(i)} y={pts[i][1] - 8} textAnchor="middle"
                    style={{ fontSize: 9, fontWeight: 650, fill: 'var(--ink-800)' }}>
                    {valueFormat(d.values[s.id] ?? 0)}
                  </text>
                ))}
              </g>
            );
          })}

          {hover !== null && (
            <g>
              <line className="chart__cursor" x1={x(hover)} x2={x(hover)} y1={0} y2={ih} />
              {live.filter(s => s.kind !== 'bar').map(s => (
                <circle key={s.id} className="chart__dot" cx={x(hover)}
                  cy={yFor(s, data[hover].values[s.id] ?? 0)} r={3.5}
                  fill={seriesColor(s.colorIndex ?? series.indexOf(s))} />
              ))}
            </g>
          )}

          <rect className="chart__hit" x={0} y={0} width={iw} height={ih}
            onMouseMove={move} onMouseLeave={() => { setHover(null); setTip(null); }}
            onClick={() => hp && onPointClick?.(hp)} />
        </g>
      </svg>

      {tip && hp && createPortal(
        <div className="tip ctip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 200), top: tip.y + 12 }}>
          <div className="ctip__hd">{hp.label}</div>
          {live.map(s => (
            <div className="ctip__row" key={s.id}>
              <span className="ctip__sw" style={{ background: seriesColor(s.colorIndex ?? series.indexOf(s)) }} />
              {s.label}
              <span className="ctip__v">{(s.format ?? valueFormat)(hp.values[s.id] ?? 0)}</span>
            </div>
          ))}
          {onPointClick && <div className="ctip__hint">Click to open these {hp.rows.length} records</div>}
        </div>, document.body)}

      <ChartLegend series={legend} hidden={hidden}
        onToggle={id => setHidden(h => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
    </div>
  );
}

export type { Row };

type TrendProps = Parameters<typeof TrendChartBase>[0] & {
  /** Pie only: whether the centre may show a total. Defaults to yes unless the
   *  series is a percentage or an average, where a total means nothing. */
  pieTotal?: boolean;
};

/**
 * TrendChart as placed on a page. Draws as designed unless the page's chart
 * type says otherwise, then re-plots the same points in that form.
 */
export function TrendChart({ pieTotal, ...props }: TrendProps) {
  const kind = useChartKind();
  if (kind === 'default') return <TrendChartBase {...props} />;

  const { data, series, height = 240, onPointClick, valueFormat = formatCompactNum, legendStat = 'sum' } = props;
  const additive = pieTotal ?? (legendStat !== 'avg' && !isPercentFormat(valueFormat));
  const mixedAxes = series.some(s => s.axis === 'right');
  const allBars = <TrendChartBase {...props} series={series.map(s => ({ ...s, kind: 'bar' as const }))} />;

  if (kind === 'bar' || kind === 'line' || kind === 'area') {
    return <TrendChartBase {...props} series={series.map(s => ({ ...s, kind }))} />;
  }

  const one = series.length === 1 ? series[0] : null;
  const byLabel = new Map(data.map(p => [p.label, p]));

  if (kind === 'hbar') {
    if (!one) return allBars;               // several series: grouped bars read best
    return (
      <AsDesigned>
        <CategoryChartBase height={height} orientation="horizontal" maxBars={24}
          valueFormat={one.format ?? valueFormat} valueLabel={one.label} colorIndex={one.colorIndex ?? 0}
          data={data.map(p => ({ key: p.label, value: p.values[one.id] ?? 0, count: p.rows.length, rows: p.rows }))}
          onBarClick={onPointClick ? d => { const p = byLabel.get(d.key); if (p) onPointClick(p); } : undefined} />
      </AsDesigned>
    );
  }

  // pie
  if (one) {
    const fmt = one.format ?? valueFormat;
    const showTotal = additive && !isPercentFormat(fmt);
    return (
      <AsDesigned>
        <DonutChartBase height={Math.min(height, 220)} valueFormat={fmt} maxSlices={12}
          showTotal={showTotal} centerLabel={showTotal ? one.label : 'periods'}
          data={data.filter(p => (p.values[one.id] ?? 0) > 0)
            .map(p => ({ key: p.label, value: p.values[one.id] ?? 0, count: p.rows.length, rows: p.rows }))}
          onSliceClick={onPointClick ? sl => { const p = byLabel.get(sl.key); if (p) onPointClick(p); } : undefined} />
      </AsDesigned>
    );
  }
  // Several series share a pie only when they are amounts in one unit: then
  // each slice is that series' total for the period.
  if (!additive || mixedAxes) return allBars;
  const allRows = data.flatMap(p => p.rows);
  const slices = series.map(s => ({
    key: s.label, value: data.reduce((a, p) => a + (p.values[s.id] ?? 0), 0),
    count: allRows.length, rows: allRows, id: s.id,
  })).filter(sl => sl.value > 0);
  return (
    <AsDesigned>
      <DonutChartBase height={Math.min(height, 220)} valueFormat={valueFormat} maxSlices={12}
        centerLabel="Total" data={slices}
        onSliceClick={onPointClick ? sl => onPointClick({
          key: sl.key, label: sl.key, values: { [sl.key]: sl.value }, rows: sl.rows,
        }) : undefined} />
    </AsDesigned>
  );
}
