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
 * Spend is entered once, above the categories, because that is the only way it
 * can be observed — the ad accounts report one account-level total and the
 * campaigns carry no line-of-business label. Cost metrics are therefore
 * blended; only lead-to-customer rate stays meaningful per category, since it
 * divides customers by leads and never touches spend.
 *
 * One form, two rows written: lead performance and acquisition cost for the
 * same month. They are separate tabs because the team reads them separately,
 * but they cannot be entered separately — CPL, CPVL, CAC and the lead-to-
 * customer rate are all spend or customers divided by a lead count, so an
 * acquisition row without its lead row has nothing to divide by.
 *
 *   Total leads   = valid + invalid                     (per category)
 *   Valid rate    = valid ÷ total × 100                 (per category)
 *   L2C rate      = customers ÷ total leads × 100       (per category)
 *   CPL           = month spend ÷ total leads           (blended)
 *   CPVL          = month spend ÷ valid leads           (blended)
 *   CAC           = month spend ÷ customers won         (blended)
 *
 * Only the ten entered figures are typed. Everything above is
 * computed here for the live preview and recomputed server-side on save,
 * because a figure the browser calculates is a figure the browser can be
 * wrong about.
 *
 * Order matters on save: leads first. The acquisition deriver reads the lead
 * row for the month and refuses if it is missing.
 * ------------------------------------------------------------------------- */

const CATEGORIES = [
  { key: 'b2c', name: 'B2C' },
  { key: 'b2b', name: 'B2B' },
  { key: 'pm', name: 'Packing & Moving' },
] as const;

type CatKey = typeof CATEGORIES[number]['key'];

const n = (v: string) => toNum(v) ?? 0;
const monthKey = (v: unknown): string => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
/** The date input and the record id both need ISO; the sheet may return any
 *  locale format. */
const toISOMonth = (v: unknown): string => {
  const raw = String(v ?? '');
  const t = Date.parse(raw);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return raw.slice(0, 10);
};

type Entered = Record<CatKey, { valid: string; invalid: string; customers: string }>;

const BLANK: Entered = {
  b2c: { valid: '', invalid: '', customers: '' },
  b2b: { valid: '', invalid: '', customers: '' },
  pm: { valid: '', invalid: '', customers: '' },
};

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
  const [spend, setSpend] = useState<string>('');

  /** The two rows for the month in the form, whichever table it was opened
   *  from. Either may be absent — a month can legitimately have leads
   *  recorded before its spend is known. */
  const leadRow = useMemo(
    () => allLeads.find(r => monthKey(r.month) === monthKey(month)) ?? null,
    [allLeads, month]);
  const acqRow = useMemo(
    () => allAcq.find(r => monthKey(r.month) === monthKey(month)) ?? null,
    [allAcq, month]);

  /**
   * Prefilled once, from whichever rows existed when the form opened. Not kept
   * in sync with the rows afterwards: the user is editing, and rewriting their
   * inputs underneath them because a background refresh landed is worse than
   * a slightly stale starting point.
   */
  const [d, setD] = useState<Entered>(BLANK);
  const [seeded, setSeeded] = useState(false);

  if (!seeded && existing && (leadRow || acqRow)) {
    const v = (r: Row | null, k: string) => (r && r[k] != null ? String(r[k]) : '');
    setD({
      b2c: { valid: v(leadRow, 'b2c_valid'), invalid: v(leadRow, 'b2c_invalid'),
             customers: v(acqRow, 'b2c_customers') },
      b2b: { valid: v(leadRow, 'b2b_valid'), invalid: v(leadRow, 'b2b_invalid'),
             customers: v(acqRow, 'b2b_customers') },
      pm: { valid: v(leadRow, 'pm_valid'), invalid: v(leadRow, 'pm_invalid'),
            customers: v(acqRow, 'pm_customers') },
    });
    setSpend(v(acqRow, 'total_spend'));
    setSeeded(true);
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when leads saved but acquisition did not, so the message can say
   *  exactly what is on the sheet rather than "something went wrong". */
  const [partial, setPartial] = useState(false);

  const set = (c: CatKey, f: keyof Entered[CatKey]) => (e: { target: { value: string } }) =>
    setD(prev => ({ ...prev, [c]: { ...prev[c], [f]: e.target.value } }));

  const calc = useMemo(() => {
    const totalSpend = n(spend);

    const per = CATEGORIES.map(c => {
      const valid = n(d[c.key].valid);
      const invalid = n(d[c.key].invalid);
      const customers = n(d[c.key].customers);
      const total = valid + invalid;
      return {
        ...c, valid, invalid, customers, total,
        validRate: total > 0 ? (valid / total) * 100 : null,
        // Divides customers by leads, so it needs no spend and stays real per
        // category. The only comparison across the three lines that survives.
        l2c: total > 0 ? (customers / total) * 100 : null,
      };
    });

    const totalValid = per.reduce((a, c) => a + c.valid, 0);
    const totalInvalid = per.reduce((a, c) => a + c.invalid, 0);
    const totalLeads = totalValid + totalInvalid;
    const totalCustomers = per.reduce((a, c) => a + c.customers, 0);

    return {
      per, totalValid, totalInvalid, totalLeads, totalSpend, totalCustomers,
      validRate: totalLeads > 0 ? (totalValid / totalLeads) * 100 : null,
      cpl: totalLeads > 0 ? totalSpend / totalLeads : null,
      cpvl: totalValid > 0 ? totalSpend / totalValid : null,
      cac: totalCustomers > 0 ? totalSpend / totalCustomers : null,
      l2c: totalLeads > 0 ? (totalCustomers / totalLeads) * 100 : null,
    };
  }, [d, spend]);

  const problems: string[] = [];
  for (const c of calc.per) {
    if (c.valid < 0 || c.invalid < 0) problems.push(`${c.name} lead counts cannot be negative.`);
    if (c.customers > c.total && c.total > 0) {
      problems.push(`${c.name} has more customers (${c.customers}) than leads (${c.total}).`);
    }
  }
  if (calc.totalLeads === 0 && calc.totalSpend > 0) {
    problems.push('Spend was entered with no leads against it, so no cost metric can be computed.');
  }
  if (calc.totalSpend < 0) problems.push('Marketing spend cannot be negative.');

  const submit = async () => {
    setError(null);
    setPartial(false);
    if (!month) { setError('Pick a month.'); return; }
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);

    const leadPayload: Row = { month };
    const acqPayload: Row = { month, total_spend: spend || '0' };
    for (const c of CATEGORIES) {
      leadPayload[`${c.key}_valid`] = d[c.key].valid || '0';
      leadPayload[`${c.key}_invalid`] = d[c.key].invalid || '0';
      acqPayload[`${c.key}_customers`] = d[c.key].customers || '0';
    }

    try {
      // Leads first, always. The acquisition deriver reads this row to get its
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
      // saving again completes it — both writes are keyed on the month, so
      // the retry updates rather than duplicates.
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
            <div className="mk__grid">
              <div className="formrow">
                <label className="formrow__lb" htmlFor="mk-month">Month</label>
                {/* The month is the record id in both tabs, so it is fixed once
                    saved — changing it here would edit one month into another. */}
                <input id="mk-month" className="field" type="date" value={month}
                  onChange={e => setMonth(e.target.value)} disabled={Boolean(existing)} />
                <span className="formrow__hint">First of the month.</span>
              </div>

              {/* Sits above the categories, not inside them, because it is one
                  figure for the whole month. Putting a spend box under each
                  category would invite someone to split a number that has no
                  split. */}
              <Field label="Total Marketing Spend" money value={spend}
                onChange={e => setSpend(e.target.value)}
                hint="All channels, all categories." />
            </div>

            <dl className="mk__calc">
              <div><dt>Total leads</dt><dd className="num">{calc.totalLeads || '—'}</dd></div>
              <div><dt>Blended CPL</dt><dd className="num">{money(calc.cpl)}</dd></div>
              <div><dt>Blended CPVL</dt><dd className="num">{money(calc.cpvl)}</dd></div>
              <div><dt>Blended CAC</dt><dd className="num">{money(calc.cac)}</dd></div>
              <div><dt>L2C rate</dt><dd className="num">{calc.l2c === null ? '—' : `${calc.l2c.toFixed(1)}%`}</dd></div>
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
                  <Field label="Customers Won" value={d[c.key].customers} onChange={set(c.key, 'customers')} />
                </div>
                {/* No CPL, CPVL or CAC here — each would need a per-category
                    spend to divide, and spend is only known for the month. */}
                <dl className="mk__calc">
                  <div><dt>Total leads</dt><dd className="num">{p.total || '—'}</dd></div>
                  <div><dt>Valid rate</dt><dd className="num">{p.validRate === null ? '—' : `${p.validRate.toFixed(1)}%`}</dd></div>
                  <div><dt>L2C rate</dt><dd className="num">{p.l2c === null ? '—' : `${p.l2c.toFixed(1)}%`}</dd></div>
                </dl>
              </section>
            );
          })}

          <section className="mk__block mk__block--total">
            <h3 className="mk__sec">Month total</h3>
            <dl className="mk__calc">
              <div><dt>Total leads</dt><dd className="num">{calc.totalLeads || '—'}</dd></div>
              <div><dt>Valid</dt><dd className="num">{calc.totalValid || '—'}</dd></div>
              <div><dt>Valid rate</dt><dd className="num">{calc.validRate === null ? '—' : `${calc.validRate.toFixed(1)}%`}</dd></div>
              <div><dt>Customers</dt><dd className="num">{calc.totalCustomers || '—'}</dd></div>
              <div><dt>Total spend</dt><dd className="num">{money(calc.totalSpend || null)}</dd></div>
            </dl>
          </section>

          <p className="mk__note">
            Saves two rows: lead performance and acquisition cost for this month.
            Cost metrics are blended across all three categories, because spend is
            recorded once for the month rather than per category.
          </p>

          {problems.length > 0 && (
            <ul className="mk__warn">{problems.map(p => <li key={p}>{p}</li>)}</ul>
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
