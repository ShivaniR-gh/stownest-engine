import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import { Button } from '@/components/primitives';
import { createRow, updateRow } from '@/lib/data/store';
import { parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Monthly collections entry.
 *
 * One form, one row written: the monthly summary with the revenue segments on
 * the same row. The generic record form cannot express this because most of the
 * figures are arithmetic over a handful of entered values, exactly as the
 * team's own sheet computes them:
 *
 *   Gap %             = Pending ÷ Raised × 100        (Sheet1 C7  = C6/C5*100)
 *   Comparison        = (this − prev) ÷ prev          (Sheet1 C10 = (C3-B3)/B3)
 *   Segment gap %     = Gap ÷ Raised × 100            (Sheet1 C17 = C16/C14*100)
 *   Share in revenue  = Collected ÷ month's collected (Sheet1 C18 = C15/C4*100)
 *
 * Two figures the sheet derives are ENTERED here, at the team's request:
 * Pending collection amount (row 6) and Gap in Rs. for pickup (row 16). Both
 * still compute a fallback for a blank field, but a typed value always wins —
 * recomputing over what someone entered would let the percentage beside it
 * quietly contradict the amount.
 *
 * Storage Rental is NOT entered. The sheet derives it as the remainder after
 * the two transportation segments (C28 = C5-C14-C21, C29 = C4-C15-C22), so
 * asking for it again would let the three segments stop summing to the month.
 * ------------------------------------------------------------------------- */

const n = (v: string | number | undefined) => toNum(v) ?? 0;
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const s = (v: number) => String(Number(v.toFixed(2)));

/** A typed value wins; the computed figure only fills a blank field. */
const entered = (raw: string, fallback: number) => (raw.trim() === '' ? fallback : n(raw));

interface Draft {
  month: string;
  collectionTotal: string;   // row 3 — collected against everything outstanding
  collectionMonth: string;   // row 4 — collected against this month
  raised: string;            // row 5
  pending: string;           // row 6 — entered by the team
  pendingToDate: string;     // row 9
  pickupRaised: string;
  pickupCollected: string;
  pickupGap: string;         // row 16 — entered by the team
  deliveryRaised: string;
  deliveryCollected: string;
}

const EMPTY: Draft = {
  month: '', collectionTotal: '', collectionMonth: '', raised: '', pending: '',
  pendingToDate: '', pickupRaised: '', pickupCollected: '', pickupGap: '',
  deliveryRaised: '', deliveryCollected: '',
};

export function CollectionsEntryForm({ existing, onDone, onCancel }: {
  /** Row being edited. Absent when adding a month. */
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  /**
   * Entered fields are prefilled, including the two that are now typed rather
   * than computed. The remaining derived figures are recomputed on save, so
   * seeding them here would let a stale value survive an edit that should have
   * replaced it.
   */
  const [d, setD] = useState<Draft>(() => {
    if (!existing) return EMPTY;
    const v = (k: string) => (existing[k] == null ? '' : String(existing[k]));
    return {
      // The sheet may hand this back in any locale format; the date input and
      // the record id both need ISO.
      month: (() => {
        const raw = String(existing.month ?? '');
        const t = Date.parse(raw);
        return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : raw.slice(0, 10);
      })(),
      collectionTotal: v('collection_amount'),
      collectionMonth: v('collection_month'),
      raised: v('raised_amount'),
      pending: v('pending_amount'),
      pendingToDate: v('pending_to_date'),
      pickupRaised: v('pk_raised'),
      pickupCollected: v('pk_collected'),
      pickupGap: v('pk_gap'),
      deliveryRaised: v('dl_raised'),
      deliveryCollected: v('dl_collected'),
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [k]: e.target.value }));

  const calc = useMemo(() => {
    const raised = n(d.raised);
    const collectedMonth = n(d.collectionMonth);

    const pkR = n(d.pickupRaised), pkC = n(d.pickupCollected);
    const dlR = n(d.deliveryRaised), dlC = n(d.deliveryCollected);

    const pending = entered(d.pending, raised - collectedMonth);
    const pkGap = entered(d.pickupGap, pkR - pkC);

    // The remainder, exactly as the sheet computes it.
    const stR = raised - pkR - dlR;
    const stC = collectedMonth - pkC - dlC;

    /**
     * Denominators follow the sheet, verified against the columns that already
     * hold values: Gap % over Raised reproduces March 6.678613, April 7.426019
     * and May 7.778137 to six decimals. Over Collection Amount those months
     * give 5.10 / 6.54 / 6.36, which matches nothing in the sheet — Collection
     * Amount covers everything outstanding while Pending covers this month
     * alone, so that denominator mixes two periods.
     *
     * Share divides by the month's collected for the same reason storage is
     * the remainder of it: the three segments partition row 4, so dividing by
     * row 4 is what makes the shares sum to 100%.
     */
    const seg = (r: number, c: number, gapOverride?: number) => {
      const gap = gapOverride ?? r - c;
      return { raised: r, collected: c, gap, gapPct: pct(gap, r), share: pct(c, collectedMonth) };
    };

    return {
      pending,
      gapPct: pct(pending, raised),
      pickup: seg(pkR, pkC, pkGap),
      delivery: seg(dlR, dlC),
      storage: seg(stR, stC),
    };
  }, [d]);

  const problems: string[] = [];
  if (n(d.collectionMonth) > n(d.raised)) problems.push('Collected this month cannot exceed the amount raised.');
  if (calc.storage.raised < 0) problems.push('Pickup and delivery raised together exceed the month\u2019s raised total.');
  if (calc.storage.collected < 0) problems.push('Pickup and delivery collected together exceed the month\u2019s collected total.');

  /**
   * Advisory only, and deliberately not in `problems`: an override that
   * disagrees with raised − collected can be entirely legitimate, so it must
   * not block the save. Nothing else catches a mistyped figure now that these
   * two are hand-entered.
   */
  const notices: string[] = [];
  const expectedPending = n(d.raised) - n(d.collectionMonth);
  if (d.pending.trim() !== '' && expectedPending > 0 &&
      Math.abs(n(d.pending) - expectedPending) / expectedPending > 0.01) {
    notices.push(
      `Raised minus Collection amount for the month is ${expectedPending.toLocaleString('en-IN')}. ` +
      'Confirm the entered pending amount is intended.');
  }
  const expectedPkGap = n(d.pickupRaised) - n(d.pickupCollected);
  if (d.pickupGap.trim() !== '' && expectedPkGap > 0 &&
      Math.abs(n(d.pickupGap) - expectedPkGap) / expectedPkGap > 0.01) {
    notices.push(
      `Pickup raised minus collected is ${expectedPkGap.toLocaleString('en-IN')}. ` +
      'Confirm the entered gap is intended.');
  }

  const submit = async () => {
    setError(null);
    if (!d.month) { setError('Pick a month.'); return; }
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);
    try {
      // One row, one write. The segment figures live on the month's own row,
      // so an interrupted save can no longer leave a month with totals but no
      // breakdown — which is exactly how the earlier two-tab version failed.
      const payload = {
        month: d.month,
        collection_amount: d.collectionTotal,
        collection_month: d.collectionMonth,
        raised_amount: d.raised,
        pending_amount: d.pending.trim() === '' ? s(calc.pending) : d.pending,
        gap_pct: s(calc.gapPct),
        pending_to_date: d.pendingToDate,

        pk_raised: d.pickupRaised, pk_collected: d.pickupCollected,
        pk_gap: d.pickupGap.trim() === '' ? s(calc.pickup.gap) : d.pickupGap,
        pk_gap_pct: s(calc.pickup.gapPct),
        pk_share: s(calc.pickup.share),

        dl_raised: d.deliveryRaised, dl_collected: d.deliveryCollected,
        dl_gap: s(calc.delivery.gap), dl_gap_pct: s(calc.delivery.gapPct),
        dl_share: s(calc.delivery.share),

        st_raised: s(calc.storage.raised), st_collected: s(calc.storage.collected),
        st_gap: s(calc.storage.gap), st_gap_pct: s(calc.storage.gapPct),
        st_share: s(calc.storage.share),
      };

      if (existing?.__id) {
        await updateRow('collections_monthly', String(existing.__id), payload);
      } else {
        await createRow('collections_monthly', payload);
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
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Monthly collections">
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit month' : 'Monthly collections'}</h2>
        </header>

        <div className="modal__bd">
          {error && <div className="cef__err" role="alert">{error}</div>}

          <div className="formrow" style={{ maxWidth: 220, marginBottom: 'var(--s5)' }}>
            <label className="formrow__lb" htmlFor="cef-month">Month</label>
            {/* The month identifies the record, so it is fixed once saved —
                changing it here would edit one month into another. */}
            <input id="cef-month" className="field" type="date" value={d.month}
              onChange={set('month')} disabled={Boolean(existing)} />
            <span className="formrow__hint">First of the month.</span>
          </div>

          <h3 className="cef__sec">Collection</h3>
          <div className="cef__grid">
            <Field label="Collection Amount" value={d.collectionTotal} onChange={set('collectionTotal')}
              hint="Collected against everything outstanding." />
            <Field label="Collection amount for the month" value={d.collectionMonth} onChange={set('collectionMonth')} />
            <Field label="Raised Invoice amount" value={d.raised} onChange={set('raised')} />
            <Field label="Pending collection amount" value={d.pending} onChange={set('pending')}
              hint="Leave blank to use Raised minus Collection amount for the month." />
            <Field label="Total Pending Invoice amount till date" value={d.pendingToDate} onChange={set('pendingToDate')} />
          </div>

          <h3 className="cef__sec">Source of revenue</h3>

          <h4 className="cef__sub">Transportation (Pickup)</h4>
          <div className="cef__grid">
            <Field label="Raised Invoices Amount of pickup" value={d.pickupRaised} onChange={set('pickupRaised')} />
            <Field label="Collection Amount of pickup" value={d.pickupCollected} onChange={set('pickupCollected')} />
            <Field label="Gap in Rs. of pickup" value={d.pickupGap} onChange={set('pickupGap')}
              hint="Leave blank to use raised minus collected." />
          </div>

          <h4 className="cef__sub">Transportation (Delivery)</h4>
          <div className="cef__grid">
            <Field label="Raised Invoices Amount of delivery" value={d.deliveryRaised} onChange={set('deliveryRaised')} />
            <Field label="Collection Amount of delivery" value={d.deliveryCollected} onChange={set('deliveryCollected')} />
          </div>

          {/* Storage Rental has no inputs at all — the sheet derives it as the
              remainder after pickup and delivery, so there is nothing to type. */}
          <p className="cef__note">
            Storage Rental is calculated as the month total less pickup and delivery.
            It appears in the records once saved.
          </p>

          {problems.length > 0 && (
            <ul className="cef__warn">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
          {notices.length > 0 && (
            <ul className="cef__note">{notices.map(p => <li key={p}>{p}</li>)}</ul>
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

function Field({ label, value, onChange, hint }: {
  label: string; value: string; hint?: string;
  onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <div className="formrow">
      <label className="formrow__lb">{label}</label>
      <span className="cef__money">
        <span className="cef__cur" aria-hidden="true">₹</span>
        <input className="field num" inputMode="decimal" value={value}
          onChange={onChange} placeholder="0" />
      </span>
      {hint && <span className="formrow__hint">{hint}</span>}
    </div>
  );
}


export const monthOf = (r: Row) => parseDate(r.month)?.getTime() ?? 0;
