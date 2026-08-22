import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { Pipeline } from '@/components/charts/Pipeline';
import { RankedList } from '@/components/charts/RankedList';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { DrillDown } from '@/components/data/DrillDown';
import { Badge, Button, ErrorState, Icon } from '@/components/primitives';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { useDrill } from '@/lib/analytics/useDrill';
import { applyFilters, applyPeriod } from '@/lib/analytics/filters';
import { groupBy, timeSeries } from '@/lib/analytics/aggregate';
import { getDataset } from '@/config/datasets';
import { formatINRCompact, formatInt } from '@/lib/format';
import { download, toCSV } from '@/lib/export';

const HEADLINE = ['fin.revenue', 'fin.collections', 'fin.outstanding', 'fin.profit', 'space.utilisation', 'cust.active'];
const DATASETS = ['invoices', 'expenses', 'space', 'customers', 'leads', 'jobs', 'tasks'];

/**
 * Executive overview.
 *
 * Deliberately three bands, not a wall of tiles: what the business earned,
 * where the money is coming from, and what needs a decision today. Everything
 * below the fold is operational detail, not more headline numbers.
 */
export default function Overview() {
  const nav = useNavigate();
  const { period, compare, filters } = useAnalytics();
  const { metrics, status, error, fetchedAt, refresh } = useMetrics(HEADLINE);
  const { byId } = useDatasets(DATASETS);
  const drill = useDrill();

  const scope = useMemo(() => {
    const out: Record<string, ReturnType<typeof applyFilters>> = {};
    for (const id of DATASETS) {
      const ds = getDataset(id);
      out[id] = ds ? applyFilters(applyPeriod(byId[id] ?? [], ds, period), filters, ds) : [];
    }
    return out;
  }, [byId, period, filters]);

  /* Revenue against collections — the single most misread pair in the business. */
  const cashSeries = useMemo(() => timeSeries(scope.invoices, 'issued_at', period, [
    { id: 'revenue', agg: 'sum', measure: 'amount', filter: r => String(r.payment_status) !== 'Void' },
    { id: 'collected', agg: 'sum', measure: 'amount_paid', filter: r => String(r.payment_status) !== 'Void' },
  ]), [scope.invoices, period]);

  const revenueMix = useMemo(
    () => groupBy(scope.invoices.filter(r => String(r.payment_status) !== 'Void'), 'revenue_line', { agg: 'sum', measure: 'amount' }),
    [scope.invoices]);

  const pipeline = useMemo(() => {
    const l = scope.leads;
    const count = (...s: string[]) => l.filter(r => s.includes(String(r.status)));
    return [
      { key: 'all', label: 'Leads', value: l.length, rows: l },
      { key: 'q', label: 'Qualified', value: count('Qualified', 'Opportunity', 'Won').length, rows: count('Qualified', 'Opportunity', 'Won') },
      { key: 'o', label: 'Opportunity', value: count('Opportunity', 'Won').length, rows: count('Opportunity', 'Won') },
      { key: 'w', label: 'Won', value: count('Won').length, rows: count('Won') },
    ];
  }, [scope.leads]);

  const cityRevenue = useMemo(
    () => groupBy(scope.invoices.filter(r => String(r.payment_status) !== 'Void'), 'city', { agg: 'sum', measure: 'amount' }),
    [scope.invoices]);

  const attention = useMemo(() => {
    const delayedTasks = scope.tasks.filter(r => String(r.status) === 'Delayed');
    const delayedJobs = scope.jobs.filter(r => String(r.status) === 'Delayed');
    const overdue = scope.invoices.filter(r => String(r.payment_status) === 'Overdue');
    return [
      { key: 'tasks', label: 'Delayed tasks', count: delayedTasks.length, rows: delayedTasks, dataset: 'tasks', to: '/d/operations' },
      { key: 'jobs', label: 'Delayed jobs', count: delayedJobs.length, rows: delayedJobs, dataset: 'jobs', to: '/d/logistics' },
      { key: 'inv', label: 'Overdue invoices', count: overdue.length, rows: overdue, dataset: 'invoices', to: '/d/collections' },
    ];
  }, [scope]);

  const busy = status === 'loading' || status === 'refreshing';

  return (
    <>
      <TopBar title="Overview" />
      <ControlBar datasetIds={DATASETS} fetchedAt={fetchedAt} busy={busy} onRefresh={refresh}
        right={<Button size="sm" icon="present" onClick={() => nav('/presentation')}>Present</Button>} />

      <div className="page">
        {status === 'error' && !byId.invoices?.length ? (
          <ErrorState title="Could not load business data"
            body={error?.message ?? 'The data service did not respond.'} onRetry={refresh} />
        ) : (
          <>
            <section className="section">
              <SectionHeader title="Business" note={period.label} />
              <MetricGrid metrics={metrics} compare={compare} onDrill={drill.openMetric} />
            </section>

            <section className="section">
              <SectionHeader title="Money" />
              <div className="grid grid--split">
                <ChartFrame
                  title="Revenue against collections"
                  question="Is the cash following the invoicing, or is the gap widening?"
                  department="finance"
                  isEmpty={!cashSeries.some(p => p.values.revenue || p.values.collected)}
                  onExport={() => download('revenue-vs-collections.csv', toCSV(
                    cashSeries.map(p => ({ period: p.label, revenue: p.values.revenue, collected: p.values.collected })),
                    [{ key: 'period', header: 'Period', type: 'text' },
                     { key: 'revenue', header: 'Revenue', type: 'currency' },
                     { key: 'collected', header: 'Collected', type: 'currency' }]))}
                >
                  {h => (
                    <TrendChart
                      height={h}
                      data={cashSeries}
                      valueFormat={formatINRCompact}
                      series={[
                        { id: 'revenue', label: 'Invoiced', kind: 'bar', colorIndex: 0 },
                        { id: 'collected', label: 'Collected', kind: 'line', colorIndex: 1 },
                      ]}
                      onPointClick={p => drill.openRows(`Invoices — ${p.label}`, 'invoices', p.rows)}
                    />
                  )}
                </ChartFrame>

                <ChartFrame
                  title="Revenue mix"
                  question="Which lines of business are actually carrying the period?"
                  department="finance"
                  isEmpty={!revenueMix.length}
                  emptyBody="No invoices with a revenue line in this period."
                >
                  {() => (
                    <DonutChart
                      data={revenueMix}
                      centerLabel="Invoiced"
                      valueFormat={formatINRCompact}
                      onSliceClick={s => drill.openRows(`Revenue — ${s.key}`, 'invoices', s.rows)}
                    />
                  )}
                </ChartFrame>
              </div>
            </section>

            <section className="section">
              <SectionHeader title="Demand and delivery" />
              <div className="grid grid--3">
                <ChartFrame title="Sales pipeline" question="Where are leads falling out on the way to won?"
                  department="sales" isEmpty={!scope.leads.length} height={200}>
                  {() => <Pipeline stages={pipeline}
                    onStageClick={s => drill.openRows(`Leads — ${s.label}`, 'leads', s.rows)} />}
                </ChartFrame>

                <ChartFrame title="Revenue by city" question="Which markets are producing the revenue?"
                  department="finance" isEmpty={!cityRevenue.length} height={200}>
                  {() => <RankedList items={cityRevenue} valueFormat={formatINRCompact} metaLabel="invoices"
                    onClick={i => drill.openRows(`Invoices — ${i.key}`, 'invoices', i.rows)} />}
                </ChartFrame>

                <section className="card">
                  <header className="card__hd">
                    <div>
                      <div className="card__title">Needs a decision</div>
                      <div className="card__sub">Open exceptions inside this period.</div>
                    </div>
                  </header>
                  <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                    {attention.map(a => (
                      <button key={a.key} className="rank__row" style={{ gridTemplateColumns: '1fr auto auto', width: '100%' }}
                        onClick={() => a.count && drill.openRows(a.label, a.dataset, a.rows)}>
                        <span className="rank__nm" style={{ textAlign: 'left' }}>{a.label}</span>
                        {a.count > 0
                          ? <Badge tone="signal">{formatInt(a.count)}</Badge>
                          : <Badge tone="pos">Clear</Badge>}
                        <Icon name="chevronRight" size={13} />
                      </button>
                    ))}
                    <Button size="sm" variant="ghost" icon="radar" style={{ marginTop: 'auto' }}
                      onClick={() => nav('/d/control_tower')}>
                      Open Control Tower
                    </Button>
                  </div>
                </section>
              </div>
            </section>

            <section className="section">
              <SectionHeader title="Operations" />
              <div className="grid grid--2">
                <ChartFrame title="Jobs by status" question="How much of the movement book is stuck?"
                  department="logistics" isEmpty={!scope.jobs.length} height={220}>
                  {h => <CategoryChart height={h} valueFormat={formatInt}
                    data={groupBy(scope.jobs, 'status')}
                    onBarClick={d => drill.openRows(`Jobs — ${d.key}`, 'jobs', d.rows)} />}
                </ChartFrame>

                <ChartFrame title="Lead source performance" question="Which channels are worth more spend?"
                  department="sales" isEmpty={!scope.leads.length} height={220}>
                  {h => <CategoryChart height={h} valueFormat={formatInt} colorIndex={1}
                    data={groupBy(scope.leads, 'source')}
                    onBarClick={d => drill.openRows(`Leads — ${d.key}`, 'leads', d.rows)} />}
                </ChartFrame>
              </div>
            </section>
          </>
        )}
      </div>

      {drill.target && getDataset(drill.target.datasetId) && (
        <DrillDown
          title={drill.target.title}
          subtitle={drill.target.subtitle}
          dataset={getDataset(drill.target.datasetId)!}
          rows={drill.target.rows}
          onClose={drill.close}
        />
      )}
    </>
  );
}
