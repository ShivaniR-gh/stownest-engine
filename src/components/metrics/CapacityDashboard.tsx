import { useMemo, useState, type ReactNode } from 'react';
import '@/styles/collections.css';
import '@/styles/capacity.css';
import { Badge, Button, EmptyState, Icon } from '@/components/primitives';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { DrillDown } from '@/components/data/DrillDown';
import {
  BAND_LABEL, BAND_TONE, band, bandDistribution,
  insights, sumOf, utilisationBy,
  type DerivedSchema, type UtilisationRow,
} from '@/lib/analytics/deriveSchema';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { tabMonthDate } from '@/lib/analytics/monthWindow';
import { formatCompactNum, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { ColumnDef, DatasetDef, Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Capacity dashboard.
 *
 * Rendered for ANY dataset whose mapping declares a `capacity` and an
 * `occupied` column. It holds no warehouse, city or month names — every label,
 * axis and grouping comes from the field mapping, so a different sheet or
 * department produces a correct dashboard with no code change.
 *
 * Laid out like the B2B dashboard on purpose: two rows of icon-chip KPI tiles
 * with sparklines, a Business health strip of plain ratio cards, then a
 * three-column grid of small charts. Same components, same soft palette, same
 * heights — so moving between departments does not feel like moving between
 * products.
 *
 * Space is a SNAPSHOT, not a flow. Three months of readings describe the same
 * floor three times, so headline figures come from the newest month in the
 * period; earlier months feed the trends and the comparisons.
 * ------------------------------------------------------------------------- */

/** Both churn rates divide by an OPENING balance.
 *
 *  Customer churn = who left ÷ who was there at the start (closing − joined +
 *  left). Whoever joined this month was never at risk of leaving it, so
 *  counting them in the denominator flatters the rate.
 *
 *  Space churn = sqft given back ÷ sqft occupied at the start, counting only
 *  sites that reported in BOTH months. A site that simply was not read this
 *  month is missing data, not an empty warehouse, and treating it as a total
 *  loss is what produced the old, alarming figure. */
interface Churn { lost: number; opening: number; pct: number | null }

const num = (r: Row, k: string) => toNum(r[k]) ?? 0;
const sumKey = (rows: Row[], k: string) => rows.reduce((a, r) => a + num(r, k), 0);

function customerChurn(rows: Row[]): Churn {
  const lost = sumKey(rows, 'churned_customers');
  const opening = rows.reduce((a, r) =>
    a + Math.max(0, num(r, 'total_customers') - num(r, 'new_customers') + num(r, 'churned_customers')), 0);
  return { lost, opening, pct: opening > 0 ? (lost / opening) * 100 : null };
}

function spaceChurn(now: Row[], prev: Row[], nameKey: string, occKey: string): Churn {
  if (!prev.length) return { lost: 0, opening: 0, pct: null };
  const nowBy = new Map(now.map(r => [String(r[nameKey] ?? ''), num(r, occKey)]));
  let lost = 0, opening = 0;
  for (const r of prev) {
    const key = String(r[nameKey] ?? '');
    if (!nowBy.has(key)) continue;            // not read this month — not a loss
    const before = num(r, occKey);
    lost += Math.max(0, before - nowBy.get(key)!);
    opening += before;
  }
  return { lost, opening, pct: opening > 0 ? (lost / opening) * 100 : null };
}

/** Delta chip, same shape as the B2B tiles use. */
function chip(p: number | null, tag: string) {
  if (p == null || !Number.isFinite(p)) return <span className="delta delta--na">N/A {tag}</span>;
  const pos = p >= 0;
  return (
    <span className={`delta ${pos ? 'delta--pos' : 'delta--neg'}`}>
      {pos ? '▲' : '▼'} {Math.abs(p).toFixed(1)}% {tag}
    </span>
  );
}

/** KPI tile: icon chip beside the label, the value, a sub line, and a
 *  sparkline of the same metric across the months on screen. */
function Tile({ label, value, tone, sub, lead, icon, spark }: {
  label: string; value: string; tone?: 'neg' | 'pos'; sub?: ReactNode; lead?: boolean;
  icon?: string; spark?: number[];
}) {
  const sparkTone = lead ? 'var(--kpi2-spark-lead)'
    : tone === 'neg' ? 'var(--neg)' : 'var(--accent)';
  return (
    <div className={`metric coll__kpi kpi2${lead ? ' metric--lead' : ''}`} data-kpi={tone === 'neg' ? 3 : 1}>
      <div className="kpi2__hd">
        {icon && <span className={`kpi2__chip${tone === 'neg' ? ' kpi2__chip--neg' : ''}`}>
          <Icon name={icon} size={15} />
        </span>}
        <span className="metric__label">{label}</span>
      </div>
      <div className="metric__value num">{value}</div>
      {sub && <div className="metric__cmp">{sub}</div>}
      {spark && spark.length > 1 && (
        <div className="kpi2__spark"><Sparkline values={spark} tone={sparkTone} height={30} /></div>
      )}
    </div>
  );
}

export function CapacityDashboard({ ds, rows, schema, focusMonth, snapshotRows }: {
  ds: DatasetDef;
  /** Already scoped to the active period and filters by the parent page. */
  rows: Row[];
  schema: DerivedSchema;
  focusMonth?: string;
  /** Rows from the exact tab the picker names. Wins over newest-in-history. */
  snapshotRows?: Row[];
}) {
  const { period } = useAnalytics();
  const [drill, setDrill] = useState<{ title: string; rows: Row[] } | null>(null);
  const { roles, hasUtilisation, primaryDimension } = schema;

  /** Which column names the thing being measured. `roles.name` is the admin's
   *  explicit answer and wins; the dataset's own titleColumn / idColumn come
   *  next, before the inferred dimension — otherwise this panel groups by
   *  location rather than by the row's own name. */
  const mappedCol = (key?: string): ColumnDef | undefined =>
    key ? ds.columns.find(c => c.key === key && c.sheetColumn) : undefined;
  const nameDim: ColumnDef | undefined =
    roles.name ?? mappedCol(ds.titleColumn) ?? mappedCol(ds.idColumn) ?? primaryDimension ?? undefined;
  const locDim: ColumnDef | undefined = roles.location;
  const dateCol: ColumnDef | undefined = roles.date ?? schema.dateColumn ?? undefined;
  const unit = roles.capacity?.header.match(/\(([^)]+)\)/)?.[1] ?? 'sqft';

  const capKey = roles.capacity?.key ?? 'total_space';
  const occKey = roles.occupied?.key ?? 'occupied_space';
  const nameKey = nameDim?.key ?? 'wh_code';

  const byMonth = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const tab = String((r as Row & { _tab?: string })._tab ?? '');
      const fromTab = tab ? tabMonthDate(tab) : null;
      const fromDate = !fromTab && dateCol ? parseDate(r[dateCol.key]) : null;
      const k = fromTab
        ? `${fromTab.getFullYear()}-${String(fromTab.getMonth() + 1).padStart(2, '0')}`
        : fromDate
          ? `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`
          : String(tab || r.month || '').trim();
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    /* One reading per warehouse per month. The same month can arrive twice —
       rows pasted into the wrong tab, or a month re-entered — and because
       space is a snapshot, a duplicate does not add capacity, it doubles it.
       Later rows win, matching how the sheet is read. */
    for (const [k, list] of map) {
      const one = new Map<string, Row>();
      for (const r of list) one.set(String(r[nameKey] ?? ''), r);
      map.set(k, [...one.values()]);
    }

    /* Months whose rows carry no capacity are dropped. A month tab can exist
       with a blank or half-saved row in it — no warehouse, no space — and
       that is missing data, not an empty network. Keeping it made the newest
       month the snapshot and printed zeroes across the page, and pulled every
       trend line down to the axis on its last point. */
    return [...map.entries()]
      .filter(([, list]) => list.reduce((a, r) => a + (toNum(r[capKey]) ?? 0), 0) > 0)
      .sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows, dateCol, capKey, nameKey]);

  const monthName = (k: string) => {
    const [y, m] = k.split('-');
    return m
      ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : k;
  };

  const focusKey = (() => {
    if (!focusMonth || focusMonth === '3m' || focusMonth === '6m' || focusMonth === '12m') return '';
    const d = tabMonthDate(focusMonth);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
  })();
  const focusIdx = focusKey ? byMonth.findIndex(([k]) => k === focusKey) : 0;
  const snapIdx = focusIdx >= 0 ? focusIdx : 0;
  const fromPicker = snapshotRows && snapshotRows.length ? snapshotRows : null;
  const snapshot = fromPicker ?? byMonth[snapIdx]?.[1] ?? rows;
  const prior = byMonth[snapIdx + 1]?.[1] ?? [];
  const snapLabel = focusMonth && !focusMonth.endsWith('m')
    ? focusMonth.replace(/^\S+\s/, '')
    : (byMonth[snapIdx]?.[0] ? monthName(byMonth[snapIdx][0]) : period.label);

  const observations = useMemo(() => insights(snapshot, schema), [snapshot, schema]);
  const byName = useMemo(
    () => (nameDim ? utilisationBy(snapshot, nameDim, schema, 200) : []),
    [snapshot, nameDim, schema]);
  const byLoc = useMemo(
    () => (locDim ? utilisationBy(snapshot, locDim, schema, 40) : []),
    [snapshot, locDim, schema]);
  const distribution = useMemo(() => bandDistribution(byName), [byName]);

  const capacity = sumOf(snapshot, roles.capacity);
  const occupied = sumOf(snapshot, roles.occupied);
  const available = Math.max(0, capacity - occupied);
  const util = capacity > 0 ? (occupied / capacity) * 100 : 0;
  const utilBand = band(util);

  const hasCustomers = ds.columns.some(c => c.key === 'total_customers');
  const cChurn = useMemo(() => customerChurn(snapshot), [snapshot]);
  const sChurn = useMemo(
    () => spaceChurn(snapshot, prior, nameKey, occKey), [snapshot, prior, nameKey, occKey]);
  const customers = sumKey(snapshot, 'total_customers');
  const avgSpace = customers > 0 ? occupied / customers : 0;

  const priorOcc = sumKey(prior, occKey);
  const priorCap = sumKey(prior, capKey);
  const priorUtil = priorCap > 0 ? (priorOcc / priorCap) * 100 : 0;
  const pctDelta = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : null;

  /** Per-month figures, oldest first: the trends and the tile sparklines are
   *  built from the same series, so they can never tell different stories. */
  const trend = useMemo(() => [...byMonth].reverse().map(([k, list], i, all) => {
    const occ = sumKey(list, occKey);
    const cap = sumKey(list, capKey);
    const cust = sumKey(list, 'total_customers');
    const cc = customerChurn(list);
    const sc = spaceChurn(list, all[i - 1]?.[1] ?? [], nameKey, occKey);
    return {
      key: k, label: monthName(k), rows: list,
      values: {
        occupied: occ,
        available: Math.max(0, cap - occ),
        util: cap ? (occ / cap) * 100 : 0,
        customers: cust,
        joined: sumKey(list, 'new_customers'),
        left: sumKey(list, 'churned_customers'),
        churn: cc.pct ?? 0,
        spaceChurn: sc.pct ?? 0,
        avg: cust ? occ / cust : 0,
      },
    };
  }), [byMonth, occKey, capKey, nameKey]);

  const sparkOf = (key: keyof typeof trend[number]['values']): number[] | undefined => {
    const vals = trend.map(p => p.values[key] ?? 0);
    return vals.length > 1 ? vals : undefined;
  };

  if (!hasUtilisation) {
    return (
      <div className="card">
        <EmptyState icon="layers" title="Capacity analytics not configured"
          body={'Map one column as “capacity” and one as “occupied” in this dataset\'s field mapping, and utilisation, available space and near-full warnings appear here automatically.'} />
      </div>
    );
  }

  const open = (u: UtilisationRow) => setDrill({ title: u.key, rows: u.rows });
  const h = 200;
  const cols6 = { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' };

  return (
    <div className="b2b-dash">
      <section className="section">
        <SectionHeader title="Capacity"
          note={`${formatInt(snapshot.length)} ${snapshot.length === 1 ? 'site' : 'sites'} · ${snapLabel}`} />

        {/* Four questions this page exists to answer — how full are we, what
            does a customer take, and are customers or space walking out — plus
            the two space figures they are computed from. Counts that only feed
            those ratios (total capacity, new/left, near-full site counts) are
            not tiles: they are in the status strip and the site table below. */}
        <div className="grid grid--kpi grid--kpi-std" style={cols6}>
          <Tile label="Utilisation" value={formatPct(util, 1)} lead icon="chart" spark={sparkOf('util')}
            sub={<>{chip(pctDelta(util, priorUtil), 'MoM')} <span className="mk__note">{BAND_LABEL[utilBand]}</span></>} />
          <Tile label={`Occupied ${unit}`} value={formatInt(occupied)} icon="layers" spark={sparkOf('occupied')}
            sub={chip(pctDelta(occupied, priorOcc), 'MoM')} />
          <Tile label={`Available ${unit}`} value={formatInt(available)} icon="box" spark={sparkOf('available')}
            sub={<span className="mk__note">of {formatCompactNum(capacity)} {unit}</span>} />
          <Tile label={`Average ${unit} / customer`} value={customers ? formatInt(avgSpace) : '—'}
            icon="users" spark={sparkOf('avg')}
            sub={<span className="mk__note">{customers ? `${formatInt(customers)} customers` : 'No customers recorded'}</span>} />
          <Tile label="Customer churn" value={cChurn.pct == null ? '—' : formatPct(cChurn.pct, 1)}
            icon="logout" spark={sparkOf('churn')}
            tone={cChurn.pct != null && cChurn.pct > 5 ? 'neg' : undefined}
            sub={<span className="mk__note">
              {cChurn.pct == null ? 'Needs customer counts'
                : `${formatInt(cChurn.lost)} of ${formatInt(cChurn.opening)} at month start`}
            </span>} />
          <Tile label="Space churn" value={sChurn.pct == null ? '—' : formatPct(sChurn.pct, 1)}
            icon="trash" spark={sparkOf('spaceChurn')}
            tone={sChurn.pct != null && sChurn.pct > 5 ? 'neg' : undefined}
            sub={<span className="mk__note">
              {sChurn.pct == null ? 'Needs a previous month'
                : `${formatCompactNum(sChurn.lost)} ${unit} given back`}
            </span>} />
        </div>
      </section>

      {distribution.length > 0 && (
        <section className="section">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Utilisation status</h3>
          <div className="bands">
            {distribution.map(d => (
              <div key={d.band} className="bandcard" data-band={d.band}>
                <div className="bandcard__top">
                  <div className="bandcard__lb">{d.label}</div>
                  <div className="bandcard__n">{formatInt(d.count)}</div>
                </div>
                <div className="bandcard__track" aria-hidden>
                  <span style={{ width: `${Math.min(100, d.share)}%` }} />
                </div>
                <div className="bandcard__meta">
                  {formatPct(d.share, 0)} of sites · {formatCompactNum(d.capacity)} {unit}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          <ChartFrame title="Utilisation trend" question="How full is the network month to month?" height={h}
            isEmpty={trend.length < 2}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={n => formatPct(n, 1)} legendStat="none"
              series={[{ id: 'util', label: 'Utilisation %', kind: 'line', colorIndex: 0 }]}
              onPointClick={p => setDrill({ title: p.label, rows: p.rows })} />}
          </ChartFrame>

          {locDim && (
            <ChartFrame title={`Utilisation by ${locDim.header.toLowerCase()}`}
              question="Which areas are tight and which are idle?" height={h} isEmpty={!byLoc.length}>
              {hh => <CategoryChart height={hh} valueFormat={n => formatPct(n, 1)} colorIndex={0}
                valueLabel="Utilisation"
                data={[...byLoc].sort((a, b) => b.pct - a.pct).map(u => ({
                  key: u.key, value: Math.min(100, u.pct), count: u.rows.length, rows: u.rows,
                }))}
                onBarClick={d => setDrill({ title: d.key, rows: d.rows })} />}
            </ChartFrame>
          )}

          <ChartFrame title="Space churn trend" question="How much space is being given back?" height={h}
            isEmpty={trend.length < 2}>
            {hh => <TrendChart height={hh} data={trend.slice(1)} valueFormat={n => formatPct(n, 1)}
              legendStat="none"
              series={[{ id: 'spaceChurn', label: 'Space churn %', kind: 'bar', colorIndex: 3 }]}
              onPointClick={p => setDrill({ title: p.label, rows: p.rows })} />}
          </ChartFrame>

          {hasCustomers && (
            <ChartFrame title="Customer churn trend" question="Is churn getting worse?" height={h}
              isEmpty={trend.length < 2}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={n => formatPct(n, 1)} legendStat="none"
                series={[{ id: 'churn', label: 'Churn %', kind: 'line', colorIndex: 3 }]}
                onPointClick={p => setDrill({ title: p.label, rows: p.rows })} />}
            </ChartFrame>
          )}

          {hasCustomers && (
            <ChartFrame title={`Average ${unit} per customer`} question="Are customers taking more space or less?"
              height={h} isEmpty={trend.length < 2}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt} legendStat="none"
                series={[{ id: 'avg', label: `${unit} / customer`, kind: 'line', colorIndex: 4 }]}
                onPointClick={p => setDrill({ title: p.label, rows: p.rows })} />}
            </ChartFrame>
          )}

          {nameDim && byName.length > 0 && (
            <ChartFrame title="Sites closest to full" question="Which sites have no room left to sell?" height={h}>
              {hh => <CategoryChart height={hh} maxBars={10} valueFormat={n => formatPct(n, 1)}
                valueLabel="Utilisation" colorIndex={3}
                data={[...byName].sort((a, b) => b.pct - a.pct).map(u => ({
                  key: u.key, value: Math.min(100, u.pct), count: u.rows.length, rows: u.rows,
                }))}
                onBarClick={d => setDrill({ title: d.key, rows: d.rows })} />}
            </ChartFrame>
          )}

          {nameDim && byName.length > 0 && (
            <ChartFrame title="Space still free by site" question="Where can the next customer be placed?" height={h}>
              {hh => <CategoryChart height={hh} maxBars={10} valueFormat={formatCompactNum}
                valueLabel={`Available ${unit}`} colorIndex={1}
                data={[...byName].sort((a, b) => b.available - a.available).map(u => ({
                  key: u.key, value: u.available, count: u.rows.length, rows: u.rows,
                }))}
                onBarClick={d => setDrill({ title: d.key, rows: d.rows })} />}
            </ChartFrame>
          )}
        </div>
      </section>

      {observations.length > 0 && (
        <section className="section">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Notes</h3>
          <div className="insights">
            {observations.map(t => (
              <div key={t} className="insight"
                data-tone={/no remaining|at or above/i.test(t) ? 'neg' : /headroom|unused|largest/i.test(t) ? 'pos' : 'signal'}>
                <Icon name={/no remaining|at or above/i.test(t) ? 'alert' : 'info'} size={15} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {nameDim && byName.length > 0 && (
        <section className="section">
          <SectionHeader title={`${nameDim.header} detail`}
            note={`${snapLabel} · read-only. Add, edit and delete in Records below.`}
            action={<Button size="sm" variant="ghost" icon="chevronDown"
              onClick={() => document.querySelector('.tbl__wrap')?.scrollIntoView({ behavior: 'smooth' })}>
              Go to records
            </Button>} />
          <div className="card card--flat">
            <div className="tbl__scroll" style={{ maxHeight: '60vh' }}>
              <table className="captbl">
                <thead>
                  <tr>
                    <th>{nameDim.header}</th>
                    {locDim && <th>{locDim.header}</th>}
                    <th className="is-num">{roles.capacity?.header}</th>
                    <th className="is-num">{roles.occupied?.header}</th>
                    <th className="is-num">Available</th>
                    <th style={{ width: 180 }}>Utilisation</th>
                    {hasCustomers && <th className="is-num">Customers</th>}
                    {hasCustomers && <th className="is-num">Churn</th>}
                    <th style={{ width: 140 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {byName.map(u => {
                    const loc = locDim ? String(u.rows[0]?.[locDim.key] ?? '') : '';
                    const cc = customerChurn(u.rows);
                    const cust = sumKey(u.rows, 'total_customers');
                    return (
                      <tr key={u.key} onClick={() => open(u)} style={{ cursor: 'pointer' }}>
                        <td className="is-key">{u.key}</td>
                        {locDim && <td>{loc}</td>}
                        <td className="is-num">{formatInt(u.capacity)}</td>
                        <td className="is-num">{formatInt(u.occupied)}</td>
                        <td className="is-num">{formatInt(u.available)}</td>
                        <td>
                          <span className="util__bar">
                            <span className="util__track" data-band={u.band}>
                              <span style={{ width: `${Math.min(100, u.pct)}%` }} />
                            </span>
                            <span className="util__pct">{formatPct(u.pct, 1)}</span>
                          </span>
                        </td>
                        {hasCustomers && <td className="is-num">{cust ? formatInt(cust) : '—'}</td>}
                        {hasCustomers && (
                          <td className="is-num" data-tone={cc.pct && cc.pct > 5 ? 'neg' : undefined}>
                            {cc.pct === null ? '—' : formatPct(cc.pct, 1)}
                          </td>
                        )}
                        <td><Badge tone={BAND_TONE[u.band]}>{BAND_LABEL[u.band]}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {drill && (
        <DrillDown title={drill.title} dataset={ds} rows={drill.rows}
          subtitle={`${drill.rows.length} records · ${period.label}`}
          onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
