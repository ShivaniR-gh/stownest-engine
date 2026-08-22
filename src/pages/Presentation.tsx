import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon } from '@/components/primitives';
import { MetricGrid } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { Pipeline } from '@/components/charts/Pipeline';
import { RankedList } from '@/components/charts/RankedList';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { applyFilters, applyPeriod } from '@/lib/analytics/filters';
import { groupBy, timeSeries } from '@/lib/analytics/aggregate';
import { getDataset } from '@/config/datasets';
import { formatINRCompact, formatInt, relativeTime } from '@/lib/format';
import { dataSourceKind } from '@/lib/data/store';
import { periodLabel } from '@/lib/analytics/period';

const DATASETS = ['invoices', 'expenses', 'leads', 'jobs', 'space', 'customers', 'tasks'];

/**
 * Executive presentation mode.
 *
 * Same components, same tokens, same numbers — scaled for a room. Arrow keys
 * and Escape only; nothing here is editable, so no one can change a record by
 * accident while a deck is on the wall.
 */
export default function Presentation() {
  const nav = useNavigate();
  const [slide, setSlide] = useState(0);
  const { period, compare, filters } = useAnalytics();
  const { byId } = useDatasets(DATASETS);
  const business = useMetrics(['fin.revenue', 'fin.collections', 'fin.outstanding', 'fin.profit']);
  const growth = useMetrics(['sales.leads', 'sales.conversions', 'sales.conv_rate', 'cust.active']);
  const ops = useMetrics(['space.utilisation', 'log.completed', 'ops.on_time_rate', 'coll.rate']);

  const scope = useMemo(() => {
    const out: Record<string, ReturnType<typeof applyFilters>> = {};
    for (const id of DATASETS) {
      const ds = getDataset(id);
      out[id] = ds ? applyFilters(applyPeriod(byId[id] ?? [], ds, period), filters, ds) : [];
    }
    return out;
  }, [byId, period, filters]);

  const cash = useMemo(() => timeSeries(scope.invoices ?? [], 'issued_at', period, [
    { id: 'revenue', agg: 'sum', measure: 'amount', filter: r => String(r.payment_status) !== 'Void' },
    { id: 'collected', agg: 'sum', measure: 'amount_paid', filter: r => String(r.payment_status) !== 'Void' },
  ]), [scope.invoices, period]);

  const mix = useMemo(() => groupBy((scope.invoices ?? []).filter(r => String(r.payment_status) !== 'Void'),
    'revenue_line', { agg: 'sum', measure: 'amount' }), [scope.invoices]);
  const cities = useMemo(() => groupBy((scope.invoices ?? []).filter(r => String(r.payment_status) !== 'Void'),
    'city', { agg: 'sum', measure: 'amount' }), [scope.invoices]);
  const jobStatus = useMemo(() => groupBy(scope.jobs ?? [], 'status'), [scope.jobs]);

  const funnel = useMemo(() => {
    const l = scope.leads ?? [];
    const c = (...s: string[]) => l.filter(r => s.includes(String(r.status)));
    return [
      { key: 'a', label: 'Leads', value: l.length, rows: l },
      { key: 'q', label: 'Qualified', value: c('Qualified', 'Opportunity', 'Won').length, rows: [] },
      { key: 'w', label: 'Won', value: c('Won').length, rows: [] },
    ];
  }, [scope.leads]);

  const slides = useMemo(() => [
    {
      eyebrow: 'Section one', title: 'Where the business stands',
      body: (
        <>
          <MetricGrid metrics={business.metrics} compare={compare} size="lg" />
          <div style={{ marginTop: 'var(--s6)' }}>
            <ChartFrame title="Revenue against collections" height={320}
              question="Invoiced value compared with cash actually received in the same period.">
              {h => <TrendChart height={h} data={cash} valueFormat={formatINRCompact}
                series={[
                  { id: 'revenue', label: 'Invoiced', kind: 'bar', colorIndex: 0 },
                  { id: 'collected', label: 'Collected', kind: 'line', colorIndex: 1 },
                ]} />}
            </ChartFrame>
          </div>
        </>
      ),
    },
    {
      eyebrow: 'Section two', title: 'Where the revenue comes from',
      body: (
        <div className="grid grid--split">
          <ChartFrame title="Revenue by city" question="Contribution by market." height={300}>
            {() => <RankedList items={cities} valueFormat={formatINRCompact} limit={8} metaLabel="invoices" />}
          </ChartFrame>
          <ChartFrame title="Revenue mix" question="Share by line of business." height={300}>
            {() => <DonutChart data={mix} height={230} centerLabel="Invoiced" valueFormat={formatINRCompact} />}
          </ChartFrame>
        </div>
      ),
    },
    {
      eyebrow: 'Section three', title: 'Growth and demand',
      body: (
        <>
          <MetricGrid metrics={growth.metrics} compare={compare} size="lg" />
          <div className="grid grid--split" style={{ marginTop: 'var(--s6)' }}>
            <ChartFrame title="Conversion funnel" question="Lead to won, and where it leaks." height={260}>
              {() => <Pipeline stages={funnel} />}
            </ChartFrame>
            <ChartFrame title="Jobs by status" question="Delivery book at a glance." height={260}>
              {h => <CategoryChart height={h} data={jobStatus} valueFormat={formatInt} />}
            </ChartFrame>
          </div>
        </>
      ),
    },
    {
      eyebrow: 'Section four', title: 'Operating performance',
      body: <MetricGrid metrics={ops.metrics} compare={compare} size="lg" />,
    },
  ], [business.metrics, growth.metrics, ops.metrics, compare, cash, cities, mix, funnel, jobStatus]);

  const go = useCallback((d: number) => setSlide(s => Math.max(0, Math.min(slides.length - 1, s + d))), [slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      if (e.key === 'Escape') nav('/');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, nav]);

  const s = slides[slide];

  return (
    <div className="present">
      <header className="present__bar no-print">
        <span className="present__mark">
          <span className="rail__mark">SN</span>
          <span className="rail__word">STOWNEST</span>
        </span>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-400)', marginLeft: 'var(--s4)' }}>
          {periodLabel(period)}
          {dataSourceKind === 'demo' && <b style={{ color: 'var(--signal)', marginLeft: 8 }}>· Demo data</b>}
          {business.fetchedAt && <span className="num" style={{ marginLeft: 8 }}>· synced {relativeTime(business.fetchedAt)}</span>}
        </span>

        <div className="present__nav">
          <span className="present__dots">
            {slides.map((_, i) => <span key={i} className="present__dot" data-on={i === slide} />)}
          </span>
          <span className="num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)' }}>
            {slide + 1} / {slides.length}
          </span>
          <Button size="sm" iconOnly icon="chevronLeft" aria-label="Previous slide" disabled={slide === 0} onClick={() => go(-1)} />
          <Button size="sm" iconOnly icon="chevronRight" aria-label="Next slide" disabled={slide === slides.length - 1} onClick={() => go(1)} />
          <Button size="sm" icon="close" onClick={() => nav('/')}>Exit</Button>
        </div>
      </header>

      <div className="present__body">
        <div className="present__eyebrow">{s.eyebrow}</div>
        <h1 className="present__h">{s.title}</h1>
        {s.body}
      </div>

      <footer style={{
        padding: 'var(--s3) var(--s8)', borderTop: '1px solid var(--line)',
        fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', display: 'flex', gap: 'var(--s4)',
      }} className="no-print">
        <span><Icon name="chevronLeft" size={11} /> <Icon name="chevronRight" size={11} /> to move · Esc to exit</span>
        <span style={{ marginLeft: 'auto' }}>
          Figures respect the period and filters set on the Overview screen.
        </span>
      </footer>
    </div>
  );
}
