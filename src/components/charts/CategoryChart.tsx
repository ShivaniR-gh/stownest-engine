import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Row } from '@/config/types';
import { formatCompactNum } from '@/lib/format';
import { formatTick, niceTicks, scaleY, seriesColor } from './util';
import { TrendChartBase } from './TrendChart';
import { DonutChartBase } from './DonutChart';
import { AsDesigned, isPercentFormat, shortLabel, useChartKind } from './chartKind';

export interface CatDatum { key: string; value: number; count: number; rows: Row[] }

/** Comparison across categories. Horizontal is the default because category
 *  names are words — rotated 45° labels are a design failure, not a style. */
export function CategoryChartBase({
  data, orientation = 'horizontal', height = 240, valueFormat = formatCompactNum,
  onBarClick, colorIndex = 0, maxBars = 12, showValues = true,
  valueLabel = 'Value', showCount = false,
}: {
  data: CatDatum[];
  orientation?: 'horizontal' | 'vertical';
  height?: number;
  valueFormat?: (n: number) => string;
  onBarClick?: (d: CatDatum) => void;
  colorIndex?: number;
  maxBars?: number;
  showValues?: boolean;
  valueLabel?: string;
  showCount?: boolean;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; d: CatDatum } | null>(null);
  const rows = data.slice(0, maxBars);
  const max = Math.max(1, ...rows.map(d => d.value));
  const color = seriesColor(colorIndex);

  if (orientation === 'horizontal') {
    const barH = 24, gap = 6;
    const H = Math.max(height, rows.length * (barH + gap));
    const LABEL_W = 150, VALUE_W = 74;
    return (
      <div className="chart">
        <svg viewBox={`0 0 800 ${H}`} height={H} role="img" aria-label="Category comparison">
          {rows.map((d, i) => {
            const y = i * (barH + gap);
            const w = (d.value / max) * (800 - LABEL_W - VALUE_W);
            return (
              <g key={d.key}
                onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, d })}
                onMouseLeave={() => setTip(null)}
                onClick={() => onBarClick?.(d)}
                style={{ cursor: onBarClick ? 'pointer' : 'default' }}>
                <rect x={0} y={y} width={800} height={barH} fill="transparent" />
                <text x={LABEL_W - 10} y={y + barH / 2 + 4} textAnchor="end"
                  style={{ fontSize: 12, fill: 'var(--ink-700)' }}>
                  {d.key.length > 22 ? `${d.key.slice(0, 21)}…` : d.key}
                </text>
                <rect x={LABEL_W} y={y + 3} width={800 - LABEL_W - VALUE_W} height={barH - 6}
                  fill="var(--surface-sunk)" rx={2} />
                <rect className="chart__bar" x={LABEL_W} y={y + 3} width={Math.max(1, w)} height={barH - 6}
                  fill={color} rx={2} />
                {showValues && (
                  <text x={795} y={y + barH / 2 + 4} textAnchor="end"
                    style={{ fontSize: 12, fill: 'var(--ink-900)', fontFamily: 'var(--font-num)', fontWeight: 550 }}>
                    {valueFormat(d.value)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {tip && createPortal(
          <div className="tip ctip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 200), top: tip.y + 12 }}>
            <div className="ctip__hd">{tip.d.key}</div>
            <div className="ctip__row">{valueLabel}<span className="ctip__v">{valueFormat(tip.d.value)}</span></div>
            {showCount && <div className="ctip__row">Records<span className="ctip__v">{tip.d.count}</span></div>}
            {onBarClick && <div className="ctip__hint">Click to open these records</div>}
          </div>, document.body)}
      </div>
    );
  }

  const W = 800, PAD = { t: 10, r: 8, b: 40, l: 52 };
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const ticks = niceTicks(0, max);
  const yMax = ticks.at(-1) ?? max;
  const band = iw / Math.max(1, rows.length);
  const bw = Math.min(46, band * 0.66);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Category comparison">
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          <g className="chart__grid">
            {ticks.map(t => <line key={t} x1={0} x2={iw} y1={scaleY(t, 0, yMax, ih)} y2={scaleY(t, 0, yMax, ih)} />)}
          </g>
          <g className="chart__axis">
            {ticks.map(t => <text key={t} x={-8} y={scaleY(t, 0, yMax, ih) + 3.5} textAnchor="end">{formatTick(t, ticks, formatCompactNum)}</text>)}
            <line x1={0} x2={iw} y1={ih} y2={ih} />
          </g>
          {rows.map((d, i) => {
            const y = scaleY(d.value, 0, yMax, ih);
            const cx = i * band + band / 2;
            return (
              <g key={d.key}
                onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, d })}
                onMouseLeave={() => setTip(null)}
                onClick={() => onBarClick?.(d)}>
                <rect className="chart__bar" x={cx - bw / 2} y={y} width={bw} height={Math.max(1, ih - y)} rx={2} fill={color} />
                <text x={cx} y={ih + 15} textAnchor="middle" style={{ fontSize: 10.5, fill: 'var(--ink-400)' }}>
                  {d.key.length > 11 ? `${d.key.slice(0, 10)}…` : d.key}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {tip && createPortal(
        <div className="tip ctip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 200), top: tip.y + 12 }}>
          <div className="ctip__hd">{tip.d.key}</div>
          <div className="ctip__row">{valueLabel}<span className="ctip__v">{valueFormat(tip.d.value)}</span></div>
          {showCount && <div className="ctip__row">Records<span className="ctip__v">{tip.d.count}</span></div>}
        </div>, document.body)}
    </div>
  );
}

/** Stacked bars for composition-over-time. */
export function StackedBarChartBase({
  data, keys, labels, height = 240, valueFormat = formatCompactNum, onBarClick,
}: {
  data: { key: string; label: string; values: Record<string, number>; rows: Row[] }[];
  keys: string[];
  labels: Record<string, string>;
  height?: number;
  valueFormat?: (n: number) => string;
  onBarClick?: (d: { rows: Row[]; label: string }) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null);
  const W = 800, PAD = { t: 10, r: 8, b: 26, l: 52 };
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const totals = data.map(d => keys.reduce((a, k) => a + (d.values[k] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals));
  const yMax = ticks.at(-1) ?? 1;
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(42, band * 0.68);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Stacked composition">
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          <g className="chart__grid">
            {ticks.map(t => <line key={t} x1={0} x2={iw} y1={scaleY(t, 0, yMax, ih)} y2={scaleY(t, 0, yMax, ih)} />)}
          </g>
          <g className="chart__axis">
            {ticks.map(t => <text key={t} x={-8} y={scaleY(t, 0, yMax, ih) + 3.5} textAnchor="end">{formatTick(t, ticks, formatCompactNum)}</text>)}
            {data.map((d, i) => {
              const every = Math.ceil(data.length / 12);
              return i % every === 0 || i === data.length - 1
                ? <text key={d.key} x={i * band + band / 2} y={ih + 15} textAnchor="middle">{d.label}</text> : null;
            })}
            <line x1={0} x2={iw} y1={ih} y2={ih} />
          </g>
          {data.map((d, i) => {
            let acc = 0;
            return (
              <g key={d.key}
                onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, i })}
                onMouseLeave={() => setTip(null)}
                onClick={() => onBarClick?.({ rows: d.rows, label: d.label })}>
                {keys.map((k, ki) => {
                  const v = d.values[k] ?? 0;
                  const y0 = scaleY(acc, 0, yMax, ih);
                  acc += v;
                  const y1 = scaleY(acc, 0, yMax, ih);
                  return <rect key={k} className="chart__bar" x={i * band + (band - bw) / 2} y={y1}
                    width={bw} height={Math.max(0, y0 - y1)} fill={seriesColor(ki)} />;
                })}
              </g>
            );
          })}
        </g>
      </svg>
      {tip && createPortal(
        <div className="tip ctip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 210), top: tip.y + 12 }}>
          <div className="ctip__hd">{data[tip.i].label}</div>
          {keys.map((k, ki) => (
            <div className="ctip__row" key={k}>
              <span className="ctip__sw" style={{ background: seriesColor(ki) }} />
              {labels[k] ?? k}
              <span className="ctip__v">{valueFormat(data[tip.i].values[k] ?? 0)}</span>
            </div>
          ))}
        </div>, document.body)}
      <div className="legend">
        {keys.map((k, ki) => (
          <span className="legend__item" key={k}>
            <span className="legend__swatch" style={{ background: seriesColor(ki) }} />
            {labels[k] ?? k}
          </span>
        ))}
      </div>
    </div>
  );
}

type CatProps = Parameters<typeof CategoryChartBase>[0];

/** CategoryChart as placed on a page; follows the page's chart type. */
export function CategoryChart(props: CatProps) {
  const kind = useChartKind();
  const { data, height = 240, valueFormat = formatCompactNum, onBarClick, colorIndex = 0,
    maxBars = 12, valueLabel = 'Value' } = props;

  if (kind === 'default') return <CategoryChartBase {...props} />;
  if (kind === 'hbar') return <CategoryChartBase {...props} orientation="horizontal" />;
  if (kind === 'bar') return <CategoryChartBase {...props} orientation="vertical" />;

  const byKey = new Map(data.map(d => [d.key, d]));
  if (kind === 'line' || kind === 'area') {
    return (
      <AsDesigned>
        <TrendChartBase height={height} valueFormat={valueFormat} legendStat="none"
          data={data.slice(0, maxBars).map(d => ({ key: d.key, label: shortLabel(d.key), values: { v: d.value }, rows: d.rows }))}
          series={[{ id: 'v', label: valueLabel, kind, colorIndex }]}
          onPointClick={onBarClick ? p => { const d = byKey.get(p.key); if (d) onBarClick(d); } : undefined} />
      </AsDesigned>
    );
  }
  const showTotal = !isPercentFormat(valueFormat);
  return (
    <AsDesigned>
      <DonutChartBase height={Math.min(height, 220)} valueFormat={valueFormat} maxSlices={12}
        showTotal={showTotal} centerLabel={showTotal ? valueLabel : 'items'}
        data={data.filter(d => d.value > 0)}
        onSliceClick={onBarClick} />
    </AsDesigned>
  );
}

type StackProps = Parameters<typeof StackedBarChartBase>[0];

/** StackedBarChart as placed on a page; follows the page's chart type.
 *  Horizontal bar has no stacked form here, so it stays stacked columns. */
export function StackedBarChart(props: StackProps) {
  const kind = useChartKind();
  const { data, keys, labels, height = 240, valueFormat = formatCompactNum, onBarClick } = props;
  if (kind === 'default' || kind === 'bar' || kind === 'hbar') return <StackedBarChartBase {...props} />;

  if (kind === 'line' || kind === 'area') {
    return (
      <AsDesigned>
        <TrendChartBase height={height} valueFormat={valueFormat} data={data}
          series={keys.map((k, i) => ({ id: k, label: labels[k] ?? k, kind, colorIndex: i }))}
          onPointClick={onBarClick ? p => onBarClick({ rows: p.rows, label: p.label }) : undefined} />
      </AsDesigned>
    );
  }
  const allRows = data.flatMap(d => d.rows);
  const slices = keys.map(k => ({
    key: labels[k] ?? k, value: data.reduce((a, d) => a + (d.values[k] ?? 0), 0),
    count: allRows.length, rows: allRows,
  })).filter(sl => sl.value > 0);
  return (
    <AsDesigned>
      <DonutChartBase height={Math.min(height, 220)} valueFormat={valueFormat} maxSlices={12}
        showTotal={!isPercentFormat(valueFormat)} centerLabel="Total" data={slices}
        onSliceClick={onBarClick ? sl => onBarClick({ rows: sl.rows, label: sl.key }) : undefined} />
    </AsDesigned>
  );
}
