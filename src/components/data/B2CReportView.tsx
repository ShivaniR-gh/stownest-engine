import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { formatINR, formatINRCompact, formatInt, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';
import { isRowOpen } from '@/lib/data/editable';
import { SelectField } from '@/components/filters/SelectField';

/** ---------------------------------------------------------------------------
 * B2C monthly report.
 *
 * Two tables, because the report is two tables. The generic record panel shows
 * all twenty-five columns in one sideways-scrolling row — technically the same
 * data, and unreadable as a report.
 *
 * ONE month picker at the top drives both halves. Two pickers on one screen is
 * how a summary ends up quoted against a different month than the city split
 * printed under it.
 *
 * The dashboard reads the selected month as cards; Records keeps it tabular
 * with the four preceding months alongside, because the two views get used for
 * different jobs — glancing at where the month landed, versus checking whether
 * a figure moved.
 * ------------------------------------------------------------------------- */

const n = (v: unknown) => toNum(v) ?? 0;

/** Selected month plus this many before it, in the Records table. Beyond about
 *  five columns a crore figure stops fitting on one line. */
const MONTHS_SHOWN = 5;

const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
  { key: 'gur', name: 'Gurugram' },
] as const;

/**
 * Report order, with the exact labels and emoji the circulated report uses.
 * The report goes to people outside this app; a row that reads differently
 * here is a row someone will query.
 */
const SUMMARY: {
  key: string; label: string; money: boolean;
  tint: string; strong?: boolean;
}[] = [
  { key: 'customers_raised', label: 'Total Customers Raised', money: false, tint: '#3b82f6' },
  { key: 'raised_amount', label: 'Total Raised Amount', money: true, tint: '#6366f1' },
  { key: 'collected_customers', label: 'Total Collected Customers', money: false, tint: '#10b981' },
  { key: 'collection_amount', label: 'Total Collection Amount', money: true, tint: '#059669', strong: true },
  { key: 'pending_customers', label: 'Pending Customers', money: false, tint: '#f59e0b' },
  { key: 'pending_amount', label: 'Pending Amount', money: true, tint: '#ea580c' },
  { key: 'receivable_customers_60', label: 'Receivable Customers (>60 Days)', money: false, tint: '#a855f7' },
  { key: 'receivables_amount_60', label: 'Receivables Amount (>60 Days)', money: true, tint: '#9333ea' },
];

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
};

/** Em dash rather than zero for an absent figure: a blank cell and a real zero
 *  mean different things to whoever reads the report. */
const cell = (r: Row | undefined, key: string, money: boolean, compact = false) => {
  if (!r || r[key] === undefined || r[key] === null || r[key] === '') return '—';
  if (!money) return formatInt(n(r[key]));
  return compact ? formatINRCompact(n(r[key])) : formatINR(n(r[key]));
};

export function B2CReportView({ rows, variant = 'records', onEdit }: {
  rows: Row[];
  /** 'dashboard' renders the month as cards; 'records' as a table. */
  variant?: 'records' | 'dashboard';
  /** Omitted on the dashboard, where the report is read rather than edited. */
  onEdit?: (r: Row) => void;
}) {
  /** Newest first. The report is always read most-recent-first. */
  const months = useMemo(() => {
    const seen = new Map<string, Row>();
    for (const r of rows) {
      const k = monthKey(r.month);
      if (k && !seen.has(k)) seen.set(k, r);
    }
    return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const [pick, setPick] = useState('');
  const activeIdx = Math.max(0, months.findIndex(([k]) => k === pick));
  const activeKey = months[activeIdx]?.[0] ?? '';
  const activeRow = months[activeIdx]?.[1];

  /** The selected month and the months before it — never after, so the table
   *  reads as history rather than jumping around the picker. */
  const shown = months.slice(activeIdx, activeIdx + MONTHS_SHOWN);

  const cityTotals = useMemo(() => ({
    invoice: CITIES.reduce((a, c) => a + n(activeRow?.[`${c.key}_invoice`]), 0),
    collection: CITIES.reduce((a, c) => a + n(activeRow?.[`${c.key}_collection`]), 0),
  }), [activeRow]);

  if (!months.length) {
    return (
      <div className="card"><div className="card__bd">
        <p className="cef__note">No months recorded yet. Use New record to add one.</p>
      </div></div>
    );
  }

  return (
    <>
      {/* Same pill as every other filter row. SelectField rather than
          PeriodSelect: this view selects one month by index, so the 3/6/12
          month presets PeriodSelect offers have no meaning here. */}
      <div className="filter-bar">
        <SelectField icon="calendar" label="Month" value={activeKey}
          onChange={setPick}
          options={months.map(([k, r]) => ({ value: k, label: monthLabel(r.month) }))} />
        {onEdit && activeRow && isRowOpen(activeRow, rows) && (
          <button className="pop__item" onClick={() => onEdit(activeRow)}>Edit this month</button>
        )}
      </div>

      {variant === 'dashboard' ? (
        <div style={{
          display: 'grid', gap: 'var(--s3)', marginBottom: 'var(--s5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
          {SUMMARY.map(f => (
            <div key={f.key} style={{
              padding: 'var(--s4)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)',
              // Tinted rather than saturated: eight fully coloured cards
              // compete with each other and nothing reads as important.
              background: `linear-gradient(135deg, ${f.tint}14, ${f.tint}05)`,
              borderLeft: `3px solid ${f.tint}`,
            }}>
              <div style={{
                fontSize: 'var(--fs-sm)', color: 'var(--ink-600)',
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
              }}>
                {f.label}
              </div>
              <div style={{
                fontSize: f.strong ? 26 : 22,
                fontWeight: f.strong ? 700 : 600,
                color: 'var(--ink-900)', letterSpacing: '-0.01em',
              }}>
                {cell(activeRow, f.key, f.money, f.money)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 'var(--s5)' }}>
          <div className="card__bd">
            <h3 className="cef__sec" style={{ marginTop: 0 }}>
              Collection &amp; customer report
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="xpose">
                <thead>
                  <tr>
                    <th scope="col" className="xpose__rowhd">Metric</th>
                    {shown.map(([k, r]) => (
                      <th key={k} scope="col" className="is-num"
                        style={k === activeKey ? { color: 'var(--accent)' } : undefined}>
                        {monthLabel(r.month)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SUMMARY.map(f => (
                   <tr key={f.key}>
                      <th scope="row" className="xpose__rowhd">{f.label}</th>
                      {shown.map(([k, r]) => (
                        <td key={k} className="is-num" style={{
                          fontWeight: f.strong || k === activeKey ? 650 : undefined,
                          color: k === activeKey ? 'var(--ink-900)' : undefined,
                        }}>
                          {cell(r, f.key, f.money)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card__bd">
          <h3 className="cef__sec" style={{ marginTop: 0 }}>
            Collection &amp; invoice report by city — {monthLabel(activeRow?.month)}
          </h3>

          <table className="xpose">
            <thead>
              <tr>
                <th scope="col" className="xpose__rowhd">City</th>
                <th scope="col" className="is-num">Invoice Amount</th>
                <th scope="col" className="is-num">Collection Amount</th>
              </tr>
            </thead>
            <tbody>
              {CITIES.map(c => (
                <tr key={c.key}>
                  <th scope="row" className="xpose__rowhd">{c.name}</th>
                  <td className="is-num">{cell(activeRow, `${c.key}_invoice`, true)}</td>
                  <td className="is-num">{cell(activeRow, `${c.key}_collection`, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="xpose__foot">
                <th scope="row" className="xpose__rowhd">Total</th>
                <td className="is-num">{formatINR(cityTotals.invoice)}</td>
                <td className="is-num">{formatINR(cityTotals.collection)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
