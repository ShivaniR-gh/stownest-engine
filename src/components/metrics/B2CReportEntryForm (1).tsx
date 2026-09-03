import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { Button } from '@/components/primitives';
import { createRow, updateRow } from '@/lib/data/store';
import { toNum } from '@/lib/format';
import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * B2C monthly report entry.
 *
 * One form, one row: the customer/amount summary and the per-city split that
 * make up the two tables the team circulates each month.
 *
 * Total Raised Amount and Total Collection Amount are NOT entered. In the
 * source report they are the totals of the city table — 2.33Cr and 2.39Cr
 * appear in both places — so typing them again is one more chance for the two
 * halves of the same report to contradict each other. They are summed here,
 * shown live, and written by the server.
 *
 * Field labels match the report images exactly, brackets and plurals
 * included. The report goes to people outside this app; a label that reads
 * differently here is a label someone will query.
 * ------------------------------------------------------------------------- */

const n = (v: string | number | undefined) => toNum(v) ?? 0;
const s = (v: number) => String(Number(v.toFixed(2)));

/** Order matters: it is the order the report table prints. */
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

/** The eight summary rows, in report order. The two totals are absent because
 *  they are computed from the city grid below. */
const SUMMARY = [
  { key: 'customers_raised', label: 'Total Customers Raised', money: false },
  { key: 'collected_customers', label: 'Total Collected Customers', money: false },
  { key: 'pending_customers', label: 'Pending Customers', money: false },
  { key: 'pending_amount', label: 'Pending Amount', money: true },
  { key: 'receivable_customers_60', label: 'Receivable Customers (>60 Days)', money: false },
  { key: 'receivables_amount_60', label: 'Receivables Amount (>60 Days)', money: true },
] as const;

type Draft = Record<string, string>;

const EMPTY: Draft = {
  month: '',
  ...Object.fromEntries(SUMMARY.map(f => [f.key, ''])),
  ...Object.fromEntries(CITIES.flatMap(c => [[`${c.key}_invoice`, ''], [`${c.key}_collection`, '']])),
};

export function B2CReportEntryForm({ existing, onDone, onCancel }: {
  /** Row being edited. Absent when adding a month. */
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => {
    if (!existing) return EMPTY;
    const v = (k: string) => (existing[k] == null ? '' : String(existing[k]));
    return {
      ...EMPTY,
      // The sheet may hand the month back as a serial, an ISO string or a
      // locale date; the date input and the record id both need ISO.
      month: (() => {
        const raw = String(existing.month ?? '');
        const serial = Number(raw);
        if (/^\d+(\.\d+)?$/.test(raw) && serial > 20000 && serial < 80000) {
          return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
        }
        const t = Date.parse(raw);
        return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : raw.slice(0, 10);
      })(),
      ...Object.fromEntries(SUMMARY.map(f => [f.key, v(f.key)])),
      ...Object.fromEntries(CITIES.flatMap(c => [
        [`${c.key}_invoice`, v(`${c.key}_invoice`)],
        [`${c.key}_collection`, v(`${c.key}_collection`)],
      ])),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [k]: e.target.value }));

  const totals = useMemo(() => ({
    invoice: CITIES.reduce((a, c) => a + n(d[`${c.key}_invoice`]), 0),
    collection: CITIES.reduce((a, c) => a + n(d[`${c.key}_collection`]), 0),
  }), [d]);

  const problems: string[] = [];
  if (n(d.pending_customers) > n(d.customers_raised) && n(d.customers_raised) > 0) {
    problems.push('Pending customers cannot exceed customers raised.');
  }
  for (const c of CITIES) {
    if (n(d[`${c.key}_invoice`]) < 0 || n(d[`${c.key}_collection`]) < 0) {
      problems.push(`${c.name} amounts cannot be negative.`);
      break;
    }
  }

  const submit = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);
    try {
      const payload: Row = {
        month: d.month,
        ...Object.fromEntries(SUMMARY.map(f => [f.key, d[f.key]])),
        ...Object.fromEntries(CITIES.flatMap(c => [
          [`${c.key}_invoice`, d[`${c.key}_invoice`]],
          [`${c.key}_collection`, d[`${c.key}_collection`]],
        ])),
        // Sent so the sheet reads correctly if someone opens it directly. The
        // server recomputes both from the city figures regardless.
        raised_amount: s(totals.invoice),
        collection_amount: s(totals.collection),
      };

      if (existing?.__id) {
        await updateRow('collections_b2c_report', String(existing.__id), payload);
      } else {
        await createRow('collections_b2c_report', payload);
      }
      onDone();
    } catch (e) {
      setError((e as Error).message || 'Could not save. Nothing was written.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal__scrim" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="B2C monthly report">
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit month' : 'B2C monthly report'}</h2>
        </header>

        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}

          <div className="formrow" style={{ maxWidth: 220, marginBottom: 'var(--s5)' }}>
            <label className="formrow__lb" htmlFor="b2c-month">Month</label>
            {/* The month identifies the record, so it is fixed once saved —
                changing it here would edit one month into another. */}
            <input id="b2c-month" className="field" type="date" value={d.month}
              onChange={set('month')} disabled={Boolean(existing)} />
            <span className="formrow__hint">First of the month.</span>
          </div>

          <h3 className="cef__sec">Collection &amp; customer report</h3>
          <div className="cef__grid">
            {SUMMARY.map(f => (
              <Field key={f.key} label={f.label} value={d[f.key]}
                onChange={set(f.key)} money={f.money} />
            ))}
          </div>

          <p className="cef__note">
            Total Raised Amount and Total Collection Amount are the totals of the city
            figures below, so they are not entered here.
          </p>

          <h3 className="cef__sec">Collection &amp; invoice report by city</h3>
          <div className="cef__grid">
            {CITIES.map(c => (
              <Field key={`${c.key}_invoice`} label={`${c.name} — Invoice Amount`}
                value={d[`${c.key}_invoice`]} onChange={set(`${c.key}_invoice`)} money />
            ))}
          </div>
          <div className="cef__grid">
            {CITIES.map(c => (
              <Field key={`${c.key}_collection`} label={`${c.name} — Collection Amount`}
                value={d[`${c.key}_collection`]} onChange={set(`${c.key}_collection`)} money />
            ))}
          </div>

          <p className="cef__note">
            Total Raised Amount ₹{totals.invoice.toLocaleString('en-IN')} ·
            Total Collection Amount ₹{totals.collection.toLocaleString('en-IN')}
          </p>

          {problems.length > 0 && (
            <ul className="cef__warn">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
        </div>

        <footer className="modal__ft">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || problems.length > 0}>
            {busy ? 'Saving\u2026' : existing ? 'Save changes' : 'Save month'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, money, hint }: {
  label: string; value: string; hint?: string; money?: boolean;
  onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <div className="formrow">
      <label className="formrow__lb">{label}</label>
      {money ? (
        <span className="cef__money">
          <span className="cef__cur" aria-hidden="true">₹</span>
          <input className="field num" inputMode="decimal" value={value}
            onChange={onChange} placeholder="0" />
        </span>
      ) : (
        <input className="field num" inputMode="numeric" value={value}
          onChange={onChange} placeholder="0" />
      )}
      {hint && <span className="formrow__hint">{hint}</span>}
    </div>
  );
}
