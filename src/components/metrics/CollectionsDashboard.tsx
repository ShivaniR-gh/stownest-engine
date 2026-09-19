import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/primitives';
import { formatINRCompact, formatPct, parseDate, toNum } from '@/lib/format';
import { keysInWindow, monthKey as ymk, defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { KpiTile } from '@/components/metrics/KpiTile';

/** ---------------------------------------------------------------------------
 * Collections dashboard.
 *
 * Deliberately NOT the capacity dashboard: there is no capacity/occupied pair
 * here, so utilisation bands would be meaningless. This reads two datasets —
 * one row per month, and one row per month per revenue segment — and shows the
 * selected month's figures with the surrounding months as context.
 *
 * Segment names are never hardcoded. A new line of business is a new row in
 * the sheet, and it appears here without a code change.
 * ------------------------------------------------------------------------- */

const n = (r: Row, k: string) => toNum(r[k]) ?? 0;

/** Sheet months arrive as text or dates. Sorting on a parsed date keeps
 *  "February 2025" ahead of "March 2024" where a string sort would not. */
const monthKey = (r: Row): number => parseDate(r.month)?.getTime() ?? 0;
const monthLabel = (r: Row): string => {
  const d = parseDate(r.month);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : String(r.month ?? '');
};

export function CollectionsDashboard({ monthly, drill }: {
  monthly: Row[];
  drill: (title: string, datasetId: string, rows: Row[]) => void;
}) {
  const ordered = useMemo(
    () => [...monthly].sort((a, b) => monthKey(a) - monthKey(b)),
    [monthly]);

  const [pickedRaw, setPicked] = useState<string>('');
  const monthKeys = useMemo(
    () => [...ordered].reverse().map(r => ymk(r.month)).filter(Boolean),
    [ordered]);

  /** Opens on last month; an explicit choice overrides it. Kept as a derived
   *  value rather than a useState initializer because the month list is not
   *  known on first render. */
  const picked = pickedRaw || defaultMonthPeriod(monthKeys);

  const windowed = useMemo(() => {
    const keys = new Set(keysInWindow(monthKeys, picked));
    return ordered.filter(r => keys.has(ymk(r.month)));
  }, [ordered, monthKeys, picked]);
  /** Latest month in the window. Used only for the cumulative "to date"
   *  figures, which are running totals carried on the newest row — summing
   *  those across months would count the same balance repeatedly. */
  const current = useMemo(() => {
    if (!windowed.length) return null;
    return windowed[windowed.length - 1];
  }, [windowed]);

  /** Sums a per-month column across every month in the selected window.
   *  The period filter previously computed `windowed` and then read only its
   *  last row, so "Last 12 Months" and "Last 3 Months" showed the identical
   *  single-month figure. Flow columns (raised, collected) are additive and
   *  must be summed; ratios are recomputed from those sums below rather than
   *  averaged, which would misstate a multi-month gap. */
  const wsum = (key: string) => windowed.reduce((a, r) => a + n(r, key), 0);

  const periodLabel = windowed.length > 1
    ? `${monthLabel(windowed[0])} \u2013 ${monthLabel(windowed[windowed.length - 1])}`
    : current ? monthLabel(current) : '\u2014';

  /**
   * The three segments are columns on the month's own row now, so they arrive
   * with the totals or not at all — a month can no longer be half entered.
   */
  const segRows = useMemo(() => ([
    { name: 'Transportation (Pickup)', p: 'pk' },
    { name: 'Transportation (Delivery)', p: 'dl' },
    { name: 'Storage Rental', p: 'st' },
  ] as const).map(({ name, p: pre }) => ({
    name,
    raised: wsum(`${pre}_raised`),
    collected: wsum(`${pre}_collected`),
  })), [windowed])
    .map((sg, _i, all) => {
      const totalRaised = all.reduce((a, x) => a + x.raised, 0);
      return {
        ...sg,
        gap: sg.raised - sg.collected,
        gapPct: sg.raised > 0 ? ((sg.raised - sg.collected) / sg.raised) * 100 : 0,
        share: totalRaised > 0 ? (sg.raised / totalRaised) * 100 : 0,
      };
    });

  /** Collected in this window against the equally-long window immediately
   *  before it — so a 3-month selection compares against the previous 3
   *  months, not against a single adjacent month. Computed from the rows in
   *  view rather than stored: inserting an earlier month would leave a
   *  stored value describing the wrong pair. */
  const comparison = useMemo(() => {
    if (!windowed.length) return '\u2014';
    const firstIdx = ordered.findIndex(r => ymk(r.month) === ymk(windowed[0].month));
    const prior = firstIdx > 0
      ? ordered.slice(Math.max(0, firstIdx - windowed.length), firstIdx)
      : [];
    const prev = prior.reduce((a, r) => a + n(r, 'collection_month'), 0);
    const now = windowed.reduce((a, r) => a + n(r, 'collection_month'), 0);
    return prev > 0 && now > 0 ? (((now - prev) / prev) * 100).toFixed(1) + '%' : '\u2014';
  }, [ordered, windowed]);

  /** Every month on record, not just the selected window. A trend needs the
   *  long view to be readable — filtered to one month it collapses to a
   *  single point, and to three it cannot show a seasonal shape. The KPI
   *  cards above answer "how much in this period"; this answers "what is the
   *  shape over time", so it deliberately ignores the period filter. */
  const trend = useMemo(() => ordered.map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: { raised: n(r, 'raised_amount'), collected: n(r, 'collection_month') },
  })), [ordered]);

  if (!ordered.length || !current) {
    return (
      <div className="card">
        <EmptyState icon="receipt" title="No collections data"
          body="Connect the monthly summary tab and a row per month appears here." />
      </div>
    );
  }

  const raised = wsum('raised_amount');
  const collected = wsum('collection_month');
  /* Outstanding and Gap are no longer headline tiles — the same story is in
     "Raised vs collected by month" below, per month rather than as one
     blended number. Segment-level gap is still shown in Source of revenue. */

  return (
    <>
      {/* No entry point here. Adding a month is a Records action — Department
          already renders "New record" there, gated on view === 'records', and
          two buttons opening the same form from different tabs is one more
          than anyone needs. */}
      <section className="section">
        <SectionHeader title="Collections" note={periodLabel} />

        {/* Its own filter row, matching every other dashboard. It previously
            sat in the header action slot wrapped in a second <label>, which
            nests a label inside PeriodSelect's own — invalid, and it broke
            the pill styling. */}
        <div className="filter-bar">
          <PeriodSelect value={picked} onChange={setPicked} monthKeys={monthKeys} />
        </div>

        <div className="grid grid--kpi grid--kpi-std">
          <KpiTile label="Raised" value={formatINRCompact(raised)}
            note="Invoiced in period" />
          <KpiTile label="Collected" value={formatINRCompact(collected)} lead
            note="Received in period" />
        </div>


        {/* Cumulative figures sit apart from the month's four. Mixing "till
            date" into the same row invites reading them as one period. */}
        <div className="coll__strip">
          <div className="coll__cell">
            <span className="coll__lb">Collected to date</span>
            <span className="coll__v num">{formatINRCompact(n(current, 'collection_amount'))}</span>
          </div>
          <div className="coll__cell">
            <span className="coll__lb">Pending to date</span>
            <span className="coll__v num">{formatINRCompact(n(current, 'pending_to_date'))}</span>
          </div>
          <div className="coll__cell">
            <span className="coll__lb">Comparison</span>
            <span className="coll__v num">{comparison}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHeader title="Source of revenue" note={periodLabel} />
        <div className="coll__segs">
          {segRows.map(sg => (
            <div key={sg.name} className="coll__seg" role="button" tabIndex={0}
              onClick={() => drill(sg.name, 'collections_monthly', windowed)}>
              <div className="coll__seg-hd">
                <span className="coll__seg-nm">{sg.name}</span>
                <span className="coll__seg-share num">{formatPct(sg.share, 1)}</span>
              </div>
              <div className="coll__seg-bar">
                <span style={{ width: `${Math.min(100, sg.share)}%` }} />
              </div>
              <dl className="coll__seg-rows">
                <div><dt>Raised</dt><dd className="num">{formatINRCompact(sg.raised)}</dd></div>
                <div><dt>Collected</dt><dd className="num">{formatINRCompact(sg.collected)}</dd></div>
                <div><dt>Gap</dt><dd className="num">{formatINRCompact(sg.gap)}</dd></div>
                <div><dt>Gap %</dt><dd className="num">{formatPct(sg.gapPct, 2)}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </section>


      <section className="section">
        <SectionHeader title="Analysis" />
        <div className="grid grid--split">
          <ChartFrame title="Raised vs collected by month" department="collections" height={260}
            question="Which months are we invoicing but not collecting? (full history, not the selected period)"
            isEmpty={trend.length < 2}>
            {h => (
              <TrendChart height={h} data={trend} valueFormat={formatINRCompact}
                series={[
                  { id: 'raised', label: 'Raised', kind: 'line', colorIndex: 0 },
                  { id: 'collected', label: 'Collected', kind: 'line', colorIndex: 1 },
                ]}
                onPointClick={p => drill(`Collections \u2014 ${p.label}`, 'collections_monthly', p.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Gap by segment" department="collections" height={260}
            question="Which line of business is leaking most?" isEmpty={!segRows.some(sg => sg.raised)}>
            {h => (
              <CategoryChart height={h} valueFormat={n2 => formatPct(n2, 1)}
                data={segRows.map(sg => ({
                  key: sg.name, value: sg.gapPct, count: windowed.length, rows: windowed,
                }))}
                onBarClick={d => drill(d.key, 'collections_monthly', d.rows)} />
            )}
          </ChartFrame>
        </div>
      </section>
    </>
  );
}

