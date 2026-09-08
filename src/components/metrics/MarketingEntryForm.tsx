import { useMemo, useState } from 'react';
import '@/styles/marketing.css';
import { Button } from '@/components/primitives';
import { createRow, updateRow } from '@/lib/data/store';
import { useDatasets } from '@/lib/data/useDataset';
import { parseDate, toNum } from '@/lib/format';
import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Monthly marketing entry.
 *
 * One form, two rows written: lead performance and acquisition cost for the
 * same month. Separate tabs because the team reads them separately, but they
 * cannot be entered separately — the cost figures divide spend by lead counts,
 * so an acquisition row without its lead row has nothing to divide by.
 *
 * Typed:     valid, invalid, spend, customers          (per category)
 * Computed:  total leads, valid rate, CPL, CPVL, CAC,
 *            L2C rate                                   (per category)
 *            total spend, blended CPL, CPVL, CAC        (month)
 *
 * The ratios are NOT entered. This reverses the earlier arrangement, which had
 * the team typing CPL, CPVL and CAC because the ad accounts reported only one
 * account-level spend. They now report it per line of business, so the rupees
 * are observed and the ratios follow — which is the right way round. A typed
 * ratio sitting beside a typed spend can disagree with it, and nothing in the
 * sheet would say which was wrong.
 *
 * Three checks the old form needed are now impossible by construction:
 * CPVL can no longer fall below CPL (valid leads are a subset of total, so the
 * same spend over a smaller denominator is always larger), the two routes to
 * spend can no longer disagree because there is only one, and CAC can no
 * longer imply more customers than leads because customers are counted rather
 * than inferred. What remains is a genuine judgement call: customers exceeding
 * VALID leads, which is possible but usually a miscount.
 * ------------------------------------------------------------------------- */

const CATEGORIES = [
  { key: 'b2c', name: 'B2C' },
  { key: 'b2b', name: 'B2B' },
  { key: 'pm', name: 'Packing & Moving' },
] as const;

type CatKey = typeof CATEGORIES[number]['key'];
type FieldKey = 'valid' | 'invalid' | 'spend' | 'customers';

const n = (v: string) => toNum(v) ?? 0;
const has = (v: string) => String(v ?? '').trim() !== '';

const monthKey = (v: unknown): string => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
/** The date input and the record id both need ISO; the sheet may return any
 *  locale format, or a Sheets serial. */
const toISOMonth = (v: unknown): string => {
  const d = parseDate(v);
  if (d) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return String(v ?? '').slice(0, 10);
};

type Entered = Record<CatKey, Record<FieldKey, string>>;

const blankCat = (): Record<FieldKey, string> =>
  ({ valid: '', invalid: '', spend: '', customers: '' });

const BLANK: Entered = { b2c: blankCat(), b2b: blankCat(), pm: blankCat() };

export function MarketingEntryForm({ existing, onDone, onCancel }: {
  /** A row from either marketing dataset. The month is taken from it and the
   *  paired row looked up, so editing from either table opens the same form. */
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { byId } = useDatasets(['marketing_leads', 'marketing_acquisition']);
  const allLeads = byId.marketing_leads ?? [];
  const allAcq = byId.marketing_acquisition ?? [];

  const [month, setMonth] = useState<string>(() => (existing ? toISOMonth(existing.month) : ''));

  /** The two rows for the month in the form, whichever table it was opened
   *  from. Either may be absent — a month can legitimately have leads recorded
   *  before its costs are known. */
  const leadRow = useMemo(
    () => allLeads.find(r => monthKey(r.month) === monthKey(month)) ?? null,
    [allLeads, month]);
  const acqRow = useMemo(
    () => allAcq.find(r => monthKey(r.month) === monthKey(month)) ?? null,
    [allAcq, month]);

  /**
   * Prefilled once, from whichever rows existed when the form opened. Not kept
   * in sync afterwards: the user is editing, and rewriting their inputs
   * underneath them because a background refresh landed is worse than a
   * slightly stale starting point.
   */
  const [d, setD] = useState<Entered>(BLANK);
  const [seeded, setSeeded] = useState(false);

  if (!seeded && existing && (leadRow || acqRow)) {
    const v = (r: Row | null, k: string) => (r && r[k] != null ? String(r[k]) : '');
    const next = {} as Entered;
    for (const c of CATEGORIES) {
      next[c.key] = {
        valid: v(leadRow, `${c.key}_valid`),
        invalid: v(leadRow, `${c.key}_invalid`),
        spend: v(acqRow, `${c.key}_spend`),
        customers: v(acqRow, `${c.key}_customers`),
      };
    }
    setD(next);
    setSeeded(true);
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when leads saved but acquisition did not, so the message can say
   *  exactly what is on the sheet rather than "something went wrong". */
  const [partial, setPartial] = useState(false);

  const set = (c: CatKey, f: FieldKey) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [c]: { ...prev[c], [f]: e.target.value } }));

  const calc = useMemo(() => {
    const per = CATEGORIES.map(c => {
      const f = d[c.key];
      const valid = n(f.valid);
      const invalid = n(f.invalid);
      const total = valid + invalid;
      const spend = n(f.spend);
      const customers = n(f.customers);

      return {
        ...c, valid, invalid, total, spend, customers,
        validRate: total > 0 ? (valid / total) * 100 : null,
        cpl: valid > 0 && spend > 0 ? spend / valid : null,
        cac: customers > 0 && spend > 0 ? spend / customers : null,
        l2c: total > 0 && customers > 0 ? (customers / total) * 100 : null,
      };
    });

    const totalValid = per.reduce((a, c) => a + c.valid, 0);
    const totalInvalid = per.reduce((a, c) => a + c.invalid, 0);
    const totalLeads = totalValid + totalInvalid;
    const totalSpend = per.reduce((a, c) => a + c.spend, 0);
    const totalCustomers = per.reduce((a, c) => a + c.customers, 0);

    return {
      per, totalValid, totalInvalid, totalLeads, totalSpend, totalCustomers,
      validRate: totalLeads > 0 ? (totalValid / totalLeads) * 100 : null,
      // Weighted by construction — total spend over total VALID leads, never
      // an average of the three CPLs. Averaging would treat a category
      // bringing 226 leads as equal to one bringing 2,551.
      cpl: totalValid > 0 && totalSpend > 0 ? totalSpend / totalValid : null,
      cac: totalCustomers > 0 && totalSpend > 0 ? totalSpend / totalCustomers : null,
      l2c: totalLeads > 0 && totalCustomers > 0 ? (totalCustomers / totalLeads) * 100 : null,
    };
  }, [d]);

  /* Blocking: the row would be arithmetically impossible. */
  const problems: string[] = [];
  for (const c of calc.per) {
    if (c.valid < 0 || c.invalid < 0) problems.push(`${c.name} lead counts cannot be negative.`);
    if (c.spend < 0) problems.push(`${c.name} spend cannot be negative.`);
    if (c.customers < 0) problems.push(`${c.name} customers cannot be negative.`);
    if (c.customers > c.total && c.total > 0) {
      problems.push(
        `${c.name} has ${c.customers} customers from ${c.total} leads — a customer has to have been a lead first.`);
    }
  }

  /* Non-blocking: the row saves, but something looks wrong and only the person
     entering it can tell whether it actually is. */
  const checks: string[] = [];
  for (const c of calc.per) {
    // Possible — a lead marked invalid can still convert — but usually it
    // means valid and invalid were entered the wrong way round.
    if (c.customers > c.valid && c.valid > 0) {
      checks.push(
        `${c.name} has ${c.customers} customers but only ${c.valid} valid leads. ` +
        `Check whether valid and invalid are the right way round.`);
    }
    // Spend with nothing to show for it is worth a second look before it
    // becomes a blank CAC on the dashboard.
    if (c.spend > 0 && c.customers === 0) {
      checks.push(`${c.name} has spend recorded but no customers, so its CAC will be blank.`);
    }
    // The reverse: customers with no spend leaves CAC blank too, and suggests
    // the spend figure simply has not been filled in yet.
    if (c.customers > 0 && c.spend === 0) {
      checks.push(`${c.name} has customers but no spend recorded, so its CAC will be blank.`);
    }
  }

  const submit = async () => {
    setError(null);
    setPartial(false);
    if (!month) { setError('Pick a month.'); return; }
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);

    const leadPayload: Row = { month };
    const acqPayload: Row = { month };
    for (const c of CATEGORIES) {
      const f = d[c.key];
      leadPayload[`${c.key}_valid`] = f.valid || '0';
      leadPayload[`${c.key}_invalid`] = f.invalid || '0';
      // Blank stays blank. A figure nobody supplied should read "Data
      // unavailable" downstream, not zero — a spend of ₹0 is a claim.
      acqPayload[`${c.key}_spend`] = has(f.spend) ? f.spend : '';
      acqPayload[`${c.key}_customers`] = has(f.customers) ? f.customers : '';
      // Sent for the server's checks only — these keys are not columns, so
      // they are dropped before the row reaches the sheet. Without them the
      // deriver divides by whatever Sheets has caught up to, which on a month
      // whose counts just changed is the old figure.
      acqPayload[`${c.key}_leads_now`] = String(n(f.valid) + n(f.invalid));
      acqPayload[`${c.key}_valid_now`] = f.valid || '0';
    }

    acqPayload.leads_now = String(calc.totalLeads);
    acqPayload.valid_now = String(calc.totalValid);
    try {
      // Leads first, always. The acquisition deriver reads this row for its
      // denominators, so the reverse order fails on a genuinely new month.
      if (leadRow?.__id) {
        await updateRow('marketing_leads', String(leadRow.__id), leadPayload);
      } else {
        await createRow('marketing_leads', leadPayload);
      }
    } catch (e) {
      setBusy(false);
      setError(`Lead performance could not be saved, so nothing was written. ${(e as Error).message ?? ''}`.trim());
      return;
    }

    try {
      if (acqRow?.__id) {
        await updateRow('marketing_acquisition', String(acqRow.__id), acqPayload);
      } else {
        await createRow('marketing_acquisition', acqPayload);
      }
    } catch (e) {
      // Two tabs cannot be written atomically, so say plainly what landed
      // rather than implying the whole save failed. Reopening this month and
      // saving again completes it — both writes key on the month, so the retry
      // updates rather than duplicates.
      setBusy(false);
      setPartial(true);
      setError(
        `Lead performance saved, but acquisition cost did not: ${(e as Error).message ?? 'the write was refused.'} ` +
        `Reopen this month and save again to finish it.`);
      return;
    }

    setBusy(false);
    onDone();
  };

  return (
    <div className="modal__scrim" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Monthly marketing">
        <header className="modal__hd">
          <h2 className="modal__title">{existing ? 'Edit month' : 'Monthly marketing'}</h2>
        </header>

        <div className="modal__bd">
          {error && <div className={`mk__err${partial ? ' mk__err--partial' : ''}`} role="alert">{error}</div>}

          <section className="mk__block mk__block--head">
            <div className="formrow" style={{ maxWidth: 240 }}>
              <label className="formrow__lb" htmlFor="mk-month">Month</label>
              {/* The month is the record id in both tabs, so it is fixed once
                  saved — changing it would edit one month into another. */}
              <input id="mk-month" className="field" type="date" value={month}
                onChange={e => setMonth(e.target.value)} disabled={Boolean(existing)} />
              <span className="formrow__hint">First of the month.</span>
            </div>

            {/* The blended figures, as consequences of the categories below.
                Every one of them is spend over a lead or customer count. */}
            <dl className="mk__calc">
              <div><dt>Total leads</dt><dd className="num">{calc.totalLeads || '—'}</dd></div>
              <div><dt>Total spend</dt><dd className="num">{money(calc.totalSpend || null)}</dd></div>
              <div><dt>Blended CPL</dt><dd className="num">{money(calc.cpl)}</dd></div>
              <div><dt>Blended CAC</dt><dd className="num">{money(calc.cac)}</dd></div>
            </dl>
          </section>

          {CATEGORIES.map(c => {
            const p = calc.per.find(x => x.key === c.key)!;
            return (
              <section key={c.key} className="mk__block">
                <h3 className="mk__sec">{c.name}</h3>
                <div className="mk__grid">
                  <Field label="Valid Leads" value={d[c.key].valid} onChange={set(c.key, 'valid')} />
                  <Field label="Invalid Leads" value={d[c.key].invalid} onChange={set(c.key, 'invalid')} />
                  <Field label="Marketing Spend" money value={d[c.key].spend} onChange={set(c.key, 'spend')} />
                  <Field label="Customers" value={d[c.key].customers} onChange={set(c.key, 'customers')} />
                </div>
                {/* Consequences of the four typed figures, not more inputs.
                    Every ratio here is this category's spend over one of its
                    own counts. */}
                <dl className="mk__calc">
                  <div><dt>Total leads</dt><dd className="num">{p.total || '—'}</dd></div>
                  <div><dt>Valid rate</dt><dd className="num">{pctOf(p.validRate)}</dd></div>
                  <div><dt>CPL</dt><dd className="num">{money(p.cpl)}</dd></div>
                  <div><dt>CAC</dt><dd className="num">{money(p.cac)}</dd></div>
                </dl>
              </section>
            );
          })}

          <section className="mk__block mk__block--total">
            <h3 className="mk__sec">Month total</h3>
            <dl className="mk__calc">
              <div><dt>Total leads</dt><dd className="num">{calc.totalLeads || '—'}</dd></div>
              <div><dt>Valid</dt><dd className="num">{calc.totalValid || '—'}</dd></div>
              <div><dt>Valid rate</dt><dd className="num">{pctOf(calc.validRate)}</dd></div>
              <div><dt>Customers</dt><dd className="num">{calc.totalCustomers || '—'}</dd></div>
              <div><dt>Total spend</dt><dd className="num">{money(calc.totalSpend || null)}</dd></div>
            </dl>
          </section>

          {checks.length > 0 && (
            <ul className="mk__warn">
              {checks.map(w => <li key={w}>{w}</li>)}
              <li className="mk__warn-foot">
                These do not block saving — the entered figures are kept as typed.
              </li>
            </ul>
          )}

          <p className="mk__note">
            Saves two rows: lead performance and acquisition cost for this month.
            Leads, spend and customers are recorded as entered. CPL and CAC are
            calculated from them.
          </p>

          {problems.length > 0 && (
            <ul className="mk__warn mk__warn--block">{problems.map(p => <li key={p}>{p}</li>)}</ul>
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

const money = (v: number | null) => (v === null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const pctOf = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);

function Field({ label, value, onChange, money: isMoney, hint }: {
  label: string; value: string; hint?: string; money?: boolean;
  onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <div className="formrow">
      <label className="formrow__lb">{label}</label>
      <span className={isMoney ? 'mk__money' : undefined}>
        {isMoney && <span className="mk__cur" aria-hidden="true">₹</span>}
        <input className="field num" inputMode="decimal" value={value}
          onChange={onChange} placeholder="0" />
      </span>
      {hint && <span className="formrow__hint">{hint}</span>}
    </div>
  );
}
