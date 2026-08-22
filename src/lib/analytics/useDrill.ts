import { useCallback, useState } from 'react';
import type { Row } from '@/config/types';
import { getDataset } from '@/config/datasets';
import { getEntry } from '@/lib/data/store';
import { applyFilters, applyPeriod } from './filters';
import { useAnalytics } from './AnalyticsContext';
import type { ResolvedMetric } from './resolveMetric';

export interface DrillTarget { title: string; subtitle?: string; datasetId: string; rows: Row[] }

/**
 * Turns a number back into the rows behind it, respecting the same period and
 * filters that produced the number. Drilling into ₹4.2L must never open a set
 * of rows that doesn't sum to ₹4.2L.
 */
export function useDrill() {
  const { period, filters, period: p } = useAnalytics();
  const [target, setTarget] = useState<DrillTarget | null>(null);

  const scoped = useCallback((datasetId: string): Row[] => {
    const ds = getDataset(datasetId);
    if (!ds) return [];
    return applyFilters(applyPeriod(getEntry(datasetId).rows, ds, period), filters, ds);
  }, [period, filters]);

  const openMetric = useCallback((m: ResolvedMetric) => {
    const t = m.def.drillTo;
    if (!t) return;
    const ds = getDataset(t.dataset);
    if (!ds) return;
    let rows = scoped(t.dataset);
    if (t.filter) {
      rows = rows.filter(r =>
        Object.entries(t.filter!).every(([k, v]) =>
          String(r[k] ?? '').trim().toLowerCase() === v.toLowerCase()));
    }
    setTarget({
      title: m.def.label,
      subtitle: `${m.def.formula} · ${p.label}`,
      datasetId: t.dataset,
      rows,
    });
  }, [scoped, p.label]);

  const openRows = useCallback((title: string, datasetId: string, rows: Row[], subtitle?: string) => {
    setTarget({ title, datasetId, rows, subtitle });
  }, []);

  return { target, openMetric, openRows, close: () => setTarget(null), scoped };
}
