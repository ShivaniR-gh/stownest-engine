import type { MetricDef, Row } from '@/config/types';
import { getDataset, isMapped } from '@/config/datasets';
import { formatMetric } from '@/lib/format';
import { pctChange } from './aggregate';

export type MetricStatus = 'ok' | 'unmapped' | 'no_rows' | 'undefined_math' | 'no_access';

export interface ResolvedMetric {
  def: MetricDef;
  status: MetricStatus;
  value: number | null;
  display: string;
  /** Percent change vs the previous equal-length window. */
  delta: number | null;
  deltaTone: 'pos' | 'neg' | 'flat';
  /** Fully-qualified `dataset.column` names the metric needs but cannot read. */
  missing: string[];
  /** Sheet tabs actually read to produce this number. */
  sources: string[];
  reason: string;
}

/**
 * The honesty layer.
 *
 * A metric produces a number ONLY when every column it declares is mapped and
 * the arithmetic is defined. Otherwise it reports why, naming the exact missing
 * column. There is no default of zero and no estimation — a zero here would be
 * indistinguishable from a real zero, which is how dashboards start lying.
 */
export function resolveMetric(
  def: MetricDef,
  rows: Row[],
  prevRows: Row[],
  related: Record<string, Row[]> = {},
  /**
   * Datasets that failed to load — permission denied, network error, or never
   * fetched. Without this, SUM over an empty array returns a finite 0 and the
   * card renders "₹0", which is indistinguishable from a genuine zero. A user
   * who cannot see finance data must never be told revenue is zero.
   */
  unavailable: Set<string> = new Set(),
): ResolvedMetric {
  const ds = getDataset(def.dataset);

  const missing = [
    ...def.requires
      .filter(c => !isMapped(def.dataset, c))
      .map(c => `${def.dataset}.${c}`),
    ...Object.entries(def.requiresFrom ?? {}).flatMap(([dsId, cols]) =>
      cols.filter(c => !isMapped(dsId, c)).map(c => `${dsId}.${c}`)),
  ];

  const sources = [ds?.sheetName, ...(def.requiresDatasets ?? []).map(d => getDataset(d)?.sheetName)]
    .filter((s): s is string => Boolean(s));

  const base = { def, missing, sources, delta: null, deltaTone: 'flat' as const };

  const blocked = [def.dataset, ...(def.requiresDatasets ?? [])].filter(d => unavailable.has(d));
  if (blocked.length) {
    return { ...base, status: 'no_access', value: null, display: 'Not available',
      reason: `This metric reads ${blocked.join(', ')}, which could not be loaded for your account.` };
  }

  if (missing.length) {
    return { ...base, status: 'unmapped', value: null, display: 'Data unavailable',
      reason: `Not computed — ${missing.length === 1 ? 'column' : 'columns'} not mapped to the sheet.` };
  }

  const mapped = (dataset: string, col: string) => isMapped(dataset, col);
  const value = def.compute({ rows, prevRows, related, mapped });

  if (value === null || !Number.isFinite(value)) {
    return { ...base, status: rows.length === 0 ? 'no_rows' : 'undefined_math', value: null,
      display: rows.length === 0 ? 'No records' : 'Insufficient data',
      reason: rows.length === 0
        ? 'No rows fall inside the selected period and filters.'
        : 'The denominator is zero for this selection, so the ratio is undefined.' };
  }

  const prev = prevRows.length || rows.length
    ? def.compute({ rows: prevRows, prevRows: [], related, mapped })
    : null;

  const delta = prev !== null && Number.isFinite(prev) ? pctChange(value, prev) : null;
  const dir = def.goodDirection ?? 'up';
  const deltaTone: 'pos' | 'neg' | 'flat' =
    delta === null || Math.abs(delta) < 0.05 || dir === 'neutral' ? 'flat'
      : (delta > 0) === (dir === 'up') ? 'pos' : 'neg';

  return {
    ...base, status: 'ok', value, delta, deltaTone,
    display: formatMetric(value, def.format),
    reason: def.definition,
  };
}
