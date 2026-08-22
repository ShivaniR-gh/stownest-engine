import { parseDate, toISODate } from '@/lib/format';

export type PresetId =
  | 'today' | 'yesterday' | 'last7' | 'last30' | 'last90'
  | 'this_month' | 'prev_month' | 'this_quarter' | 'this_year' | 'all' | 'custom';

export interface Period { id: PresetId; label: string; from: Date | null; to: Date | null }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'prev_month', label: 'Previous month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export function resolvePeriod(id: PresetId, custom?: { from: string; to: string }): Period {
  const now = new Date();
  const label = PRESETS.find(p => p.id === id)?.label ?? 'Custom';
  const mk = (from: Date | null, to: Date | null): Period => ({ id, label, from, to });

  switch (id) {
    case 'today': return mk(startOfDay(now), endOfDay(now));
    case 'yesterday': { const y = addDays(now, -1); return mk(startOfDay(y), endOfDay(y)); }
    case 'last7': return mk(startOfDay(addDays(now, -6)), endOfDay(now));
    case 'last30': return mk(startOfDay(addDays(now, -29)), endOfDay(now));
    case 'last90': return mk(startOfDay(addDays(now, -89)), endOfDay(now));
    case 'this_month': return mk(new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now));
    case 'prev_month': return mk(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
      endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)),
    );
    case 'this_quarter': return mk(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), endOfDay(now));
    case 'this_year': return mk(new Date(now.getFullYear(), 0, 1), endOfDay(now));
    case 'all': return mk(null, null);
    case 'custom': {
      const f = custom?.from ? parseDate(custom.from) : null;
      const t = custom?.to ? parseDate(custom.to) : null;
      return { id: 'custom', label: 'Custom', from: f ? startOfDay(f) : null, to: t ? endOfDay(t) : null };
    }
  }
}

/** The equally-long window immediately before `p`, used for every delta.
 *  All-time has no comparable prior window, so deltas are suppressed. */
export function previousPeriod(p: Period): Period {
  if (!p.from || !p.to) return { id: p.id, label: 'n/a', from: null, to: null };
  const span = p.to.getTime() - p.from.getTime();
  return {
    id: p.id,
    label: 'Previous period',
    from: new Date(p.from.getTime() - span - 1),
    to: new Date(p.from.getTime() - 1),
  };
}

export const inPeriod = (v: unknown, p: Period): boolean => {
  if (!p.from && !p.to) return true;
  const d = parseDate(v);
  if (!d) return false;
  if (p.from && d < p.from) return false;
  if (p.to && d > p.to) return false;
  return true;
};

export function periodLabel(p: Period): string {
  if (!p.from || !p.to) return 'All time';
  if (p.id !== 'custom') return p.label;
  const f = p.from.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const t = p.to.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${f} – ${t}`;
}

export const periodToISO = (p: Period) => ({
  from: p.from ? toISODate(p.from) : '',
  to: p.to ? toISODate(p.to) : '',
});

/** Bucket size that keeps a trend chart readable across the chosen window. */
export function bucketFor(p: Period): 'day' | 'week' | 'month' {
  if (!p.from || !p.to) return 'month';
  const days = (p.to.getTime() - p.from.getTime()) / 86400000;
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
}
