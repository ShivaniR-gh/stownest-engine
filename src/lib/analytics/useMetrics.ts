import { useMemo } from 'react';
import type { Row } from '@/config/types';
import { getDataset } from '@/config/datasets';
import { getMetric } from '@/config/metrics';
import { useDatasets } from '@/lib/data/useDataset';
import { getEntry } from '@/lib/data/store';
import { resolveMetric, type ResolvedMetric } from './resolveMetric';
import { applyFilters, applyPeriod } from './filters';
import { useAnalytics } from './AnalyticsContext';

/**
 * Resolves a list of metric ids against the current period and filters.
 * Every dataset any metric touches is requested once; `useDatasets` dedupes
 * the actual network reads.
 */
export function useMetrics(metricIds: string[]): {
  metrics: ResolvedMetric[];
  status: string;
  error: Error | null;
  fetchedAt: number | null;
  refresh: () => Promise<void>;
} {
  const { period, prevPeriod, filters } = useAnalytics();

  const defs = useMemo(
    () => metricIds.map(getMetric).filter((m): m is NonNullable<typeof m> => Boolean(m)),
    [metricIds.join('|')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const datasetIds = useMemo(() => {
    const s = new Set<string>();
    defs.forEach(d => { s.add(d.dataset); (d.requiresDatasets ?? []).forEach(x => s.add(x)); });
    return [...s];
  }, [defs]);

  const { byId, status, error, fetchedAt, refresh } = useDatasets(datasetIds);

  const metrics = useMemo(() => {
    const scope = (id: string, p = period): Row[] => {
      const ds = getDataset(id);
      if (!ds) return [];
      return applyFilters(applyPeriod(byId[id] ?? [], ds, p), filters, ds);
    };
    const related = Object.fromEntries(datasetIds.map(id => [id, scope(id)]));
    const relatedPrev = Object.fromEntries(datasetIds.map(id => [id, scope(id, prevPeriod)]));

    // A dataset is unavailable if its last read errored, or if it has never
    // completed a read. Either way it has no rows we are entitled to reason about.
    const unavailable = new Set(
      datasetIds.filter(id => {
        const e = getEntry(id);
        return e.error !== null || e.fetchedAt === null;
      }),
    );

    return defs.map(def =>
      resolveMetric(def, related[def.dataset] ?? [], relatedPrev[def.dataset] ?? [], related, unavailable),
    );
  }, [defs, byId, filters, period, prevPeriod, datasetIds]);

  return { metrics, status, error, fetchedAt, refresh };
}

/** Rows for one dataset already scoped to the active period and filters. */
export function useScopedRows(datasetId: string) {
  const { period, prevPeriod, filters } = useAnalytics();
  const { byId, status, error, fetchedAt, refresh } = useDatasets([datasetId]);
  const ds = getDataset(datasetId);

  return useMemo(() => {
    const all = byId[datasetId] ?? [];
    if (!ds) return { rows: [], prevRows: [], all, status, error, fetchedAt, refresh };
    return {
      rows: applyFilters(applyPeriod(all, ds, period), filters, ds),
      prevRows: applyFilters(applyPeriod(all, ds, prevPeriod), filters, ds),
      all,
      status, error, fetchedAt, refresh,
    };
  }, [byId, datasetId, ds, period, prevPeriod, filters, status, error, fetchedAt, refresh]);
}
