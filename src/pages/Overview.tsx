import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { DrillDown } from '@/components/data/DrillDown';
import { Badge, Button, EmptyState, Icon, Skeleton } from '@/components/primitives';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { useDrill } from '@/lib/analytics/useDrill';
import { applyFilters, applyPeriod, describePeriod } from '@/lib/analytics/filters';
import { groupBy, timeSeries } from '@/lib/analytics/aggregate';
import { allDatasets, getDataset } from '@/config/datasets';
import { activeDepartments, type DepartmentDef } from '@/config/departments';
import { METRICS } from '@/config/metrics';
import { usePermission } from '@/lib/permissions/usePermission';
import { visibleMetricIds } from '@/lib/permissions/scope';
import { formatInt } from '@/lib/format';
import type { DatasetDef, Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Overview.
 *
 * A portfolio of the departments this account can actually read, resolved
 * through the registry. It is not a finance dashboard: a Facility admin lands
 * on Facility, and no metric appears unless its datasets are readable and its
 * columns are mapped.
 * ------------------------------------------------------------------------- */

export default function Overview() {
  const nav = useNavigate();
  const { principal, hasDepartment } = usePermission();
  const { period, compare, filters } = useAnalytics();
  const drill = useDrill();

  const departments = useMemo(
    () => activeDepartments().filter(d => d.inWorkspace && hasDepartment(d.id)),
    [hasDepartment]);

  /** Every dataset across every department this account may read. */
  const datasets = useMemo(() => {
    const ids = new Set(departments.map(d => d.id));
    return allDatasets().filter(d => ids.has(d.department));
  }, [departments]);
  const datasetIds = datasets.map(d => d.id);

  /**
   * Company-level metrics only — those explicitly marked `department: 'business'`.
   * Naming a real department here would privilege one team's KPIs as everyone's
   * headline, which is the assumption this rewrite exists to remove. A
   * department's own metrics belong on its own page.
   */
  const headline = useMemo(() => {
    const readable = new Set(datasetIds);
    return visibleMetricIds(principal, METRICS
      .filter(m => m.department === 'business' && readable.has(m.dataset))
      .map(m => m.id)).slice(0, 6);
  }, [principal, datasetIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const { metrics, status, fetchedAt, refresh } = useMetrics(headline);
  const { byId, status: dsStatus } = useDatasets(datasetIds);

  const busy = status === 'loading' || dsStatus === 'loading';

  return (
    <>
      <TopBar title="Overview" />
      <ControlBar datasetIds={datasetIds} fetchedAt={fetchedAt} busy={busy} onRefresh={refresh}
        right={<Button size="sm" icon="present" onClick={() => nav('/presentation')}>Present</Button>} />

      <div className="page">
        {!departments.length ? (
          <div className="card">
            <EmptyState icon="shield" title="No departments assigned"
              body="Your account is not assigned to a department yet. A super admin can assign one under Administration → Users." />
          </div>
        ) : !datasets.length ? (
          <div className="card">
            <EmptyState icon="layers" title="No data connected yet"
              body={`${departments.map(d => d.label).join(', ')} ${departments.length > 1 ? 'have' : 'has'} no Google Sheet connected. Connect one under Administration → Data sources.`}
              action={<Button size="sm" onClick={() => nav('/admin/data-sources')}>Open data sources</Button>} />
          </div>
        ) : (
          <>
            {metrics.length > 0 && (
              <section className="section">
                <SectionHeader title="Business" note={period.label} />
                <MetricGrid metrics={metrics} compare={compare} onDrill={drill.openMetric} />
              </section>
            )}

            <section className="section">
              <SectionHeader title={departments.length > 1 ? 'Departments' : departments[0].label}
                note={`${datasets.length} connected dataset${datasets.length === 1 ? '' : 's'}`} />

              {busy ? (
                <div className="grid grid--2">{[0, 1].map(i => <Skeleton key={i} h={200} />)}</div>
              ) : (
                <div className="grid grid--2">
                  {departments.map(dept => (
                    <DepartmentCard key={dept.id} dept={dept}
                      datasets={datasets.filter(d => d.department === dept.id)}
                      byId={byId} period={period} filters={filters}
                      onOpen={() => nav(`/d/${dept.id}`)} />
                  ))}
                </div>
              )}
            </section>
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

/** One department: its connected datasets, record counts, and a factual chart
 *  drawn from whichever dimension the sheet actually provides. */
function DepartmentCard({ dept, datasets, byId, period, filters, onOpen }: {
  dept: DepartmentDef;
  datasets: DatasetDef[];
  byId: Record<string, Row[]>;
  period: ReturnType<typeof useAnalytics>['period'];
  filters: ReturnType<typeof useAnalytics>['filters'];
  onOpen: () => void;
}) {
  const scoped = useMemo(() => datasets.map(ds => ({
    ds,
    all: byId[ds.id] ?? [],
    rows: applyFilters(applyPeriod(byId[ds.id] ?? [], ds, period), filters, ds),
  })), [datasets, byId, period, filters]);

  const total = scoped.reduce((a, s) => a + s.rows.length, 0);
  const largest = scoped.slice().sort((a, b) => b.rows.length - a.rows.length)[0];

  const dim = largest?.ds.columns.find(c => c.sheetColumn && (c.groupable || c.type === 'enum'));
  const breakdown = useMemo(
    () => (largest && dim ? groupBy(largest.rows, dim.key, { limit: 6 }) : []),
    [largest, dim]);

  const trend = useMemo(() => (largest?.ds.dateColumn
    ? timeSeries(largest.rows, largest.ds.dateColumn, period, [{ id: 'n', agg: 'count' }])
    : []), [largest, period]);

  const diag = largest ? describePeriod(largest.all, largest.ds, period) : null;

  return (
    <section className="card">
      <header className="card__hd">
        <span className="rail__icon"><Icon name={dept.icon} size={15} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="card__title">{dept.label}</div>
          <div className="card__sub">{dept.purpose}</div>
        </div>
        <div className="card__tools">
          <Badge tone={total ? 'accent' : 'idle'}>{formatInt(total)} records</Badge>
          <Button size="sm" variant="ghost" iconOnly icon="chevronRight" aria-label={`Open ${dept.label}`} onClick={onOpen} />
        </div>
      </header>

      <div className="card__bd">
        <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
          {scoped.map(({ ds, rows }) => (
            <span key={ds.id} style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-600)' }}>
              <span className="num" style={{ color: 'var(--ink-900)', fontWeight: 600 }}>{formatInt(rows.length)}</span>
              {' '}{ds.label}
              <span className="num" style={{ color: 'var(--ink-300)', marginLeft: 4 }}>· {ds.sheetName}</span>
            </span>
          ))}
        </div>

        {!total ? (
          <EmptyState icon="search" title="Nothing in this view"
            body={diag?.emptyReason ?? 'Widen the date range or clear a filter to see more.'} />
        ) : trend.length > 1 ? (
          <ChartFrame title="Records over time" department={dept.id} height={180}
            question={`Volume of ${largest.ds.label.toLowerCase()} in each period.`}>
            {h => <TrendChart height={h} data={trend} valueFormat={formatInt}
              series={[{ id: 'n', label: largest.ds.label, kind: 'area', colorIndex: 0 }]} />}
          </ChartFrame>
        ) : dim && breakdown.length > 1 ? (
          <ChartFrame title={`By ${dim.header}`} department={dept.id} height={180}
            question={`How ${largest.ds.noun}s are distributed across ${dim.header.toLowerCase()}.`}>
            {h => <CategoryChart height={h} data={breakdown} valueFormat={formatInt} />}
          </ChartFrame>
        ) : (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.7 }}>
            Mark a column as groupable, or set a date column, in the field mapping to see a chart here.
          </p>
        )}
      </div>
    </section>
  );
}
