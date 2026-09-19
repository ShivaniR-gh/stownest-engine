import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBarChart } from '@/components/charts/CategoryChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/primitives';
import { formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import { keysInWindow, defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { KpiTile } from '@/components/metrics/KpiTile';

/** ---------------------------------------------------------------------------
 * Operations dashboard.
 *
 * Four blocks describing the same months. Which one is showing follows the
 * dataset switcher in the page header, so there is one control rather than two
 * that disagree.
 *
 * The headline figures are COUNTS, and where a count has a natural denominator
 * the share sits beside it. "336 full deliveries" without "68% of the month"
 * is what lets a month with a partial-delivery problem pass for a busy one.
 *
 * PICK-UP TO DELIVERY GAP. The report carries this as a single line at the
 * bottom, and it is the one figure here that needs two datasets: pick-ups
 * started this month against deliveries completed. It reads both and shows
 * nothing when either month is missing, rather than presenting a gap computed
 * against a zero it invented.
 *
 * Note on the source report: its "Difference Percentage" row is labelled
 * "Delivery by Stownest (All items)" but uses 336, which is FULL DELIVERY —
 * Stownest and customer together. Stownest alone is 244. This follows the
 * arithmetic that was actually used, since that is the figure the team has
 * been reading, and names the row for what it computes.
 * ------------------------------------------------------------------------- */

const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
] as const;

const n = (r: Row | null | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);

const monthKey = (v: unknown): string => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (v: unknown): string => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
};

const sumCities = (r: Row | undefined, suffix: string) =>
  CITIES.reduce((a, c) => a + n(r, `${c.key}_${suffix}`), 0);

/** The dashboard's one headline figure per block — kpiRow() always puts the
 *  aggregate total first, so `lead` follows position here rather than being
 *  hand-picked per target. */
function Kpi({ label, value, note, lead }: {
  i?: number; label: string; value: string; note?: React.ReactNode; lead?: boolean;
}) {
  return <KpiTile label={label} value={value} note={note} lead={lead} />;
}

/** What each block plots: the fields that stack in the composition chart, and
 *  the two series that trend over time. */
const PLOTS: Record<string, {
  stack: { key: string; label: string }[];
  trend: { key: string; label: string }[];
}> = {
  ops_deliveries: {
    stack: [
      { key: 'sn_all', label: 'Stownest — all' },
      { key: 'sn_part', label: 'Stownest — partial' },
      { key: 'cust_all', label: 'Customer — all' },
      { key: 'cust_part', label: 'Customer — partial' },
    ],
    trend: [{ key: 'full', label: 'Full deliveries' }, { key: 'partial', label: 'Partial deliveries' }],
  },
  ops_pickups: {
    stack: [
      { key: 'sn', label: 'Stownest' },
      { key: 'cust', label: 'Customer' },
      { key: 'sn_addon', label: 'Stownest — add on' },
      { key: 'cust_addon', label: 'Customer — add on' },
    ],
    trend: [{ key: 'new', label: 'New pick-ups' }, { key: 'addon', label: 'Add-on pick-ups' }],
  },
  ops_moving: {
    stack: [
      { key: 'del_is', label: 'Deliveries' },
      { key: 'pick_is', label: 'Pick-ups' },
      { key: 'pick_local', label: 'Local moving' },
    ],
    trend: [{ key: 'del_is', label: 'Interstate deliveries' }, { key: 'pick_is', label: 'Interstate pick-ups' }],
  },
  ops_tickets: {
    stack: [],
    trend: [
      { key: 'warehouse_visit', label: 'Warehouse visits' },
      { key: 'photo_request', label: 'Photo requests' },
    ],
  },
};

export function OperationsDashboard({ rows, activeDatasetId }: {
  rows: Record<string, Row[]>;
  activeDatasetId: string;
}) {
  const target = PLOTS[activeDatasetId] ? activeDatasetId : 'ops_deliveries';
  const plot = PLOTS[target];
  const data = rows[target] ?? [];

  /** Oldest first for the charts; the picker reverses. One row per month, so a
   *  duplicate month in the sheet takes the first and is not silently added. */
  const months = useMemo(() => {
    const seen = new Map<string, Row>();
    for (const r of data) {
      const k = monthKey(r.month);
      if (k && !seen.has(k)) seen.set(k, r);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const newestFirst = useMemo(() => [...months].reverse(), [months]);
  const monthKeys = newestFirst.map(([k]) => k);


  const [pickRaw, setPick] = useState<string>('');
  /** Opens on last month; an explicit choice overrides it. Kept as a derived
   *  value rather than a useState initializer because the month list is not
   *  known on first render. */
  const pick = pickRaw || defaultMonthPeriod(monthKeys);
  const windowed = useMemo(() => {
    const keys = keysInWindow(monthKeys, pick);
    return newestFirst.filter(([k]) => keys.includes(k));
  }, [newestFirst, monthKeys, pick]);
  const cur = windowed[0]?.[1];
  const prev = windowed[1]?.[1];

  const cityPlot = plot.stack.length > 0;
  const trend = useMemo(() => [...windowed].reverse().map(([k, r]) => ({
    key: k,
    label: monthLabel(r.month),
    values: Object.fromEntries(plot.trend.map(t => [
      t.key,
      cityPlot ? sumCities(r, t.key) : n(r, t.key),
    ])),
    rows: [r],
  })), [windowed, plot, cityPlot]);

  const composition = useMemo(() => CITIES.map(c => ({
    key: c.key,
    label: c.name,
    values: Object.fromEntries(plot.stack.map(f => [f.key, n(cur, `${c.key}_${f.key}`)])),
    rows: cur ? [cur] : [],
  })), [cur, plot]);

  const byCity = useMemo(() => CITIES.map(c => ({
    key: c.name,
    value: plot.stack.reduce((a, f) => a + n(cur, `${c.key}_${f.key}`), 0),
    count: 1,
    rows: cur ? [cur] : [],
  })).sort((a, b) => b.value - a.value), [cur, plot]);

  /* --- the one figure that needs both blocks --- */
  const gap = useMemo(() => {
    const k = windowed[0]?.[0];
    if (!k) return null;
    const pk = (rows.ops_pickups ?? []).find(r => monthKey(r.month) === k);
    const dl = (rows.ops_deliveries ?? []).find(r => monthKey(r.month) === k);
    if (!pk || !dl) return null;
    const started = sumCities(pk, 'new');
    const finished = sumCities(dl, 'full');
    if (started <= 0) return null;
    return { started, finished, pct: ((started - finished) / started) * 100 };
  }, [rows, windowed]);

  if (!months.length) {
    return (
      <EmptyState icon="chart" title="No months recorded yet"
        body="Save a month from the entry form and the figures will appear here." />
    );
  }

  const kpis = kpiRow(target, cur, prev);

  return (
    <>
      <section className="section">
        {/* No "Key figures" heading: the cards below are self-evidently the
            key figures, and it stacked directly under the page's own heading
            with nothing between them. The filter states the period. */}
        <div className="filter-bar">
          <PeriodSelect id="ops-month-pick" value={pick} onChange={setPick} monthKeys={monthKeys} />
        </div>

        <div className="grid grid--kpi grid--kpi-std">
          {kpis.map((k, i) => (
            <Kpi key={k.label} i={i} label={k.label} value={k.value} note={k.note} lead={i === 0} />
          ))}
        </div>

        {gap && (
          <p className="cef__note" style={{ marginTop: 'var(--s3)' }}>
            {formatInt(gap.started)} pick-ups started against {formatInt(gap.finished)} full
            deliveries completed — a {gap.pct >= 0 ? 'surplus' : 'shortfall'} of{' '}
            {formatPct(Math.abs(gap.pct), 0)} of the month&rsquo;s intake.
          </p>
        )}
      </section>

      <section className="section">
        <SectionHeader title="Analysis" />
        <div className="grid grid--split">
          <ChartFrame title="Month on month" department="operations"
            question="Is throughput holding, and is the mix shifting?"
            isEmpty={!trend.length}>
            {h => (
              <TrendChart height={h} data={trend} valueFormat={formatInt}
                series={plot.trend.map((t, i) => ({
                  id: t.key, label: t.label, kind: 'line' as const, colorIndex: i,
                }))} />
            )}
          </ChartFrame>

          {cityPlot ? (
            <ChartFrame title="Composition by city" department="operations"
              question="Where is the volume, and who is doing the moving?"
              isEmpty={!cur}>
              {h => (
                <StackedBarChart height={h} data={composition}
                  keys={plot.stack.map(f => f.key)}
                  labels={Object.fromEntries(plot.stack.map(f => [f.key, f.label]))}
                  valueFormat={formatInt} />
              )}
            </ChartFrame>
          ) : (
            <ChartFrame title="Ticket mix" department="operations"
              question="What is the month made of?"
              isEmpty={!cur}>
              {h => <CategoryChart height={h} valueFormat={formatInt} data={[
                { key: 'Warehouse visits', value: n(cur, 'warehouse_visit'), count: 1, rows: [] },
                { key: 'Photo requests', value: n(cur, 'photo_request'), count: 1, rows: [] },
              ].filter(d => d.value)} />}
            </ChartFrame>
          )}
        </div>

        {cityPlot && (
          <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
            <ChartFrame title="Cities ranked" department="operations"
              question="Which cities carry the month?"
              isEmpty={!cur}>
              {h => <CategoryChart height={h} data={byCity} valueFormat={formatInt} valueLabel={target === "ops_pickups" ? "Pick-ups" : target === "ops_moving" ? "Moves" : "Deliveries"} />}
            </ChartFrame>
            {target === 'ops_deliveries' && (
              <ChartFrame title="Who delivered" department="operations"
                question="StowNest vs customer this month?"
                isEmpty={!cur}>
                {h => <CategoryChart height={h} valueFormat={formatInt} data={[
                  { key: 'StowNest full', value: sumCities(cur, 'sn_all'), count: 1, rows: [] },
                  { key: 'StowNest partial', value: sumCities(cur, 'sn_part'), count: 1, rows: [] },
                  { key: 'Customer full', value: sumCities(cur, 'cust_all'), count: 1, rows: [] },
                  { key: 'Customer partial', value: sumCities(cur, 'cust_part'), count: 1, rows: [] },
                ].filter(d => d.value)} />}
              </ChartFrame>
            )}
            {target === 'ops_pickups' && (
              <ChartFrame title="Who picked up" department="operations"
                question="StowNest vs customer this month?"
                isEmpty={!cur}>
                {h => <CategoryChart height={h} valueFormat={formatInt} data={[
                  { key: 'StowNest new', value: sumCities(cur, 'sn'), count: 1, rows: [] },
                  { key: 'Customer new', value: sumCities(cur, 'cust'), count: 1, rows: [] },
                  { key: 'StowNest add-on', value: sumCities(cur, 'sn_addon'), count: 1, rows: [] },
                  { key: 'Customer add-on', value: sumCities(cur, 'cust_addon'), count: 1, rows: [] },
                ].filter(d => d.value)} />}
              </ChartFrame>
            )}
            {target === 'ops_moving' && (
              <ChartFrame title="Moving mix" department="operations"
                question="Interstate vs local?"
                isEmpty={!cur}>
                {h => <CategoryChart height={h} valueFormat={formatInt} data={[
                  { key: 'Interstate delivery', value: sumCities(cur, 'del_is'), count: 1, rows: [] },
                  { key: 'Interstate pickup', value: sumCities(cur, 'pick_is'), count: 1, rows: [] },
                  { key: 'Local moving', value: sumCities(cur, 'pick_local'), count: 1, rows: [] },
                ].filter(d => d.value)} />}
              </ChartFrame>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/** Headline figures per block. Shares are shown only where a denominator
 *  exists — a share of the empty month would read as a result. */
function kpiRow(target: string, cur: Row | undefined, prev: Row | undefined) {
  const delta = (now: number, before: number) => {
    if (!before) return undefined;
    const diff = now - before;
    if (diff === 0) return <span className="mk__note">no change</span>;
    return (
      <span className={`mk__delta mk__delta--${diff > 0 ? 'pos' : 'neg'}`}>
        {diff > 0 ? '▲' : '▼'} {formatInt(Math.abs(diff))}
      </span>
    );
  };

  if (target === 'ops_pickups') {
    const fresh = sumCities(cur, 'new');
    const addon = sumCities(cur, 'addon');
    return [
      { label: 'Total pick-ups', value: formatInt(fresh + addon),
        note: delta(fresh + addon, sumCities(prev, 'new') + sumCities(prev, 'addon')) },
      { label: 'New', value: formatInt(fresh), note: delta(fresh, sumCities(prev, 'new')) },
      { label: 'Add on', value: formatInt(addon), note: delta(addon, sumCities(prev, 'addon')) },
      { label: 'By customer', value: formatInt(sumCities(cur, 'cust') + sumCities(cur, 'cust_addon')),
        note: <span className="mk__note">self-collected</span> },
    ];
  }

  if (target === 'ops_tickets') {
    const visits = n(cur, 'warehouse_visit');
    const photos = n(cur, 'photo_request');
    const tot = n(cur, 'tot_tickets') || visits + photos;
    return [
      { label: 'Total tickets', value: formatInt(tot),
        note: delta(tot, n(prev, 'tot_tickets') || n(prev, 'warehouse_visit') + n(prev, 'photo_request')) },
      { label: 'Warehouse visits', value: formatInt(visits),
        note: delta(visits, n(prev, 'warehouse_visit')) },
      { label: 'Photo requests', value: formatInt(photos),
        note: delta(photos, n(prev, 'photo_request')) },
    ];
  }

  if (target === 'ops_moving') {
    return [
      { label: 'Deliveries', value: formatInt(sumCities(cur, 'del_is')),
        note: delta(sumCities(cur, 'del_is'), sumCities(prev, 'del_is')) },
      { label: 'Pick-ups', value: formatInt(sumCities(cur, 'pick_is')),
        note: delta(sumCities(cur, 'pick_is'), sumCities(prev, 'pick_is')) },
      { label: 'Local moving', value: formatInt(sumCities(cur, 'pick_local')),
        note: delta(sumCities(cur, 'pick_local'), sumCities(prev, 'pick_local')) },
    ];
  }

  const full = sumCities(cur, 'full');
  const partial = sumCities(cur, 'partial');
  const all = full + partial;
  return [
    { label: 'Total deliveries', value: formatInt(all),
      note: delta(all, sumCities(prev, 'full') + sumCities(prev, 'partial')) },
    { label: 'Full', value: formatInt(full),
      note: all > 0 ? <span className="mk__note">{formatPct((full / all) * 100, 0)} of month</span> : undefined },
    { label: 'Partial', value: formatInt(partial),
      note: all > 0 ? <span className="mk__note">{formatPct((partial / all) * 100, 0)} of month</span> : undefined },
    { label: 'Delivered by Stownest',
      value: formatInt(sumCities(cur, 'sn_all') + sumCities(cur, 'sn_part')),
      note: <span className="mk__note">rest self-collected</span> },
  ];
}
