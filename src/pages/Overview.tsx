import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@/styles/collections.css';
import '@/styles/overview.css';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { Button, EmptyState, ErrorState, Icon, Skeleton } from '@/components/primitives';
import { useDatasets } from '@/lib/data/useDataset';
import { usePermission } from '@/lib/permissions/usePermission';
import { getDataset } from '@/config/datasets';
import { scopedId } from '@/lib/data/store';
import { tabMonthDate, windowTabNames } from '@/lib/analytics/monthWindow';
import { activeDepartments } from '@/config/departments';
import { formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';
import { ChartKindProvider, ChartsHeading } from '@/components/charts/chartKind';

/** ---------------------------------------------------------------------------
 * Overview — the company on one page.
 *
 * The previous version was a directory: a card per department showing how many
 * ROWS its sheet held, with a "records over time" line. Row count is a
 * property of the spreadsheet, not of the business, so the page could not
 * answer a question anyone actually asks.
 *
 * This one reports the business: headline figures, a summary card per
 * department, three trends, and where revenue comes from by service and city.
 *
 * Two rules it keeps to:
 *
 * 1. Every figure is the LATEST MONTH its own dataset holds, named on the
 *    card. Departments record at different speeds — Finance can be weeks
 *    behind Marketing — and one shared period would silently show an empty
 *    month for whoever is behind.
 * 2. Nothing is invented. A block renders only when its dataset is readable
 *    and has rows, so a Facility admin gets a working page with fewer blocks
 *    rather than a page of zeroes.
 * ------------------------------------------------------------------------- */

const num = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);
const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + num(r, k), 0);

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthName = (k: string) => {
  const [y, m] = k.split('-');
  return m ? new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : k;
};

interface Month { key: string; label: string; rows: Row[] }

/** Rows bucketed by month, oldest first. Months with no rows never appear. */
function byMonth(rows: Row[]): Month[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = monthKey(r.month);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, label: monthName(key), rows: list }));
}

const pctDelta = (now: number, prev: number): number | null =>
  prev > 0 ? ((now - prev) / prev) * 100 : null;

function Delta({ v, good = 'up' }: { v: number | null; good?: 'up' | 'down' }) {
  if (v == null || !Number.isFinite(v)) return null;
  const better = (v >= 0) === (good === 'up');
  return (
    <span className={`delta ${better ? 'delta--pos' : 'delta--neg'}`}>
      {v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

/** Headline figure with an icon chip and a sparkline of its own history. */
function Kpi({ label, value, unit, delta, spark, icon, tone, asOf }: {
  label: string; value: string; unit?: string; delta: number | null;
  spark: number[]; icon: string; tone?: number;
  /** Which month this figure is actually from — never assume it is the one
   *  picked, because a department can be a month behind. */
  asOf?: string;
}) {
  return (
    <div className="ovw__kpi" data-kpi={tone ?? 1}>
      <div className="ovw__kpi-hd">
        <span className="ovw__kpi-chip"><Icon name={icon} size={15} /></span>
        <span className="ovw__kpi-lb">{label}</span>
      </div>
      <div className="ovw__kpi-v num">
        {value}{unit && <span className="ovw__kpi-u">{unit}</span>}
      </div>
      <div className="ovw__kpi-meta">
        <Delta v={delta} />
        {asOf && <span className="ovw__asof">{asOf}</span>}
      </div>
      {spark.length > 1 && (
        <div className="ovw__kpi-spark">
          <Sparkline values={spark} height={38} tone={`var(--c${((tone ?? 1) - 1) % 8 + 1})`} />
        </div>
      )}
    </div>
  );
}

/** One department, one number: the figure that department is judged on. */
function DeptCard({ icon, label, value, note, delta, good, onOpen }: {
  icon: string; label: string; value: string; note: string;
  delta: number | null; good?: 'up' | 'down'; onOpen: () => void;
}) {
  return (
    <button className="ovw__dept" onClick={onOpen}>
      <div className="ovw__dept-hd">
        <span className="ovw__dept-chip"><Icon name={icon} size={14} /></span>
        <span className="ovw__dept-lb">{label}</span>
        <Icon name="chevronRight" size={14} />
      </div>
      <div className="ovw__dept-v num">{value}</div>
      <div className="ovw__dept-note">{note}</div>
      <Delta v={delta} good={good} />
    </button>
  );
}

export default function Overview() {
  const nav = useNavigate();
  const { hasDepartment } = usePermission();
  const [tab, setTab] = useState('all');

  const departments = useMemo(
    () => activeDepartments().filter(d => d.inWorkspace && hasDepartment(d.id)),
    [hasDepartment]);
  const may = (d: string) => departments.some(x => x.id === d);

  /* Only what this page reads, and only what the account may see. */
  const wanted = useMemo(() => ([
    ['finance', 'finance_pnl'],
    ['control_tower', 'ct_city_income'],
    ['b2b', 'b2b_revenue'],
    ['b2b', 'b2b_occupancy'],
    ['b2b', 'b2b_movement'],
    ['marketing', 'marketing_leads'],
    ['marketing', 'marketing_acquisition'],
    ['collections', 'collections_monthly'],
    ['sales', 'sales_storage'],
    ['sales', 'sales_moving'],
    ['operations', 'ops_deliveries'],
    ['operations', 'ops_pickups'],
  ] as const).filter(([dept, id]) => may(dept) && getDataset(id)).map(([, id]) => id),
  [departments]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Warehouse readings keep ONE SHEET TAB PER MONTH, so the bare dataset id
     reads nothing — which is why Facility said "No readings recorded" while
     the Facility page itself was full. A year of month tabs is read instead. */
  const facilityIds = useMemo(() => {
    const ds = (may('facility') || may('warehouse')) ? getDataset('warehouse_readings') : undefined;
    return ds ? windowTabNames(ds.tabPrefix ?? ds.sheetName, 13).map(t => scopedId(ds.id, t)) : [];
  }, [departments]); // eslint-disable-line react-hooks/exhaustive-deps

  const { byId, status, error, refresh } = useDatasets([...wanted, ...facilityIds]);
  const busy = status === 'loading';
  /* A failed read must not look like an empty company. */
  const failed = status === 'error' && !Object.values(byId).some(r => r.length);

  const pnl = useMemo(() => byMonth(byId.finance_pnl ?? []), [byId.finance_pnl]);
  const b2c = useMemo(() => byMonth(byId.ct_city_income ?? []), [byId.ct_city_income]);
  const b2bRev = useMemo(() => byMonth(byId.b2b_revenue ?? []), [byId.b2b_revenue]);
  const b2bOcc = useMemo(() => byMonth(byId.b2b_occupancy ?? []), [byId.b2b_occupancy]);
  const b2bMov = useMemo(() => byMonth(byId.b2b_movement ?? []), [byId.b2b_movement]);
  const leads = useMemo(() => byMonth(byId.marketing_leads ?? []), [byId.marketing_leads]);
  const acq = useMemo(() => byMonth(byId.marketing_acquisition ?? []), [byId.marketing_acquisition]);
  const coll = useMemo(() => byMonth(byId.collections_monthly ?? []), [byId.collections_monthly]);
  const sales = useMemo(
    () => byMonth([...(byId.sales_storage ?? []), ...(byId.sales_moving ?? [])]),
    [byId.sales_storage, byId.sales_moving]);
  /* Warehouse readings are dated by Recorded On, not Month. */
  const facility = useMemo(() => {
    /* A reading belongs to the month of the TAB it sits in, which is how the
       Facility page reads it. Grouping by Recorded On instead put rows into
       whatever month someone typed in that cell, so a mis-dated row landed in
       a second month and the totals disagreed with the Facility page. */
    const rows = facilityIds.flatMap(id => {
      const d = tabMonthDate(id.split('::')[1] ?? '');
      if (!d) return [];
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      return (byId[id] ?? []).map(r => ({ ...r, month }));
    });
    /* ONE READING PER WAREHOUSE PER MONTH. Space is a level, not a flow: if
       the same month is present twice — rows pasted into the wrong tab, or a
       month re-entered — adding them does not describe more warehouse, it
       counts the same floor twice, which is how occupied space came out at
       11.5L against a real 5.8L. Later rows win. */
    return byMonth(rows).map(m => {
      const one = new Map<string, Row>();
      for (const r of m.rows) one.set(String(r.wh_code ?? r.__id ?? ''), r);
      return { ...m, rows: [...one.values()] };
    });
  }, [byId, facilityIds]);
  const ops = useMemo(() => byMonth(byId.ops_deliveries ?? []), [byId.ops_deliveries]);

  const pickups = useMemo(() => byMonth(byId.ops_pickups ?? []), [byId.ops_pickups]);

  /* Operations keeps per-city columns AND a network rollup. The rollup column
     is `tot_total` with no city prefix — summing the per-city ones instead
     returned nothing, which is why Deliveries read 0 while the Operations
     dashboard showed 496 for the same month. */
  const deliveriesIn = (m?: Month) => (m ? sum(m.rows, 'tot_total') : 0);
  const pickupsIn = (m?: Month) => (m ? sum(m.rows, 'tot_total') : 0);
  const fullIn = (m?: Month) => (m ? sum(m.rows, 'tot_full') : 0);

  /* ------------------------------------------------------------- month
     Every dataset is read AT THE SELECTED MONTH. Departments record at
     different speeds, so a dataset with nothing for that month falls back to
     its newest earlier month and the card says which — mixing months silently
     is what made the figures look wrong. */
  /* The month list follows the TAB. On a department tab it offers only the
     months that department has recorded, so picking "Control Tower" cannot
     land on a month Control Tower has never entered — which is how the page
     came to say "Oct 2026" above figures that were plainly August's. */
  const monthsOf = (sets: Month[][]) =>
    [...new Set(sets.flat().map(m => m.key))].sort().reverse();

  const allMonths = useMemo(() => {
    const perTab: Record<string, Month[][]> = {
      finance: [pnl],
      control_tower: [b2c],
      b2b: [b2bRev, b2bOcc, b2bMov],
      marketing: [leads, acq],
      collections: [coll],
      sales: [sales],
      facility: [facility],
      operations: [ops, pickups],
    };
    return monthsOf(perTab[tab] ?? [pnl, b2c, b2bRev, b2bOcc, b2bMov, leads, acq, coll, sales, facility, ops, pickups]);
  }, [tab, pnl, b2c, b2bRev, b2bOcc, b2bMov, leads, acq, coll, sales, facility, ops, pickups]);

  const [pickRaw, setPick] = useState('');
  /* Default to the newest month that is not in the future. A team entering
     next month early (Sales had an October row in September) should not drag
     the whole page onto a month nobody else has reported yet. Future months
     stay selectable — they are simply not the default. */
  const nowKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const defaultMonth = allMonths.find(k => k <= nowKey) ?? allMonths[0] ?? '';
  /* A month the current tab does not have is not a valid selection: fall back
     to that tab's newest month rather than showing a blank or a stale one. */
  const pick = (pickRaw && allMonths.includes(pickRaw) ? pickRaw : defaultMonth) || '';

  /** The month at or before the selection, and the one before that. */
  const at = (m: Month[]): Month | undefined => {
    const upto = m.filter(x => x.key <= pick);
    return upto[upto.length - 1];
  };
  const before = (m: Month[]): Month | undefined => {
    const cur = at(m);
    if (!cur) return undefined;
    const i = m.findIndex(x => x.key === cur.key);
    return i > 0 ? m[i - 1] : undefined;
  };
  const last = at;
  const prev = before;
  /** Sum of a column at the selected month, and at the month before it. */
  const pair = (m: Month[], k: string): [number, number] =>
    [at(m) ? sum(at(m)!.rows, k) : 0, before(m) ? sum(before(m)!.rows, k) : 0];
  /** Sparkline history ends at the selected month, never after it. */
  const spark = (m: Month[], k: string) =>
    m.filter(x => x.key <= pick).map(x => sum(x.rows, k));
  /** "Aug 2026", or "Jul 2026 (latest)" when that dataset is behind. */
  const asOf = (m: Month[]) => {
    const cur = at(m);
    if (!cur) return 'No data';
    return cur.key === pick ? cur.label : `${cur.label} · latest`;
  };

  /* ---------------------------------------------------------- headline */
  const [revB2C, pRevB2C] = pair(b2c, 'tot_income');
  const [revB2B, pRevB2B] = pair(b2bRev, 'total_rev');

  const [clientsB2C] = pair(b2c, 'tot_clients');
  const [clientsB2B] = pair(b2bOcc, 'active_clients');

  const [sqft] = pair(b2bOcc, 'occupied_sqft');
  const [totLeads, pTotLeads] = pair(leads, 'total_leads');
  const [spend] = pair(acq, 'total_spend');
  const [collected, pCollected] = pair(coll, 'collection_month');
  const [pending] = pair(coll, 'pending_to_date');
  const [orders, pOrders] = pair(sales, 'tot_orders');

  const facilityOcc = at(facility) ? sum(at(facility)!.rows, 'occupied_space') : 0;
  const facilityCap = at(facility) ? sum(at(facility)!.rows, 'total_space') : 0;

  const anything = pnl.length || b2c.length || b2bRev.length || leads.length
    || coll.length || sales.length || facility.length || ops.length;

  /* ------------------------------------------------------------ trends */
  const revenueTrend = useMemo(() => {
    const keys = [...new Set([...b2c, ...b2bRev, ...coll].map(m => m.key))]
      .filter(k => k <= pick).sort();
    return keys.map(k => ({
      key: k, label: monthName(k),
      rows: [...(b2c.find(m => m.key === k)?.rows ?? []), ...(b2bRev.find(m => m.key === k)?.rows ?? [])],
      values: {
        b2c: sum(b2c.find(m => m.key === k)?.rows ?? [], 'tot_income'),
        b2b: sum(b2bRev.find(m => m.key === k)?.rows ?? [], 'total_rev'),
        collected: sum(coll.find(m => m.key === k)?.rows ?? [], 'collection_month'),
      },
    }));
  }, [b2c, b2bRev, coll, pick]);

  const leadTrend = useMemo(() => leads.filter(m => m.key <= pick).map(m => {
    const t = sum(m.rows, 'total_leads');
    const v = sum(m.rows, 'total_valid');
    return {
      key: m.key, label: m.label, rows: m.rows,
      values: { total: t, valid: v, rate: t > 0 ? (v / t) * 100 : 0 },
    };
  }), [leads, pick]);

  /* Intake against outflow: the two Operations sheets, month by month. */
  const opsTrend = useMemo(() => {
    const keys = [...new Set([...ops, ...pickups].map(m => m.key))].filter(k => k <= pick).sort();
    return keys.map(k => ({
      key: k, label: monthName(k),
      rows: [...(ops.find(m => m.key === k)?.rows ?? [])],
      values: {
        deliveries: deliveriesIn(ops.find(m => m.key === k)),
        pickups: pickupsIn(pickups.find(m => m.key === k)),
      },
    }));
  }, [ops, pickups, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientTrend = useMemo(() => b2bMov.filter(m => m.key <= pick).map(m => ({
    key: m.key, label: m.label, rows: m.rows,
    values: {
      joined: sum(m.rows, 'new_clients'),
      left: sum(m.rows, 'vacated_clients'),
      net: sum(m.rows, 'net_clients'),
    },
  })), [b2bMov, pick]);

  /* ------------------------------------------------- revenue breakdowns */
  /** Finance splits revenue by service line; nothing else does. */
  const services = useMemo(() => {
    const m = last(pnl);
    if (!m) return [];
    const rows: { label: string; value: number }[] = [
      { label: 'B2C storage', value: sum(m.rows, 'b2c_storage') },
      { label: 'B2C transport', value: sum(m.rows, 'b2c_transport') },
      { label: 'B2C packing and moving', value: sum(m.rows, 'b2c_packing') },
      { label: 'B2B storage', value: sum(m.rows, 'b2b_storage') },
      { label: 'B2B transport', value: sum(m.rows, 'b2b_transport') },
    ].filter(r => r.value > 0).sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0);
    return rows.map(r => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 }));
  }, [pnl, pick]);

  /** City names come off the schema, so adding a city to the sheet adds a row
   *  here without touching this file. B2C and B2B are added per city. */
  const cities = useMemo(() => {
    const out = new Map<string, number>();
    const ct = last(b2c);
    if (ct) {
      for (const c of getDataset('ct_city_income')?.columns ?? []) {
        if (!c.key.endsWith('_rental') || c.key.startsWith('tot')) continue;
        const base = c.key.replace('_rental', '');
        const name = c.header.replace(' Rental Income', '');
        out.set(name, (out.get(name) ?? 0)
          + sum(ct.rows, `${base}_rental`) + sum(ct.rows, `${base}_logistic`));
      }
    }
    const br = last(b2bRev);
    if (br) {
      for (const r of br.rows) {
        const name = String(r.city ?? '').trim();
        if (name) out.set(name, (out.get(name) ?? 0) + num(r, 'total_rev'));
      }
    }
    const list = [...out.entries()].map(([label, value]) => ({ label, value }))
      .filter(c => c.value > 0).sort((a, b) => b.value - a.value);
    const total = list.reduce((a, c) => a + c.value, 0);
    return list.map(c => ({ ...c, share: total > 0 ? (c.value / total) * 100 : 0 })).slice(0, 7);
  }, [b2c, b2bRev, pick]);

  /** What each department last recorded — the honest version of "recent
   *  activity" without an event log to read from. */
  const freshness = useMemo(() => ([
    { dept: 'finance', label: 'Finance', what: 'P&L', m: last(pnl) },
    { dept: 'control_tower', label: 'Control Tower', what: 'City income', m: last(b2c) },
    { dept: 'b2b', label: 'B2B', what: 'Revenue', m: last(b2bRev) },
    { dept: 'marketing', label: 'Marketing', what: 'Lead performance', m: last(leads) },
    { dept: 'collections', label: 'Collections', what: 'Collection summary', m: last(coll) },
    { dept: 'sales', label: 'Sales', what: 'Storage and moving', m: last(sales) },
    { dept: 'facility', label: 'Facility', what: 'Warehouse readings', m: last(facility) },
    { dept: 'operations', label: 'Operations', what: 'Deliveries', m: last(ops) },
  ] as const).filter(f => f.m && may(f.dept)), [pnl, b2c, b2bRev, leads, coll, sales, facility, ops, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (dept: string) => {
    const allowed = may(dept) || (dept === 'facility' && (may('warehouse') || may('facility')))
      || (dept === 'warehouse' && (may('warehouse') || may('facility')));
    return allowed && (tab === 'all' || tab === dept || (tab === 'facility' && dept === 'warehouse'));
  };

  if (!departments.length) {
    return (
      <>
        <TopBar title="Overview" />
        <div className="page">
          <div className="card">
            <EmptyState icon="shield" title="No departments assigned"
              body="Your account is not assigned to a department yet. A super admin can assign one under Administration → Users." />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Overview" />
      <ControlBar datasetIds={[...wanted]} fetchedAt={null} busy={busy}
        right={<Button size="sm" icon="present" onClick={() => nav('/presentation')}>Present</Button>} />

      <div className="page ovw">
        <header className="ovw__head">
          <div>
            <h1 className="ovw__title">Overview</h1>
            <p className="ovw__sub">
              {departments.length === 1
                ? `${departments[0].label} · ${monthName(pick)}`
                : tab === 'all'
                  ? 'Your departments, at the selected month'
                  : `${departments.find(d => d.id === tab)?.label ?? ''} · ${monthName(pick)}`}
            </p>
          </div>
          {allMonths.length > 0 && (
            <label className="ovw__month">
              <Icon name="calendar" size={14} />
              <select value={pick} onChange={e => setPick(e.target.value)}>
                {allMonths.map(k => <option key={k} value={k}>{monthName(k)}</option>)}
              </select>
            </label>
          )}
        </header>

        {departments.length > 1 && (
        <nav className="ovw__tabs">
          <button className={`ovw__tab${tab === 'all' ? ' is-on' : ''}`} onClick={() => setTab('all')}>
            All departments
          </button>
          {departments.map(d => (
            <button key={d.id} className={`ovw__tab${tab === d.id ? ' is-on' : ''}`}
              onClick={() => setTab(d.id)}>{d.label}</button>
          ))}
        </nav>
        )}

        {busy && !anything ? (
          <div className="ovw__kpis">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} h={140} />)}</div>
        ) : failed ? (
          <div className="card">
            <ErrorState title="Could not load your data"
              body={error?.message ?? 'The data service did not respond.'} onRetry={refresh} />
          </div>
        ) : !anything ? (
          <div className="card">
            <EmptyState icon="layers" title="No data connected yet"
              body="Connect a Google Sheet under Administration → Data sources, or enter a month in any department."
              action={<Button size="sm" onClick={() => nav('/admin/data-sources')}>Open data sources</Button>} />
          </div>
        ) : (
          <>
            {/* One tile per DEPARTMENT, each showing that team's own figure
                from its own sheet. Nothing is added across departments: a
                combined "total revenue" mixed B2C with B2B and made it
                impossible to see whose number had moved, and a combined client
                count did the same. Each tile names its source and its month. */}
            <div className="ovw__kpis">
              {show('control_tower') && (
                <Kpi icon="radar" label="Control Tower · B2C income" tone={1}
                  value={at(b2c) ? formatINRCompact(revB2C) : '—'}
                  delta={pctDelta(revB2C, pRevB2C)} spark={spark(b2c, 'tot_income')}
                  asOf={at(b2c) ? `${formatInt(clientsB2C)} active clients · ${asOf(b2c)}` : 'No month recorded'} />
              )}
              {show('b2b') && (
                <Kpi icon="layers" label="B2B · Revenue" tone={2}
                  value={at(b2bRev) ? formatINRCompact(revB2B) : '—'}
                  delta={pctDelta(revB2B, pRevB2B)} spark={spark(b2bRev, 'total_rev')}
                  asOf={at(b2bRev)
                    ? `${formatInt(clientsB2B)} clients · ${formatInt(sqft)} sqft · ${asOf(b2bRev)}`
                    : 'No month recorded'} />
              )}
              {show('finance') && (
                <Kpi icon="ledger" label="Finance · P&L revenue" tone={3}
                  value={at(pnl) ? formatINRCompact(sum(at(pnl)!.rows, 'tot_rev')) : '—'}
                  delta={pctDelta(at(pnl) ? sum(at(pnl)!.rows, 'tot_rev') : 0,
                    before(pnl) ? sum(before(pnl)!.rows, 'tot_rev') : 0)}
                  spark={spark(pnl, 'tot_rev')}
                  asOf={at(pnl)
                    ? `Net profit ${formatINRCompact(sum(at(pnl)!.rows, 'net_profit'))} · ${asOf(pnl)}`
                    : 'No month recorded'} />
              )}
              {show('collections') && (
                <Kpi icon="checklist" label="Collections · Collected" tone={4}
                  value={at(coll) ? formatINRCompact(collected) : '—'}
                  delta={pctDelta(collected, pCollected)} spark={spark(coll, 'collection_month')}
                  asOf={at(coll)
                    ? `${formatINRCompact(pending)} pending · ${asOf(coll)}`
                    : 'No month recorded'} />
              )}
              {show('marketing') && (
                <Kpi icon="chart" label="Marketing · Leads" tone={5}
                  value={at(leads) ? formatInt(totLeads) : '—'}
                  delta={pctDelta(totLeads, pTotLeads)} spark={spark(leads, 'total_leads')}
                  asOf={at(leads)
                    ? `${formatINRCompact(spend)} spend · ${asOf(leads)}`
                    : 'No month recorded'} />
              )}
              {show('sales') && (
                <Kpi icon="trending" label="Sales · Orders" tone={6}
                  value={at(sales) ? formatInt(orders) : '—'}
                  delta={pctDelta(orders, pOrders)} spark={spark(sales, 'tot_orders')}
                  asOf={at(sales)
                    ? `${formatInt(sum(at(sales)!.rows, 'tot_leads'))} leads · ${asOf(sales)}`
                    : 'No month recorded'} />
              )}
              {show('facility') && (
                <Kpi icon="box" label="Facility · Utilisation" tone={1}
                  value={facilityCap > 0 ? formatPct((facilityOcc / facilityCap) * 100, 1) : '—'}
                  delta={null}
                  spark={facility.filter(m => m.key <= pick)
                    .map(m => {
                      const cap = sum(m.rows, 'total_space');
                      return cap > 0 ? (sum(m.rows, 'occupied_space') / cap) * 100 : 0;
                    })}
                  asOf={at(facility)
                    ? `${formatInt(facilityOcc)} of ${formatInt(facilityCap)} sqft · ${asOf(facility)}`
                    : 'No readings recorded'} />
              )}
              {show('facility') && (
                <Kpi icon="layers" label="Facility · Space free" tone={2}
                  value={at(facility) ? formatInt(Math.max(0, facilityCap - facilityOcc)) : '—'}
                  unit=" sqft" delta={null}
                  spark={facility.filter(m => m.key <= pick)
                    .map(m => Math.max(0, sum(m.rows, 'total_space') - sum(m.rows, 'occupied_space')))}
                  asOf={at(facility)
                    ? `${formatInt(at(facility)!.rows.length)} sites · ${asOf(facility)}`
                    : 'No readings recorded'} />
              )}
              {show('operations') && (
                <Kpi icon="truck" label="Operations · Deliveries" tone={2}
                  value={at(ops) ? formatInt(deliveriesIn(at(ops))) : '—'}
                  delta={pctDelta(deliveriesIn(at(ops)), deliveriesIn(before(ops)))}
                  spark={ops.filter(m => m.key <= pick).map(m => deliveriesIn(m))}
                  asOf={at(ops)
                    ? `${formatInt(fullIn(at(ops)))} full · ${asOf(ops)}`
                    : 'No month recorded'} />
              )}
              {show('operations') && (
                <Kpi icon="box" label="Operations · Pick-ups" tone={3}
                  value={at(pickups) ? formatInt(pickupsIn(at(pickups))) : '—'}
                  delta={pctDelta(pickupsIn(at(pickups)), pickupsIn(before(pickups)))}
                  spark={pickups.filter(m => m.key <= pick).map(m => pickupsIn(m))}
                  asOf={at(pickups) ? asOf(pickups) : 'No month recorded'} />
              )}
            </div>

            <section className="section">
              <SectionHeader title="Department summary"
                note="The figure each team is judged on, from its newest month" />
              <div className="ovw__depts">
                {show('collections') && last(coll) && (
                  <DeptCard icon="ledger" label="Collections" value={formatINRCompact(collected)}
                    note={`Collected · ${last(coll)!.label}`} delta={pctDelta(collected, pCollected)}
                    onOpen={() => nav('/d/collections')} />
                )}
                {show('control_tower') && last(b2c) && (
                  <DeptCard icon="radar" label="Control Tower" value={formatINRCompact(revB2C)}
                    note={`B2C income · ${last(b2c)!.label}`} delta={pctDelta(revB2C, pRevB2C)}
                    onOpen={() => nav('/d/control_tower')} />
                )}
                {show('finance') && last(pnl) && (
                  <DeptCard icon="receipt" label="Finance"
                    value={formatINRCompact(sum(last(pnl)!.rows, 'net_profit'))}
                    note={`Net profit · ${last(pnl)!.label}`}
                    delta={pctDelta(sum(last(pnl)!.rows, 'net_profit'),
                      prev(pnl) ? sum(prev(pnl)!.rows, 'net_profit') : 0)}
                    onOpen={() => nav('/d/finance')} />
                )}
                {show('marketing') && last(leads) && (
                  <DeptCard icon="chart" label="Marketing" value={formatInt(totLeads)}
                    note={`Leads · ${last(leads)!.label}`} delta={pctDelta(totLeads, pTotLeads)}
                    onOpen={() => nav('/d/marketing')} />
                )}
                {show('sales') && last(sales) && (
                  <DeptCard icon="trending" label="Sales" value={formatInt(orders)}
                    note={`Orders · ${last(sales)!.label}`} delta={pctDelta(orders, pOrders)}
                    onOpen={() => nav('/d/sales')} />
                )}
                {show('b2b') && last(b2bRev) && (
                  <DeptCard icon="layers" label="B2B" value={formatINRCompact(revB2B)}
                    note={`Revenue · ${last(b2bRev)!.label}`} delta={pctDelta(revB2B, pRevB2B)}
                    onOpen={() => nav('/d/b2b')} />
                )}
                {show('operations') && at(pickups) && (
                  <DeptCard icon="box" label="Operations · Pick-ups"
                    value={formatInt(pickupsIn(at(pickups)))}
                    note={`Pick-ups · ${at(pickups)!.label}`}
                    delta={pctDelta(pickupsIn(at(pickups)), pickupsIn(before(pickups)))}
                    onOpen={() => nav('/d/operations')} />
                )}
                {show('facility') && at(facility) && (
                  <DeptCard icon="box" label="Facility"
                    value={facilityCap > 0 ? formatPct((facilityOcc / facilityCap) * 100, 1) : '—'}
                    note={`Utilisation · ${at(facility)!.rows.length} sites · ${at(facility)!.label}`}
                    delta={null} onOpen={() => nav('/d/facility')} />
                )}
                {show('operations') && at(ops) && (
                  <DeptCard icon="truck" label="Operations"
                    value={formatInt(deliveriesIn(at(ops)))}
                    note={`Deliveries · ${at(ops)!.label}`}
                    delta={pctDelta(deliveriesIn(at(ops)), deliveriesIn(before(ops)))}
                    onOpen={() => nav('/d/operations')} />
                )}

              </div>
            </section>

            <ChartKindProvider scope="overview">
            <ChartsHeading title="Trends" />
            <div className="ovw__charts">
              {show('finance') && (
              <ChartFrame title="Revenue trend" height={220}
                question="Total revenue across departments, and what was actually collected."
                isEmpty={revenueTrend.length < 2}>
                {h => <TrendChart height={h} data={revenueTrend} valueFormat={formatINRCompact}
                  legendStat="none" series={[
                    { id: 'b2c', label: 'B2C', kind: 'line', colorIndex: 0 },
                    { id: 'b2b', label: 'B2B', kind: 'line', colorIndex: 1 },
                    { id: 'collected', label: 'Collected', kind: 'line', colorIndex: 2 },
                  ]} />}
              </ChartFrame>
              )}

              {show('marketing') && (
              <ChartFrame title="Leads and quality" height={220}
                question="Lead volume against the share worth working."
                isEmpty={leadTrend.length < 2}>
                {h => <TrendChart height={h} data={leadTrend} valueFormat={formatInt}
                  legendStat="none" series={[
                    { id: 'valid', label: 'Valid', kind: 'bar', colorIndex: 1 },
                    { id: 'total', label: 'Total', kind: 'bar', colorIndex: 2 },
                    { id: 'rate', label: 'Valid rate', kind: 'line', axis: 'right', colorIndex: 0,
                      format: n => formatPct(n, 1) },
                  ]} />}
              </ChartFrame>
              )}

              {show('operations') && (
              <ChartFrame title="Deliveries and pick-ups" height={220}
                question="Is the warehouse taking in more than it is sending out?"
                isEmpty={opsTrend.length < 2}>
                {h => <TrendChart height={h} data={opsTrend} valueFormat={formatInt}
                  legendStat="none" series={[
                    { id: 'pickups', label: 'Pick-ups in', kind: 'bar', colorIndex: 1 },
                    { id: 'deliveries', label: 'Deliveries out', kind: 'bar', colorIndex: 3 },
                  ]} />}
              </ChartFrame>
              )}

              {show('b2b') && (
              <ChartFrame title="Clients joined and left" height={220}
                question="Is the B2B book growing or leaking?"
                isEmpty={clientTrend.length < 2}>
                {h => <TrendChart height={h} data={clientTrend} valueFormat={formatInt}
                  legendStat="none" series={[
                    { id: 'joined', label: 'Joined', kind: 'bar', colorIndex: 1 },
                    { id: 'left', label: 'Left', kind: 'bar', colorIndex: 3 },
                  ]} />}
              </ChartFrame>
              )}
            </div>
            </ChartKindProvider>

            <div className="ovw__tables">
              {show('finance') && services.length > 0 && (
                <section className="card">
                  <header className="card__hd">
                    <div>
                      <div className="card__title">Revenue by service</div>
                      <div className="card__sub">Which services are earning · {last(pnl)!.label}</div>
                    </div>
                  </header>
                  <div className="card__bd" style={{ paddingTop: 0 }}>
                    <table className="ovw__tbl">
                      <tbody>
                        {services.map((s, i) => (
                          <tr key={s.label}>
                            <td className="ovw__rank num">{i + 1}</td>
                            <td><span className="ovw__dot" data-i={i % 8} />{s.label}</td>
                            <td className="is-num num">{formatINRCompact(s.value)}</td>
                            <td className="is-num num ovw__share">{formatPct(s.share, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {show('control_tower') && cities.length > 0 && (
                <section className="card">
                  <header className="card__hd">
                    <div>
                      <div className="card__title">Revenue by city</div>
                      <div className="card__sub">B2C and B2B combined</div>
                    </div>
                  </header>
                  <div className="card__bd" style={{ paddingTop: 0 }}>
                    <table className="ovw__tbl">
                      <tbody>
                        {cities.map((c, i) => (
                          <tr key={c.label}>
                            <td className="ovw__rank num">{i + 1}</td>
                            <td>{c.label}</td>
                            <td className="is-num num">{formatINRCompact(c.value)}</td>
                            <td className="is-num num ovw__share">{formatPct(c.share, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {tab === 'all' && freshness.length > 0 && (
                <section className="card">
                  <header className="card__hd">
                    <div>
                      <div className="card__title">Last recorded</div>
                      <div className="card__sub">What each department has entered</div>
                    </div>
                  </header>
                  <div className="card__bd" style={{ paddingTop: 0 }}>
                    <ul className="ovw__feed">
                      {freshness.map(f => (
                        <li key={f.dept}>
                          <button onClick={() => nav(`/d/${f.dept}`)}>
                            <span className="ovw__feed-lb">{f.label}</span>
                            <span className="ovw__feed-what">{f.what}</span>
                            <span className="ovw__feed-m num">{f.m!.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
