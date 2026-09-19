import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { createRow, updateRow } from '@/lib/data/store';
import { formatINR, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

const n = (v: string | number | undefined) => toNum(v) ?? 0;

function toDateInput(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const SECTIONS: { title: string; fields: { key: string; label: string }[] }[] = [
  {
    title: 'Revenue — B2C',
    fields: [
      { key: 'b2c_storage', label: 'Storage service' },
      { key: 'b2c_transport', label: 'Transportation' },
      { key: 'b2c_packing', label: 'Packing and moving' },
    ],
  },
  {
    title: 'Revenue — B2B',
    fields: [
      { key: 'b2b_storage', label: 'Storage service' },
      { key: 'b2b_transport', label: 'Transportation' },
    ],
  },
  {
    title: 'Cost of goods sold',
    fields: [
      { key: 'cogs_wh_rent', label: 'WH rent' },
      { key: 'cogs_logistics', label: 'Logistics' },
      { key: 'cogs_labour', label: 'Contract / labour' },
      { key: 'cogs_damages', label: 'Damages' },
      { key: 'cogs_packing', label: 'Packing material' },
    ],
  },
  {
    title: 'Indirect expenses',
    fields: [
      { key: 'exp_salary', label: 'Employee salary' },
      { key: 'exp_marketing', label: 'Marketing exp' },
      { key: 'exp_intermediary', label: 'Intermediary charges' },
      { key: 'exp_other', label: 'Other expenses' },
      { key: 'exp_emi', label: 'EMI and interest' },
    ],
  },
  {
    title: 'Tax',
    fields: [
      { key: 'tax_gst', label: 'Tax (GST)' },
    ],
  },
];

const KEYS = SECTIONS.flatMap(s => s.fields.map(f => f.key));

export function FinanceEntryForm({ datasetId, existing, onDone, onCancel }: {
  datasetId?: string;
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const target = datasetId ?? 'finance_pnl';
  const initial = useMemo(() => {
    const now = new Date();
    const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const d: Record<string, string> = { month: toDateInput(existing?.month) || fallback };
    for (const k of KEYS) d[k] = existing ? String(existing[k] ?? '') : '';
    return d;
  }, [existing]);

  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [key]: e.target.value }));

  const b2c = n(d.b2c_storage) + n(d.b2c_transport) + n(d.b2c_packing);
  const b2b = n(d.b2b_storage) + n(d.b2b_transport);
  const rev = b2c + b2b;
  const cogs = n(d.cogs_wh_rent) + n(d.cogs_logistics) + n(d.cogs_labour)
    + n(d.cogs_damages) + n(d.cogs_packing);
  const gp = rev - cogs;
  const indirect = n(d.exp_salary) + n(d.exp_marketing) + n(d.exp_intermediary)
    + n(d.exp_other) + n(d.exp_emi);
  const pbt = gp - indirect;
  const pat = pbt - n(d.tax_gst);

  const save = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    setBusy(true);
    try {
      const payload: Row = { month: d.month };
      for (const k of KEYS) payload[k] = d[k];
      if (existing?.__id) await updateRow(target, String(existing.__id), payload);
      else await createRow(target, payload);
      onDone();
    } catch (e) {
      setError((e as Error).message || 'Could not save. Nothing was written.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal__scrim" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Monthly P&L">
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit P&L month' : 'Monthly P&L'}</h2>
        </header>
        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}
          <div className="formrow" style={{ maxWidth: 220, marginBottom: 'var(--s5)' }}>
            <label className="formrow__lb" htmlFor="fin-month">Month</label>
            <input id="fin-month" className="field" type="date" value={d.month}
              onClick={e => { try { e.currentTarget.showPicker(); } catch { /* */ } }}
              onChange={e => {
                const raw = e.target.value;
                setD(prev => ({ ...prev, month: raw ? raw.slice(0, 8) + '01' : raw }));
              }} />
          </div>

          {SECTIONS.map(s => (
            <div key={s.title} style={{ marginBottom: 'var(--s4)' }}>
              <h3 className="cef__sec">{s.title}</h3>
              <div className="cef__grid">
                {s.fields.map(f => (
                  <div className="formrow" key={f.key}>
                    <label className="formrow__lb">{f.label}</label>
                    <input className="field num" inputMode="decimal" value={d[f.key]}
                      onChange={set(f.key)} placeholder="0" />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="cef__note">
            Revenue {formatINR(rev)} · COGS {formatINR(cogs)} · Gross {formatINR(gp)}
            {' '}· PBT {formatINR(pbt)} · PAT {formatINR(pat)}
          </p>
        </div>
        <footer className="modal__ft">
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn--primary" type="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save month'}
          </button>
        </footer>
      </div>
    </div>
  );
}
