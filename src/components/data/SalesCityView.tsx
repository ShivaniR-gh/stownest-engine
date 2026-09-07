import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBarChart } from '@/components/charts/CategoryChart';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Sales by city.
 *
 * The month's totals as cards, the circulated table, what changed since last
 * month, and the three charts that show something the table cannot.
 *
 * The totals lead because they are the headline. Left in the table footer they
 * sat behind six columns of horizontal scroll, which is the wrong place for
 * the one line most people came to read. The footer keeps them too — it is
 * what makes the columns above it check out.
 *
 * TWO deltas per city, not one. A city can take more orders while its value
 * falls — smaller deals, or discounting — and a single arrow would hide
 * whichever half it did not represent. Volume and revenue are separate
 * questions and get separate columns.
 *
 * Percentages are suppressed under ten orders. Kolkata going from 6 to 8 is
 * "+33%", which on a dashboard reads louder than Bangalore moving 163 to 170,
 * and that is exactly backwards. The absolute change leads; the percentage is
 * secondary and only shown where the base can carry it.
 *
 * Colour is deliberately thin on the ground. The table is dense with figures
 * and the only thing that should carry colour is the deltas, where red and
 * green mean something. Tinted cards with a coloured edge give the eye a
 * landing point without competing with them.
 * ------------------------------------------------------------------------- */

const n = (v: unknown) => toNum(v) ?? 0;

/** Below this, a percentage change says more about the small base than about
 *  the business. */
const PCT_FLOOR = 10;

/** How many months the trend charts reach back. */
const TREND_MONTHS = 12;

const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'pun', name: 'Pune' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
] as const;

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
};
const monthName = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'long' }) : '';
};

const sumCities = (r: Row | undefined, suffix: string) =>
  CITIES.reduce((a, c) => a + n(r?.[`${c.key}_${suffix}`]), 0);

/** Signed change, with the percentage only where the base can carry one. */
function Delta({ now, prev, money }: { now: number; prev: number; money?: boolean }) {
  if (!prev) return <span className="mk__note">—</span>;
  const diff = now - prev;
  if (diff === 0) return <span className="mk__note">no change</span>;
  const pct = (diff / prev) * 100;
  const showPct = prev >= PCT_FLOOR;
  const tone = diff > 0 ? 'pos' : 'neg';
  const abs = money ? formatINR(Math.abs(diff)) : formatInt(Math.abs(diff));
  return (
    <span className={`mk__delta mk__delta--${tone}`}>
      {diff > 0 ? '▲' : '▼'} {abs}
      {showPct && <span className="mk__note"> ({Math.abs(pct).toFixed(1)}%)</span>}
    </span>
  );
}

/** One total, as a card. The tint is a left edge rather than a fill: six solid
 *  blocks compete with each other and nothing reads as more important. */
function TotalCard({ label, value, tint, delta }: {
  label: string; value: string; tint: string; delta?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: 'var(--s4)',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--line)',
      borderLeft: `3px solid ${tint}`,
      background: `linear-gradient(135deg, ${tint}12, ${tint}04)`,
    }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 650, color: 'var(--ink-900)', letterSpacing: '-0.01em',
      }}>
        {value}
      </div>
      {delta && <div style={{ marginTop: 4 }}>{delta}</div>}
    </div>
  );
}

export function SalesCityView({ rows, label, variant = 'records', onEdit }: {
  rows: Row[];
  /** Line of business, for the section heading. */
  label: string;
  /** 'dashboard' adds the charts below the table. */
  variant?: 'records' | 'dashboard';
  /** Omitted on the dashboard, where the table is read rather than edited. */
  onEdit?: (r: Row) => void;
}) {
  /** Oldest first for the charts; the table reverses for its picker. */
  const months = useMemo(() => {
    const seen = new Map<string, Row>();
    for (const r of rows) {
      const k = monthKey(r.month);
      if (k && !seen.has(k)) seen.set(k, r);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  /** Newest first — the table is always read most-recent-first. */
  const newestFirst = useMemo(() => [...months].reverse(), [months]);

  const [pick, setPick] = useState('');
  const idx = Math.max(0, newestFirst.findIndex(([k]) => k === pick));
  const cur = newestFirst[idx]?.[1];
  /** The month before the selected one, not simply the second in the list —
   *  picking an older month must compare against what preceded it. */
  const prev = newestFirst[idx + 1]?.[1];

  const totals = useMemo(() => {
    const leads = sumCities(cur, 'leads');
    const orders = sumCities(cur, 'orders');
    const addon = sumCities(cur, 'addon');
    return {
      leads, orders, addon,
      value: sumCities(cur, 'value'),
      conv: leads > 0 ? (orders / leads) * 100 : 0,
      total: orders + addon,
      prevLeads: sumCities(prev, 'leads'),
      prevOrders: sumCities(prev, 'orders'),
      prevValue: sumCities(prev, 'value'),
    };
  }, [cur, prev]);

  /** Value against orders per month. The only place a trend is visible at all —
   *  the table is one month by construction. */
  const trend = useMemo(() => months.slice(-TREND_MONTHS).map(([k, r]) => ({
    key: k, label: monthLabel(r.month), rows: [r],
    values: { value: sumCities(r, 'value'), orders: sumCities(r, 'orders') },
  })), [months]);

  /** Value per city per month, stacked, so the bar height is the month and the
   *  bands inside it are the mix. Two separate charts would make you compare
   *  by eye. */
  const composition = useMemo(() => months.slice(-TREND_MONTHS).map(([k, r]) => ({
    key: k, label: monthLabel(r.month), rows: [r],
    values: Object.fromEntries(CITIES.map(c => [c.key, n(r[`${c.key}_value`])])),
  })), [months]);

  /** Conversion against value for the selected month. A city high on one axis
   *  and low on the other is the finding — converting well on small deals, or
   *  a few large ones from a poor pipeline. Neither column shows that alone. */
  const scatter = useMemo(() => CITIES.map(c => {
    const leads = n(cur?.[`${c.key}_leads`]);
    const orders = n(cur?.[`${c.key}_orders`]);
    return {
      x: leads > 0 ? (orders / leads) * 100 : 0,
      y: n(cur?.[`${c.key}_value`]),
      label: c.name,
      rows: cur ? [cur] : [],
    };
  }).filter(p => p.y > 0 || p.x > 0), [cur]);

  if (!months.length) {
    return (
      <div className="card"><div className="card__bd">
        <p className="cef__note">No months recorded yet. Use New record to add one.</p>
      </div></div>
    );
  }

  const valueDiff = totals.value - totals.prevValue;

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--s3)',
        marginBottom: 'var(--s3)',
      }}>
        <h3 className="cef__sec" style={{ marginTop: 0, flex: 1 }}>
          {label} — {monthLabel(cur?.month)}
        </h3>
        <select className="field" style={{ maxWidth: 170 }}
          value={newestFirst[idx]?.[0] ?? ''} onChange={e => setPick(e.target.value)}
          aria-label="Month">
          {newestFirst.map(([k, r]) => (
            <option key={k} value={k}>{monthLabel(r.month)}</option>
          ))}
        </select>
        {onEdit && cur && (
          <button className="pop__item" onClick={() => onEdit(cur)}>Edit</button>
        )}
      </div>

      <div style={{
        display: 'grid', gap: 'var(--s3)', marginBottom: 'var(--s4)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        <TotalCard label="Leads" tint="#3b82f6" value={formatInt(totals.leads)}
          delta={<Delta now={totals.leads} prev={totals.prevLeads} />} />
        <TotalCard label="Orders" tint="#6366f1" value={formatInt(totals.orders)}
          delta={<Delta now={totals.orders} prev={totals.prevOrders} />} />
        <TotalCard label="Conversion" tint="#8b5cf6" value={formatPct(totals.conv, 0)} />
        <TotalCard label="Value" tint="#059669" value={formatINRCompact(totals.value)}
          delta={<Delta now={totals.value} prev={totals.prevValue} money />} />
        <TotalCard label="Add on" tint="#f59e0b" value={formatInt(totals.addon)} />
        <TotalCard label="Total" tint="#0ea5e9" value={formatInt(totals.total)} />
      </div>

      <div className="card">
        <div className="card__bd">
          <div style={{ overflowX: 'auto' }}>
            <table className="xpose">
              <thead>
                <tr>
                  <th scope="col" className="xpose__rowhd">City</th>
                  <th scope="col" className="is-num">Leads</th>
                  <th scope="col" className="is-num">Orders</th>
                  <th scope="col" className="is-num">vs prev</th>
                  <th scope="col" className="is-num">Conversion</th>
                  <th scope="col" className="is-num">Value</th>
                  <th scope="col" className="is-num">vs prev</th>
                  <th scope="col" className="is-num">Add on</th>
                  <th scope="col" className="is-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {CITIES.map(c => {
                  const leads = n(cur?.[`${c.key}_leads`]);
                  const orders = n(cur?.[`${c.key}_orders`]);
                  const value = n(cur?.[`${c.key}_value`]);
                  const addon = n(cur?.[`${c.key}_addon`]);
                  return (
                    <tr key={c.key}>
                      <th scope="row" className="xpose__rowhd">{c.name}</th>
                      <td className="is-num">{formatInt(leads)}</td>
                      <td className="is-num">{formatInt(orders)}</td>
                      <td className="is-num">
                        <Delta now={orders} prev={n(prev?.[`${c.key}_orders`])} />
                      </td>
                      <td className="is-num">
                        {leads > 0 ? formatPct((orders / leads) * 100, 0) : '—'}
                      </td>
                      <td className="is-num">{formatINRCompact(value)}</td>
                      <td className="is-num">
                        <Delta now={value} prev={n(prev?.[`${c.key}_value`])} money />
                      </td>
                      <td className="is-num">{formatInt(addon)}</td>
                      <td className="is-num">{formatInt(orders + addon)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="xpose__foot">
                  <th scope="row" className="xpose__rowhd">Total</th>
                  <td className="is-num">{formatInt(totals.leads)}</td>
                  <td className="is-num">{formatInt(totals.orders)}</td>
                  <td className="is-num">
                    <Delta now={totals.orders} prev={totals.prevOrders} />
                  </td>
                  <td className="is-num">{formatPct(totals.conv, 0)}</td>
                  <td className="is-num">{formatINRCompact(totals.value)}</td>
                  <td className="is-num">
                    <Delta now={totals.value} prev={totals.prevValue} money />
                  </td>
                  <td className="is-num">{formatInt(totals.addon)}</td>
                  <td className="is-num">{formatInt(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* The line the report carries under the table. Written from the
              previous row rather than typed, so it cannot describe a comparison
              that the numbers above it do not support. */}
          {prev ? (
            <p className="cef__note">
              Revenue {valueDiff < 0 ? 'decreased' : 'increased'} by{' '}
              {formatINR(Math.abs(valueDiff))}
              {totals.prevValue > 0 &&
                ` (${Math.abs((valueDiff / totals.prevValue) * 100).toFixed(2)}%)`}
              {' '}compared to {monthName(prev.month)}.
            </p>
          ) : (
            <p className="cef__note">No earlier month recorded, so there is nothing to compare against.</p>
          )}
        </div>
      </div>

      {variant === 'dashboard' && (
        <>
          <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
            <ChartFrame title="Revenue against orders" department="sales" height={260}
              question="Is revenue growing, and is it more orders or bigger ones?"
              isEmpty={trend.length < 2}
              emptyBody="Two months are needed before a trend means anything. Add an earlier month.">
              {h => (
                <TrendChart height={h} data={trend} valueFormat={formatINRCompact}
                  series={[
                    { id: 'value', label: 'Value', kind: 'bar', colorIndex: 0 },
                    { id: 'orders', label: 'Orders', kind: 'line', colorIndex: 1 },
                  ]} />
              )}
            </ChartFrame>

            <ChartFrame title="Conversion against value" department="sales" height={260}
              question="Which cities convert well but only on small deals?"
              isEmpty={scatter.length < 2}>
              {h => (
                <ScatterChart height={h} points={scatter}
                  xLabel="Conversion %" yLabel="Value"
                  xFormat={v => formatPct(v, 0)} yFormat={formatINRCompact} />
              )}
            </ChartFrame>
          </div>

          <div style={{ marginTop: 'var(--s4)' }}>
            <ChartFrame title="Revenue mix by city" department="sales" height={260}
              question="Is the revenue shifting between cities, or is one carrying it?"
              isEmpty={composition.length < 2}
              emptyBody="Two months are needed before a shift in the mix is visible.">
              {h => (
                <StackedBarChart height={h} data={composition}
                  keys={CITIES.map(c => c.key)}
                  labels={Object.fromEntries(CITIES.map(c => [c.key, c.name]))}
                  valueFormat={formatINRCompact} />
              )}
            </ChartFrame>
          </div>
        </>
      )}
    </>
  );
}
