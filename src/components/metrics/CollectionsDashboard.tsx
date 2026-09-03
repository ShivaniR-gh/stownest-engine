import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Button, EmptyState } from '@/components/primitives';
import { CollectionsEntryForm } from './CollectionsEntryForm';
import { formatINRCompact, formatPct, parseDate, toNum } from '@/lib/format';

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

  const [picked, setPicked] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const current = useMemo(() => {
    if (!ordered.length) return null;
    const hit = picked ? ordered.find(r => String(r.month) === picked) : undefined;
    return hit ?? ordered[ordered.length - 1];
  }, [ordered, picked]);

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
    raised: current ? n(current, `${pre}_raised`) : 0,
    collected: current ? n(current, `${pre}_collected`) : 0,
    gap: current ? n(current, `${pre}_gap`) : 0,
    gapPct: current ? n(current, `${pre}_gap_pct`) : 0,
    share: current ? n(current, `${pre}_share`) : 0,
  })), [current]);

  /** Movement against the month immediately before this one, from the rows in
   *  view. Not a stored field: inserting an earlier month would leave a stored
   *  value describing the wrong pair. */
  const comparison = useMemo(() => {
    if (!current) return '\u2014';
    const i = ordered.findIndex(r => String(r.month) === String(current.month));
    const prev = i > 0 ? n(ordered[i - 1], 'collection_amount') : 0;
    const now = n(current, 'collection_amount');
    return prev > 0 && now > 0 ? ((now - prev) / prev).toFixed(2) : '\u2014';
  }, [ordered, current]);

  const trend = useMemo(() => ordered.slice(-12).map(r => ({
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

  const raised = n(current, 'raised_amount');
  const collected = n(current, 'collection_month');
  const pending = n(current, 'pending_amount');
  const gap = n(current, 'gap_pct');

  return (
    <>
      {adding && (
        <CollectionsEntryForm
          onCancel={() => setAdding(false)}
          onDone={() => setAdding(false)} />
      )}

      <section className="section">
        <SectionHeader title="Collections" note={monthLabel(current)} action={
          <span style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
          <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
            New month
          </Button>
          <label className="coll__month">
            <select value={String(current.month)} onChange={e => setPicked(e.target.value)}
              aria-label="Month">
              {[...ordered].reverse().map(r => (
                <option key={String(r.month)} value={String(r.month)}>{monthLabel(r)}</option>
              ))}
            </select>
          </label>
          </span>
        } />

        <div className="grid grid--kpi">
          <div className="metric coll__kpi" data-kpi="1">
            <div className="metric__label">Raised</div>
            <div className="metric__value num">{formatINRCompact(raised)}</div>
            <div className="metric__cmp">Invoiced this month</div>
          </div>
          <div className="metric coll__kpi" data-kpi="2">
            <div className="metric__label">Collected</div>
            <div className="metric__value num">{formatINRCompact(collected)}</div>
            <div className="metric__cmp">Received this month</div>
          </div>
          <div className="metric coll__kpi" data-kpi="3">
            <div className="metric__label">Outstanding</div>
            <div className="metric__value num">{formatINRCompact(pending)}</div>
            <div className="metric__cmp">Pending against this month</div>
          </div>
          <div className="metric coll__kpi" data-kpi="4">
            <div className="metric__label">Gap</div>
            <div className="metric__value num">{formatPct(gap, 1)}</div>
            <div className="metric__cmp">Raised not yet collected</div>
          </div>
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
        <SectionHeader title="Source of revenue" note={monthLabel(current)} />
        <div className="coll__segs">
          {segRows.map(sg => (
            <div key={sg.name} className="coll__seg" role="button" tabIndex={0}
              onClick={() => drill(sg.name, 'collections_monthly', [current])}>
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
          <ChartFrame title="Raised against collected" department="collections" height={260}
            question="Is collection keeping up with invoicing?" isEmpty={trend.length < 2}>
            {h => (
              <TrendChart height={h} data={trend} valueFormat={formatINRCompact}
                series={[
                  { id: 'raised', label: 'Raised', kind: 'area', colorIndex: 0 },
                  { id: 'collected', label: 'Collected', kind: 'line', colorIndex: 1 },
                ]}
                onPointClick={p => drill(`Collections — ${p.label}`, 'collections_monthly', p.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Gap by segment" department="collections" height={260}
            question="Which line of business is leaking most?" isEmpty={!segRows.some(sg => sg.raised)}>
            {h => (
              <CategoryChart height={h} valueFormat={n2 => formatPct(n2, 1)}
                data={segRows.map(sg => ({
                  key: sg.name, value: sg.gapPct, count: 1, rows: [current],
                }))}
                onBarClick={d => drill(d.key, 'collections_monthly', d.rows)} />
            )}
          </ChartFrame>
        </div>
      </section>
    </>
  );
}

