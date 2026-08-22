import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { DepartmentId } from '@/config/types';
import { DEPT_BY_ID } from '@/config/departments';
import { allDatasets, getDataset } from '@/config/datasets';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { DatasetPanel } from '@/components/data/DatasetPanel';
import { DrillDown } from '@/components/data/DrillDown';
import { DepartmentCharts } from './DepartmentCharts';
import { CapacityDashboard } from '@/components/metrics/CapacityDashboard';
import { deriveKpis, deriveSchema } from '@/lib/analytics/deriveSchema';
import { Button, ErrorState } from '@/components/primitives';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { useDrill } from '@/lib/analytics/useDrill';
import { applyFilters, applyPeriod } from '@/lib/analytics/filters';
import { usePermission } from '@/lib/permissions/usePermission';

/**
 * One page serves all eight departments. Which KPIs, which datasets and which
 * tabs appear is read from `config/departments.ts` — adding a department is a
 * config entry, not a new route or a new file.
 */
export default function Department() {
  const { deptId } = useParams<{ deptId: string }>();
  const dept = DEPT_BY_ID[deptId as DepartmentId];
  const { hasDepartment } = usePermission();
  const { period, compare, filters } = useAnalytics();
  const drill = useDrill();
  const [tab, setTab] = useState(0);

  /**
   * Datasets come from the live registry, not the department config, so a sheet
   * an admin connects today shows up immediately. Config order is preserved for
   * the seed datasets, with newly connected ones appended.
   */
  const datasetIds = useMemo(() => {
    if (!dept) return [];
    // data_sources is the single owner of the department -> dataset relationship.
    return allDatasets().filter(d => d.department === dept.id).map(d => d.id);
  }, [dept]);
  const { metrics, error, fetchedAt, status, refresh } = useMetrics(dept?.metrics ?? []);
  const { byId } = useDatasets(datasetIds);

  const scoped = useMemo(() => {
    const out: Record<string, ReturnType<typeof applyFilters>> = {};
    for (const id of datasetIds) {
      const ds = getDataset(id);
      out[id] = ds ? applyFilters(applyPeriod(byId[id] ?? [], ds, period), filters, ds) : [];
    }
    return out;
  }, [byId, datasetIds, period, filters]);

  if (!dept) return <Navigate to="/404" replace />;
  if (!hasDepartment(dept.id)) return <Navigate to="/forbidden" replace />;

  const activeDataset = getDataset(datasetIds[tab] ?? '');
  const busy = status === 'loading' || status === 'refreshing';

  // Schema-derived analytics for the dataset in view. When it declares capacity
  // and occupied roles, the full capacity dashboard replaces the legacy charts.
  const activeRows = activeDataset ? scoped[activeDataset.id] ?? [] : [];
  const schema = activeDataset ? deriveSchema(activeDataset, activeRows) : null;
  const derivedKpis = activeDataset && schema
    ? deriveKpis(activeDataset, activeRows, [], schema, 6) : [];

  return (
    <>
      <TopBar title={dept.label} crumb={[{ label: 'Workspace', to: '/' }]} />
      <ControlBar datasetIds={datasetIds} fetchedAt={fetchedAt} busy={busy} onRefresh={refresh} />

      <div className="page">
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', marginBottom: 'var(--s5)', maxWidth: 640 }}>
          {dept.purpose}
        </p>

        {status === 'error' && !Object.values(byId).some(r => r.length) ? (
          <ErrorState title={`Could not load ${dept.label} data`}
            body={error?.message ?? 'The data service did not respond.'} onRetry={refresh} />
        ) : (
          <>
            {(metrics.length > 0 || derivedKpis.length > 0) && (
              <section className="section">
                <SectionHeader title="Key figures" note={period.label} />
                <MetricGrid metrics={[...metrics, ...derivedKpis]} compare={compare}
                  onDrill={drill.openMetric} />
              </section>
            )}

            {activeDataset && schema?.hasUtilisation ? (
              <CapacityDashboard ds={activeDataset} rows={activeRows} schema={schema} />
            ) : (
              <section className="section">
                <SectionHeader title="Analysis" />
                <DepartmentCharts department={dept.id}
                  ctx={{ rows: scoped, period, drill: (t, d, r) => drill.openRows(t, d, r) }} />
              </section>
            )}

            {datasetIds.length > 0 && activeDataset && (
              <section className="section">
                <SectionHeader
                  title="Records"
                  action={
                    datasetIds.length > 1 ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        {datasetIds.map((id, i) => (
                          <Button key={id} size="sm" variant={i === tab ? 'default' : 'ghost'}
                            aria-pressed={i === tab} onClick={() => setTab(i)}>
                            {getDataset(id)?.label ?? id}
                          </Button>
                        ))}
                      </span>
                    ) : undefined
                  }
                />
                <DatasetPanel key={activeDataset.id} dataset={activeDataset} />
              </section>
            )}
          </>
        )}
      </div>

      {drill.target && getDataset(drill.target.datasetId) && (
        <DrillDown title={drill.target.title} subtitle={drill.target.subtitle}
          dataset={getDataset(drill.target.datasetId)!} rows={drill.target.rows} onClose={drill.close} />
      )}
    </>
  );
}
