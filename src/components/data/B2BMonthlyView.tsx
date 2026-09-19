import { useMemo, useState } from 'react';
import { SelectField } from '@/components/filters/SelectField';
import { WINDOW_PRESETS, keysInWindow, ytdOptions } from '@/lib/analytics/monthWindow';
import type { Row } from '@/config/types';
import { formatINR, formatInt, formatPct, parseDate, toNum } from '@/lib/format';

const n = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);
const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
};
const pct = (num: number, den: number) => den > 0 ? formatPct((num / den) * 100, 1) : '—';

type Roll = {
  key: string;
  active: number; neu: number; vacated: number; netClients: number;
  occupied: number; added: number; lost: number; netSqft: number;
  inward: number; outward: number; txns: number;
  rental: number; txnRev: number; logi: number; totalRev: number;
};

function roll(key: string, occ: Row[], mov: Row[], rev: Row[], mv: Row[]): Roll {
  const inM = (list: Row[]) => list.filter(r => monthKey(r.month) === key);
  const occM = inM(occ), movM = inM(mov), revM = inM(rev), mvM = inM(mv);
  const neu = mvM.filter(r => String(r.movement) === 'New Client').length;
  const vacated = mvM.filter(r => String(r.movement) === 'Vacated').length;
  const added = mvM.reduce((a, r) => a + Math.max(0, n(r, 'sqft_change')), 0);
  const lost = mvM.reduce((a, r) => a + Math.max(0, -n(r, 'sqft_change')), 0);
  const inward = movM.reduce((a, r) => a + n(r, 'inward'), 0);
  const outward = movM.reduce((a, r) => a + n(r, 'outward'), 0);
  const rental = revM.reduce((a, r) => a + n(r, 'rental_rev'), 0);
  const txnRev = revM.reduce((a, r) => a + n(r, 'txn_rev'), 0);
  const logi = revM.reduce((a, r) => a + n(r, 'logistics_rev'), 0);
  return {
    key,
    active: occM.reduce((a, r) => a + n(r, 'active_clients'), 0),
    neu, vacated, netClients: neu - vacated,
    occupied: occM.reduce((a, r) => a + n(r, 'occupied_sqft'), 0),
    added, lost, netSqft: added - lost,
    inward, outward, txns: inward + outward,
    rental, txnRev, logi, totalRev: rental + txnRev + logi,
  };
}

export function B2BMonthlyView({ rows }: { rows: Record<string, Row[]> }) {
  const occ = rows.b2b_occupancy ?? [];
  const moves = rows.b2b_moves ?? [];
  const rev = rows.b2b_revenue ?? [];
  const movement = rows.b2b_movement ?? [];

  const summary = useMemo(() => {
    const keys = new Set<string>();
    for (const r of [...occ, ...moves, ...rev, ...movement]) {
      const k = monthKey(r.month);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse().map(k => roll(k, occ, moves, rev, movement));
  }, [occ, moves, rev, movement]);

  /* Same Period filter as the other Records tables. All months by default —
     this table is the history, and "All months" is its own reset. */
  const [period, setPeriod] = useState('all');
  const monthKeys = summary.map(s => s.key);           // already newest first
  const visible = period === 'all'
    ? summary
    : (() => {
      const keep = new Set(keysInWindow(monthKeys, period));
      return summary.filter(s => keep.has(s.key));
    })();

  if (!summary.length) {
    return <p className="cef__note">Fill Occupancy, Moves, Revenue and Client movement first. This table is generated from those chips.</p>;
  }

  return (
    <>
    <div className="filter-bar">
      <SelectField icon="calendar" label="Period" value={period} onChange={setPeriod}
        isOn={period !== 'all'}
        options={[
          { value: 'all', label: 'All months' },
          ...WINDOW_PRESETS.map(p => ({ value: p.id, label: p.label })),
          ...ytdOptions(monthKeys).map(y => ({ value: y.id, label: y.label })),
          ...monthKeys.map(k => ({ value: k, label: monthLabel(`${k}-01`) })),
        ]} />
    </div>
    <div className="tbl__wrap">
      <div className="tbl__bar">
        <span className="cef__note" style={{ margin: 0 }}>Generated from Occupancy, Moves, Revenue and Client movement</span>
        <div className="tbl__bar-right">
          <span className="pageno">{visible.length} month{visible.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="tbl__scroll">
      <table className="tbl" style={{ minWidth: 1680 }}>
        <thead>
          <tr>
            <th>Month</th>
            <th className="is-num">Active Clients</th>
            <th className="is-num">New Clients</th>
            <th className="is-num">Vacated Clients</th>
            <th className="is-num">Net Clients</th>
            <th className="is-num">Occupied SQFT</th>
            <th className="is-num">SQFT Added</th>
            <th className="is-num">SQFT Lost</th>
            <th className="is-num">Net SQFT</th>
            <th className="is-num">Inward</th>
            <th className="is-num">Outward</th>
            <th className="is-num">Total Transactions</th>
            <th className="is-num">Rental Revenue</th>
            <th className="is-num">Transaction Revenue</th>
            <th className="is-num">Logistics Revenue</th>
            <th className="is-num">Total Revenue</th>
            <th className="is-num">Revenue / SQFT</th>
            <th className="is-num">Revenue / Client</th>
            <th className="is-num">Revenue / Transaction</th>
            <th className="is-num">Client Churn %</th>
            <th className="is-num">Space Churn %</th>
            <th className="is-num">Client Growth %</th>
            <th className="is-num">SQFT Growth %</th>
            <th className="is-num">Revenue Growth %</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => {
            const prev = summary[i + 1];
            const priorActive = prev?.active ?? 0;
            const priorOcc = prev?.occupied ?? 0;
            const priorRev = prev?.totalRev ?? 0;
            return (
              <tr key={row.key}>
                <td>{monthLabel(row.key + '-01')}</td>
                <td className="is-num">{formatInt(row.active)}</td>
                <td className="is-num">{formatInt(row.neu)}</td>
                <td className="is-num">{formatInt(row.vacated)}</td>
                <td className="is-num">{formatInt(row.netClients)}</td>
                <td className="is-num">{formatInt(row.occupied)}</td>
                <td className="is-num">{formatInt(row.added)}</td>
                <td className="is-num">{formatInt(row.lost)}</td>
                <td className="is-num">{formatInt(row.netSqft)}</td>
                <td className="is-num">{formatInt(row.inward)}</td>
                <td className="is-num">{formatInt(row.outward)}</td>
                <td className="is-num">{formatInt(row.txns)}</td>
                <td className="is-num">{formatINR(row.rental)}</td>
                <td className="is-num">{formatINR(row.txnRev)}</td>
                <td className="is-num">{formatINR(row.logi)}</td>
                <td className="is-num">{formatINR(row.totalRev)}</td>
                <td className="is-num">{row.occupied ? formatINR(row.totalRev / row.occupied) : '—'}</td>
                <td className="is-num">{row.active ? formatINR(row.totalRev / row.active) : '—'}</td>
                <td className="is-num">{row.txns ? formatINR(row.txnRev / row.txns) : '—'}</td>
                <td className="is-num">{prev ? pct(row.vacated, priorActive) : '—'}</td>
                <td className="is-num">{prev ? pct(row.lost, priorOcc) : '—'}</td>
                <td className="is-num">{prev ? pct(row.netClients, priorActive) : '—'}</td>
                <td className="is-num">{prev ? pct(row.netSqft, priorOcc) : '—'}</td>
                <td className="is-num">{prev ? pct(row.totalRev - priorRev, priorRev) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="tbl__foot">
        <span>Showing {visible.length} generated row{visible.length === 1 ? '' : 's'}</span>
        <div className="tbl__foot-right">Not edited — derived</div>
      </div>
    </div>
    </>
  );
}
