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
 * cannot be entered separately — the blended figures divide the month's spend
 * by lead counts, so an acquisition row without its lead row has nothing to
 * divide by.
 *
 * Per-category CPL, CPVL and CAC are typed, not computed. Each would need a
 * per-category spend, which the ad accounts cannot report — but the team
 * already maintains these figures, so the platform records what they hold.
 *
 * Typed:     valid, invalid, CPL, CPVL, CAC            (per category)
 * Computed:  total leads, valid rate, spend, customers,
 *            L2C rate                                   (per category)
 *            spend, blended CPL, CPVL, CAC, L2C rate    (month)
 *
 * Spend is not entered. Leads x CPL is what a category spent, so the rupee
 * figures fall out of the metrics rather than sitting beside them where the
 * two could disagree with nothing to say which was wrong.
 *
 * Valid leads x CPVL gives the same spend by a second route, and the form
 * compares the two. A gap means a digit is wrong in one of the columns; the
 * warning is shown, and what was typed is still what gets saved.
 * ------------------------------------------------------------------------- */

const CATEGORIES = [
  { key: 'b2c', name: 'B2C' },
  { key: 'b2b', name: 'B2B' },
  { key: 'pm', name: 'Packing & Moving' },
] as const;

type CatKey = typeof CATEGORIES[number]['key'];
type FieldKey = 'valid' | 'invalid' | 'cpl' | 'cpvl' | 'cac';

const n = (v: string) => toNum(v) ?? 0;
const has = (v: string) => String(v ?? '').trim() !== '';

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

type Entered = Record<CatKey, Record<FieldKey, string>>;

const blankCat = (): Record<FieldKey, string> =>
  ({ valid: '', invalid: '', cpl: '', cpvl: '', cac: '' });

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
        cpl: v(acqRow, `${c.key}_cpl`),
        cpvl: v(acqRow, `${c.key}_cpvl`),
        cac: v(acqRow, `${c.key}_cac`),
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
      const cpl = n(f.cpl);
      const cpvl = n(f.cpvl);
      const cac = n(f.cac);

      // Two routes to the same rupee figure. The first is authoritative
      // because total leads is the larger, better-populated denominator; the
      // second exists to disagree with it when a digit is wrong.
      const spend = total > 0 && cpl > 0 ? total * cpl : 0;
      const spendViaValid = valid > 0 && cpvl > 0 ? valid * cpvl : 0;
      const customers = spend > 0 && cac > 0 ? Math.round(spend / cac) : 0;

      return {
        ...c, valid, invalid, total, cpl, cpvl, cac, spend, spendViaValid, customers,
        validRate: total > 0 ? (valid / total) * 100 : null,
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
      cpl: totalLeads > 0 && totalSpend > 0 ? totalSpend / totalLeads : null,
      cpvl: totalValid > 0 && totalSpend > 0 ? totalSpend / totalValid : null,
      cac: totalCustomers > 0 ? totalSpend / totalCustomers : null,
      l2c: totalLeads > 0 && totalCustomers > 0 ? (totalCustomers / totalLeads) * 100 : null,
    };
  }, [d]);

  /* Blocking: the row would be arithmetically impossible. */
  const problems: string[] = [];
  for (const c of calc.per) {
    if (c.valid < 0 || c.invalid < 0) problems.push(`${c.name} lead counts cannot be negative.`);
    for (const [label, v] of [['CPL', c.cpl], ['CPVL', c.cpvl], ['CAC', c.cac]] as const) {
      if (v < 0) problems.push(`${c.name} ${label} cannot be negative.`);
    }
    if (c.customers > c.total && c.total > 0) {
      problems.push(
        `${c.name} CAC implies ${c.customers} customers from ${c.total} leads — more customers than leads.`);
    }
  }

  /* Non-blocking: the row saves, but something looks wrong and only the person
     entering it can tell whether it actually is. */
  const checks: string[] = [];
  for (const c of calc.per) {
    // Valid leads are a subset of total, so cost per valid lead can never sit
    // below cost per lead. Inverted means the two columns were read the wrong
    // way round.
    if (c.cpl > 0 && c.cpvl > 0 && c.cpvl < c.cpl) {
      checks.push(`${c.name} CPVL (₹${c.cpvl}) is below its CPL (₹${c.cpl}) — these may be swapped.`);
    }
    // leads x CPL and valid x CPVL are the same spend by two routes. They
    // should agree; a gap means a digit is wrong in one of them.
    if (c.spend > 0 && c.spendViaValid > 0) {
      const gap = Math.abs(c.spend - c.spendViaValid) / c.spend;
      if (gap > 0.05) {
        checks.push(
          `${c.name} CPL implies ₹${Math.round(c.spend).toLocaleString('en-IN')} of spend but its CPVL ` +
          `implies ₹${Math.round(c.spendViaValid).toLocaleString('en-IN')} (${(gap * 100).toFixed(0)}% apart).`);
      }
    }
    if (c.cac > 0 && c.cpl > 0 && c.cac < c.cpl) {
      checks.push(`${c.name} CAC is below its CPL, which would mean more customers than leads.`);
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
      // Blank stays blank. A metric nobody supplied should read "Data
      // unavailable" downstream, not zero.
      acqPayload[`${c.key}_cpl`] = has(f.cpl) ? f.cpl : '';
      acqPayload[`${c.key}_cpvl`] = has(f.cpvl) ? f.cpvl : '';
      acqPayload[`${c.key}_cac`] = has(f.cac) ? f.cac : '';
    }

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

            {/* Spend has no input. It is leads x CPL, so it appears here as a
                result of the categories below rather than as a figure someone
                could type into disagreement with them. */}
            <dl className="mk__calc">
              <div><dt>Total leads</dt><dd className="num">{calc.totalLeads || '—'}</dd></div>
              <div><dt>Total spend</dt><dd className="num">{money(calc.totalSpend || null)}</dd></div>
              <div><dt>Blended CPL</dt><dd className="num">{money(calc.cpl)}</dd></div>
              <div><dt>Blended CPVL</dt><dd className="num">{money(calc.cpvl)}</dd></div>
              <div><dt>Blended CAC</dt><dd className="num">{money(calc.cac)}</dd></div>
              <div><dt>L2C rate</dt><dd className="num">{pctOf(calc.l2c)}</dd></div>
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
                  <Field label="CPL" money value={d[c.key].cpl} onChange={set(c.key, 'cpl')} />
                  <Field label="CPVL" money value={d[c.key].cpvl} onChange={set(c.key, 'cpvl')} />
                  <Field label="CAC" money value={d[c.key].cac} onChange={set(c.key, 'cac')} />
                </div>
                {/* Consequences of the five typed figures, not more inputs.
                    Spend is leads x CPL; customers is that over CAC. */}
                <dl className="mk__calc">
                  <div><dt>Total leads</dt><dd className="num">{p.total || '—'}</dd></div>
                  <div><dt>Valid rate</dt><dd className="num">{pctOf(p.validRate)}</dd></div>
                  <div><dt>Spend</dt><dd className="num">{money(p.spend || null)}</dd></div>
                  <div><dt>Customers</dt><dd className="num">{p.customers || '—'}</dd></div>
                  <div><dt>L2C rate</dt><dd className="num">{pctOf(p.l2c)}</dd></div>
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
            CPL, CPVL and CAC are recorded as entered. Spend, customers, lead-to-customer
            rate and the blended figures are calculated from them.
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
