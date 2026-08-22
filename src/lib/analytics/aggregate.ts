import type { Row } from '@/config/types';
import { parseDate, toNum } from '@/lib/format';
import { bucketFor, inPeriod, type Period } from './period';

export const sumBy = (rows: Row[], key: string) =>
  rows.reduce((a, r) => a + (toNum(r[key]) ?? 0), 0);

export const avgBy = (rows: Row[], key: string) => (rows.length ? sumBy(rows, key) / rows.length : 0);

export type Agg = 'sum' | 'count' | 'avg';

/** Group rows by a column and aggregate, sorted by value descending. */
export function groupBy(
  rows: Row[],
  dimension: string,
  opts: { agg?: Agg; measure?: string; limit?: number; emptyLabel?: string } = {},
): { key: string; value: number; count: number; rows: Row[] }[] {
  const { agg = 'count', measure, limit, emptyLabel = 'Unspecified' } = opts;
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[dimension] ?? '').trim() || emptyLabel;
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  const out = [...map.entries()].map(([key, rs]) => ({
    key,
    count: rs.length,
    rows: rs,
    value: agg === 'count' ? rs.length : agg === 'sum' ? sumBy(rs, measure!) : avgBy(rs, measure!),
  }));
  out.sort((a, b) => b.value - a.value);
  return limit ? out.slice(0, limit) : out;
}

const bucketKey = (d: Date, b: 'day' | 'week' | 'month'): string => {
  if (b === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (b === 'week') {
    const s = new Date(d); s.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const bucketLabel = (key: string, b: 'day' | 'week' | 'month'): string => {
  const parts = key.split('-').map(Number);
  if (b === 'month') return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export interface SeriesPoint { key: string; label: string; values: Record<string, number>; rows: Row[] }

/**
 * Time series with EXPLICIT ZERO-FILL of empty buckets. A month with no
 * invoices must plot at zero, not be skipped — a gap would make a flat line
 * look like growth.
 */
export function timeSeries(
  rows: Row[],
  dateKey: string,
  period: Period,
  measures: { id: string; agg: Agg; measure?: string; filter?: (r: Row) => boolean }[],
  bucket = bucketFor(period),
): SeriesPoint[] {
  const buckets = new Map<string, Row[]>();

  // Seed every bucket in range so gaps render as zero.
  if (period.from && period.to) {
    const cur = new Date(period.from);
    if (bucket === 'month') cur.setDate(1);
    if (bucket === 'week') cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
    let guard = 0;
    while (cur <= period.to && guard++ < 400) {
      buckets.set(bucketKey(cur, bucket), []);
      if (bucket === 'month') cur.setMonth(cur.getMonth() + 1);
      else cur.setDate(cur.getDate() + (bucket === 'week' ? 7 : 1));
    }
  }

  for (const r of rows) {
    const d = parseDate(r[dateKey]);
    if (!d || !inPeriod(d, period)) continue;
    const k = bucketKey(d, bucket);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rs]) => ({
      key,
      label: bucketLabel(key, bucket),
      rows: rs,
      values: Object.fromEntries(measures.map(m => {
        const set = m.filter ? rs.filter(m.filter) : rs;
        return [m.id, m.agg === 'count' ? set.length : m.agg === 'sum' ? sumBy(set, m.measure!) : avgBy(set, m.measure!)];
      })),
    }));
}

/** Ageing buckets for receivables. Days are measured from the due date. */
export function ageingBuckets(
  rows: Row[],
  dueKey: string,
  amountKey: string,
  paidKey: string,
): { key: string; value: number; count: number; rows: Row[] }[] {
  const defs = [
    { key: 'Not due', lo: -Infinity, hi: 0 },
    { key: '1–30 days', lo: 0, hi: 30 },
    { key: '31–60 days', lo: 30, hi: 60 },
    { key: '61–90 days', lo: 60, hi: 90 },
    { key: '90+ days', lo: 90, hi: Infinity },
  ];
  const out = defs.map(d => ({ key: d.key, value: 0, count: 0, rows: [] as Row[] }));
  const today = Date.now();

  for (const r of rows) {
    const due = parseDate(r[dueKey]);
    if (!due) continue;
    const bal = (toNum(r[amountKey]) ?? 0) - (toNum(r[paidKey]) ?? 0);
    if (bal <= 0) continue;
    const age = (today - due.getTime()) / 86400000;
    const i = defs.findIndex(d => age > d.lo && age <= d.hi);
    const slot = out[i < 0 ? 0 : i];
    slot.value += bal; slot.count += 1; slot.rows.push(r);
  }
  return out;
}

/** Rows × two dimensions, for the heatmap. */
export function crosstab(
  rows: Row[], rowDim: string, colDim: string,
  opts: { agg?: Agg; measure?: string } = {},
) {
  const { agg = 'count', measure } = opts;
  const rowKeys = [...new Set(rows.map(r => String(r[rowDim] ?? '—')))].sort();
  const colKeys = [...new Set(rows.map(r => String(r[colDim] ?? '—')))].sort();
  const cells = rowKeys.map(rk =>
    colKeys.map(ck => {
      const set = rows.filter(r => String(r[rowDim] ?? '—') === rk && String(r[colDim] ?? '—') === ck);
      return { rowKey: rk, colKey: ck, rows: set,
        value: agg === 'count' ? set.length : agg === 'sum' ? sumBy(set, measure!) : avgBy(set, measure!) };
    }),
  );
  return { rowKeys, colKeys, cells };
}

export const pctChange = (cur: number, prev: number): number | null =>
  prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;
