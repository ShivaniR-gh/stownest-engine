import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@/styles/collections.css';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBarChart } from '@/components/charts/CategoryChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { Heatmap } from '@/components/charts/Heatmap';
import { SelectField } from '@/components/filters/SelectField';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';
import { KpiTile } from '@/components/metrics/KpiTile';
import { WINDOW_PRESETS, keysInWindow, defaultMonthPeriod, ytdOptions } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { isRowOpen } from '@/lib/data/editable';
import { Button, Icon, Popover } from '@/components/primitives';

/** ---------------------------------------------------------------------------
 * Sales by city.
 *
 * Two views over the same month. The DASHBOARD answers "how did we do" — four
 * headline figures and five columns, nothing that needs horizontal scrolling.
 * RECORDS answers "what exactly is in the sheet" — every column, both deltas,
 * and the edit affordance.
 *
 * Splitting them is what fixes the old layout. One table carrying nine columns
 * and six KPI cards had to scroll sideways to reach Add on, so the two figures
 * a manager actually reads sat off-screen while a card showing an em dash took
 * up a quarter of the row.
 *
 * TWO deltas per city in the records view, not one. A city can take more
 * orders while its value falls — smaller deals, or discounting — and a single
 * arrow would hide whichever half it did not represent.
 *
 * Percentages are suppressed under ten orders. Kolkata going from 6 to 8 is
 * "+33%", which on a dashboard reads louder than Bangalore moving 163 to 170,
 * and that is exactly backwards.
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

/** The dashboard's one headline figure. Standardized to the neutral +
 *  accent-border treatment (.grid--kpi-std in metrics.css) rather than the
 *  old fixed-hue gradient — see B2B/Collections for the same pattern. */
function Kpi({ label, value, note, lead }: {
  i?: number; label: string; value: string; note?: React.ReactNode; lead?: boolean;
}) {
  return <KpiTile label={label} value={value} note={note} lead={lead} />;
}

export function SalesCityView({ rows, label, datasetId, variant = 'records', onEdit }: {
  rows: Row[];
  /** Which sales dataset these rows are, for the Open record link. */
  datasetId?: string;
  /** Line of business, for the section heading. */
  label: string;
  /** 'dashboard' shows headline cards, five columns and the charts.
   *  'records' shows every column, both deltas and the edit button. */
  variant?: 'records' | 'dashboard';
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

  const monthKeys = useMemo(() => newestFirst.map(([k]) => k), [newestFirst]);
  const [pickRaw, setPick] = useState<string>('');
  /** Opens on last month; an explicit choice overrides it. Derived rather than
   *  a useState initializer because the month list is not known on first
   *  render. Declared after the state it reads — a const read before its own
   *  declaration throws at render. */
  const pick = pickRaw || defaultMonthPeriod(monthKeys);

  /** City is a column family here (blr_leads, hyd_leads, ...) rather than a
   *  row field, so filtering means reading one family instead of summing all
   *  of them — a real filter, not a decorative dropdown. */
  const [city, setCity] = useState('All');
  /** Records opens on ALL months — it is the history table, and a month per
   *  row is the whole point. The dashboard still opens on last month. */
  const [recPeriod, setRecPeriod] = useState('all');
  /** Widened to a plain array: CITIES is a readonly tuple of literal types,
   *  whose reduce overloads infer the accumulator as a city object rather
   *  than a running total. */
  const activeCities: { key: string; name: string }[] = useMemo(
    () => (city === 'All' ? [...CITIES] : CITIES.filter(c => c.key === city)),
    [city]);

  /** Months inside the selected window, newest first. */
  const windowed = useMemo(() => {
    const keys = keysInWindow(monthKeys, pick);
    return newestFirst.filter(([k]) => keys.includes(k));
  }, [newestFirst, monthKeys, pick]);

  /** The equally-long window immediately before this one, so a 3-month
   *  selection compares against the previous 3 months rather than a single
   *  adjacent month. */
  const priorWindow = useMemo(() => {
    if (!windowed.length) return [] as typeof newestFirst;
    const first = newestFirst.findIndex(([k]) => k === windowed[windowed.length - 1][0]);
    return first < 0 ? [] : newestFirst.slice(first + 1, first + 1 + windowed.length);
  }, [newestFirst, windowed]);

  const cur = windowed[0]?.[1];
  const periodLabel = windowed.length > 1
    ? `${monthLabel(windowed[windowed.length - 1][1].month)} \u2013 ${monthLabel(windowed[0][1].month)}`
    : monthLabel(cur?.month);

  /** Sums a field across every month in the window — the filter previously
   *  only chose which single month to display, so a multi-month selection
   *  showed one month's figures. */
  /** Explicit <number> on the inner reduce: activeCities is a readonly tuple
   *  of city objects, so without it TypeScript infers the accumulator as a
   *  city rather than a running total. */
  const wSum = (list: typeof newestFirst, suffix: string) =>
    list.reduce((a, [, r]) =>
      a + activeCities.reduce((b, c) => b + n(r[`${c.key}_${suffix}`]), 0), 0);
  const wCity = (list: typeof newestFirst, cityKey: string, suffix: string) =>
    list.reduce((a, [, r]) => a + n(r[`${cityKey}_${suffix}`]), 0);

  const totals = useMemo(() => {
    const leads = wSum(windowed, 'leads');
    const orders = wSum(windowed, 'orders');
    const addon = wSum(windowed, 'addon');
    return {
      leads, orders, addon,
      value: wSum(windowed, 'value'),
      conv: leads > 0 ? (orders / leads) * 100 : 0,
      total: orders + addon,
      prevLeads: wSum(priorWindow, 'leads'),
      prevOrders: wSum(priorWindow, 'orders'),
      prevValue: wSum(priorWindow, 'value'),
    };
    // activeCities matters: wSum closes over it, so leaving it out left the
    // KPI cards showing all-cities totals after a city was selected.
  }, [windowed, priorWindow, activeCities]);

  /** Value per city per month, stacked, so the bar height is the month and the
   *  bands inside it are the mix. */
  /* Months with nothing recorded are dropped, not drawn as empty slots: a
     placeholder row for next month otherwise takes a third of the plot and
     squeezes the only real bar into a column. */
  const composition = useMemo(() => months.slice(-TREND_MONTHS).map(([k, r]) => ({
    key: k, label: monthLabel(r.month), rows: [r],
    values: Object.fromEntries(activeCities.map(c => [c.key, n(r[`${c.key}_value`])])),
  })).filter(d => Object.values(d.values).some(v => v > 0)), [months, activeCities]);

  /* Revenue share for the selected period, for the single-month case. */
  const mixShare = useMemo(() => activeCities.map(c => ({
    key: c.name, value: wCity(windowed, c.key, 'value'), count: windowed.length,
    rows: windowed.map(([, r]) => r),
  })).filter(d => d.value > 0), [windowed, activeCities]);

  /** One line per city, month by month — the per-city shape the single
   *  aggregate trend hides. Full history, not the selected window: a trend
   *  filtered to one month collapses to a point. */
  const citySeries = useMemo(() => activeCities.map((c, i) => ({
    id: c.key, label: c.name, kind: 'line' as const, colorIndex: i,
  })), [activeCities]);

  /** Conversion per city per month. A city can grow leads while converting
   *  worse; the volume lines alone would not show it. */
  const recorded = useMemo(
    () => months.filter(([, r]) => CITIES.some(c => n(r[`${c.key}_leads`]) > 0 || n(r[`${c.key}_value`]) > 0)),
    [months]);

  const cityConvTrend = useMemo(() => recorded.map(([k, r]) => ({
    key: k, label: monthLabel(r.month), rows: [r],
    values: Object.fromEntries(activeCities.map(c => {
      const l = n(r[`${c.key}_leads`]);
      return [c.key, l > 0 ? (n(r[`${c.key}_orders`]) / l) * 100 : 0];
    })),
  })), [recorded, activeCities]);

  /** Cities ranked by value over the selected window. */
  const cityRank = useMemo(() => activeCities.map(c => ({
    key: c.name,
    value: wCity(windowed, c.key, 'value'),
    count: windowed.length,
    rows: windowed.map(([, r]) => r),
  })).filter(d => d.value > 0).sort((a, b) => b.value - a.value), [windowed, activeCities]);

  /** City against month, so a soft month in one city stands out from a soft
   *  month everywhere. Capped to the last 12 months to stay readable. */
  const heat = useMemo(() => {
    const cols = recorded.slice(-12);
    return {
      rowKeys: activeCities.map(c => c.name),
      colKeys: cols.map(([, r]) => monthLabel(r.month)),
      cells: activeCities.map(c => cols.map(([, r]) => ({
        rowKey: c.name,
        colKey: monthLabel(r.month),
        value: n(r[`${c.key}_value`]),
        rows: [r],
      }))),
    };
  }, [recorded, activeCities]);

  if (!months.length) {
    return (
      <div className="card"><div className="card__bd">
        <p className="cef__note">No months recorded yet. Use New record to add one.</p>
      </div></div>
    );
  }

  const valueDiff = totals.value - totals.prevValue;
  const dash = variant === 'dashboard';

  if (!dash) {
    return (
      <SalesMonthTable months={newestFirst} monthKeys={monthKeys} allRows={rows}
        datasetId={datasetId} cities={activeCities} city={city} onCity={setCity}
        period={recPeriod} onPeriod={setRecPeriod} onEdit={onEdit} />
    );
  }

  const picker = (
    <div className="filter-bar">
      <PeriodSelect value={pick} onChange={setPick} monthKeys={monthKeys} />
      <SelectField icon="radar" label="City" value={city} onChange={setCity}
        isOn={city !== 'All'}
        options={[{ value: 'All', label: 'All cities' },
          ...CITIES.map(c => ({ value: c.key, label: c.name }))]} />
      {(!!pickRaw || city !== 'All') && (
        <Button size="sm" variant="ghost" icon="close"
          onClick={() => { setPick(''); setCity('All'); }}>Reset</Button>
      )}
    </div>
  );

  return (
    <>
      {/* Dashboard only. Records has the page's own "Records" heading and a
          table that already totals these columns, so this whole block was two
          stacked titles plus four cards restating the footer. */}
      {dash && (
      <section className="section">
        <SectionHeader title={label} note={periodLabel} action={
          onEdit && cur && isRowOpen(cur, rows) ? (
            <button className="pop__item" onClick={() => onEdit(cur)}>Edit</button>
          ) : undefined
        } />

        {picker}

        <div className="grid grid--kpi grid--kpi-std">
          <Kpi i={1} label="Leads" value={formatInt(totals.leads)}
            note={<Delta now={totals.leads} prev={totals.prevLeads} />} />
          <Kpi i={2} label="Orders" value={formatInt(totals.orders)}
            note={<Delta now={totals.orders} prev={totals.prevOrders} />} />
          <Kpi i={3} label="Conversion" value={formatPct(totals.conv, 1)}
            note={<span className="mk__note">Orders as a share of leads</span>} />
          <Kpi i={4} label="Value" value={formatINRCompact(totals.value)} lead
            note={<Delta now={totals.value} prev={totals.prevValue} money />} />
        </div>

        {/* Add on and Total, as a quiet strip rather than two more cards
            competing with the four above — but on the same four-column track,
            so each cell is exactly one card wide and their edges line up. */}
        <div className="coll__strip coll__strip--kpi4">
          <div className="coll__cell">
            <span className="coll__lb">Add on</span>
            <span className="coll__v num">{formatInt(totals.addon)}</span>
          </div>
          <div className="coll__cell">
            <span className="coll__lb">Total</span>
            <span className="coll__v num">{formatInt(totals.total)}</span>
          </div>
        </div>
      </section>
      )}

      <section className="section">
        {dash
          ? <SectionHeader title="By city" note={periodLabel} />
          : picker}
        <div className="card"><div className="card__bd">
          <div style={{ overflowX: 'auto' }}>
            <table className="captbl">
              <thead>
                <tr>
                  <th scope="col">City</th>
                  <th scope="col" className="is-num">Leads</th>
                  <th scope="col" className="is-num">Orders</th>
                  {!dash && <th scope="col" className="is-num">vs prev</th>}
                  <th scope="col" className="is-num">Conversion</th>
                  <th scope="col" className="is-num">Value</th>
                  {!dash && <th scope="col" className="is-num">vs prev</th>}
                  {!dash && <th scope="col" className="is-num">Add on</th>}
                  {!dash && <th scope="col" className="is-num">Total</th>}
                </tr>
              </thead>
              <tbody>
                {activeCities.map(c => {
                  const leads = wCity(windowed, c.key, 'leads');
                  const orders = wCity(windowed, c.key, 'orders');
                  const value = wCity(windowed, c.key, 'value');
                  const addon = wCity(windowed, c.key, 'addon');
                  return (
                    <tr key={c.key}>
                      <td className="is-key">{c.name}</td>
                      <td className="is-num">{formatInt(leads)}</td>
                      <td className="is-num">{formatInt(orders)}</td>
                      {!dash && (
                        <td className="is-num">
                          <Delta now={orders} prev={wCity(priorWindow, c.key, 'orders')} />
                        </td>
                      )}
                      <td className="is-num">
                        {leads > 0 ? formatPct((orders / leads) * 100, 0) : '—'}
                      </td>
                      <td className="is-num">{formatINRCompact(value)}</td>
                      {!dash && (
                        <td className="is-num">
                          <Delta now={value} prev={wCity(priorWindow, c.key, 'value')} money />
                        </td>
                      )}
                      {!dash && <td className="is-num">{formatInt(addon)}</td>}
                      {!dash && <td className="is-num">{formatInt(orders + addon)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="is-key"><b>Total</b></td>
                  <td className="is-num"><b>{formatInt(totals.leads)}</b></td>
                  <td className="is-num"><b>{formatInt(totals.orders)}</b></td>
                  {!dash && (
                    <td className="is-num">
                      <Delta now={totals.orders} prev={totals.prevOrders} />
                    </td>
                  )}
                  <td className="is-num"><b>{formatPct(totals.conv, 0)}</b></td>
                  <td className="is-num"><b>{formatINRCompact(totals.value)}</b></td>
                  {!dash && (
                    <td className="is-num">
                      <Delta now={totals.value} prev={totals.prevValue} money />
                    </td>
                  )}
                  {!dash && <td className="is-num"><b>{formatInt(totals.addon)}</b></td>}
                  {!dash && <td className="is-num"><b>{formatInt(totals.total)}</b></td>}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* The line the report carries under the table. Written from the
              previous row rather than typed, so it cannot describe a comparison
              that the numbers above it do not support. */}
          {priorWindow.length ? (
            <p className="cef__note">
              Revenue {valueDiff < 0 ? 'decreased' : 'increased'} by{' '}
              {formatINR(Math.abs(valueDiff))}
              {totals.prevValue > 0 &&
                ` (${Math.abs((valueDiff / totals.prevValue) * 100).toFixed(2)}%)`}
              {' '}compared to {priorWindow.length > 1
                ? `the previous ${priorWindow.length} months`
                : monthName(priorWindow[0][1].month)}.
            </p>
          ) : (
            <p className="cef__note">No earlier period recorded, so there is nothing to compare against.</p>
          )}
        </div></div>
      </section>

      {dash && (
        <section className="section">
          <SectionHeader title="Analysis" />

          <div>
            {/* One month of data has no mix to shift, and a lone stacked
                column reads as a bug. Until a second month exists the same
                question is answered as a share of the period. */}
            {composition.length < 2 ? (
              <ChartFrame title="Revenue share by city" department="sales" height={260}
                question="Which cities are carrying the revenue?"
                isEmpty={!mixShare.length}
                emptyBody="No revenue recorded for this period yet.">
                {h => (
                  <DonutChart height={h} data={mixShare} centerLabel="Revenue"
                    valueFormat={formatINRCompact} />
                )}
              </ChartFrame>
            ) : (
              <ChartFrame title="Revenue mix by city" department="sales" height={260}
                question="Is the revenue shifting between cities, or is one carrying it?"
                isEmpty={false}>
                {h => (
                  <StackedBarChart height={h} data={composition}
                    keys={activeCities.map(c => c.key)}
                    labels={Object.fromEntries(activeCities.map(c => [c.key, c.name]))}
                    valueFormat={formatINRCompact} />
                )}
              </ChartFrame>
            )}
          </div>

          <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
            <ChartFrame title="Conversion by city over time" department="sales" height={240}
              question="Is any city winning more leads but closing fewer of them?"
              isEmpty={cityConvTrend.length < 2}
              emptyBody="Two months are needed before a trend means anything.">
              {h => (
                <TrendChart height={h} data={cityConvTrend} valueFormat={v => formatPct(v, 1)}
                  series={citySeries} legendStat="none" />
              )}
            </ChartFrame>

            <ChartFrame title="Cities ranked by value" department="sales" height={240}
              question="Which cities carry the selected period?"
              isEmpty={!cityRank.length}>
              {h => (
                <CategoryChart height={h} data={cityRank} valueFormat={formatINRCompact} />
              )}
            </ChartFrame>
          </div>

          <div className="grid" style={{ marginTop: 'var(--s4)' }}>
            <ChartFrame title="Value by city and month" department="sales" height={240}
              question="Is a soft month one city, or everywhere at once?"
              isEmpty={!heat.colKeys.length}>
              {() => (
                <Heatmap rowKeys={heat.rowKeys} colKeys={heat.colKeys} cells={heat.cells}
                  valueFormat={formatINRCompact} rowLabel="City" colLabel="Month" />
              )}
            </ChartFrame>
          </div>
        </section>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Records: one row per month                                                 */
/* -------------------------------------------------------------------------- */

/** Every figure the sheet holds for a month, in one row. Next month lands in
 *  the row below rather than replacing what is on screen, so the table reads
 *  as history — the same shape Control Tower and Marketing records use.
 *  Cities are column families, so the City filter hides columns rather than
 *  rows, and Edit is offered only on the newest recorded month. */
function SalesMonthTable({
  months, monthKeys, allRows, datasetId, cities, city, onCity, period, onPeriod, onEdit,
}: {
  /** [yyyy-mm, row] newest first. */
  months: [string, Row][];
  monthKeys: string[];
  /** Every row of the dataset, for the newest-month check. */
  allRows: Row[];
  datasetId?: string;
  cities: { key: string; name: string }[];
  city: string;
  onCity: (v: string) => void;
  period: string;
  onPeriod: (v: string) => void;
  onEdit?: (r: Row) => void;
}) {
  const nav = useNavigate();
  const METRICS = [
    { id: 'leads', label: 'Leads' },
    { id: 'orders', label: 'Orders' },
    { id: 'conv', label: 'Conversion' },
    { id: 'value', label: 'Value' },
    { id: 'addon', label: 'Add on' },
    { id: 'total', label: 'Total' },
  ] as const;

  const visible = period === 'all'
    ? months
    : (() => {
      const keep = new Set(keysInWindow(monthKeys, period));
      return months.filter(([k]) => keep.has(k));
    })();

  const periodOptions = [
    { value: 'all', label: 'All months' },
    ...WINDOW_PRESETS.map(p => ({ value: p.id, label: p.label })),
    ...ytdOptions(monthKeys).map(y => ({ value: y.id, label: y.label })),
    ...monthKeys.map(k => ({ value: k, label: monthLabel(`${k}-01`) })),
  ];

  /** One city's figure, or every visible city added up for the Overall band. */
  const cell = (r: Row, keys: string[], metric: string) => {
    const leads = keys.reduce((a, k) => a + n(r[`${k}_leads`]), 0);
    const orders = keys.reduce((a, k) => a + n(r[`${k}_orders`]), 0);
    const addon = keys.reduce((a, k) => a + n(r[`${k}_addon`]), 0);
    const value = keys.reduce((a, k) => a + n(r[`${k}_value`]), 0);
    switch (metric) {
      case 'leads': return formatInt(leads);
      case 'orders': return formatInt(orders);
      case 'conv': return leads > 0 ? formatPct((orders / leads) * 100, 0) : '—';
      case 'value': return formatINRCompact(value);
      case 'addon': return formatInt(addon);
      default: return formatInt(orders + addon);
    }
  };

  const bands = [
    ...cities.map(c => ({ label: c.name, keys: [c.key] })),
    /* Only worth a band when it is not a copy of the single city band. */
    ...(cities.length > 1 ? [{ label: 'Overall', keys: cities.map(c => c.key) }] : []),
  ];

  return (
    <>
      <div className="filter-bar">
        <SelectField icon="calendar" label="Period" value={period} onChange={onPeriod}
          isOn={period !== 'all'} options={periodOptions} />
        <SelectField icon="radar" label="City" value={city} onChange={onCity}
          isOn={city !== 'All'}
          options={[{ value: 'All', label: 'All cities' },
            ...CITIES.map(c => ({ value: c.key, label: c.name }))]} />
        {(period !== 'all' || city !== 'All') && (
          <Button size="sm" variant="ghost" icon="close"
            onClick={() => { onPeriod('all'); onCity('All'); }}>
            Reset
          </Button>
        )}
      </div>

      <div className="card">
        <div className="card__bd" style={{ padding: 0 }}>
          {!visible.length ? (
            <p className="cef__note" style={{ padding: 16 }}>No months in this period.</p>
          ) : (
            <div className="tbl__scroll">
              <table className="xpose xpose--free">
                <thead>
                  <tr>
                    <th className="xpose__rowhd" rowSpan={2}>Month</th>
                    {bands.map(b => (
                      <th key={b.label} colSpan={METRICS.length} className="is-num">{b.label}</th>
                    ))}
                    <th rowSpan={2} style={{ width: 44 }} />
                  </tr>
                  <tr>
                    {bands.flatMap(b => METRICS.map(m => (
                      <th key={`${b.label}:${m.id}`} className="is-num">{m.label}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(([k, r]) => (
                    <tr key={k}>
                      <th className="xpose__rowhd">{monthLabel(r.month)}</th>
                      {bands.flatMap(b => METRICS.map(m => (
                        <td key={`${b.label}:${m.id}`} className="is-num">{cell(r, b.keys, m.id)}</td>
                      )))}
                      <td className="is-num">
                        <Popover width={170} align="end" trigger={({ toggle, ref }) => (
                          <Button size="sm" iconOnly variant="ghost" icon="more" ref={ref}
                            aria-label="Row actions" onClick={toggle} />
                        )}>
                          {close => (
                            <>
                              {datasetId && r.__id != null && (
                                <button className="pop__item" onClick={() => {
                                  close();
                                  nav(`/d/sales/${datasetId}/${encodeURIComponent(String(r.__id))}`);
                                }}>
                                  <Icon name="external" size={13} /> View record
                                </button>
                              )}
                              {onEdit && isRowOpen(r, allRows) && (
                                <button className="pop__item" onClick={() => { close(); onEdit(r); }}>
                                  <Icon name="edit" size={13} /> Edit
                                </button>
                              )}
                            </>
                          )}
                        </Popover>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
