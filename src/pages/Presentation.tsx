import { useMemo, useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { KpiTile } from '@/components/metrics/KpiTile';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { Button, EmptyState } from '@/components/primitives';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { keysInWindow, defaultMonthPeriod, windowTabNames, tabMonthDate } from '@/lib/analytics/monthWindow';
import { scopedId } from '@/lib/data/store';
import { useDatasets } from '@/lib/data/useDataset';
import { allDatasets, getDataset } from '@/config/datasets';
import { activeDepartments } from '@/config/departments';
import { usePermission } from '@/lib/permissions/usePermission';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';
import type { SeriesPoint } from '@/lib/analytics/aggregate';
import '@/styles/presentation.css';

const KEY = 'sn.present.board';

const num = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);
const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + num(r, k), 0);
const uniqueWh = (rows: Row[]) => {
  const one = new Map<string, Row>();
  for (const r of rows) one.set(String(r.wh_code ?? r.__id ?? ''), r);
  return [...one.values()];
};

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (k: string) => {
  const [y, m] = k.split('-');
  if (!y || !m) return k;
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

function monthsOf(rows: Row[], dateKey = 'month', allow?: Set<string>): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = monthKey(r[dateKey] ?? r.recorded_on ?? r.month);
    if (!k || (allow && !allow.has(k))) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function seriesOf(m: MetricDef, byId: Record<string, Row[]>, allow?: Set<string>) {
  const rows = m.rows(byId);
  const primary = monthsOf(rows, m.dateKey ?? 'month', allow);
  if (primary.length) return primary;
  return monthsOf(rows, m.dateKey === 'recorded_on' ? 'month' : 'recorded_on', allow);
}

function deptTitle(id: string, departments: { id: string; label: string }[]) {
  if (id === 'warehouse') return departments.find(d => d.id === 'facility' || d.id === 'warehouse')?.label ?? 'Facility';
  return departments.find(d => d.id === id)?.label ?? id;
}

type Kind = 'money' | 'int' | 'pct';
type MetricDef = {
  id: string;
  dept: string;
  label: string;
  kind: Kind;
  rows: (byId: Record<string, Row[]>) => Row[];
  dateKey?: string;
  value: (list: Row[]) => number;
};

const METRICS: MetricDef[] = [
  { id: 'fin_rev', dept: 'finance', label: 'Total revenue', kind: 'money',
    rows: b => b.finance_pnl ?? [], value: l => num(l[0], 'tot_rev') },
  { id: 'fin_gp', dept: 'finance', label: 'Gross profit', kind: 'money',
    rows: b => b.finance_pnl ?? [], value: l => num(l[0], 'gross_profit') },
  { id: 'fin_pbt', dept: 'finance', label: 'PBT', kind: 'money',
    rows: b => b.finance_pnl ?? [], value: l => num(l[0], 'net_profit') },
  { id: 'fin_pat', dept: 'finance', label: 'PAT', kind: 'money',
    rows: b => b.finance_pnl ?? [], value: l => num(l[0], 'profit_after_tax') },

  { id: 'col_collected', dept: 'collections', label: 'Collected', kind: 'money',
    rows: b => b.collections_monthly ?? [], value: l => num(l[0], 'collection_amount') },
  { id: 'col_raised', dept: 'collections', label: 'Raised', kind: 'money',
    rows: b => b.collections_monthly ?? [], value: l => num(l[0], 'raised_amount') },
  { id: 'col_pending', dept: 'collections', label: 'Pending', kind: 'money',
    rows: b => b.collections_monthly ?? [], value: l => num(l[0], 'pending_amount') },

  { id: 'ct_rental', dept: 'control_tower', label: 'Rental income', kind: 'money',
    rows: b => b.ct_city_income ?? [], value: l => num(l[0], 'tot_rental') },
  { id: 'ct_log', dept: 'control_tower', label: 'Logistic income', kind: 'money',
    rows: b => b.ct_city_income ?? [], value: l => num(l[0], 'tot_logistic') },
  { id: 'ct_calls', dept: 'control_tower', label: 'Calls', kind: 'int',
    rows: b => b.ct_calls ?? [], value: l => num(l[0], 'cq_total') },

  { id: 'ops_del', dept: 'operations', label: 'Deliveries', kind: 'int',
    rows: b => b.ops_deliveries ?? [], value: l => num(l[0], 'tot_total') || num(l[0], 'tot_sn_all') + num(l[0], 'tot_cust_all') },
  { id: 'ops_pk', dept: 'operations', label: 'Pick-ups', kind: 'int',
    rows: b => b.ops_pickups ?? [], value: l => num(l[0], 'tot_total') || num(l[0], 'tot_sn_all') + num(l[0], 'tot_cust_all') },

  { id: 'wh_occ', dept: 'warehouse', label: 'Occupied sqft', kind: 'int',
    rows: b => b.warehouse_readings ?? [], dateKey: 'month',
    value: l => sum(uniqueWh(l), 'occupied_space') },
  { id: 'wh_util', dept: 'warehouse', label: 'Utilisation', kind: 'pct',
    rows: b => b.warehouse_readings ?? [], dateKey: 'month',
    value: l => {
      const rows = uniqueWh(l);
      const tot = sum(rows, 'total_space');
      return tot ? (sum(rows, 'occupied_space') / tot) * 100 : 0;
    } },

  { id: 'b2b_clients', dept: 'b2b', label: 'Active clients', kind: 'int',
    rows: b => b.b2b_occupancy ?? [], value: l => sum(l, 'active_clients') },
  { id: 'b2b_sqft', dept: 'b2b', label: 'Occupied sqft', kind: 'int',
    rows: b => b.b2b_occupancy ?? [], value: l => sum(l, 'txn_sqft') + sum(l, 'nontxn_sqft') },
  { id: 'b2b_rev', dept: 'b2b', label: 'B2B revenue', kind: 'money',
    rows: b => b.b2b_revenue ?? [],
    value: l => sum(l, 'total_rev') || sum(l, 'rental_rev') + sum(l, 'txn_rev') + sum(l, 'logistics_rev') },

  { id: 'sales_leads', dept: 'sales', label: 'Total leads', kind: 'int',
    rows: b => [...(b.sales_storage ?? []), ...(b.sales_moving ?? [])],
    value: l => sum(l, 'tot_leads') || sum(l, 'total_leads') },
  { id: 'sales_orders', dept: 'sales', label: 'Orders', kind: 'int',
    rows: b => [...(b.sales_storage ?? []), ...(b.sales_moving ?? [])],
    value: l => sum(l, 'tot_orders') },
  { id: 'sales_valid', dept: 'sales', label: 'Valid leads', kind: 'int',
    rows: b => b.b2b_sales ?? [...(b.sales_storage ?? []), ...(b.sales_moving ?? [])],
    value: l => sum(l, 'valid_leads') || sum(l, 'tot_leads') },
  { id: 'sales_value', dept: 'sales', label: 'Total value', kind: 'money',
    rows: b => [...(b.sales_storage ?? []), ...(b.sales_moving ?? [])],
    value: l => sum(l, 'tot_value') },

  { id: 'mkt_leads', dept: 'marketing', label: 'Marketing leads', kind: 'int',
    rows: b => b.marketing_leads ?? [],
    value: l => num(l[0], 'b2b_total') + num(l[0], 'b2c_total') || num(l[0], 'total_leads') },
];

function fmt(kind: Kind, v: number) {
  if (kind === 'money') return formatINR(v);
  if (kind === 'pct') return formatPct(v, 1);
  return formatInt(Math.round(v));
}
function fmtCompact(kind: Kind, v: number) {
  if (kind === 'money') return formatINRCompact(v);
  if (kind === 'pct') return formatPct(v, 1);
  return formatInt(Math.round(v));
}

export default function Presentation() {
  const { principal, hasDepartment } = usePermission();
  const superAdmin = principal?.role === 'super_admin';
  const departments = useMemo(
    () => activeDepartments().filter(d => d.inWorkspace && hasDepartment(d.id)),
    [hasDepartment]);
  const datasets = useMemo(() => {
    const ids = new Set(departments.map(d => d.id));
    return allDatasets().filter(d =>
      ids.has(d.department)
      || ((ids.has('facility') || ids.has('warehouse')) && d.id === 'warehouse_readings'));
  }, [departments]);
  const facilityIds = useMemo(() => {
    if (!departments.some(d => d.id === 'facility' || d.id === 'warehouse')) return [] as string[];
    const ds = getDataset('warehouse_readings');
    if (!ds) return [];
    const prefix = ds.tabPrefix || 'Readings';
    return windowTabNames(prefix, 13).map(tab => scopedId(ds.id, tab));
  }, [departments]);
  const loadIds = useMemo(() => {
    const ids = datasets.map(d => d.id).filter(id => id !== 'warehouse_readings');
    return [...ids, ...facilityIds];
  }, [datasets, facilityIds]);
  const { byId: rawById, fetchedAt, status, refresh } = useDatasets(loadIds);
  const byId = useMemo(() => {
    const warehouse_readings = facilityIds.flatMap(id => {
      const tab = id.split('::')[1] ?? '';
      const d = tabMonthDate(tab);
      const month = d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        : '';
      return (rawById[id] ?? []).map(r => ({ ...r, month: month || r.recorded_on || r.month }));
    });
    return { ...rawById, warehouse_readings };
  }, [rawById, facilityIds]);

  const monthKeys = useMemo(() => {
    const s = new Set<string>();
    for (const rows of Object.values(byId)) {
      for (const r of rows) {
        const k = monthKey(r.month ?? (r as Row).recorded_on);
        if (k) s.add(k);
      }
    }
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [byId]);
  const [pickRaw, setPick] = useState('');
  const pick = pickRaw || (monthKeys.length ? '6m' : defaultMonthPeriod(monthKeys));
  const allow = useMemo(() => new Set(keysInWindow(monthKeys, pick)), [monthKeys, pick]);

  const usable = useMemo(
    () => METRICS.filter(m =>
      hasDepartment(m.dept as never)
      || (m.dept === 'warehouse' && (hasDepartment('warehouse' as never) || hasDepartment('facility' as never)))),
    [hasDepartment]);

  const [picked, setPicked] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(saved) && saved.length) return saved;
    } catch { /* ignore */ }
    return [];
  });
  const persist = (ids: string[]) => {
    setPicked(ids);
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* ignore */ }
  };

  const [tab, setTab] = useState(departments[0]?.id ?? 'finance');
  const tabMetrics = usable.filter(m => m.dept === tab || (tab === 'facility' && m.dept === 'warehouse'));

  const facilitySeries = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const id of facilityIds) {
      const d = tabMonthDate(id.split('::')[1] ?? '');
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rows = uniqueWh(rawById[id] ?? []);
      if (!rows.length) continue;
      map.set(key, rows);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [facilityIds, rawById]);

  const resolved = picked
    .map(id => usable.find(m => m.id === id))
    .filter((m): m is MetricDef => Boolean(m))
    .map(m => {
      const fromTabs = m.dept === 'warehouse' ? facilitySeries : null;
      const windowed = fromTabs
        ? (allow.size ? fromTabs.filter(([k]) => allow.has(k)) : fromTabs)
        : seriesOf(m, byId, allow);
      const all = windowed.length ? windowed : (fromTabs && fromTabs.length ? fromTabs : seriesOf(m, byId));
      const last = all[all.length - 1];
      const data: SeriesPoint[] = (windowed.length ? windowed : all).map(([k, list]) => ({
        key: k, label: monthLabel(k), values: { v: m.value(list) }, rows: list,
      }));
      return {
        m,
        month: last ? monthLabel(last[0]) : '',
        has: Boolean(last),
        fallback: !windowed.length && Boolean(last),
        value: last ? m.value(last[1]) : 0,
        data,
      };
    });

  return (
    <>
      <TopBar title="Presentation"
        actions={<Button size="sm" icon="report" onClick={() => window.print()}>Print</Button>} />
      <ControlBar datasetIds={loadIds} fetchedAt={fetchedAt} busy={status === 'loading'} onRefresh={refresh} />

      <div className="page">
        <p className="pres-note">
          {superAdmin
            ? 'Pick any department metric. They sit on one board so you can compare teams.'
            : 'You can only add metrics from your department.'}
        </p>

        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <PeriodSelect id="pres-pick" value={pick} onChange={setPick} monthKeys={monthKeys} />
        </div>

        <section className="section" style={{ marginTop: 0 }}>
          <SectionHeader title="Add to the board" note={departments.find(d => d.id === tab)?.label} />
          <div className="pres-tools" style={{ marginBottom: 10 }}>
            {departments.map(d => (
              <button key={d.id} className="pres-tab" aria-pressed={tab === d.id} onClick={() => setTab(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="pres-picks">
            {tabMetrics.map(m => {
              const on = picked.includes(m.id);
              return (
                <button key={m.id} className={`pres-chip${on ? ' is-on' : ''}`}
                  onClick={() => persist(on ? picked.filter(x => x !== m.id) : [...picked, m.id])}>
                  {on ? '✓ ' : '+ '}{m.label}
                </button>
              );
            })}
            {!tabMetrics.length && <span style={{ color: 'var(--ink-400)', fontSize: 13 }}>No metrics for this team yet.</span>}
          </div>
        </section>

        <section className="section">
          <SectionHeader title="Board"
            note={`${resolved.length} metric${resolved.length === 1 ? '' : 's'}`}
            action={resolved.length ? <Button size="sm" variant="ghost" onClick={() => persist([])}>Clear</Button> : undefined} />
          {!resolved.length ? (
            <div className="card">
              <EmptyState icon="present" title="Nothing on the board"
                body="Choose a team above, then tap the figures you want on this slide." />
            </div>
          ) : (
            <>
              <div className="grid grid--kpi grid--kpi-std">
                {resolved.map(r => (
                  <KpiTile key={r.m.id} label={r.m.label}
                    value={r.has ? fmt(r.m.kind, r.value) : '—'}
                    note={<span className="mk__note">
                      {deptTitle(r.m.dept, departments)} · {r.has ? (r.fallback ? `latest ${r.month}` : r.month) : 'no data yet'}
                    </span>} />
                ))}
              </div>
              <div className="pres-charts">
                {resolved.filter(r => r.data.length > 0).map(r => (
                  <div key={r.m.id} className="card"><div className="card__bd">
                    <ChartFrame title={r.m.label}
                      question={`${deptTitle(r.m.dept, departments)} · ${r.has ? r.month : ''}`}
                      height={200} isEmpty={!r.data.some(p => p.values.v)}>
                      {h => (
                        <TrendChart height={h} data={r.data}
                          valueFormat={v => fmtCompact(r.m.kind, v)}
                          series={[{ id: 'v', label: r.m.label, kind: 'area', colorIndex: 0 }]} />
                      )}
                    </ChartFrame>
                  </div></div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}



