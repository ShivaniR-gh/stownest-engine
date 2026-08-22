import type { DatasetDef, Row } from '@/config/types';
import { inPeriod, type Period } from './period';
import { parseDate } from '@/lib/format';

export type FilterMap = Record<string, string[]>;

/** Filter keys shared across datasets. A city filter set on the Overview screen
 *  applies to leads, jobs, invoices and expenses alike, because they all carry
 *  a `city` column. Datasets without the column are simply unaffected. */
export const GLOBAL_FILTER_KEYS = [
  'city', 'facility', 'status', 'payment_status', 'source', 'category',
  'vendor', 'owner', 'assignee', 'service', 'revenue_line', 'department', 'direction',
] as const;

export function applyFilters(rows: Row[], filters: FilterMap, ds: DatasetDef): Row[] {
  const active = Object.entries(filters).filter(([, v]) => v.length > 0);
  if (!active.length) return rows;
  const cols = new Set(ds.columns.filter(c => c.sheetColumn).map(c => c.key));

  return rows.filter(r =>
    active.every(([k, vals]) => {
      if (!cols.has(k)) return true; // dataset does not carry this dimension
      return vals.includes(String(r[k] ?? '').trim());
    }),
  );
}

export function applyPeriod(rows: Row[], ds: DatasetDef, period: Period): Row[] {
  // All time keeps everything, including rows whose date cannot be read.
  if (!ds.dateColumn || !period.from) return rows;
  return rows.filter(r => inPeriod(r[ds.dateColumn!], period));
}

export interface PeriodDiagnostics {
  total: number;
  readable: number;
  unreadable: number;
  inPeriod: number;
  dateColumnHeader: string | null;
  /** Plain-English reason the table is empty, or null when it is not. */
  emptyReason: string | null;
}

/**
 * Explains an empty table instead of blaming the date range.
 *
 * A row whose date cannot be parsed is excluded from a period — it has to be —
 * but staying silent about it makes a mis-mapped date column look like an empty
 * sheet. This reports exactly how many rows exist and why none are showing.
 */
export function describePeriod(all: Row[], ds: DatasetDef, period: Period): PeriodDiagnostics {
  const col = ds.dateColumn ? ds.columns.find(c => c.key === ds.dateColumn) : undefined;
  const header = col?.header ?? ds.dateColumn ?? null;

  if (!ds.dateColumn || !period.from) {
    return { total: all.length, readable: all.length, unreadable: 0, inPeriod: all.length,
      dateColumnHeader: header, emptyReason: all.length ? null : 'This sheet has no rows yet.' };
  }

  let readable = 0, within = 0;
  for (const r of all) {
    const d = parseDate(r[ds.dateColumn]);
    if (!d) continue;
    readable++;
    if (inPeriod(d, period)) within++;
  }
  const unreadable = all.length - readable;

  let emptyReason: string | null = null;
  if (within === 0 && all.length > 0) {
    emptyReason = unreadable === all.length
      ? `${all.length} rows exist, but none have a date StowNest could read from “${header}”. Check that column, or set the dataset's date column to None.`
      : unreadable > 0
        ? `${all.length} rows exist. ${within} fall inside this period, and ${unreadable} have a date StowNest could not read from “${header}”.`
        : `${all.length} rows exist, but none fall inside this period. Try All time.`;
  }

  return { total: all.length, readable, unreadable, inPeriod: within, dateColumnHeader: header, emptyReason };
}

export function applySearch(rows: Row[], q: string, ds: DatasetDef): Row[] {
  const term = q.trim().toLowerCase();
  if (!term) return rows;
  const keys = ds.columns.filter(c => c.sheetColumn).map(c => c.key);
  return rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(term)));
}

/** Distinct values for a column, for the filter menus. */
export function optionsFor(rows: Row[], key: string, limit = 60): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = String(r[key] ?? '').trim();
    if (v) set.add(v);
    if (set.size > limit) break;
  }
  return [...set].sort();
}

export const countActive = (f: FilterMap) =>
  Object.values(f).reduce((a, v) => a + (v.length ? 1 : 0), 0);
