import { useEffect, useMemo, useState } from 'react';
import type { DatasetDef, Row } from '@/config/types';
import { adapter } from '@/lib/data/store';
import { Button, Icon } from '@/components/primitives';

/** ---------------------------------------------------------------------------
 * Filter bar for one view.
 *
 * State lives in the parent, so Dashboard and Records each keep their own —
 * filtering the charts to Bangalore does not silently change what the records
 * table shows. The selected month is displayed prominently in both bars for
 * that reason: two views can legitimately be looking at different months, and
 * that has to be visible rather than surprising.
 * ------------------------------------------------------------------------- */

export interface ViewFilters {
  month: string;
  city: string;
  location: string;
  warehouse: string;
  band: '' | 'low' | 'medium' | 'high';
}

export const EMPTY_FILTERS: ViewFilters = {
  month: '', city: '', location: '', warehouse: '', band: '',
};

/** Utilisation bands. Low under 50%, medium to 80%, high above. */
export const BANDS: Record<'low' | 'medium' | 'high', { label: string; test: (p: number) => boolean }> = {
  low:    { label: 'Low (< 50%)',      test: p => p < 50 },
  medium: { label: 'Medium (50–80%)',  test: p => p >= 50 && p <= 80 },
  high:   { label: 'High (> 80%)',     test: p => p > 80 },
};

const val = (r: Row, k: string) => String(r[k] ?? '').trim();
const num = (r: Row, k: string) => Number(String(r[k] ?? '').replace(/[,\s%]/g, ''));

/** Applies the filter set to a row list. Empty values match everything. */
export function applyViewFilters(rows: Row[], f: ViewFilters): Row[] {
  return rows.filter(r => {
    if (f.city && val(r, 'city') !== f.city) return false;
    if (f.location && val(r, 'location') !== f.location) return false;
    if (f.warehouse && val(r, 'wh_code') !== f.warehouse) return false;
    if (f.band) {
      const total = num(r, 'total_space');
      const occ = num(r, 'occupied_space');
      if (!total) return false;
      const pct = (occ / total) * 100;
      if (!BANDS[f.band].test(pct)) return false;
    }
    return true;
  });
}

/** Distinct non-empty values for a column, sorted, for a dropdown. */
function options(rows: Row[], key: string): string[] {
  return [...new Set(rows.map(r => val(r, key)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function DatasetFilters({
  dataset, rows, value, onChange,
}: {
  dataset: DatasetDef;
  /** Unfiltered rows for the selected month — the source of the dropdowns. */
  rows: Row[];
  value: ViewFilters;
  onChange: (next: ViewFilters) => void;
}) {
  const [months, setMonths] = useState<string[]>([]);
  const monthly = dataset.tabStrategy === 'monthly';

  // The month list is generated and enforced by the server, so it is fetched
  // rather than computed here — a locally built list could offer a month the
  // API would then refuse.
  useEffect(() => {
    if (!monthly) return;
    let cancelled = false;
    adapter.list(dataset.id)
      .then(r => {
        if (cancelled) return;
        setMonths(r.tabs ?? []);
        if (!value.month) onChange({ ...value, month: r.tab || r.tabs?.[0] || '' });
      })
      .catch(() => { /* the view's own error state covers this */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id, monthly]);

  const cities = useMemo(() => options(rows, 'city'), [rows]);
  const locations = useMemo(
    () => options(value.city ? rows.filter(r => val(r, 'city') === value.city) : rows, 'location'),
    [rows, value.city]);
  const warehouses = useMemo(() => {
    const scope = rows.filter(r =>
      (!value.city || val(r, 'city') === value.city) &&
      (!value.location || val(r, 'location') === value.location));
    return [...new Set(scope.map(r => val(r, 'wh_code')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map(code => ({
        code,
        label: `${code}${val(scope.find(r => val(r, 'wh_code') === code) ?? {}, 'wh_name')
          ? ` — ${val(scope.find(r => val(r, 'wh_code') === code)!, 'wh_name')}` : ''}`,
      }));
  }, [rows, value.city, value.location]);

  const set = (patch: Partial<ViewFilters>) => {
    const next = { ...value, ...patch };
    // Clearing a broader filter clears the narrower ones under it, so the bar
    // cannot end up in a state that matches nothing.
    if (patch.city !== undefined) { next.location = ''; next.warehouse = ''; }
    if (patch.location !== undefined) next.warehouse = '';
    onChange(next);
  };

  const active =
    (value.city ? 1 : 0) + (value.location ? 1 : 0) +
    (value.warehouse ? 1 : 0) + (value.band ? 1 : 0);

  return (
    <div className="filter-bar">
      {monthly && (
        <label className="filter-bar__field filter-bar__field--month">
          <Icon name="calendar" size={14} />
          <select value={value.month} onChange={e => set({ month: e.target.value })} aria-label="Month">
            {!months.length && <option value="">Loading…</option>}
            {months.map(m => <option key={m} value={m}>{m.replace(/^\S+\s/, '')}</option>)}
          </select>
        </label>
      )}

      <label className="filter-bar__field">
        <select value={value.city} onChange={e => set({ city: e.target.value })} aria-label="City">
          <option value="">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label className="filter-bar__field">
        <select value={value.location} onChange={e => set({ location: e.target.value })}
                aria-label="Location" disabled={!locations.length}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>

      <label className="filter-bar__field filter-bar__field--wide">
        <select value={value.warehouse} onChange={e => set({ warehouse: e.target.value })}
                aria-label="Warehouse" disabled={!warehouses.length}>
          <option value="">All warehouses</option>
          {warehouses.map(w => <option key={w.code} value={w.code}>{w.label}</option>)}
        </select>
      </label>

      <label className="filter-bar__field">
        <select value={value.band} onChange={e => set({ band: e.target.value as ViewFilters['band'] })}
                aria-label="Utilisation">
          <option value="">All utilisation</option>
          {(Object.keys(BANDS) as Array<keyof typeof BANDS>).map(k => (
            <option key={k} value={k}>{BANDS[k].label}</option>
          ))}
        </select>
      </label>

      {active > 0 && (
        <Button size="sm" variant="ghost" icon="x"
                onClick={() => onChange({ ...EMPTY_FILTERS, month: value.month })}>
          Reset
        </Button>
      )}
    </div>
  );
}
