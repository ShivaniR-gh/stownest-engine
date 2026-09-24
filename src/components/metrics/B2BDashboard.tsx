import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { Button, EmptyState, Icon } from '@/components/primitives';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { SeriesPoint } from '@/lib/analytics/aggregate';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { SelectField } from '@/components/filters/SelectField';
import { defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { ChartsHeading } from '@/components/charts/chartKind';

const B2BSalesDashboard = lazy(() =>
  import('@/components/metrics/B2BSalesDashboard').then(m => ({ default: m.B2BSalesDashboard })),
);

const n = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);
const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
};

function chip(p: number | null, tag: string) {
  if (p == null || !Number.isFinite(p)) return <span className="delta delta--na">N/A {tag}</span>;
  const pos = p >= 0;
  return (
    <span className={`delta ${pos ? 'delta--pos' : 'delta--neg'}`}>
      {pos ? '▲' : '▼'} {Math.abs(p).toFixed(1)}% {tag}
    </span>
  );
}

/** A KPI tile in the reference layout: an icon chip beside the label, the
 *  value, its delta chips, and a sparkline of the same metric across the
 *  selected window. The icon is passed in per tile rather than derived from
 *  the value's format — a format-derived icon just repeats itself (every
 *  plain count gets the same glyph), which is why the old auto-icon was
 *  removed. Here each one is chosen for what the metric actually is. */
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

function Health({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value num">{value}</div>
      {hint && <div className="metric__cmp">{hint}</div>}
    </div>
  );
}

export function B2BDashboard({ rows, activeDatasetId }: {
  rows: Record<string, Row[]>;
  activeDatasetId?: string;
}) {
  if (activeDatasetId === 'b2b_sales') {
    return (
      <Suspense fallback={<EmptyState icon="trending" title="Loading sales…" body="" />}>
        <B2BSalesDashboard rows={rows} />
      </Suspense>
    );
  }
  return <B2BAccountsDashboard rows={rows} />;
}

function B2BAccountsDashboard({ rows }: { rows: Record<string, Row[]> }) {
  const occ = rows.b2b_occupancy ?? [];
  const moves = rows.b2b_moves ?? [];
  const rev = rows.b2b_revenue ?? [];
  const movement = rows.b2b_movement ?? [];

  const months = useMemo(() => {
    const s = new Set<string>();
    for (const r of [...occ, ...moves, ...rev, ...movement]) {
      const k = monthKey(r.month);
      if (k) s.add(k);
    }
    return [...s].sort().reverse();
  }, [occ, moves, rev, movement]);
  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const r of [...occ, ...moves, ...rev, ...movement]) {
      const c = String(r.city ?? '').trim();
      if (c) s.add(c === 'Bangalore' ? 'Bengaluru' : c);
    }
    return [...s].sort();
  }, [occ, moves, rev, movement]);

  const [periodRaw, setPeriod] = useState<string>('');
  /** Opens on last month; an explicit choice overrides it. Kept as a derived
   *  value rather than a useState initializer because the month list is not
   *  known on first render. */
  const period = periodRaw || defaultMonthPeriod(months);
  const [city, setCity] = useState('All');
  const [clientType, setClientType] = useState('All');
  const [service, setService] = useState('All');

  const normCity = (c: string) => c === 'Bangalore' ? 'Bengaluru' : c;
  const dedupeCityMonth = (list: Row[]) => {
    const map = new Map<string, Row>();
    for (const r of list) {
      const k = `${monthKey(r.month)}|${normCity(String(r.city ?? '').trim())}`;
      map.set(k, r);
    }
    return [...map.values()];
  };
  const occU = dedupeCityMonth(occ);
  const movesU = dedupeCityMonth(moves);
  const revU = dedupeCityMonth(rev);
  const windowKeys = (() => {
    if (period === '3m') return months.slice(0, 3);
    if (period === '6m') return months.slice(0, 6);
    if (period === '12m') return months.slice(0, 12);
    if (period.startsWith('ytd-')) {
      const y = period.slice(4);
      return months.filter(k => k.startsWith(y));
    }
    return months.filter(k => k === period);
  })();
  const latestKey = windowKeys[0] ?? '';
  const inCity = (list: Row[]) =>
    city === 'All' ? list : list.filter(r => normCity(String(r.city ?? '').trim()) === city);
  const inWin = (list: Row[]) => list.filter(r => windowKeys.includes(monthKey(r.month)));
  const inLatest = (list: Row[]) => list.filter(r => monthKey(r.month) === latestKey);

  const occF = inWin(inCity(occU));
  const occNow = inLatest(inCity(occU));
  const movF = inWin(inCity(movesU));
  const revF = inWin(inCity(revU));
  const mvF = inWin(inCity(movement));

  const pickClients = (r: Row) => {
    if (clientType === 'Transactional') return n(r, 'txn_clients');
    if (clientType === 'Non Transactional') return n(r, 'nontxn_clients');
    if (clientType === 'Document') return n(r, 'doc_clients');
    return n(r, 'active_clients');
  };
  const pickSqft = (r: Row) => {
    if (clientType === 'Transactional') return n(r, 'txn_sqft');
    if (clientType === 'Non Transactional') return n(r, 'nontxn_sqft');
    if (clientType === 'Document') return 0;
    return n(r, 'occupied_sqft');
  };

  const active = occNow.reduce((a, r) => a + pickClients(r), 0);
  const sqft = occNow.reduce((a, r) => a + pickSqft(r), 0);

  const mvTyped = clientType === 'All' ? mvF
    : mvF.filter(r => String(r.client_type ?? '') === clientType);
  const neu = mvTyped.filter(r => String(r.movement) === 'New Client').length;
  const vacated = mvTyped.filter(r => String(r.movement) === 'Vacated').length;
  const added = mvTyped.reduce((a, r) => a + Math.max(0, n(r, 'sqft_change')), 0);
  const lost = mvTyped.reduce((a, r) => a + Math.max(0, -n(r, 'sqft_change')), 0);
  const occWindowSqft = occF.reduce((a, r) => a + pickSqft(r), 0);
  const inward = movF.reduce((a, r) => a + n(r, 'inward'), 0);
  const outward = movF.reduce((a, r) => a + n(r, 'outward'), 0);
  const txns = inward + outward;
  const rental = revF.reduce((a, r) => a + n(r, 'rental_rev'), 0);
  const txnR = revF.reduce((a, r) => a + n(r, 'txn_rev'), 0);
  const logi = revF.reduce((a, r) => a + n(r, 'logistics_rev'), 0);
  const sliceRev = (r: Row) =>
    service === 'Rental' ? n(r, 'rental_rev')
    : service === 'Transaction' ? n(r, 'txn_rev')
    : service === 'Logistics' ? n(r, 'logistics_rev')
    : n(r, 'rental_rev') + n(r, 'txn_rev') + n(r, 'logistics_rev');
  const totRev = service === 'Rental' ? rental
    : service === 'Transaction' ? txnR
    : service === 'Logistics' ? logi
    : rental + txnR + logi;
  const revSum = (keys: string[]) =>
    inCity(revU).filter(r => keys.includes(monthKey(r.month))).reduce((a, r) => a + sliceRev(r), 0);

  const shift = (k: string, monthsBack: number) => {
    if (!k) return '';
    const [y, m] = k.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const momKey = shift(latestKey, 1);
  const yoyKey = shift(latestKey, 12);
  const stockAt = (k: string) => {
    const list = inCity(occU).filter(r => monthKey(r.month) === k);
    return {
      active: list.reduce((a, r) => a + pickClients(r), 0),
      sqft: list.reduce((a, r) => a + pickSqft(r), 0),
    };
  };
  const mom = stockAt(momKey);
  const yoy = stockAt(yoyKey);
  const pctDelta = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : null;
  const latestRev = revSum(latestKey ? [latestKey] : []);
  const momRev = revSum(momKey ? [momKey] : []);
  const yoyRev = revSum(yoyKey ? [yoyKey] : []);

  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  // Raw, Client-Type-unfiltered monthly totals — the reference sheet's
  // Business Health and Revenue/Client formulas only ever filter by city,
  // never by Client Type, even though the dashboard has that dropdown.
  const totalActiveAt = (k: string) =>
    inCity(occU).filter(r => monthKey(r.month) === k).reduce((a, r) => a + n(r, 'active_clients'), 0);
  const totalOccupiedAt = (k: string) =>
    inCity(occU).filter(r => monthKey(r.month) === k).reduce((a, r) => a + n(r, 'occupied_sqft'), 0);

  const monthRates = windowKeys.map(k => {
    const prevActive = totalActiveAt(shift(k, 1));
    const prevSqft = totalOccupiedAt(shift(k, 1));
    if (prevActive <= 0) {
      return { clientGrowth: null, sqftGrowth: null, clientChurn: null, spaceChurn: null };
    }
    const mvK = inCity(movement).filter(r => monthKey(r.month) === k);
    const newK = mvK.filter(r => String(r.movement) === 'New Client').length;
    const vacatedK = mvK.filter(r => String(r.movement) === 'Vacated').length;
    const addedK = mvK.reduce((a, r) => a + Math.max(0, n(r, 'sqft_change')), 0);
    const lostK = mvK.reduce((a, r) => a + Math.max(0, -n(r, 'sqft_change')), 0);
    return {
      clientGrowth: ((newK - vacatedK) / prevActive) * 100,
      sqftGrowth: prevSqft > 0 ? ((addedK - lostK) / prevSqft) * 100 : null,
      clientChurn: (vacatedK / prevActive) * 100,
      spaceChurn: prevSqft > 0 ? (lostK / prevSqft) * 100 : null,
    };
  });
  const clientGrowth = avg(monthRates.map(r => r.clientGrowth));
  const sqftGrowth = avg(monthRates.map(r => r.sqftGrowth));
  const clientChurn = avg(monthRates.map(r => r.clientChurn));
  const spaceChurn = avg(monthRates.map(r => r.spaceChurn));

  // Revenue/client: average of each month's own (revenue ÷ clients) ratio,
  // matching the reference sheet's per-month LAMBDA. Two things the old
  // `totRev / active` version got wrong:
  //  1) totRev summed revenue across the whole window but active was only
  //     the latest month's snapshot — mismatched periods.
  //  2) The reference's client count is always total Active Clients
  //     (column C), unfiltered by Client Type — so this ratio ignores the
  //     Client Type dropdown even when it's set, same as the sheet does.
  const revPerClientRatios = windowKeys.map(k => {
    const revK = revSum([k]);
    const clientsK = totalActiveAt(k);
    return clientsK > 0 ? revK / clientsK : null;
  });
  const revPerClient = avg(revPerClientRatios);

  const trendKeys = [...windowKeys].slice().reverse();
  const trend: SeriesPoint[] = trendKeys.map(k => {
    const o = inCity(occU).filter(r => monthKey(r.month) === k);
    const m = inCity(movesU).filter(r => monthKey(r.month) === k);
    const rv = inCity(revU).filter(r => monthKey(r.month) === k);
    const mv = inCity(movement).filter(r => monthKey(r.month) === k);
    const rent = rv.reduce((a, r) => a + n(r, 'rental_rev'), 0);
    const tr = rv.reduce((a, r) => a + n(r, 'txn_rev'), 0);
    const lg = rv.reduce((a, r) => a + n(r, 'logistics_rev'), 0);
    const tot = rent + tr + lg;
    const occu = o.reduce((a, r) => a + n(r, 'occupied_sqft'), 0);
    const inn = m.reduce((a, r) => a + n(r, 'inward'), 0);
    const out = m.reduce((a, r) => a + n(r, 'outward'), 0);
    return {
      key: k,
      label: monthLabel(k + '-01'),
      values: {
        revenue: tot, rental: rent, txn: tr, logi: lg, occupied: occu,
        active: o.reduce((a, r) => a + n(r, 'active_clients'), 0),
        neu: mv.filter(r => String(r.movement) === 'New Client').length,
        vacated: mv.filter(r => String(r.movement) === 'Vacated').length,
        added: mv.reduce((a, r) => a + Math.max(0, n(r, 'sqft_change')), 0),
        lost: mv.reduce((a, r) => a + Math.max(0, -n(r, 'sqft_change')), 0),
        txns: inn + out,
        revPerSqft: occu ? tot / occu : 0,
      },
      rows: [...o, ...m, ...rv, ...mv],
    };
  });

  /** Per-month values for one metric, oldest-first, for the tile sparklines.
   *  Reuses the same `trend` series the charts below are built from, so a
   *  tile's sparkline and its chart can never tell different stories. */
  const sparkOf = (key: string): number[] | undefined => {
    const vals = trend.map(p => p.values[key] ?? 0);
    return vals.length > 1 ? vals : undefined;
  };

  const byCityOcc = cities.map(c => {
    const list = inLatest(occU).filter(r => normCity(String(r.city ?? '').trim()) === c);
    return { key: c, value: list.reduce((a, r) => a + pickSqft(r), 0), count: list.length, rows: list };
  }).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  const byCityRev = cities.map(c => {
    const list = inWin(revU).filter(r => normCity(String(r.city ?? '').trim()) === c);
    return { key: c, value: list.reduce((a, r) => a + n(r, 'rental_rev') + n(r, 'txn_rev') + n(r, 'logistics_rev'), 0), count: list.length, rows: list };
  }).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  const byCityTxn = cities.map(c => {
    const list = inWin(movesU).filter(r => normCity(String(r.city ?? '').trim()) === c);
    return { key: c, value: list.reduce((a, r) => a + n(r, 'inward') + n(r, 'outward'), 0), count: list.length, rows: list };
  }).filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  const reasons = (() => {
    const map = new Map<string, number>();
    for (const r of mvF.filter(x => String(x.movement) === 'Vacated')) {
      const reason = String(r.reason ?? 'Unspecified').trim() || 'Unspecified';
      map.set(reason, (map.get(reason) ?? 0) + 1);
    }
    return [...map.entries()].map(([key, value]) => ({ key, value, count: value, rows: [] as Row[] }))
      .sort((a, b) => b.value - a.value);
  })();

  const empty = !occ.length && !moves.length && !rev.length && !movement.length;
  if (empty) {
    return (
      <EmptyState icon="chart" title="No B2B rows yet"
        body="Save occupancy, moves, revenue and client movement. The dashboard builds itself from those chips." />
    );
  }

  const h = 200;

  return (
    <div className="b2b-dash">
      <section className="section">
        <div className="filter-bar">
          <PeriodSelect value={period} onChange={setPeriod} monthKeys={months} />
          <SelectField icon="radar" label="City" value={city} onChange={setCity}
            isOn={city !== 'All'}
            options={[{ value: 'All', label: 'All cities' }, ...cities.map(c => ({ value: c, label: c }))]} />
          <SelectField icon="users" label="Client type" value={clientType} onChange={setClientType}
            isOn={clientType !== 'All'}
            options={[
              { value: 'All', label: 'All client types' },
              ...['Transactional', 'Non Transactional', 'Document'].map(v => ({ value: v, label: v })),
            ]} />
          <SelectField icon="box" label="Service" value={service} onChange={setService}
            isOn={service !== 'All'}
            options={[
              { value: 'All', label: 'All services' },
              ...['Rental', 'Transaction', 'Logistics'].map(v => ({ value: v, label: v })),
            ]} />
          {(city !== 'All' || clientType !== 'All' || service !== 'All') && (
            <Button size="sm" variant="ghost" icon="close" onClick={() => {
              setCity('All'); setClientType('All'); setService('All');
            }}>
              Reset
            </Button>
          )}
        </div>

        <div className="grid grid--kpi grid--kpi-std" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <Tile label="Active clients" value={formatInt(active)} icon="users" spark={sparkOf('active')}
            sub={<>{chip(pctDelta(active, mom.active), 'MoM')} {chip(pctDelta(active, yoy.active), 'YoY')}</>} />
          <Tile label="Occupied sqft" value={formatInt(sqft)} icon="layers" spark={sparkOf('occupied')}
            sub={<>{chip(pctDelta(sqft, mom.sqft), 'MoM')} {chip(pctDelta(sqft, yoy.sqft), 'YoY')}</>} />
          <Tile label="Total revenue" value={formatINRCompact(totRev)} lead icon="ledger" spark={sparkOf('revenue')}
            sub={<>{chip(pctDelta(latestRev, momRev), 'MoM')} {chip(pctDelta(latestRev, yoyRev), 'YoY')}</>} />
          <Tile label="New clients" value={formatInt(neu)} icon="plus" spark={sparkOf('neu')} />
          <Tile label="Vacated clients" value={formatInt(vacated)} icon="logout" spark={sparkOf('vacated')}
            tone={vacated > neu ? 'neg' : undefined} />
          <Tile label="Net clients" value={String(neu - vacated)} icon="trending"
            tone={neu - vacated < 0 ? 'neg' : 'pos'} />
        </div>
        <div className="grid grid--kpi grid--kpi-std" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', marginTop: 8 }}>
          <Tile label="SQFT added" value={formatInt(added)} icon="plus" spark={sparkOf('added')} />
          <Tile label="SQFT lost" value={formatInt(lost)} tone="neg" icon="trash" spark={sparkOf('lost')} />
          <Tile label="Net SQFT" value={formatInt(added - lost)} icon="layers"
            tone={added - lost < 0 ? 'neg' : 'pos'} />
          <Tile label="Transactions" value={formatInt(txns)} icon="refresh" spark={sparkOf('txns')} />
          <Tile label="Revenue / client" value={revPerClient != null ? formatINR(revPerClient) : '—'} icon="users" />
          <Tile label="Revenue / sqft" value={occWindowSqft ? formatINR(totRev / occWindowSqft) : '—'} icon="chart" />
        </div>
      </section>

      <section className="section">
        <h3 className="cef__sec" style={{ marginTop: 0 }}>Business health</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <Health label="Client growth" hint="(New − vacated) ÷ prior-month active"
            value={clientGrowth == null ? '—' : formatPct(clientGrowth, 1)} />
          <Health label="Client churn" hint="Average vacated ÷ prior-month active"
            value={clientChurn == null ? '—' : formatPct(clientChurn, 1)} />
          <Health label="SQFT growth" hint="(Added − lost) ÷ prior-month occupied"
            value={sqftGrowth == null ? '—' : formatPct(sqftGrowth, 1)} />
          <Health label="Space churn" hint="Average lost ÷ prior-month occupied"
            value={spaceChurn == null ? '—' : formatPct(spaceChurn, 1)} />
        </div>
      </section>

      <section className="section">
        <ChartsHeading />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          <ChartFrame title="Revenue growth trend" question="How is booked revenue moving month to month?" height={h}
            isEmpty={!trend.some(p => p.values.revenue)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
              series={[{ id: 'revenue', label: 'Revenue', kind: 'line', colorIndex: 0 }]} />}
          </ChartFrame>
          <ChartFrame title="Occupied SQFT growth trend" question="Is occupied space rising or falling?" height={h}
            isEmpty={!trend.some(p => p.values.occupied)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[{ id: 'occupied', label: 'Occupied sqft', kind: 'area', colorIndex: 2 }]} />}
          </ChartFrame>
          <ChartFrame title="Total occupied space by city" question="Where is the floor sitting?" height={h}
            isEmpty={!byCityOcc.length}>
            {hh => <CategoryChart height={hh} data={byCityOcc} valueFormat={formatInt} colorIndex={2} />}
          </ChartFrame>

          <ChartFrame title="Active client growth trend" question="Is the live book growing?" height={h}
            isEmpty={!trend.some(p => p.values.active)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[{ id: 'active', label: 'Active clients', kind: 'line', colorIndex: 1 }]} />}
          </ChartFrame>
          <ChartFrame title="New vs vacated clients" question="Are we adding more than we lose?" height={h}
            isEmpty={!trend.some(p => p.values.neu || p.values.vacated)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'neu', label: 'New', kind: 'bar', colorIndex: 2 },
                { id: 'vacated', label: 'Vacated', kind: 'bar', colorIndex: 3 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="SQFT added vs SQFT lost" question="Is the floor expanding?" height={h}
            isEmpty={!trend.some(p => p.values.added || p.values.lost)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'added', label: 'Added', kind: 'bar', colorIndex: 2 },
                { id: 'lost', label: 'Lost', kind: 'bar', colorIndex: 3 },
              ]} />}
          </ChartFrame>

          <ChartFrame title="Revenue by service" question="Rental vs transaction vs logistics?" height={h}
            isEmpty={!trend.some(p => p.values.revenue)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
              series={[
                { id: 'rental', label: 'Rental', kind: 'line', colorIndex: 0 },
                { id: 'txn', label: 'Transaction', kind: 'line', colorIndex: 1 },
                { id: 'logi', label: 'Logistics', kind: 'line', colorIndex: 3 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Revenue / SQFT trend" question="Are we earning more per foot?" height={h}
            isEmpty={!trend.some(p => p.values.revPerSqft)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINR}
              series={[{ id: 'revPerSqft', label: 'Revenue / sqft', kind: 'line', colorIndex: 4 }]} />}
          </ChartFrame>
          <ChartFrame title="Total revenue by city" question="Which city books the most?" height={h}
            isEmpty={!byCityRev.length}>
            {hh => <CategoryChart height={hh} data={byCityRev} valueFormat={formatINRCompact} colorIndex={0} />}
          </ChartFrame>

          <ChartFrame title="Transactions growth trend" question="Are inward and outward accelerating?" height={h}
            isEmpty={!trend.some(p => p.values.txns)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[{ id: 'txns', label: 'Transactions', kind: 'line', colorIndex: 5 }]} />}
          </ChartFrame>
          <ChartFrame title="Vacation reasons" question="Why did clients leave?" height={h}
            isEmpty={!reasons.length}>
            {hh => <CategoryChart height={hh} data={reasons} valueFormat={formatInt} colorIndex={3} />}
          </ChartFrame>
          <ChartFrame title="Transactions by city" question="Where are the moves?" height={h}
            isEmpty={!byCityTxn.length}>
            {hh => <CategoryChart height={hh} data={byCityTxn} valueFormat={formatInt} colorIndex={1} />}
          </ChartFrame>
        </div>
      </section>
    </div>
  );
}
