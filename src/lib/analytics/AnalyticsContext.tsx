import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PRESETS, previousPeriod, resolvePeriod, type Period, type PresetId } from './period';
import type { FilterMap } from './filters';

interface AnalyticsState {
  period: Period;
  prevPeriod: Period;
  presetId: PresetId;
  custom: { from: string; to: string };
  setPreset: (id: PresetId) => void;
  setCustom: (from: string, to: string) => void;
  filters: FilterMap;
  setFilter: (key: string, values: string[]) => void;
  clearFilter: (key: string) => void;
  resetFilters: () => void;
  compare: boolean;
  setCompare: (b: boolean) => void;
  activeCount: number;
}

const Ctx = createContext<AnalyticsState | null>(null);

/** Bumped from v1 when the period picker was removed. Browsers still holding
 *  a v1 entry have `presetId: 'last30'` saved, which would filter every screen
 *  to a window the UI no longer offers any way to widen. A new key retires
 *  that state for everyone without asking anyone to clear site data. */
const KEY = 'sn.analytics.v2';

/** Global analytics state. Persisted so a reload keeps the analyst where they
 *  were — an ops lead filtered to Bengaluru + Delayed does not want that reset
 *  because they refreshed. */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  /**
   * All-time, and effectively fixed: with no period picker in the UI, nothing
   * calls setPreset. A narrower default would silently hide rows — collections
   * runs Feb–Jul 2026, so 'last30' returns an empty table on a September
   * morning and reads as a data outage rather than a filter.
   */
  const [presetId, setPresetId] = useState<PresetId>('all');
  const [custom, setCustomState] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState<FilterMap>({});
  const [compare, setCompare] = useState(true);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (!s) return;
      // presetId is deliberately NOT restored. It is not user-settable any
      // more, so a saved value can only ever be a stale one.
      if (s.custom) setCustomState(s.custom);
      if (s.filters) setFilters(s.filters);
      if (typeof s.compare === 'boolean') setCompare(s.compare);
    } catch { /* corrupt state is not worth crashing over */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ custom, filters, compare }));
  }, [custom, filters, compare]);

  const period = useMemo(() => resolvePeriod(presetId, custom), [presetId, custom]);
  const prevPeriod = useMemo(() => previousPeriod(period), [period]);

  const setFilter = useCallback((key: string, values: string[]) => {
    setFilters(f => (values.length ? { ...f, [key]: values } : Object.fromEntries(Object.entries(f).filter(([k]) => k !== key))));
  }, []);

  const value = useMemo<AnalyticsState>(() => ({
    period, prevPeriod, presetId, custom,
    setPreset: setPresetId,
    setCustom: (from, to) => { setCustomState({ from, to }); setPresetId('custom'); },
    filters, setFilter,
    clearFilter: k => setFilter(k, []),
    resetFilters: () => setFilters({}),
    compare, setCompare,
    activeCount: Object.values(filters).filter(v => v.length).length,
  }), [period, prevPeriod, presetId, custom, filters, setFilter, compare]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalytics(): AnalyticsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAnalytics must be used inside AnalyticsProvider');
  return v;
}

export { PRESETS };
