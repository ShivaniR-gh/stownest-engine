import { parseDate } from '@/lib/format';

/** Same period list B2B uses: rolling windows, YTD, then individual months. */
export const WINDOW_PRESETS = [
  { id: '3m', label: 'Last 3 Months', count: 3 },
  { id: '6m', label: 'Last 6 Months', count: 6 },
  { id: '12m', label: 'Last 12 Months', count: 12 },
] as const;

export type WindowId = typeof WINDOW_PRESETS[number]['id'];

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** "Readings AUG 2026" → the first of that month, or null if it does not
 *  parse. Lets a window be anchored on a real month rather than on today. */
export function tabMonthDate(tab: string): Date | null {
  const m = /([A-Z]{3})\s+(\d{4})$/.exec(tab.trim().toUpperCase());
  if (!m) return null;
  const i = MON.indexOf(m[1] as typeof MON[number]);
  return i < 0 ? null : new Date(Number(m[2]), i, 1);
}

export function isWindowId(v: string): v is WindowId {
  return v === '3m' || v === '6m' || v === '12m';
}

export function windowCount(v: string): number {
  return WINDOW_PRESETS.find(p => p.id === v)?.count ?? 1;
}

export function monthKey(v: unknown): string {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
}

export function monthLabel(v: unknown): string {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
}

/** Tab names newest-first, matching api/_lib/months.ts ("Readings AUG 2026"). */
export function windowTabNames(prefix: string, count: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${prefix} ${MON[d.getMonth()]} ${d.getFullYear()}`);
  }
  return out;
}

/**
 * `allNewestFirst` is yyyy-mm keys newest first.
 * `period` is 3m/6m/12m, ytd-YYYY, or a yyyy-mm key.
 */
export function keysInWindow(allNewestFirst: string[], period: string): string[] {
  if (period === '3m') return allNewestFirst.slice(0, 3);
  if (period === '6m') return allNewestFirst.slice(0, 6);
  if (period === '12m') return allNewestFirst.slice(0, 12);
  if (period.startsWith('ytd-')) {
    const y = period.slice(4);
    return allNewestFirst.filter(k => k.startsWith(y));
  }
  return allNewestFirst.filter(k => k === period);
}

export function ytdOptions(keysNewestFirst: string[]): { id: string; label: string }[] {
  const years = [...new Set(keysNewestFirst.map(k => k.slice(0, 4)).filter(Boolean))];
  return years.sort((a, b) => b.localeCompare(a)).map(y => ({ id: `ytd-${y}`, label: `YTD ${y}` }));
}

/**
 * The period a dashboard opens on: last calendar month.
 *
 * Resolved against the data rather than the clock alone. If last month has a
 * row, that is the default. If it does not — a sheet that lags, or one only
 * filled to an earlier month — the newest month actually present is used, so
 * a dashboard never opens on an empty window. Falls back to the rolling
 * 12-month view when there are no months at all.
 *
 * `keysNewestFirst` is yyyy-mm keys, newest first.
 */
export function defaultMonthPeriod(keysNewestFirst: string[], today = new Date()): string {
  if (!keysNewestFirst.length) return '12m';
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const key = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  return keysNewestFirst.includes(key) ? key : keysNewestFirst[0];
}
