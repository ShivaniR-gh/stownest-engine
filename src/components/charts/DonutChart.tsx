import { useState } from 'react';
import type { Row } from '@/config/types';
import { formatCompactNum } from '@/lib/format';
import { arcPath, seriesColor } from './util';
import { TrendChartBase } from './TrendChart';
import { CategoryChartBase } from './CategoryChart';
import { AsDesigned, shortLabel, useChartKind } from './chartKind';

export interface Slice { key: string; value: number; count: number; rows: Row[] }

/**
 * Part-to-whole only. If the slices don't sum to a meaningful total, or there
 * are more than about seven of them, this is the wrong chart — use
 * CategoryChart instead.
 */
export function DonutChartBase({
  data, total, height = 200, valueFormat = formatCompactNum, onSliceClick, centerLabel = 'Total', maxSlices = 7, showTotal = true,
}: {
  data: Slice[];
  total?: number;
  height?: number;
  valueFormat?: (n: number) => string;
  onSliceClick?: (s: Slice) => void;
  centerLabel?: string;
  maxSlices?: number;
  /** False when slices are ratios that do not sum to anything meaningful:
   *  the centre then shows the slice count instead of a total. */
  showTotal?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);

  // Everything past maxSlices becomes an explicit "Other" slice rather than
  // being dropped — a donut that doesn't sum to 100% is a broken donut.
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);
  const slices: Slice[] = tail.length
    ? [...head, { key: `Other (${tail.length})`, value: tail.reduce((a, s) => a + s.value, 0),
        count: tail.reduce((a, s) => a + s.count, 0), rows: tail.flatMap(s => s.rows) }]
    : head;

  const live = slices.filter(s => !hidden.has(s.key));
  const sum = live.reduce((a, s) => a + s.value, 0);
  const shown = total ?? sum;

  const size = height, cx = size / 2, cy = size / 2;
  const r = size / 2 - 4, ri = r * 0.63;

  let angle = -Math.PI / 2;
  const arcs = live.map((s, i) => {
    const frac = sum === 0 ? 0 : s.value / sum;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    return { s, a0, a1, color: seriesColor(slices.findIndex(x => x.key === s.key)), i };
  });

  return (
    <div className="donut__wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Composition">
        {arcs.map(({ s, a0, a1, color }) => (
          <path key={s.key} className="donut__arc" d={arcPath(cx, cy, r, ri, a0, Math.max(a1, a0 + 0.001))}
            fill={color} opacity={hover === null || hover === s.key ? 1 : 0.32}
            onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
            onClick={() => onSliceClick?.(s)}>
            <title>{`${s.key}: ${valueFormat(s.value)} (${sum ? ((s.value / sum) * 100).toFixed(1) : '0'}%)`}</title>
          </path>
        ))}
        <text className="donut__center donut__total" x={cx} y={cy - 1}>
          {hover ? valueFormat(live.find(s => s.key === hover)?.value ?? 0) : showTotal ? valueFormat(shown) : live.length}
        </text>
        <text className="donut__center donut__lb" x={cx} y={cy + 15}>
          {hover ? (hover.length > 16 ? `${hover.slice(0, 15)}…` : hover) : centerLabel}
        </text>
      </svg>

      <div className="donut__list">
        {slices.map(s => {
          const pct = sum === 0 ? 0 : (s.value / sum) * 100;
          return (
            <div key={s.key} className="donut__row" data-off={hidden.has(s.key)}
              onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
              onClick={() => onSliceClick?.(s)}
              onDoubleClick={() => setHidden(h => { const n = new Set(h); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })}
              title="Click to drill in · double-click to hide">
              <span className="legend__swatch" style={{ background: seriesColor(slices.indexOf(s)) }} />
              <span className="donut__nm">{s.key}</span>
              <span className="donut__v">{valueFormat(s.value)}</span>
              <span className="donut__pc">{hidden.has(s.key) ? '—' : `${pct.toFixed(1)}%`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DonutProps = Parameters<typeof DonutChartBase>[0];

/** DonutChart as placed on a page; follows the page's chart type. */
export function DonutChart(props: DonutProps) {
  const kind = useChartKind();
  if (kind === 'default' || kind === 'pie') return <DonutChartBase {...props} />;

  const { data, height = 200, valueFormat = formatCompactNum, onSliceClick, centerLabel = 'Total' } = props;
  const h = Math.max(height, 200);
  const sorted = [...data].sort((a, b) => b.value - a.value);

  if (kind === 'bar' || kind === 'hbar') {
    return (
      <AsDesigned>
        <CategoryChartBase height={h} orientation={kind === 'bar' ? 'vertical' : 'horizontal'}
          valueFormat={valueFormat} valueLabel={centerLabel} maxBars={12}
          data={sorted} onBarClick={onSliceClick} />
      </AsDesigned>
    );
  }
  const byKey = new Map(data.map(d => [d.key, d]));
  return (
    <AsDesigned>
      <TrendChartBase height={h} valueFormat={valueFormat} legendStat="none"
        data={sorted.slice(0, 12).map(d => ({ key: d.key, label: shortLabel(d.key), values: { v: d.value }, rows: d.rows }))}
        series={[{ id: 'v', label: centerLabel, kind, colorIndex: 0 }]}
        onPointClick={onSliceClick ? p => { const d = byKey.get(p.key); if (d) onSliceClick(d); } : undefined} />
    </AsDesigned>
  );
}
