import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { createRow, updateRow } from '@/lib/data/store';
import { formatINR, formatInt, parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

const CITIES = ['Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi', 'Kolkata'];

const SELECTS: Record<string, string[]> = {
  movement: ['New Client', 'Vacated'],
  client_type: ['Transactional', 'Non Transactional', 'Document'],
  reason: ['New Business', 'Own Warehouse', 'Project/Business Closed'],
  service: ['Storage', 'Transportation', 'Packing & Moving'],
  lead_source: ['Website', 'Referral', 'Inbound', 'Field', 'Partner', 'Other'],
};

function toDateInput(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const BLOCKS: Record<string, { title: string; fields: { key: string; label: string; money?: boolean }[] }> = {
  b2b_occupancy: {
    title: 'Occupancy',
    fields: [
      { key: 'txn_clients', label: 'Transactional clients' },
      { key: 'txn_sqft', label: 'Transactional sqft' },
      { key: 'nontxn_clients', label: 'Non-transactional clients' },
      { key: 'nontxn_sqft', label: 'Non-transactional sqft' },
      { key: 'doc_clients', label: 'Document clients' },
    ],
  },
  b2b_moves: {
    title: 'Moves',
    fields: [
      { key: 'inward', label: 'Inward' },
      { key: 'outward', label: 'Outward' },
      { key: 'txn_revenue', label: 'Transaction revenue', money: true },
    ],
  },
  b2b_revenue: {
    title: 'Revenue',
    fields: [
      { key: 'rental_rev', label: 'Rental revenue', money: true },
      { key: 'txn_rev', label: 'Transaction revenue', money: true },
      { key: 'logistics_rev', label: 'Logistics revenue', money: true },
    ],
  },
  b2b_movement: {
    title: 'Client movement',
    fields: [
      { key: 'client_name', label: 'Client name' },
      { key: 'movement', label: 'Movement' },
      { key: 'client_type', label: 'Client type' },
      { key: 'sqft_change', label: 'SQFT change' },
      { key: 'reason', label: 'Reason' },
    ],
  },
  b2b_sales: {
    title: 'Sales',
    fields: [
      { key: 'total_leads', label: 'Total leads' },
      { key: 'invalid', label: 'Invalid' },
      { key: 'unresponsive', label: 'Unresponsive' },
      { key: 'txn_leads', label: 'Transactional' },
      { key: 'nontxn_leads', label: 'Non-transactional' },
      { key: 'doc_leads', label: 'Document' },
      { key: 'following_up', label: 'Following up' },
      { key: 'closed_won', label: 'Closed won' },
      { key: 'closed_lost', label: 'Closed lost' },
      { key: 'cold', label: 'Cold' },
      { key: 'sqft_won', label: 'SQFT won' },
      { key: 'est_rev', label: 'Est. monthly revenue', money: true },
      { key: 'lost_too_far', label: 'Lost - location too far' },
      { key: 'lost_no_need', label: 'Lost - no longer requires service' },
      { key: 'lost_unsuitable', label: 'Lost - requirement not suitable' },
      { key: 'lost_ops', label: 'Lost - ops not accommodated' },
      { key: 'lost_other_loc', label: 'Lost - requires another location' },
      { key: 'lost_other', label: 'Lost - other' },
    ],
  },
};

export function B2BEntryForm({ datasetId, existing, onDone, onCancel }: {
  datasetId?: string;
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const target = datasetId && BLOCKS[datasetId] ? datasetId : 'b2b_occupancy';
  const block = BLOCKS[target];
  const initial = useMemo(() => {
    const now = new Date();
    const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const d: Record<string, string> = {
      month: toDateInput(existing?.month) || fallback,
      city: String(existing?.city ?? 'Bengaluru'),
    };
    for (const f of block.fields) d[f.key] = existing ? String(existing[f.key] ?? '') : '';
    return d;
  }, [existing, block]);

  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [key]: e.target.value }));

  const n = (k: string) => toNum(d[k]) ?? 0;
  let preview = '';
  if (target === 'b2b_occupancy') {
    preview = `Active ${formatInt(n('txn_clients') + n('nontxn_clients') + n('doc_clients'))} · Occupied ${formatInt(n('txn_sqft') + n('nontxn_sqft'))} sqft`;
  } else if (target === 'b2b_moves') {
    const tx = n('inward') + n('outward');
    preview = `Moves ${formatInt(tx)} · Rev / move ${tx ? formatINR(n('txn_revenue') / tx) : '—'}`;
  } else if (target === 'b2b_sales') {
    const valid = Math.max(0, n('total_leads') - n('invalid') - n('unresponsive'));
    const conv = valid ? `${((n('closed_won') / valid) * 100).toFixed(1)}%` : '—';
    preview = `Valid ${formatInt(valid)} · Won ${formatInt(n('closed_won'))} · Conversion ${conv}`;
  } else {
    preview = `Total ${formatINR(n('rental_rev') + n('txn_rev') + n('logistics_rev'))}`;
  }

  const save = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    if (!d.city) { setError('Pick a city.'); return; }
    if (target === 'b2b_movement' && !d.client_name.trim()) { setError('Enter the client name.'); return; }
    setBusy(true);
    try {
      const payload: Row = { month: d.month, city: d.city };
      for (const f of block.fields) payload[f.key] = d[f.key];
      if (existing?.__id) await updateRow(target, String(existing.__id), payload);
      else await createRow(target, payload);
      onDone();
    } catch (e) {
      setError((e as Error).message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (datasetId === 'b2b_summary') {
    return (
      <div className="modal__scrim" onClick={onCancel}>
        <div className="modal" role="dialog" aria-modal="true">
          <header className="modal__hd"><h2 className="modal__title">Monthly summary</h2></header>
          <div className="modal__bd">
            <p className="cef__note">
              No form on this chip. Fill Occupancy, Moves, Revenue and Client
              movement, then open Dashboard — the monthly row is generated there.
            </p>
          </div>
          <footer className="modal__ft">
            <button className="btn btn--primary" type="button" onClick={onCancel}>Back</button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="modal__scrim" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? `Edit ${block.title}` : block.title}</h2>
        </header>
        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}
          <div className="cef__grid">
            <div className="formrow">
              <label className="formrow__lb" htmlFor="b2b-month">Month</label>
              <input id="b2b-month" className="field" type="date" value={d.month}
                onClick={e => { try { e.currentTarget.showPicker(); } catch { /* */ } }}
                onChange={e => {
                  const raw = e.target.value;
                  setD(prev => ({ ...prev, month: raw ? raw.slice(0, 8) + '01' : raw }));
                }} />
            </div>
            <div className="formrow">
              <label className="formrow__lb" htmlFor="b2b-city">City</label>
              <select id="b2b-city" className="field" value={d.city} onChange={set('city')}>
                {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {block.fields.map(f => (
              <div className="formrow" key={f.key}>
                <label className="formrow__lb">{f.label}</label>
                {SELECTS[f.key] ? (
                  <select className="field" value={d[f.key]} onChange={set(f.key)}>
                    <option value="">Choose…</option>
                    {SELECTS[f.key].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="field num" inputMode="decimal" value={d[f.key]}
                    onChange={set(f.key)} placeholder={f.key === 'client_name' ? 'Client name' : '0'} />
                )}
              </div>
            ))}
          </div>
          {preview && <p className="cef__note">{preview}</p>}
        </div>
        <footer className="modal__ft">
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn--primary" type="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
