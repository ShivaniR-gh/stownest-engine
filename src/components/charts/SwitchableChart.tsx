import { useCallback, useState, type ReactNode } from 'react';
import type { Row } from '@/config/types';
import type { SeriesPoint } from '@/lib/analytics/aggregate';
import { formatCompactNum } from '@/lib/format';
import { TrendChart } from './TrendChart';
import { CategoryChart } from './CategoryChart';
import { DonutChart } from './DonutChart';

/** ---------------------------------------------------------------------------
 * Viewer-chosen chart type.
 *
 * 'default' is whatever the dashboard designed for that chart and is what
 * everyone sees until they pick something else. The other kinds re-plot the
 * SAME single series, so switching never changes the numbers — only the shape.
 * ------------------------------------------------------------------------- */
export type ChartKind = 'default' | 'bar' | 'hbar' | 'line' | 'area' | 'pie';

export const CHART_KINDS: { id: ChartKind; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'bar', label: 'Bar' },
  { id: 'hbar', label: 'Horizontal bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
];

const isKind = (v: unknown): v is ChartKind => CHART_KINDS.some(k => k.id === v);

/** Per-chart choices for one dashboard, remembered in this browser so a
 *  viewer who prefers bars does not have to re-pick them on every visit.
 *  Storage can be blocked or full; that only means the choice is not kept. */
export function useChartKinds(scope: string) {
  const storeKey = `chartKinds:${scope}`;
  const [kinds, setKinds] = useState<Record<string, ChartKind>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, unknown>;
      return Object.fromEntries(Object.entries(raw).filter(([, v]) => isKind(v))) as Record<string, ChartKind>;
    } catch { return {}; }
  });

  const kindOf = useCallback((id: string): ChartKind => kinds[id] ?? 'default', [kinds]);

  const setKind = useCallback((id: string, kind: ChartKind) => {
    setKinds(prev => {
      const next = { ...prev };
      if (kind === 'default') delete next[id]; else next[id] = kind;
      try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* not kept */ }
      return next;
    });
  }, [storeKey]);

  return { kindOf, setKind };
}

/** Compact dropdown for a ChartFrame's `actions` slot. */
export function ChartKindSelect({ value, onChange }: { value: ChartKind; onChange: (k: ChartKind) => void }) {
  return (
    <select className="chartkind" value={value} aria-label="Chart type"
      title="Chart type" data-on={value !== 'default' || undefined}
      onChange={e => onChange(e.target.value as ChartKind)}>
      {CHART_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
    </select>
  );
}

export interface SwitchDatum { key: string; label: string; value: number; rows: Row[] }

const short = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Renders one series in the chosen kind. `renderDefault` is the dashboard's
 * own chart, untouched, so 'default' looks exactly as it did before.
 *
 * `isRatio` matters for pie: slices of a percentage (or a per-customer
 * average) do not add up to anything, so the centre shows how many slices
 * there are instead of a meaningless total.
 */
export function SwitchableChart({
  kind, data, height, renderDefault, seriesLabel, valueFormat = formatCompactNum,
  colorIndex = 0, isRatio = false, countNoun = 'items', maxBars = 12, onSelect,
}: {
  kind: ChartKind;
  data: SwitchDatum[];
  height: number;
  renderDefault: () => ReactNode;
  seriesLabel: string;
  valueFormat?: (n: number) => string;
  colorIndex?: number;
  isRatio?: boolean;
  /** Plural noun for the pie centre when isRatio, e.g. "months" or "sites". */
  countNoun?: string;
  maxBars?: number;
  onSelect?: (d: SwitchDatum) => void;
}) {
  if (kind === 'default') return <>{renderDefault()}</>;

  const byKey = new Map(data.map(d => [d.key, d]));
  const byLabel = new Map(data.map(d => [d.label, d]));

  if (kind === 'bar' || kind === 'line' || kind === 'area') {
    const points: SeriesPoint[] = data.slice(0, kind === 'bar' ? maxBars : undefined).map(d => ({
      key: d.key, label: short(d.label), values: { v: d.value }, rows: d.rows,
    }));
    return (
      <TrendChart height={height} data={points} valueFormat={valueFormat} legendStat="none"
        series={[{ id: 'v', label: seriesLabel, kind, colorIndex }]}
        onPointClick={p => { const d = byKey.get(p.key); if (d) onSelect?.(d); }} />
    );
  }

  if (kind === 'hbar') {
    return (
      <CategoryChart height={height} maxBars={maxBars} valueFormat={valueFormat}
        valueLabel={seriesLabel} colorIndex={colorIndex}
        data={data.map(d => ({ key: d.label, value: d.value, count: d.rows.length, rows: d.rows }))}
        onBarClick={c => { const d = byLabel.get(c.key); if (d) onSelect?.(d); }} />
    );
  }

  // pie
  return (
    <DonutChart height={height} valueFormat={valueFormat} maxSlices={12}
      showTotal={!isRatio} centerLabel={isRatio ? countNoun : seriesLabel}
      data={data.filter(d => d.value > 0)
        .map(d => ({ key: d.label, value: d.value, count: d.rows.length, rows: d.rows }))}
      onSliceClick={s => { const d = byLabel.get(s.key); if (d) onSelect?.(d); }} />
  );
}
