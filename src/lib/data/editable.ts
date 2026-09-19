import { parseDate } from '@/lib/format';

const monthKey = (v: unknown): string => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};

export function latestMonthKey(
  rows: ReadonlyArray<object | undefined | null> | undefined,
): string {
  let best = '';
  for (const r of rows ?? []) {
    const k = monthKey((r as { month?: unknown } | undefined | null)?.month);
    if (k > best) best = k;
  }
  return best;
}

/**
 * Only the newest month stored in this dataset can be edited or deleted.
 * Add October and October becomes the open month; July–September lock.
 */
export function isMonthOpen(
  month: unknown,
  peers?: ReadonlyArray<object | undefined | null>,
): boolean {
  const k = monthKey(month);
  const latest = latestMonthKey(peers);
  return !!k && !!latest && k === latest;
}

export function isRowOpen(
  row: { [k: string]: unknown } | undefined | null,
  peers?: ReadonlyArray<object | undefined | null>,
): boolean {
  return row ? isMonthOpen(row.month, peers) : false;
}
