import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { RankedList } from '@/components/charts/RankedList';
import { DatasetPanel } from '@/components/data/DatasetPanel';
import { Badge, Button, EmptyState, Icon, Skeleton } from '@/components/primitives';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { applyFilters, applyPeriod, describePeriod } from '@/lib/analytics/filters';
import { groupBy, timeSeries } from '@/lib/analytics/aggregate';
import { deriveKpis, deriveSchema, summariseBy } from '@/lib/analytics/deriveSchema';
import { allDatasets } from '@/config/datasets';
import { activeDepartments } from '@/config/departments';
import { METRICS } from '@/config/metrics';
import { usePermission } from '@/lib/permissions/usePermission';
import { visibleMetricIds } from '@/lib/permissions/scope';
import { formatCompactNum, formatINRCompact, formatInt } from '@/lib/format';
import type { DatasetDef, Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Presentation.
 *
 * Department -> registry -> connected dataset -> derived schema -> analytics.
 * Every KPI, chart, filter and grouping below comes from the field mapping the
 * admin configured. There is no per-department branch anywhere in this file.
 * ------------------------------------------------------------------------- */

const KEY = 'sn.present.dept';

export default function Presentation() {
  const nav = useNavigate();
  const { principal, hasDepartment } = usePermission();
  const { period, compare, filters } = useAnalytics();

  const departments = useMemo(
    () => activeDepartments().filter(d => d.inWorkspace && hasDepartment(d.id)),
    [hasDepartment]);

  const [deptId, setDeptId] = useState(() => localStorage.getItem(KEY) ?? '');
  const dept = departments.find(d => d.id === deptId) ?? departments[0];
  useEffect(() => { if (dept) localStorage.setItem(KEY, dept.id); }, [dept]);

  const datasets = useMemo(
    () => (dept ? allDatasets().filter(d => d.department === dept.id) : []),
    [dept]);

  const [dsIndex, setDsIndex] = useState(0);
  const activeDs: DatasetDef | undefined = datasets[Math.min(dsIndex, datasets.length - 1)];
  useEffect(() => { setDsIndex(0); }, [dept?.id]);

  const datasetIds = datasets.map(d => d.id);
  const { byId, status, fetchedAt, refresh } = useDatasets(datasetIds);

  const metricIds = useMemo(() => {
    const mine = new Set(datasetIds);
    return visibleMetricIds(principal, (dept?.metrics ?? []).filter(id =>
      mine.has(METRICS.find(m => m.id === id)?.dataset ?? '')));
  }, [principal, dept, datasetIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const { metrics: configured } = useMetrics(metricIds);

  const all = activeDs ? byId[activeDs.id] ?? [] : [];
  const rows = useMemo(
    () => (activeDs ? applyFilters(applyPeriod(all, activeDs, period), filters, activeDs) : []),
    [all, activeDs, period, filters]);
  const prevRows = useMemo(() => [], []);

  const schema = useMemo(() => (activeDs ? deriveSchema(activeDs, rows) : null), [activeDs, rows]);
  const derived = useMemo(
    () => (activeDs && schema ? deriveKpis(activeDs, rows, prevRows, schema) : []),
    [activeDs, rows, prevRows, schema]);
  const diag = useMemo(
    () => (activeDs ? describePeriod(all, activeDs, period) : null),
    [all, activeDs, period]);

  const busy = status === 'loading';

  return (
    <>
      <TopBar title="Presentation"
        actions={<Button size="sm" icon="report" onClick={() => window.print()}>Print</Button>} />
      <ControlBar datasetIds={datasetIds} fetchedAt={fetchedAt} busy={busy} onRefresh={refresh} />

      <div className="page">
        {!dept ? (
          <div className="card"><EmptyState icon="shield" title="No department assigned"
            body="Your account is not assigned to a department yet. A super admin can assign one under Administration → Users." /></div>
        ) : !datasets.length ? (
          <div className="card"><EmptyState icon="layers" title="No data source connected"
            body={`Connect ${dept.label}'s Google Sheet to present its analytics.`}
            action={<Button size="sm" onClick={() => nav('/admin/data-sources')}>Connect a sheet</Button>} /></div>
        ) : (
          <>
            <header className="pres__hd">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">{dept.label}</div>
                <h1 className="pres__title">Operational analytics</h1>
                <p className="pres__sub">{dept.purpose}</p>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {departments.length > 1 && (
                  <span className="pres__ds">
                    {departments.map(d => (
                      <Button key={d.id} size="sm" variant={d.id === dept.id ? 'default' : 'ghost'}
                        aria-pressed={d.id === dept.id} icon={d.icon} onClick={() => setDeptId(d.id)}>
                        {d.label}
                      </Button>
                    ))}
                  </span>
                )}
              </div>
            </header>

            {datasets.length > 1 && (
              <div className="pres__ds" style={{ marginBottom: 'var(--s5)' }}>
                {datasets.map((d, i) => (
                  <Button key={d.id} size="sm" variant={i === dsIndex ? 'default' : 'ghost'}
                    aria-pressed={i === dsIndex} onClick={() => setDsIndex(i)}>
                    {d.label}
                  </Button>
                ))}
              </div>
            )}

            {busy ? (
              <>
                <div className="grid grid--kpi" style={{ marginBottom: 'var(--s6)' }}>
                  {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}
                </div>
                <div className="grid grid--split"><Skeleton h={300} /><Skeleton h={300} /></div>
              </>
            ) : !all.length ? (
              <div className="card"><EmptyState icon="search" title="No records found"
                body={`The connected dataset “${activeDs?.sheetName}” currently contains no rows.`} /></div>
            ) : !rows.length ? (
              <div className="card"><EmptyState icon="calendar" title="Nothing in this view"
                body={diag?.emptyReason ?? 'Widen the date range or clear a filter to see more.'}
                action={<Button size="sm" onClick={() => nav('/admin/data-sources')}>Check field mapping</Button>} /></div>
            ) : activeDs && schema ? (
              <Analytics ds={activeDs} rows={rows} schema={schema} derived={derived}
                configured={configured} compare={compare} />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function Analytics({ ds, rows, schema, derived, configured, compare }: {
  ds: DatasetDef;
  rows: Row[];
  schema: NonNullable<ReturnType<typeof deriveSchema>>;
  derived: ReturnType<typeof deriveKpis>;
  configured: ReturnType<typeof deriveKpis>;
  compare: boolean;
}) {
  const { period } = useAnalytics();
  const { statusColumn, primaryDimension, dateColumn, measures, dimensions } = schema;

  const money = (n: number) => (measures[0]?.type === 'currency' ? formatINRCompact(n) : formatCompactNum(n));

  const trend = useMemo(() => (dateColumn
    ? timeSeries(rows, dateColumn.key, period, [
        { id: 'records', agg: 'count' },
        ...(measures[0] ? [{ id: 'measure', agg: 'sum' as const, measure: measures[0].key }] : []),
      ])
    : []), [rows, dateColumn, period, measures]);

  const byStatus = useMemo(
    () => (statusColumn ? groupBy(rows, statusColumn.key) : []),
    [rows, statusColumn]);

  const byPrimary = useMemo(
    () => (primaryDimension
      ? groupBy(rows, primaryDimension.key, measures[0] ? { agg: 'sum', measure: measures[0].key } : undefined)
      : []),
    [rows, primaryDimension, measures]);

  const summaries = useMemo(
    () => (primaryDimension ? summariseBy(rows, primaryDimension, measures) : []),
    [rows, primaryDimension, measures]);

  const secondary = dimensions.find(d => d.key !== primaryDimension?.key && d.key !== statusColumn?.key);
  const bySecondary = useMemo(
    () => (secondary ? groupBy(rows, secondary.key) : []),
    [rows, secondary]);

  const maxCount = summaries[0]?.count ?? 1;

  return (
    <>
      <section className="section">
        <SectionHeader title="Key figures" note={`${formatInt(rows.length)} records · tab ${ds.sheetName}`} />
        <MetricGrid metrics={[...configured, ...derived]} compare={compare} />
      </section>

      <section className="section">
        <SectionHeader title="Analysis" />
        <div className="grid grid--split">
          {dateColumn && trend.length > 1 ? (
            <ChartFrame title={`${ds.label} over time`} department={ds.department} height={280}
              question={`How ${ds.noun}s${measures[0] ? ` and ${measures[0].header.toLowerCase()}` : ''} move across ${dateColumn.header.toLowerCase()}.`}>
              {h => <TrendChart height={h} data={trend} valueFormat={formatCompactNum}
                series={[
                  { id: 'records', label: 'Records', kind: 'bar', colorIndex: 0 },
                  ...(measures[0] ? [{ id: 'measure', label: measures[0].header, kind: 'line' as const, colorIndex: 1, axis: 'right' as const }] : []),
                ]} />}
            </ChartFrame>
          ) : primaryDimension ? (
            <ChartFrame title={`By ${primaryDimension.header}`} department={ds.department} height={280}
              question={`Which ${primaryDimension.header.toLowerCase()} values carry the most ${ds.noun}s.`}>
              {h => <CategoryChart height={h} data={byPrimary} valueFormat={measures[0] ? money : formatInt} />}
            </ChartFrame>
          ) : (
            <div className="card"><div className="card__bd">
              <EmptyState icon="chart" title="No dimension to chart"
                body="Mark a column as groupable, or set a date column, in the field mapping." />
            </div></div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
            {statusColumn && byStatus.length > 1 && (
              <ChartFrame title={statusColumn.header} department={ds.department} height={210}
                question={`Share of ${ds.noun}s by ${statusColumn.header.toLowerCase()}.`}>
                {() => <DonutChart data={byStatus} height={180} centerLabel="Records" valueFormat={formatInt} />}
              </ChartFrame>
            )}
            {secondary && bySecondary.length > 1 && (
              <ChartFrame title={secondary.header} department={ds.department} height={210}
                question={`Which ${secondary.header.toLowerCase()} values appear most often.`}>
                {() => <RankedList items={bySecondary} valueFormat={formatInt} limit={6} metaLabel="records" />}
              </ChartFrame>
            )}
          </div>
        </div>
      </section>

      {primaryDimension && summaries.length > 1 && (
        <section className="section">
          <SectionHeader title={`Summary by ${primaryDimension.header}`}
            note={`${summaries.length} groups`} />
          <div className="sumgrid">
            {summaries.map(g => (
              <div key={g.key} className="sumcard">
                <div className="sumcard__hd">
                  <span className="sumcard__nm" title={g.key}>{g.key}</span>
                  <span className="sumcard__n num">{formatInt(g.count)} records</span>
                </div>
                {measures.map(m => (
                  <div key={m.key} className="sumcard__row">
                    <span>{m.header}</span>
                    <b>{m.type === 'currency' ? formatINRCompact(g.measures[m.key]) : formatCompactNum(g.measures[m.key])}</b>
                  </div>
                ))}
                {statusColumn && (
                  <div className="sumcard__row" style={{ flexWrap: 'wrap', gap: 4 }}>
                    {groupBy(g.rows, statusColumn.key, { limit: 3 }).map(s => (
                      <Badge key={s.key} tone={statusColumn.tone?.[s.key] ?? 'idle'}>
                        {s.key} {s.count}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="sumcard__bar"><span style={{ width: `${(g.count / maxCount) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <SectionHeader title="Data details"
          action={<span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)' }}>
            <Icon name="info" size={12} /> Actions follow your permissions
          </span>} />
        <DatasetPanel dataset={ds} />
      </section>
    </>
  );
}
