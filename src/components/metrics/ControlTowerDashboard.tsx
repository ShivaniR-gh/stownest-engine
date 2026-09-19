import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/primitives';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import { keysInWindow, defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { KpiTile } from '@/components/metrics/KpiTile';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import type { SeriesPoint } from '@/lib/analytics/aggregate';

const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi/Gurugram' },
  { key: 'kol', name: 'Kolkata' },
] as const;

const n = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);

const cityGap = (r: Row | undefined, key: string) => {
  const pk = n(r, `${key}_pickups`);
  const dl = n(r, `${key}_deliveries`);
  return { pk, dl, diff: pk - dl, pct: dl > 0 ? ((pk - dl) / dl) * 100 : 0 };
};

const cityTotals = (r: Row | undefined) => {
  return CITIES.reduce((acc, c) => {
    const g = cityGap(r, c.key);
    acc.pk += g.pk; acc.dl += g.dl; acc.diff += g.diff;
    return acc;
  }, { pk: 0, dl: 0, diff: 0 });
};

const rentalGap = (r: Row | undefined) => {
  const pkR = n(r, 'pk_rental');
  const dlR = n(r, 'dl_rental');
  const pkC = n(r, 'pk_count');
  const dlC = n(r, 'dl_count');
  return { pkR, dlR, pkC, dlC, money: pkR - dlR, count: pkC - dlC };
};

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
};

/** Thin wrapper over the shared tile. `i` is kept in the signature because
 *  every call site passes it; it no longer picks a colour. */
function Kpi({ label, value, note, lead }: { i?: number; label: string; value: string; note?: string; lead?: boolean }) {
  return (
    <KpiTile label={label} value={value} lead={lead}
      note={note ? <span className="mk__note">{note}</span> : undefined} />
  );
}

function monthsOf(rows: Row[]) {
  const seen = new Map<string, Row>();
  for (const r of rows) {
    const k = monthKey(r.month);
    if (k && !seen.has(k)) seen.set(k, r);
  }
  return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export function ControlTowerDashboard({ rows, activeDatasetId, hideKpis }: {
  rows: Record<string, Row[]>;
  activeDatasetId: string;
  hideKpis?: boolean;
}) {
  const id = activeDatasetId || 'ct_rental_trends';
  const list = rows[id] ?? [];
  const newest = useMemo(() => monthsOf(list), [list]);
  const monthKeys = newest.map(([k]) => k);


  const [pickRaw, setPick] = useState<string>('');
  /** Opens on last month; an explicit choice overrides it. Kept as a derived
   *  value rather than a useState initializer because the month list is not
   *  known on first render. */
  const pick = pickRaw || defaultMonthPeriod(monthKeys);
  const windowed = useMemo(() => {
    const keys = keysInWindow(monthKeys, pick);
    return newest.filter(([k]) => keys.includes(k));
  }, [newest, monthKeys, pick]);
  const cur = windowed[0]?.[1];

  if (!newest.length) {
    return (
      <EmptyState icon="chart" title="No months recorded yet"
        body="Use New record on this chip to add the first month." />
    );
  }

  return (
    <>
      {!hideKpis && (
        <section className="section">
          <div className="filter-bar">
            <PeriodSelect id="ct-month-pick" value={pick} onChange={setPick} monthKeys={monthKeys} />
          </div>
          <Kpis id={id} cur={cur} />
        </section>
      )}

      <section className="section" style={hideKpis ? { marginTop: 12 } : undefined}>
        {!hideKpis && <SectionHeader title="Report" />}
        <Table id={id} rows={id === 'ct_rental_trends' ? windowed.map(([, r]) => r) : (cur ? [cur] : [])} />
      </section>
      {!hideKpis && <Charts id={id} windowed={windowed} cur={cur} />}
    </>
  );
}

const INCOME_CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi/Haryana' },
  { key: 'kol', name: 'Kolkata' },
] as const;

function Kpis({ id, cur }: { id: string; cur?: Row }) {
  if (id === 'ct_city_income') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Active clients" value={formatInt(n(cur, 'tot_clients'))} />
        <Kpi i={1} label="Rental income" value={formatINRCompact(n(cur, 'tot_rental'))} />
        <Kpi i={2} label="Logistic income" value={formatINRCompact(n(cur, 'tot_logistic'))} />
        <Kpi i={3} label="Total income" value={formatINRCompact(n(cur, 'tot_rental') + n(cur, 'tot_logistic'))} lead />
      </div>
    );
  }
  if (id === 'ct_rental_trends') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Pickup rental" value={formatINRCompact(n(cur, 'pk_rental'))} />
        <Kpi i={1} label="Delivery rental" value={formatINRCompact(n(cur, 'dl_rental'))} />
        <Kpi i={2} label="Difference" value={formatINRCompact(rentalGap(cur).money)} lead />
        <Kpi i={3} label="Count gap" value={formatInt(rentalGap(cur).count)} />
      </div>
    );
  }
  if (id === 'ct_city_gap') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Pick-ups" value={formatInt(n(cur, 'tot_pickups'))} />
        <Kpi i={1} label="Deliveries" value={formatInt(n(cur, 'tot_deliveries'))} />
        <Kpi i={2} label="Difference" value={formatInt(cityTotals(cur).diff)} lead />
        <Kpi i={3} label="Percentage" value={formatPct(cityTotals(cur).dl ? (cityTotals(cur).diff / cityTotals(cur).dl) * 100 : 0, 0)} />
      </div>
    );
  }
  if (id === 'ct_interstate') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Pickup total" value={formatInt(n(cur, 'pk_total'))} note={`${formatInt(n(cur, 'pk_transit'))} in transit`} />
        <Kpi i={1} label="Delivery total" value={formatInt(n(cur, 'dl_total'))} note={`${formatInt(n(cur, 'dl_transit'))} in transit`} />
      </div>
    );
  }
  if (id === 'ct_reviews') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Deliveries" value={formatInt(n(cur, 'dl_count'))} />
        <Kpi i={1} label="Reviews" value={formatInt(n(cur, 'review_count'))} lead />
        <Kpi i={2} label="Pickup reviewed" value={formatInt(n(cur, 'tot_pk_rev'))} />
        <Kpi i={3} label="Pickup negative" value={formatInt(n(cur, 'tot_pk_neg'))} />
      </div>
    );
  }
  if (id === 'ct_tickets') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Expense" value={formatINRCompact(n(cur, 'exp_total'))} lead />
        <Kpi i={1} label="Damage/missing tickets" value={formatInt(n(cur, 'tix_dmg_total'))} />
        <Kpi i={2} label="Other tickets" value={formatInt(n(cur, 'other_total'))} />
      </div>
    );
  }
  if (id === 'ct_delivery_econ') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Total deliveries" value={formatInt(n(cur, 'tot_del'))} />
        <Kpi i={1} label="By StowNest" value={formatInt(n(cur, 'by_sn'))} />
        <Kpi i={2} label="Revenue" value={formatINRCompact(n(cur, 'revenue'))} lead />
        <Kpi i={3} label="Conversion" value={formatPct(n(cur, 'conv_rate'), 0)} />
      </div>
    );
  }
  if (id === 'ct_calls') {
    return (
      <div className="grid grid--kpi grid--kpi-std">
        <Kpi i={0} label="Call total" value={formatInt(n(cur, 'cq_total'))} lead />
        <Kpi i={1} label="Missed calls" value={formatInt(n(cur, 'cq_miss'))} />
        <Kpi i={2} label="Interakt total" value={formatInt(n(cur, 'ik_total'))} />
      </div>
    );
  }
  return null;
}

function Table({ id, rows }: { id: string; rows: Row[] }) {
  if (!rows.length) return null;
  const money = (v: number) => formatINR(v);

  if (id === 'ct_rental_trends') {
    const totPkR = rows.reduce((a, r) => a + n(r, 'pk_rental'), 0);
    const totPkC = rows.reduce((a, r) => a + n(r, 'pk_count'), 0);
    const totDlR = rows.reduce((a, r) => a + n(r, 'dl_rental'), 0);
    const totDlC = rows.reduce((a, r) => a + n(r, 'dl_count'), 0);
    return (
      <div className="card"><div className="card__bd" style={{ overflowX: 'auto' }}>
        <table className="xpose">
          <thead>
            <tr>
              <th className="xpose__rowhd">Month</th>
              <th className="is-num">Pickup Rental</th>
              <th className="is-num">Number of Pickup</th>
              <th className="is-num">Delivery Rental</th>
              <th className="is-num">Number of Delivery</th>
              <th className="is-num">Difference</th>
              <th className="is-num">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={monthKey(r.month)}>
                <th className="xpose__rowhd">{monthLabel(r.month)}</th>
                <td className="is-num">{money(n(r, 'pk_rental'))}</td>
                <td className="is-num">{formatInt(n(r, 'pk_count'))}</td>
                <td className="is-num">{money(n(r, 'dl_rental'))}</td>
                <td className="is-num">{formatInt(n(r, 'dl_count'))}</td>
                <td className="is-num">{money(rentalGap(r).money)}</td>
                <td className="is-num">{formatInt(rentalGap(r).count)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="xpose__foot">
              <th className="xpose__rowhd">Total</th>
              <td className="is-num">{money(totPkR)}</td>
              <td className="is-num">{formatInt(totPkC)}</td>
              <td className="is-num">{money(totDlR)}</td>
              <td className="is-num">{formatInt(totDlC)}</td>
              <td className="is-num">{money(totPkR - totDlR)}</td>
              <td className="is-num">{formatInt(totPkC - totDlC)}</td>
            </tr>
          </tfoot>
        </table>
      </div></div>
    );
  }

  const r = rows[0];
  if (id === 'ct_city_income') {
    return (
      <div className="card"><div className="card__bd" style={{ overflowX: 'auto' }}>
        <h3 className="cef__sec" style={{ marginTop: 0 }}>Income by CT</h3>
        <table className="xpose">
          <thead>
            <tr>
              <th className="xpose__rowhd">City</th>
              <th className="is-num">Active clients</th>
              <th className="is-num">Rental income</th>
              <th className="is-num">Logistic income</th>
            </tr>
          </thead>
          <tbody>
            {INCOME_CITIES.map(c => (
              <tr key={c.key}>
                <th className="xpose__rowhd">{c.name}</th>
                <td className="is-num">{formatInt(n(r, `${c.key}_clients`))}</td>
                <td className="is-num">{money(n(r, `${c.key}_rental`))}</td>
                <td className="is-num">{money(n(r, `${c.key}_logistic`))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="xpose__foot">
              <th className="xpose__rowhd">Total</th>
              <td className="is-num">{formatInt(n(r, 'tot_clients'))}</td>
              <td className="is-num">{money(n(r, 'tot_rental'))}</td>
              <td className="is-num">{money(n(r, 'tot_logistic'))}</td>
            </tr>
          </tfoot>
        </table>
      </div></div>
    );
  }
  if (id === 'ct_city_gap') {
    return (
      <div className="card"><div className="card__bd" style={{ overflowX: 'auto' }}>
        <table className="xpose">
          <thead>
            <tr>
              <th className="xpose__rowhd">City</th>
              <th className="is-num">Pick-ups</th>
              <th className="is-num">Deliveries</th>
              <th className="is-num">Difference</th>
              <th className="is-num">Percentage</th>
            </tr>
          </thead>
          <tbody>
            {CITIES.map(c => (
              <tr key={c.key}>
                <th className="xpose__rowhd">{c.name}</th>
                <td className="is-num">{formatInt(n(r, `${c.key}_pickups`))}</td>
                <td className="is-num">{formatInt(n(r, `${c.key}_deliveries`))}</td>
                <td className="is-num">{formatInt(cityGap(r, c.key).diff)}</td>
                <td className="is-num">{formatPct(cityGap(r, c.key).pct, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="xpose__foot">
              <th className="xpose__rowhd">Total</th>
              <td className="is-num">{formatInt(n(r, 'tot_pickups'))}</td>
              <td className="is-num">{formatInt(n(r, 'tot_deliveries'))}</td>
              <td className="is-num">{formatInt(cityTotals(r).diff)}</td>
              <td className="is-num">{formatPct(cityTotals(r).dl ? (cityTotals(r).diff / cityTotals(r).dl) * 100 : 0, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div></div>
    );
  }

  if (id === 'ct_reviews') {
    return (
      <>
        <div className="card" style={{ marginBottom: 'var(--s4)' }}><div className="card__bd" style={{ overflowX: 'auto' }}>
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Pickup &amp; delivery reviews by city</h3>
          <table className="xpose">
            <thead>
              <tr>
                <th className="xpose__rowhd">City</th>
                <th className="is-num">Pk requested</th>
                <th className="is-num">Pk reviewed</th>
                <th className="is-num">Pk negative</th>
                <th className="is-num">Dl requested</th>
                <th className="is-num">Dl reviewed</th>
              </tr>
            </thead>
            <tbody>
              {CITIES.map(c => (
                <tr key={c.key}>
                  <th className="xpose__rowhd">{c.name}</th>
                  <td className="is-num">{formatInt(n(r, `${c.key}_pk_req`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_pk_rev`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_pk_neg`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_dl_req`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_dl_rev`))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
        <div className="card"><div className="card__bd" style={{ overflowX: 'auto' }}>
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Negative reasons by city</h3>
          <table className="xpose">
            <thead>
              <tr>
                <th className="xpose__rowhd">City</th>
                <th className="is-num">Communication</th>
                <th className="is-num">Pricing</th>
                <th className="is-num">Damage/Missing</th>
                <th className="is-num">Only star</th>
              </tr>
            </thead>
            <tbody>
              {CITIES.map(c => (
                <tr key={c.key}>
                  <th className="xpose__rowhd">{c.name}</th>
                  <td className="is-num">{formatInt(n(r, `${c.key}_comm`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_price`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_dmg`))}</td>
                  <td className="is-num">{formatInt(n(r, `${c.key}_star`))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </>
    );
  }

  if (id === 'ct_calls') {
    const callRows: [string, string][] = [
      ['New Query', 'cq_new'], ['RM Query', 'cq_rm'], ['Enquiry', 'cq_enq'],
      ['P&D Confirmation', 'cq_pd'], ['Business', 'cq_biz'], ['Invoice CT', 'cq_inv_ct'],
      ['Invoice A/c', 'cq_inv_ac'], ['New Delivery', 'cq_new_del'],
      ['Repeated Delivery', 'cq_rep_del'], ['Damage/Missing', 'cq_dmg'],
      ['Repeated Damage/Missing', 'cq_rep_dmg'], ['Other City', 'cq_other'],
      ['Invalid', 'cq_invalid'],
    ];
    const ikRows: [string, string][] = [
      ['New Query', 'ik_new'], ['Enquiry', 'ik_enq'], ['New Delivery', 'ik_new_del'],
      ['Other City', 'ik_other'], ['Invalid', 'ik_invalid'],
    ];
    return (
      <div className="grid grid--split">
        <div className="card"><div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Call update</h3>
          <table className="xpose">
            <tbody>
              {callRows.map(([label, key]) => (
                <tr key={key}>
                  <th className="xpose__rowhd">{label}</th>
                  <td className="is-num">{formatInt(n(r, key))}</td>
                </tr>
              ))}
              <tr className="xpose__foot">
                <th className="xpose__rowhd">Total</th>
                <td className="is-num">{formatInt(n(r, 'cq_total'))}</td>
              </tr>
              <tr>
                <th className="xpose__rowhd">Missed calls</th>
                <td className="is-num">{formatInt(n(r, 'cq_miss'))}</td>
              </tr>
            </tbody>
          </table>
        </div></div>
        <div className="card"><div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Interakt</h3>
          <table className="xpose">
            <tbody>
              {ikRows.map(([label, key]) => (
                <tr key={key}>
                  <th className="xpose__rowhd">{label}</th>
                  <td className="is-num">{formatInt(n(r, key))}</td>
                </tr>
              ))}
              <tr className="xpose__foot">
                <th className="xpose__rowhd">Total</th>
                <td className="is-num">{formatInt(n(r, 'ik_total'))}</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </div>
    );
  }

  if (id === 'ct_tickets') {
    return (
      <div className="grid grid--split">
        <div className="card"><div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Damages and missing</h3>
          <table className="xpose">
            <thead>
              <tr><th className="xpose__rowhd">Line</th><th className="is-num">Expense</th><th className="is-num">Tickets</th></tr>
            </thead>
            <tbody>
              <tr><th className="xpose__rowhd">Damages</th><td className="is-num">{money(n(r, 'dmg_exp'))}</td><td className="is-num">{formatInt(n(r, 'dmg_tix'))}</td></tr>
              <tr><th className="xpose__rowhd">Missing</th><td className="is-num">{money(n(r, 'miss_exp'))}</td><td className="is-num">{formatInt(n(r, 'miss_tix'))}</td></tr>
            </tbody>
            <tfoot>
              <tr className="xpose__foot"><th className="xpose__rowhd">Total</th><td className="is-num">{money(n(r, 'exp_total'))}</td><td className="is-num">{formatInt(n(r, 'tix_dmg_total'))}</td></tr>
            </tfoot>
          </table>
        </div></div>
        <div className="card"><div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Other tickets</h3>
          <table className="xpose">
            <tbody>
              <tr><th className="xpose__rowhd">Invoice queries</th><td className="is-num">{formatInt(n(r, 'inv_queries'))}</td></tr>
              <tr><th className="xpose__rowhd">Service escalations</th><td className="is-num">{formatInt(n(r, 'escalations'))}</td></tr>
              <tr><th className="xpose__rowhd">Warehouse visits</th><td className="is-num">{formatInt(n(r, 'wh_visits'))}</td></tr>
              <tr><th className="xpose__rowhd">Photo and video</th><td className="is-num">{formatInt(n(r, 'photo_video'))}</td></tr>
              <tr className="xpose__foot"><th className="xpose__rowhd">Total</th><td className="is-num">{formatInt(n(r, 'other_total'))}</td></tr>
            </tbody>
          </table>
        </div></div>
      </div>
    );
  }

  if (id === 'ct_interstate') {
    return (
      <div className="grid grid--split">
        <div className="card"><div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Interstate pickups</h3>
          <table className="xpose">
            <tbody>
              <tr><th className="xpose__rowhd">Completed</th><td className="is-num">{formatInt(n(r, 'pk_done'))}</td></tr>
              <tr><th className="xpose__rowhd">In transit</th><td className="is-num">{formatInt(n(r, 'pk_transit'))}</td></tr>
              <tr className="xpose__foot"><th className="xpose__rowhd">Total</th><td className="is-num">{formatInt(n(r, 'pk_total'))}</td></tr>
            </tbody>
          </table>
        </div></div>
        <div className="card"><div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>Interstate deliveries</h3>
          <table className="xpose">
            <tbody>
              <tr><th className="xpose__rowhd">Completed</th><td className="is-num">{formatInt(n(r, 'dl_done'))}</td></tr>
              <tr><th className="xpose__rowhd">In transit</th><td className="is-num">{formatInt(n(r, 'dl_transit'))}</td></tr>
              <tr className="xpose__foot"><th className="xpose__rowhd">Total</th><td className="is-num">{formatInt(n(r, 'dl_total'))}</td></tr>
            </tbody>
          </table>
        </div></div>
      </div>
    );
  }

  if (id === 'ct_delivery_econ') {
    const tot = n(r, 'tot_del');
    const sn = n(r, 'by_sn');
    const rev = n(r, 'revenue');
    const conv = tot > 0 ? (sn / tot) * 100 : 0;
    const earn = sn > 0 ? rev / sn : 0;
    return (
      <div className="card"><div className="card__bd">
        <table className="xpose">
          <tbody>
            <tr><th className="xpose__rowhd">Total deliveries</th><td className="is-num">{formatInt(tot)}</td></tr>
            <tr><th className="xpose__rowhd">Delivery by customer</th><td className="is-num">{formatInt(n(r, 'by_cust'))}</td></tr>
            <tr><th className="xpose__rowhd">Delivery by StowNest</th><td className="is-num">{formatInt(sn)}</td></tr>
            <tr><th className="xpose__rowhd">No of items</th><td className="is-num">{formatInt(n(r, 'items'))}</td></tr>
            <tr><th className="xpose__rowhd">Delivery revenue</th><td className="is-num">{money(rev)}</td></tr>
            <tr><th className="xpose__rowhd">Conversion rate</th><td className="is-num">{formatPct(conv, 0)}</td></tr>
            <tr><th className="xpose__rowhd">Earnings / request</th><td className="is-num">{money(earn)}</td></tr>
          </tbody>
        </table>
      </div></div>
    );
  }

  return null;
}


function pack(id: string, r: Row): Record<string, number> {
  if (id === 'ct_city_income') {
    return {
      rental: n(r, 'tot_rental'), logistic: n(r, 'tot_logistic'),
      income: n(r, 'tot_rental') + n(r, 'tot_logistic'), clients: n(r, 'tot_clients'),
    };
  }
  if (id === 'ct_rental_trends') {
    const g = rentalGap(r);
    return { pkR: g.pkR, dlR: g.dlR, pkC: g.pkC, dlC: g.dlC, gapR: g.money };
  }
  if (id === 'ct_city_gap') {
    const tot = cityTotals(r);
    return { pk: n(r, 'tot_pickups') || tot.pk, dl: n(r, 'tot_deliveries') || tot.dl, gap: tot.diff };
  }
  if (id === 'ct_interstate') {
    const pk = n(r, 'pk_total') || n(r, 'pk_done') + n(r, 'pk_transit');
    const dl = n(r, 'dl_total') || n(r, 'dl_done') + n(r, 'dl_transit');
    return {
      pkDone: n(r, 'pk_done'), pkTransit: n(r, 'pk_transit'), pk,
      dlDone: n(r, 'dl_done'), dlTransit: n(r, 'dl_transit'), dl,
      pkRate: pk ? (n(r, 'pk_done') / pk) * 100 : 0,
    };
  }
  if (id === 'ct_reviews') {
    const del = n(r, 'dl_count');
    const rev = n(r, 'review_count');
    return {
      del, rev, cover: del ? (rev / del) * 100 : 0,
      badComm: n(r, 'bad_comm'), badDmg: n(r, 'bad_dmg'),
      pkNeg: n(r, 'tot_pk_neg'), pkRev: n(r, 'tot_pk_rev'),
    };
  }
  if (id === 'ct_tickets') {
    const tix = n(r, 'tix_dmg_total');
    const exp = n(r, 'exp_total');
    return {
      dmgTix: n(r, 'dmg_tix'), missTix: n(r, 'miss_tix'),
      dmgExp: n(r, 'dmg_exp'), missExp: n(r, 'miss_exp'), exp,
      other: n(r, 'other_total'),
      costPer: tix ? exp / tix : 0,
    };
  }
  if (id === 'ct_delivery_econ') {
    const tot = n(r, 'tot_del');
    const sn = n(r, 'by_sn');
    const rev = n(r, 'revenue');
    return {
      tot, sn, cust: n(r, 'by_cust'), rev,
      conv: tot ? (sn / tot) * 100 : 0,
      earn: sn ? rev / sn : 0,
    };
  }
  if (id === 'ct_calls') {
    const tot = n(r, 'cq_total');
    return {
      calls: tot, interakt: n(r, 'ik_total'), missed: n(r, 'cq_miss'),
      missRate: tot ? (n(r, 'cq_miss') / tot) * 100 : 0,
      dmg: n(r, 'cq_dmg') + n(r, 'cq_rep_dmg'),
      newDel: n(r, 'cq_new_del'),
    };
  }
  return {};
}

function Charts({ id, windowed, cur }: { id: string; windowed: [string, Row][]; cur?: Row }) {
  const trend: SeriesPoint[] = useMemo(() => (
    [...windowed].reverse().map(([k, r]) => ({
      key: k, label: monthLabel(r.month), rows: [r], values: pack(id, r),
    }))
  ), [id, windowed]);
  const h = 240;
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 } as const;

  if (id === 'ct_city_income') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Income" question="Is rental and logistic income moving together?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
              series={[
                { id: 'rental', label: 'Rental', kind: 'line', colorIndex: 0 },
                { id: 'logistic', label: 'Logistic', kind: 'line', colorIndex: 2 },
                { id: 'income', label: 'Total', kind: 'line', colorIndex: 1 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Clients vs income" question="Are clients and income moving together?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt} legendStat="none"
              series={[
                { id: 'clients', label: 'Active clients', kind: 'line', colorIndex: 0 },
                { id: 'income', label: 'Total income', kind: 'line', colorIndex: 1, axis: 'right',
                  format: formatINRCompact },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Income by city" question="Which cities contribute most?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Total income" valueFormat={formatINRCompact} colorIndex={0}
              data={INCOME_CITIES.map(c => ({
                key: c.name,
                value: n(cur, `${c.key}_rental`) + n(cur, `${c.key}_logistic`),
                count: 1, rows: cur ? [cur] : [],
              })).filter(d => d.value)} />}
          </ChartFrame>
          <ChartFrame title="Rental by city" question="Where is storage income coming from?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Rental income" valueFormat={formatINRCompact} colorIndex={0}
              data={INCOME_CITIES.map(c => ({
                key: c.name, value: n(cur, `${c.key}_rental`), count: 1, rows: cur ? [cur] : [],
              })).filter(d => d.value)} />}
          </ChartFrame>
          <ChartFrame title="Logistic by city" question="Where is moving income coming from?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Logistic income" valueFormat={formatINRCompact} colorIndex={2}
              data={INCOME_CITIES.map(c => ({
                key: c.name, value: n(cur, `${c.key}_logistic`), count: 1, rows: cur ? [cur] : [],
              })).filter(d => d.value)} />}
          </ChartFrame>
          <ChartFrame title="Clients by city" question="Where are the active clients?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Active clients" valueFormat={formatInt} colorIndex={1}
              data={INCOME_CITIES.map(c => ({
                key: c.name, value: n(cur, `${c.key}_clients`), count: 1, rows: cur ? [cur] : [],
              })).filter(d => d.value)} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_rental_trends') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Pickup vs delivery rental" question="Which side is earning more?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
              series={[
                { id: 'pkR', label: 'Pickup rental', kind: 'line', colorIndex: 0 },
                { id: 'dlR', label: 'Delivery rental', kind: 'line', colorIndex: 2 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Pickup vs delivery count" question="Are volumes in step?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'pkC', label: 'Pickups', kind: 'line', colorIndex: 0 },
                { id: 'dlC', label: 'Deliveries', kind: 'line', colorIndex: 2 },
              ]} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_city_gap') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="National pickup vs delivery" question="Is the gap closing?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'pk', label: 'Pick-ups', kind: 'line', colorIndex: 0 },
                { id: 'dl', label: 'Deliveries', kind: 'line', colorIndex: 2 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Gap by city" question="Where is pickup ahead of delivery?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Pickup − delivery gap" valueFormat={formatInt} colorIndex={3}
              data={CITIES.map(c => ({
                key: c.name, value: cityGap(cur, c.key).diff, count: 1, rows: cur ? [cur] : [],
              }))} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_interstate') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Completed vs in transit" question="How much work is still on the road?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'pkDone', label: 'Pickup done', kind: 'bar', colorIndex: 0 },
                { id: 'pkTransit', label: 'Pickup transit', kind: 'bar', colorIndex: 3 },
                { id: 'dlDone', label: 'Delivery done', kind: 'bar', colorIndex: 2 },
                { id: 'dlTransit', label: 'Delivery transit', kind: 'bar', colorIndex: 4 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Pickup completion" question="What share of pickups is finished?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={v => formatPct(v, 1)} legendStat="avg"
              series={[{ id: 'pkRate', label: 'Completed %', kind: 'line', colorIndex: 1 }]} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_reviews') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Review coverage" question="How many deliveries get a review?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt} legendStat="none"
              series={[
                { id: 'del', label: 'Deliveries', kind: 'line', colorIndex: 0 },
                { id: 'rev', label: 'Reviews', kind: 'line', colorIndex: 2 },
                { id: 'cover', label: 'Coverage %', kind: 'line', colorIndex: 1, axis: 'right',
                  format: v => formatPct(v, 1) },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Bad reviews" question="What is driving negatives?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Bad reviews" valueFormat={formatInt} colorIndex={3} data={[
              { key: 'Communication / pricing', value: n(cur, 'bad_comm'), count: 1, rows: [] },
              { key: 'Damage & missing', value: n(cur, 'bad_dmg'), count: 1, rows: [] },
            ].filter(d => d.value)} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_tickets') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Tickets" question="Are damage and missing tickets rising?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'dmgTix', label: 'Damage', kind: 'bar', colorIndex: 3 },
                { id: 'missTix', label: 'Missing', kind: 'bar', colorIndex: 4 },
                { id: 'other', label: 'Other', kind: 'line', colorIndex: 0 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Expense" question="What are tickets costing?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
              series={[
                { id: 'dmgExp', label: 'Damage ₹', kind: 'line', colorIndex: 3 },
                { id: 'missExp', label: 'Missing ₹', kind: 'line', colorIndex: 4 },
                { id: 'exp', label: 'Total', kind: 'line', colorIndex: 1 },
              ]} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_delivery_econ') {
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Who delivers" question="StowNest vs customer deliveries?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'sn', label: 'StowNest', kind: 'bar', colorIndex: 0 },
                { id: 'cust', label: 'Customer', kind: 'bar', colorIndex: 2 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Revenue vs earnings" question="Is revenue per delivery holding?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact} legendStat="none"
              series={[
                { id: 'rev', label: 'Revenue', kind: 'line', colorIndex: 0 },
                { id: 'earn', label: 'Earnings / delivery', kind: 'line', colorIndex: 1, axis: 'right' },
              ]} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  if (id === 'ct_calls') {
    const mix = [
      ['New query', 'cq_new'], ['Enquiry', 'cq_enq'], ['P&D', 'cq_pd'],
      ['New delivery', 'cq_new_del'], ['Damage', 'cq_dmg'], ['Invalid', 'cq_invalid'],
      ['Missed', 'cq_miss'],
    ] as const;
    return (
      <section className="section">
        <SectionHeader title="Trends" />
        <div style={grid}>
          <ChartFrame title="Calls vs Interakt" question="Where is volume landing?" height={h} isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'calls', label: 'Calls', kind: 'line', colorIndex: 0 },
                { id: 'interakt', label: 'Interakt', kind: 'line', colorIndex: 2 },
                { id: 'missed', label: 'Missed', kind: 'line', colorIndex: 3 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Call mix" question="What are people calling about?" height={h} isEmpty={!cur}>
            {hh => <CategoryChart height={hh} valueLabel="Calls" valueFormat={formatInt} colorIndex={0}
              data={mix.map(([label, key]) => ({
                key: label, value: n(cur, key), count: 1, rows: [],
              })).filter(d => d.value)} />}
          </ChartFrame>
        </div>
      </section>
    );
  }

  return null;
}
