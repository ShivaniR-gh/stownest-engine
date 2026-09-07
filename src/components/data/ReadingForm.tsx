import { useEffect, useMemo, useState } from 'react';
import type { DatasetDef, Row } from '@/config/types';
import { Button, Field, Modal } from '@/components/primitives';
import { adapter } from '@/lib/data/store';
import { useDataset } from '@/lib/data/useDataset';

/** ---------------------------------------------------------------------------
 * Monthly space reading.
 *
 * The employee supplies two things: which warehouse, and how much of it is
 * occupied. Everything else is either chosen from a list or computed.
 *
 * Warehouse is a dropdown rather than a text field because a typed code that
 * does not exist is rejected by the server with an error the person cannot act
 * on. Picking from the master list makes that failure impossible.
 *
 * Available space and utilisation are shown live as the number is typed, but
 * they are NOT submitted — the server recomputes them from the warehouse's
 * recorded total. What is displayed here is a preview, not the source of truth.
 *
 * The three customer counts are OPTIONAL. Months recorded before they existed
 * have none, and a required field would make every one of those rows invalid
 * the moment someone opened it to edit.
 *
 * Churn divides by the OPENING balance, not the closing one:
 *
 *   opening = total − new + left
 *   churn % = left ÷ opening × 100
 *
 * Dividing by the closing total understates it, because the customers who
 * joined this month were never at risk of leaving it. Deriving the opening
 * from the three entered figures keeps a month self-contained — it can be
 * entered or corrected without reading its neighbour — and gives a free check:
 * this figure should equal last month's total, and if it does not, one of the
 * three counts is wrong.
 * ------------------------------------------------------------------------- */

interface Warehouse {
  wh_code: string;
  wh_name: string;
  city: string;
  location: string;
  total_space: string;
  status: string;
}

const toNum = (v: unknown) => Number(String(v ?? '').replace(/[,\s]/g, ''));

export function ReadingForm({
  dataset, onClose, onSubmit,
}: {
  dataset: DatasetDef;
  onClose: () => void;
  onSubmit: (values: Row, tab: string) => Promise<void>;
}) {
  // The warehouse master is a normal dataset, so it arrives through the same
  // cache every other read uses — no bespoke fetch.
  const { rows: whRows, status: whStatus } = useDataset('warehouses');

  const warehouses = useMemo<Warehouse[]>(() =>
    (whRows as unknown as Warehouse[])
      .filter(w => String(w.status ?? 'Active').toLowerCase() !== 'inactive')
      .sort((a, b) => `${a.city}${a.wh_code}`.localeCompare(`${b.city}${b.wh_code}`)),
    [whRows]);

  const [months, setMonths] = useState<string[]>([]);
  const [tab, setTab] = useState('');
  const [code, setCode] = useState('');
  const [occupied, setOccupied] = useState('');
  const [recordedOn, setRecordedOn] = useState('');
  const [totalCustomers, setTotalCustomers] = useState('');
  const [newCustomers, setNewCustomers] = useState('');
  const [churnedCustomers, setChurnedCustomers] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // The month list is computed by the server, which also enforces it. Building
  // it here as well would risk offering a month the API then refuses.
  useEffect(() => {
    let cancelled = false;
    adapter.list(dataset.id)
      .then(r => {
        if (cancelled) return;
        setMonths(r.tabs ?? []);
        if (r.tabs?.length) setTab(r.tabs[0]);
      })
      .catch(() => { if (!cancelled) setFailure('Could not load the list of months.'); });
    return () => { cancelled = true; };
  }, [dataset.id]);

  const selected = warehouses.find(w => w.wh_code === code) ?? null;
  const total = selected ? toNum(selected.total_space) : 0;
  const occ = toNum(occupied);
  const valid = total > 0 && occupied !== '' && !Number.isNaN(occ) && occ >= 0 && occ <= total;
  const available = valid ? total - occ : null;
  const pct = valid && total > 0 ? (occ / total) * 100 : null;

  /** Only shown once all three are filled — an opening balance from two of
   *  them would be a different and misleading number. */
  const custFilled = totalCustomers !== '' && newCustomers !== '' && churnedCustomers !== '';
  const custTotal = toNum(totalCustomers);
  const custNew = toNum(newCustomers);
  const custLeft = toNum(churnedCustomers);
  const opening = custFilled ? custTotal - custNew + custLeft : null;
  const churnPct = opening !== null && opening > 0 ? (custLeft / opening) * 100 : null;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!tab) e.tab = 'Choose a month';
    if (!code) e.wh_code = 'Choose a warehouse';
    if (occupied === '') e.occupied_space = 'Enter the occupied space';
    else if (Number.isNaN(occ)) e.occupied_space = 'Enter a number';
    else if (occ < 0) e.occupied_space = 'Cannot be negative';
    else if (total > 0 && occ > total) {
      e.occupied_space = `Cannot exceed this warehouse's total of ${total.toLocaleString('en-IN')} sqft`;
    }

    for (const [k, v] of [
      ['total_customers', totalCustomers], ['new_customers', newCustomers],
      ['churned_customers', churnedCustomers],
    ] as const) {
      if (v !== '' && (Number.isNaN(toNum(v)) || toNum(v) < 0)) {
        e[k] = 'Enter a number, zero or more';
      }
    }

    // The three only make sense together: an opening balance computed from a
    // partly filled set is arithmetic on a figure nobody supplied.
    const anyCust = totalCustomers !== '' || newCustomers !== '' || churnedCustomers !== '';
    if (anyCust && !custFilled) {
      e.total_customers = 'Fill all three customer counts, or leave all three blank';
    } else if (custFilled && opening !== null && opening < 0) {
      e.total_customers =
        `${custNew} new and ${custLeft} left against a total of ${custTotal} implies a negative ` +
        `opening balance. One of the three is wrong.`;
    }

    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true); setFailure(null);
    try {
      await onSubmit(
        {
          wh_code: code,
          occupied_space: String(occ),
          recorded_on: recordedOn,
          total_customers: totalCustomers,
          new_customers: newCustomers,
          churned_customers: churnedCustomers,
        },
        tab,
      );
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The reading could not be saved.');
    } finally { setBusy(false); }
  };

  const noWarehouses = whStatus === 'ready' && warehouses.length === 0;

  return (
    <Modal
      title="New reading"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || noWarehouses}>
            {busy ? 'Saving…' : 'Add reading'}
          </Button>
        </>
      }>

      {failure && <div className="form-error">{failure}</div>}

      {noWarehouses && (
        <div className="form-notice">
          No warehouses have been added yet. An admin adds them on the <b>Data Sources</b> page,
          and they appear here automatically.
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>

        <Field label="Month *" error={errors.tab}
               hint="The tab this reading is written to. Created if it does not exist yet.">
          <select className="field" value={tab} onChange={e => setTab(e.target.value)}>
            {!months.length && <option value="">Loading…</option>}
            {months.map(m => <option key={m} value={m}>{m.replace(/^\S+\s/, '')}</option>)}
          </select>
        </Field>

        <Field label="Warehouse *" error={errors.wh_code}
               hint="Added on the Data Sources page.">
          <select
            className={`field${errors.wh_code ? ' field--err' : ''}`}
            value={code}
            onChange={e => { setCode(e.target.value); setErrors(x => ({ ...x, wh_code: '', occupied_space: '' })); }}
            disabled={whStatus === 'loading'}
          >
            <option value="">
              {whStatus === 'loading' ? 'Loading warehouses…' : 'Choose a warehouse'}
            </option>
            {warehouses.map(w => (
              <option key={w.wh_code} value={w.wh_code}>
                {w.wh_code} — {w.wh_name} ({w.city})
              </option>
            ))}
          </select>
        </Field>

        {/* Read-only facts about the chosen warehouse. Shown so the person can
            confirm they picked the right one before entering a figure. */}
        {selected && (
          <div style={{ gridColumn: 'span 2' }} className="reading-facts">
            <div><span className="reading-facts__k">WH Name</span><span>{selected.wh_name}</span></div>
            <div><span className="reading-facts__k">City</span><span>{selected.city}</span></div>
            {selected.location && (
              <div><span className="reading-facts__k">Location</span><span>{selected.location}</span></div>
            )}
            <div>
              <span className="reading-facts__k">Total Space</span>
              <span>{total.toLocaleString('en-IN')} sqft</span>
            </div>
          </div>
        )}

        <Field label="Occupied Space (sqft) *" error={errors.occupied_space}
               hint={selected ? `Up to ${total.toLocaleString('en-IN')} sqft.` : 'Choose a warehouse first.'}>
          <input
            className={`field${errors.occupied_space ? ' field--err' : ''}`}
            inputMode="decimal"
            value={occupied}
            disabled={!selected}
            placeholder="0"
            onChange={e => { setOccupied(e.target.value); setErrors(x => ({ ...x, occupied_space: '' })); }}
          />
        </Field>

        <Field label="Recorded On" hint="Defaults to today if left blank.">
          <input className="field" type="date" value={recordedOn}
                 onChange={e => setRecordedOn(e.target.value)} />
        </Field>

        {/* Live preview. Recomputed server-side on submit — this is guidance,
            not the figure that gets stored. */}
        {valid && available !== null && pct !== null && (
          <div style={{ gridColumn: 'span 2' }} className="reading-calc">
            <div className="reading-calc__row">
              <span>Available space</span>
              <b>{available.toLocaleString('en-IN')} sqft</b>
            </div>
            <div className="reading-calc__row">
              <span>Utilisation</span>
              <b>{pct.toFixed(1)}%</b>
            </div>
            <div className="reading-calc__bar" role="img"
                 aria-label={`${pct.toFixed(1)} percent utilised`}>
              <span
                className="reading-calc__fill"
                data-band={pct >= 95 ? 'full' : pct >= 85 ? 'high' : pct >= 70 ? 'mid' : 'low'}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        )}

        <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--line)', paddingTop: 'var(--s4)' }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', marginBottom: 'var(--s3)' }}>
            Customers — optional, but all three together
          </div>
          <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <Field label="Total Customers" error={errors.total_customers}
                   hint="At the end of this month.">
              <input className={`field${errors.total_customers ? ' field--err' : ''}`}
                inputMode="numeric" value={totalCustomers} placeholder="0"
                onChange={e => { setTotalCustomers(e.target.value); setErrors(x => ({ ...x, total_customers: '' })); }} />
            </Field>

            <Field label="New Customers" error={errors.new_customers}
                   hint="Joined during this month.">
              <input className={`field${errors.new_customers ? ' field--err' : ''}`}
                inputMode="numeric" value={newCustomers} placeholder="0"
                onChange={e => { setNewCustomers(e.target.value); setErrors(x => ({ ...x, new_customers: '' })); }} />
            </Field>

            <Field label="Customers Left" error={errors.churned_customers}
                   hint="Left during this month.">
              <input className={`field${errors.churned_customers ? ' field--err' : ''}`}
                inputMode="numeric" value={churnedCustomers} placeholder="0"
                onChange={e => { setChurnedCustomers(e.target.value); setErrors(x => ({ ...x, churned_customers: '' })); }} />
            </Field>
          </div>

          {/* Same preview treatment as utilisation: shown as it is typed,
              recomputed by the server on submit. */}
          {opening !== null && opening >= 0 && (
            <div className="reading-calc" style={{ marginTop: 'var(--s3)' }}>
              <div className="reading-calc__row">
                <span>Opening balance</span>
                <b>{opening.toLocaleString('en-IN')}</b>
              </div>
              <div className="reading-calc__row">
                <span>Churn</span>
                <b>{churnPct === null ? '—' : `${churnPct.toFixed(1)}%`}</b>
              </div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', marginTop: 4 }}>
                Opening is total minus new plus left, and should match last month's total.
                Churn is those who left as a share of it.
              </p>
            </div>
          )}
        </div>
      </div>

      <p style={{ marginTop: 'var(--s5)', fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.6 }}>
        Writes to the <b>{tab || 'selected month'}</b> tab. Warehouse details and the calculated
        figures are filled in by the server, so the spreadsheet always matches what you see here.
      </p>
    </Modal>
  );
}
