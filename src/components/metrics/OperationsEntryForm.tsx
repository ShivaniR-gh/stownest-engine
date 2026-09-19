import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { Button } from '@/components/primitives';
import { createRow, updateRow } from '@/lib/data/store';
import { formatInt, formatPct, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Operations monthly entry.
 *
 * One form serves all four blocks of the OPS report — deliveries, pick-ups,
 * inter-state and tickets — and which dataset a save lands in follows the block
 * selected in the page header. Four forms would be four copies of the same
 * month picker, the same city loop and the same save path, and the first fix
 * applied to one of them would be the moment they started to drift.
 *
 * The blocks differ only in which figures are entered per city, so that is the
 * only thing BLOCKS below describes. Everything derived is shown live but never
 * typed:
 *   Full Delivery = Stownest (All)  + Customer (All)
 *   Total New     = Stownest        + Customer
 *   Total Pickups = New + Add on
 * All of it is recomputed on the server, so a stale browser cannot write a
 * total that disagrees with the figures beside it.
 * ------------------------------------------------------------------------- */

const n = (v: string | number | undefined) => toNum(v) ?? 0;
const s = (v: number) => String(Number(v.toFixed(2)));

/** Report order — Pune before Mumbai, which is how the ops report prints it.
 *  Sales uses a different order; matching the report each team actually reads
 *  matters more than the two departments agreeing with each other. */
const CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
] as const;

interface Block {
  title: string;
  /** Entered per city. Empty for a block with no city split. */
  fields: readonly { suffix: string; label: string }[];
  /** Entered once for the month. */
  monthFields?: readonly { key: string; label: string }[];
  /** The live per-city summary line under each group of inputs. */
  cityNote?: (get: (suffix: string) => number) => string;
}

const BLOCKS: Record<string, Block> = {
  ops_deliveries: {
    title: 'Deliveries by city',
    fields: [
      { suffix: 'sn_all', label: 'Stownest — all items' },
      { suffix: 'sn_part', label: 'Stownest — partial' },
      { suffix: 'cust_all', label: 'Customer — all items' },
      { suffix: 'cust_part', label: 'Customer — partial' },
    ],
    cityNote: g => {
      const full = g('sn_all') + g('cust_all');
      const partial = g('sn_part') + g('cust_part');
      return `Full ${formatInt(full)} · Partial ${formatInt(partial)} · Total ${formatInt(full + partial)}`;
    },
  },
  ops_pickups: {
    title: 'Pick-ups by city',
    fields: [
      { suffix: 'sn', label: 'Stownest' },
      { suffix: 'cust', label: 'Customer' },
      { suffix: 'sn_addon', label: 'Stownest — add on' },
      { suffix: 'cust_addon', label: 'Customer — add on' },
    ],
    cityNote: g => {
      const fresh = g('sn') + g('cust');
      const addon = g('sn_addon') + g('cust_addon');
      return `New ${formatInt(fresh)} · Add on ${formatInt(addon)} · Total ${formatInt(fresh + addon)}`;
    },
  },
  ops_moving: {
    title: 'Moving by city',
    fields: [
      { suffix: 'del_is', label: 'Delivery — interstate' },
      { suffix: 'pick_is', label: 'Pick up — interstate' },
      { suffix: 'pick_local', label: 'Pick up — local moving' },
    ],
  },
  ops_tickets: {
    title: 'Tickets this month',
    fields: [],
    monthFields: [
      { key: 'warehouse_visit', label: 'Warehouse visits' },
      { key: 'photo_request', label: 'Photo requests' },
    ],
  },
};

type Draft = Record<string, string>;

/** Sheets hands a month back as a serial, an ISO string or a locale date; the
 *  date input and the record id both need ISO. */
function isoMonth(raw: string): string {
  const serial = Number(raw);
  if (/^\d+(\.\d+)?$/.test(raw) && serial > 20000 && serial < 80000) {
    return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : raw.slice(0, 10);
}

export function OperationsEntryForm({ datasetId, existing, onDone, onCancel }: {
  /** Which block is being written — set by the page from the selected dataset,
   *  so New record lands where the user is looking. */
  datasetId?: string;
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const target = datasetId ?? 'ops_deliveries';
  const block = BLOCKS[target] ?? BLOCKS.ops_deliveries;

  const empty = useMemo<Draft>(() => ({
    month: '',
    ...Object.fromEntries(
      CITIES.flatMap(c => block.fields.map(f => [`${c.key}_${f.suffix}`, '']))),
    ...Object.fromEntries((block.monthFields ?? []).map(f => [f.key, ''])),
  }), [block]);

  const [d, setD] = useState<Draft>(() => {
    if (!existing) return empty;
    const v = (k: string) => (existing[k] == null ? '' : String(existing[k]));
    return {
      ...empty,
      month: isoMonth(String(existing.month ?? '')),
      ...Object.fromEntries(
        CITIES.flatMap(c => block.fields.map(f =>
          [`${c.key}_${f.suffix}`, v(`${c.key}_${f.suffix}`)]))),
      ...Object.fromEntries((block.monthFields ?? []).map(f => [f.key, v(f.key)])),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [k]: e.target.value }));

  /** Column totals across every city, one per entered field. */
  const totals = useMemo(() => Object.fromEntries(
    block.fields.map(f => [
      f.suffix,
      CITIES.reduce((a, c) => a + n(d[`${c.key}_${f.suffix}`]), 0),
    ])), [d, block]);

  const summary = useMemo(() => {
    const t = (k: string) => totals[k] ?? 0;
    if (target === 'ops_deliveries') {
      const full = t('sn_all') + t('cust_all');
      const partial = t('sn_part') + t('cust_part');
      const all = full + partial;
      return all === 0 ? 'Nothing entered yet.'
        : `All cities — Full ${formatInt(full)} (${formatPct((full / all) * 100, 0)}) · `
          + `Partial ${formatInt(partial)} (${formatPct((partial / all) * 100, 0)}) · `
          + `Total ${formatInt(all)}`;
    }
    if (target === 'ops_pickups') {
      const fresh = t('sn') + t('cust');
      const addon = t('sn_addon') + t('cust_addon');
      return `All cities — New ${formatInt(fresh)} · Add on ${formatInt(addon)} · `
        + `Total ${formatInt(fresh + addon)}`;
    }
    if (target === 'ops_moving') {
      return `All cities — Deliveries ${formatInt(t('del_is'))} · `
        + `Pick-ups ${formatInt(t('pick_is'))} · Local moving ${formatInt(t('pick_local'))}`;
    }
    return `Total tickets ${formatInt(n(d.warehouse_visit) + n(d.photo_request))}`;
  }, [totals, d, target]);

  const submit = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    setBusy(true);
    try {
      const payload: Row = { month: d.month };

      for (const c of CITIES) {
        for (const f of block.fields) {
          payload[`${c.key}_${f.suffix}`] = d[`${c.key}_${f.suffix}`];
        }
        // Sent so the tab reads correctly if someone opens it in Sheets
        // directly. The server recomputes all of it regardless.
        const g = (suffix: string) => n(d[`${c.key}_${suffix}`]);
        if (target === 'ops_deliveries') {
          const full = g('sn_all') + g('cust_all');
          const partial = g('sn_part') + g('cust_part');
          payload[`${c.key}_full`] = s(full);
          payload[`${c.key}_partial`] = s(partial);
          payload[`${c.key}_total`] = s(full + partial);
        }
        if (target === 'ops_pickups') {
          const fresh = g('sn') + g('cust');
          const addon = g('sn_addon') + g('cust_addon');
          payload[`${c.key}_new`] = s(fresh);
          payload[`${c.key}_addon`] = s(addon);
          payload[`${c.key}_total`] = s(fresh + addon);
        }
      }

      for (const f of block.monthFields ?? []) payload[f.key] = d[f.key];

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
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label={block.title}>
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit month' : block.title}</h2>
        </header>

        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}

          <div className="formrow" style={{ maxWidth: 220, marginBottom: 'var(--s5)' }}>
            <label className="formrow__lb" htmlFor="ops-month">Month</label>
            {/* The month identifies the record, so it is fixed once saved —
                changing it here would edit one month into another. */}
            <input id="ops-month" className="field" type="date" value={d.month}
              onChange={set('month')} disabled={Boolean(existing)} />
            <span className="formrow__hint">First of the month.</span>
          </div>

          {block.monthFields && (
            <div className="cef__grid" style={{ marginBottom: 'var(--s4)' }}>
              {block.monthFields.map(f => (
                <Field key={f.key} label={f.label} value={d[f.key]} onChange={set(f.key)} />
              ))}
            </div>
          )}

          {CITIES.map(c => block.fields.length > 0 && (
            <div key={c.key} style={{ marginBottom: 'var(--s4)' }}>
              <h4 className="cef__sub">{c.name}</h4>
              <div className="cef__grid">
                {block.fields.map(f => (
                  <Field key={f.suffix} label={f.label}
                    value={d[`${c.key}_${f.suffix}`]}
                    onChange={set(`${c.key}_${f.suffix}`)} />
                ))}
              </div>
              {block.cityNote && (
                <p className="cef__note" style={{ marginTop: 4 }}>
                  {block.cityNote(suffix => n(d[`${c.key}_${suffix}`]))}
                </p>
              )}
            </div>
          ))}

          <p className="cef__note">{summary}</p>
        </div>

        <footer className="modal__ft">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving\u2026' : existing ? 'Save changes' : 'Save month'}
          </Button>
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
      <input className="field num" inputMode="numeric" value={value}
        onChange={onChange} placeholder="0" />
    </div>
  );
}
