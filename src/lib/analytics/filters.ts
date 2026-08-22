import type { DatasetDef, Row } from '@/config/types';
import { inPeriod, type Period } from './period';

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
  if (!ds.dateColumn || !period.from) return rows;
  return rows.filter(r => inPeriod(r[ds.dateColumn!], period));
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
