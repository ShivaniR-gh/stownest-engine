import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { createRow, updateRow } from '@/lib/data/store';
import { formatInt, formatINR, formatPct, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

const n = (v: string | number | undefined) => toNum(v) ?? 0;

/** Native date inputs only accept YYYY-MM-DD. */
function toDateInput(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi/Gurugram' },
  { key: 'kol', name: 'Kolkata' },
] as const;

const INCOME_CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi/Haryana' },
  { key: 'kol', name: 'Kolkata' },
] as const;

type FieldDef = { key: string; label: string; money?: boolean };

interface Block {
  title: string;
  monthFields?: FieldDef[];
  cityFields?: FieldDef[];
  cities?: readonly { key: string; name: string }[];
}

const CALL_FIELDS: FieldDef[] = [
  { key: 'cq_new', label: 'New Query' },
  { key: 'cq_rm', label: 'RM Query' },
  { key: 'cq_enq', label: 'Enquiry' },
  { key: 'cq_pd', label: 'P&D Confirmation' },
  { key: 'cq_biz', label: 'Business' },
  { key: 'cq_inv_ct', label: 'Invoice CT' },
  { key: 'cq_inv_ac', label: 'Invoice A/c' },
  { key: 'cq_new_del', label: 'New Delivery' },
  { key: 'cq_rep_del', label: 'Repeated Delivery' },
  { key: 'cq_dmg', label: 'Damage/Missing' },
  { key: 'cq_rep_dmg', label: 'Repeated Damage/Missing' },
  { key: 'cq_other', label: 'Other City' },
  { key: 'cq_invalid', label: 'Invalid' },
  { key: 'cq_miss', label: 'Missed Calls' },
];

const INTERAKT_FIELDS: FieldDef[] = [
  { key: 'ik_new', label: 'New Query' },
  { key: 'ik_enq', label: 'Enquiry' },
  { key: 'ik_new_del', label: 'New Delivery' },
  { key: 'ik_other', label: 'Other City' },
  { key: 'ik_invalid', label: 'Invalid' },
];

const BLOCKS: Record<string, Block> = {
  ct_city_income: {
    title: 'Income by CT — city wise',
    cities: INCOME_CITIES,
    cityFields: [
      { key: 'clients', label: 'Active clients' },
      { key: 'rental', label: 'Rental income', money: true },
      { key: 'logistic', label: 'Logistic income', money: true },
    ],
  },
  ct_rental_trends: {
    title: 'Pickup vs Delivery Rental Trends B2C',
    monthFields: [
      { key: 'pk_rental', label: 'Pickup Rental', money: true },
      { key: 'pk_count', label: 'Number of Pickup' },
      { key: 'dl_rental', label: 'Delivery Rental', money: true },
      { key: 'dl_count', label: 'Number of Delivery' },
    ],
  },
  ct_city_gap: {
    title: 'City-wise pick-ups vs deliveries',
    cityFields: [
      { key: 'pickups', label: 'Pick-ups' },
      { key: 'deliveries', label: 'Deliveries' },
    ],
  },
  ct_interstate: {
    title: 'Interstate / Intercity',
    monthFields: [
      { key: 'pk_done', label: 'Pickup completed' },
      { key: 'pk_transit', label: 'Pickup in transit' },
      { key: 'dl_done', label: 'Delivery completed' },
      { key: 'dl_transit', label: 'Delivery in transit' },
    ],
  },
  ct_reviews: {
    title: 'Reviews',
    monthFields: [
      { key: 'dl_count', label: 'No of Deliveries' },
      { key: 'review_count', label: 'No of reviews' },
      { key: 'bad_comm', label: 'Bad reviews — communication / pricing / stars' },
      { key: 'bad_dmg', label: 'Bad reviews — damage & missing' },
    ],
    cityFields: [
      { key: 'pk_req', label: 'Pickup requested' },
      { key: 'pk_rev', label: 'Pickup reviewed' },
      { key: 'pk_neg', label: 'Pickup negative' },
      { key: 'dl_req', label: 'Delivery requested' },
      { key: 'dl_rev', label: 'Delivery reviewed' },
      { key: 'comm', label: 'Communication' },
      { key: 'price', label: 'Pricing / estimation' },
      { key: 'dmg', label: 'Damage / missing' },
      { key: 'star', label: 'Only star' },
    ],
  },
  ct_tickets: {
    title: 'Tickets & expenses',
    monthFields: [
      { key: 'dmg_exp', label: 'Damages expense', money: true },
      { key: 'dmg_tix', label: 'Damages tickets' },
      { key: 'miss_exp', label: 'Missing expense', money: true },
      { key: 'miss_tix', label: 'Missing tickets' },
      { key: 'inv_queries', label: 'Invoice queries' },
      { key: 'escalations', label: 'Service escalations' },
      { key: 'wh_visits', label: 'Warehouse visits' },
      { key: 'photo_video', label: 'Photo and video request' },
    ],
  },
  ct_delivery_econ: {
    title: 'Delivery economics',
    monthFields: [
      { key: 'tot_del', label: 'Total deliveries' },
      { key: 'by_cust', label: 'Delivery by customer' },
      { key: 'by_sn', label: 'Delivery by StowNest' },
      { key: 'items', label: 'No of items' },
      { key: 'revenue', label: 'Delivery revenue', money: true },
    ],
  },
  ct_calls: {
    title: 'Call desk',
    monthFields: [...CALL_FIELDS, ...INTERAKT_FIELDS],
  },
};

export function ControlTowerEntryForm({ datasetId, existing, onDone, onCancel }: {
  datasetId?: string;
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const target = datasetId ?? 'ct_rental_trends';
  const block = BLOCKS[target] ?? BLOCKS.ct_rental_trends;

  const initial = useMemo(() => {
    const now = new Date();
    const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const d: Record<string, string> = {
      month: toDateInput(existing?.month) || fallback,
    };
    for (const f of block.monthFields ?? []) d[f.key] = existing ? String(existing[f.key] ?? '') : '';
    for (const c of block.cities ?? CITIES) {
      for (const f of block.cityFields ?? []) {
        const k = `${c.key}_${f.key}`;
        d[k] = existing ? String(existing[k] ?? '') : '';
      }
    }
    return d;
  }, [existing, block]);

  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    setBusy(true);
    try {
      const payload: Row = { month: d.month };
      for (const f of block.monthFields ?? []) payload[f.key] = d[f.key];
      for (const c of block.cities ?? CITIES) {
        for (const f of block.cityFields ?? []) {
          payload[`${c.key}_${f.key}`] = d[`${c.key}_${f.key}`];
        }
      }
      if (existing?.__id) await updateRow(target, String(existing.__id), payload);
      else await createRow(target, payload);
      onDone();
    } catch (e) {
      setError((e as Error).message || 'Could not save. Nothing was written.');
    } finally {
      setBusy(false);
    }
  };

  const preview = (() => {
    if (target === 'ct_city_income') {
      const cities = INCOME_CITIES;
      const clients = cities.reduce((a, c) => a + n(d[`${c.key}_clients`]), 0);
      const rental = cities.reduce((a, c) => a + n(d[`${c.key}_rental`]), 0);
      const logistic = cities.reduce((a, c) => a + n(d[`${c.key}_logistic`]), 0);
      return `Clients ${formatInt(clients)} · Rental ${formatINR(rental)} · Logistic ${formatINR(logistic)}`;
    }
    if (target === 'ct_rental_trends') {
      const diff = n(d.pk_rental) - n(d.dl_rental);
      const cnt = n(d.pk_count) - n(d.dl_count);
      return `Difference ${formatINR(diff)} · Count ${formatInt(cnt)}`;
    }
    if (target === 'ct_interstate') {
      return `Pickup total ${formatInt(n(d.pk_done) + n(d.pk_transit))} · Delivery total ${formatInt(n(d.dl_done) + n(d.dl_transit))}`;
    }
    if (target === 'ct_tickets') {
      return `Expense ${formatINR(n(d.dmg_exp) + n(d.miss_exp))} · Damage/missing tickets ${formatInt(n(d.dmg_tix) + n(d.miss_tix))}`;
    }
    if (target === 'ct_delivery_econ') {
      const tot = n(d.tot_del);
      const sn = n(d.by_sn);
      const conv = tot > 0 ? (sn / tot) * 100 : 0;
      const earn = sn > 0 ? n(d.revenue) / sn : 0;
      return `Conversion ${formatPct(conv, 0)} · Earnings/request ${formatINR(earn)}`;
    }
    if (target === 'ct_calls') {
      const cq = CALL_FIELDS.filter(f => f.key !== 'cq_miss').reduce((a, f) => a + n(d[f.key]), 0);
      const ik = INTERAKT_FIELDS.reduce((a, f) => a + n(d[f.key]), 0);
      return `Call total ${formatInt(cq)} · Interakt total ${formatInt(ik)}`;
    }
    return '';
  })();

  return (
    <div className="modal__scrim" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label={block.title}>
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit month' : block.title}</h2>
        </header>
        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}

          <div className="formrow" style={{ maxWidth: 220, marginBottom: 'var(--s5)' }}>
            <label className="formrow__lb" htmlFor="ct-month">Month</label>
            <input id="ct-month" className="field" type="date" value={d.month}
              onChange={e => {
                const picked = parseDate(e.target.value);
                setD(prev => ({
                  ...prev,
                  month: picked
                    ? `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-01`
                    : e.target.value,
                }));
              }} />
            <span className="formrow__hint">Pick any day in the month. It is stored as the 1st.</span>
          </div>

          {target === 'ct_calls' ? (
            <>
              <h3 className="cef__sec">Call update</h3>
              <div className="cef__grid">
                {CALL_FIELDS.map(f => (
                  <Field key={f.key} label={f.label} value={d[f.key]} onChange={set(f.key)} />
                ))}
              </div>
              <h3 className="cef__sec">Interakt</h3>
              <div className="cef__grid">
                {INTERAKT_FIELDS.map(f => (
                  <Field key={f.key} label={f.label} value={d[f.key]} onChange={set(f.key)} />
                ))}
              </div>
            </>
          ) : block.monthFields && (
            <div className="cef__grid" style={{ marginBottom: 'var(--s4)' }}>
              {block.monthFields.map(f => (
                <Field key={f.key} label={f.label} value={d[f.key]} onChange={set(f.key)} />
              ))}
            </div>
          )}

          {preview && <p className="cef__note">{preview}</p>}

          {block.cityFields && (block.cities ?? CITIES).map(c => (
            <div key={c.key} style={{ marginTop: 'var(--s4)' }}>
              <h3 className="cef__sec">{c.name}</h3>
              <div className="cef__grid">
                {block.cityFields!.map(f => (
                  <Field key={f.key} label={f.label}
                    value={d[`${c.key}_${f.key}`]} onChange={set(`${c.key}_${f.key}`)} />
                ))}
              </div>
            </div>
          ))}
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

function Field({ label, value, onChange }: {
  label: string; value: string;
  onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <div className="formrow">
      <label className="formrow__lb">{label}</label>
      <input className="field num" inputMode="decimal" value={value}
        onChange={onChange} placeholder="0" />
    </div>
  );
}
