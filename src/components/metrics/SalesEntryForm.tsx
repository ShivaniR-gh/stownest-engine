import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { Button } from '@/components/primitives';
import { createRow, updateRow } from '@/lib/data/store';
import { formatINR, formatInt, formatPct, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Sales city entry.
 *
 * One form serves Storage, Moving and Business — the three record the same
 * things, and which dataset a save lands in follows the line of business
 * selected in the page header. A form per line would be three copies to keep
 * in step.
 *
 * Four figures per city are entered. Conversion and total are shown live but
 * never typed:
 *   Total      = Orders + Add on
 *   Conversion = Orders / Leads
 * Both are recomputed on the server, so a stale browser cannot write a total
 * that disagrees with the two numbers beside it.
 * ------------------------------------------------------------------------- */

const n = (v: string | number | undefined) => toNum(v) ?? 0;
const s = (v: number) => String(Number(v.toFixed(2)));

/** Report order — the order the circulated table prints. */
const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'pun', name: 'Pune' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
] as const;

const FIELDS = [
  { suffix: 'leads', label: 'Leads', money: false },
  { suffix: 'orders', label: 'Orders', money: false },
  { suffix: 'value', label: 'Value', money: true },
  { suffix: 'addon', label: 'Add on', money: false },
] as const;

type Draft = Record<string, string>;

const EMPTY: Draft = {
  month: '',
  ...Object.fromEntries(
    CITIES.flatMap(c => FIELDS.map(f => [`${c.key}_${f.suffix}`, '']))),
};

export function SalesEntryForm({ datasetId, existing, onDone, onCancel }: {
  /** Which line of business is being written — set by the page from the
   *  selected dataset, so New record lands where the user is looking. */
  datasetId?: string;
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const target = datasetId ?? 'sales_storage';

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
      ...Object.fromEntries(
        CITIES.flatMap(c => FIELDS.map(f => [`${c.key}_${f.suffix}`, v(`${c.key}_${f.suffix}`)]))),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [k]: e.target.value }));

  const totals = useMemo(() => {
    const sum = (suffix: string) =>
      CITIES.reduce((a, c) => a + n(d[`${c.key}_${suffix}`]), 0);
    const leads = sum('leads');
    const orders = sum('orders');
    return {
      leads, orders, value: sum('value'), addon: sum('addon'),
      conv: leads > 0 ? (orders / leads) * 100 : 0,
      total: orders + sum('addon'),
    };
  }, [d]);

  const problems: string[] = [];
  for (const c of CITIES) {
    if (n(d[`${c.key}_orders`]) > n(d[`${c.key}_leads`]) && n(d[`${c.key}_leads`]) > 0) {
      problems.push(`${c.name}: orders cannot exceed leads.`);
      break;
    }
  }

  const submit = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);
    try {
      const payload: Row = { month: d.month };
      for (const c of CITIES) {
        for (const f of FIELDS) {
          payload[`${c.key}_${f.suffix}`] = d[`${c.key}_${f.suffix}`];
        }
        // Sent so the sheet reads correctly if someone opens it directly. The
        // server recomputes both regardless.
        const leads = n(d[`${c.key}_leads`]);
        const orders = n(d[`${c.key}_orders`]);
        payload[`${c.key}_conv`] = s(leads > 0 ? (orders / leads) * 100 : 0);
        payload[`${c.key}_total`] = s(orders + n(d[`${c.key}_addon`]));
      }
      payload.tot_leads = s(totals.leads);
      payload.tot_orders = s(totals.orders);
      payload.tot_conv = s(totals.conv);
      payload.tot_value = s(totals.value);
      payload.tot_addon = s(totals.addon);
      payload.tot_total = s(totals.total);

      if (existing?.__id) {
        await updateRow(target, String(existing.__id), payload);
      } else {
        await createRow(target, payload);
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
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Sales by city">
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit month' : 'Monthly sales by city'}</h2>
        </header>

        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}

          <div className="formrow" style={{ maxWidth: 220, marginBottom: 'var(--s5)' }}>
            <label className="formrow__lb" htmlFor="sales-month">Month</label>
            {/* The month identifies the record, so it is fixed once saved —
                changing it here would edit one month into another. */}
            <input id="sales-month" className="field" type="date" value={d.month}
              onChange={set('month')} disabled={Boolean(existing)} />
            <span className="formrow__hint">First of the month.</span>
          </div>

          {CITIES.map(c => {
            const leads = n(d[`${c.key}_leads`]);
            const orders = n(d[`${c.key}_orders`]);
            const conv = leads > 0 ? (orders / leads) * 100 : 0;
            const total = orders + n(d[`${c.key}_addon`]);
            return (
              <div key={c.key} style={{ marginBottom: 'var(--s4)' }}>
                <h4 className="cef__sub">{c.name}</h4>
                <div className="cef__grid">
                  {FIELDS.map(f => (
                    <Field key={f.suffix} label={f.label} money={f.money}
                      value={d[`${c.key}_${f.suffix}`]}
                      onChange={set(`${c.key}_${f.suffix}`)} />
                  ))}
                </div>
                <p className="cef__note" style={{ marginTop: 4 }}>
                  Conversion {formatPct(conv, 0)} · Total {formatInt(total)}
                </p>
              </div>
            );
          })}

          <p className="cef__note">
            All cities — Leads {formatInt(totals.leads)} · Orders {formatInt(totals.orders)} ·
            Conversion {formatPct(totals.conv, 0)} · Value {formatINR(totals.value)} ·
            Add on {formatInt(totals.addon)} · Total {formatInt(totals.total)}
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

function Field({ label, value, onChange, money }: {
  label: string; value: string; money?: boolean;
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
    </div>
  );
}
