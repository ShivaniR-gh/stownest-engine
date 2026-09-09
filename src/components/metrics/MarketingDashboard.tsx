import { useMemo, useState } from 'react';
import '@/styles/marketing.css';
import type { Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBarChart } from '@/components/charts/CategoryChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/primitives';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';

/** ---------------------------------------------------------------------------
 * Marketing dashboard.
 *
 * Two views over two datasets that describe the same months: how many leads
 * arrived, and what they cost. Which one is showing follows the dataset
 * switcher in the page header, so there is one control rather than two that
 * disagree.
 *
 * The KPI row is lead COUNTS only. Cost belongs per category, because that is
 * where a decision gets made — a blended CPL of ₹526 cannot tell you whether
 * to move budget between B2C and B2B, and the three category figures tell you
 * everything the blended one would have.
 *
 * Valid and invalid carry their share of the month alongside the count. The
 * two shares are complements, which looks like a wasted box until you notice
 * that reading "1,093 invalid" without "43% of the month" is what lets a bad
 * month pass for a big one.
 *
 * Category names ARE fixed here, unlike the collections segments. That is a
 * deliberate difference: collections reads its segments from sheet rows, but
 * these three are schema columns (b2b_/b2c_/pm_ prefixes), so a fourth line of
 * business is a schema change either way.
 * ------------------------------------------------------------------------- */

const CATEGORIES = [
  { key: 'b2c', name: 'B2C' },
  { key: 'b2b', name: 'B2B' },
  { key: 'pm', name: 'Packing & Moving' },
] as const;

/** How many months the cost charts reach back. */
const TREND_MONTHS = 12;

const n = (r: Row | null | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);

/** Present only when the sheet actually holds a figure. A derived metric with
 *  no denominator is written blank, and blank must not read as zero. */
const val = (r: Row | null | undefined, k: string): number | null => {
  if (!r) return null;
  const raw = String(r[k] ?? '').trim();
  return raw === '' ? null : toNum(raw);
};

const monthTime = (r: Row): number => parseDate(r.month)?.getTime() ?? 0;
const monthLabel = (r: Row): string => {
  const d = parseDate(r.month);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : String(r.month ?? '');
};
const monthKey = (v: unknown): string => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};

export function MarketingDashboard({ leads, acq, view, drill }: {
  leads: Row[];
  acq: Row[];
  /** Which dataset the page header has selected. */
  view: 'leads' | 'acquisition';
  drill: (title: string, datasetId: string, rows: Row[]) => void;
}) {
  const orderedLeads = useMemo(
    () => [...leads].sort((a, b) => monthTime(a) - monthTime(b)), [leads]);
  const orderedAcq = useMemo(
    () => [...acq].sort((a, b) => monthTime(a) - monthTime(b)), [acq]);

  const source = view === 'leads' ? orderedLeads : orderedAcq;

  const [picked, setPicked] = useState<string>('');
  const current = useMemo(() => {
    if (!source.length) return null;
    const hit = picked ? source.find(r => monthKey(r.month) === picked) : undefined;
    return hit ?? source[source.length - 1];
  }, [source, picked]);

  /** The month immediately before the selected one, for the vs-last-month
   *  deltas. Read from the rows in view rather than stored, so inserting an
   *  earlier month cannot leave a delta describing the wrong pair. */
  const previous = useMemo(() => {
    if (!current) return null;
    const i = source.findIndex(r => monthKey(r.month) === monthKey(current.month));
    return i > 0 ? source[i - 1] : null;
  }, [source, current]);

  /**
   * The acquisition row for the month the lead view is showing.
   *
   * Matched on month key rather than by index: the two tabs are written
   * separately, so a month can exist in one and not the other, and lining them
   * up positionally would eventually pair a lead count with another month's
   * spend. Absent means absent — the cost figures then read as em dashes.
   */
  const acqCurrent = useMemo(
    () => orderedAcq.find(r => monthKey(r.month) === monthKey(current?.month)) ?? null,
    [orderedAcq, current]);

  if (!source.length || !current) {
    return (
      <div className="card">
        <EmptyState icon="trending" title="No marketing data"
          body={view === 'leads'
            ? 'Add a month and its lead counts appear here.'
            : 'Add a month of spend and the cost metrics appear here.'} />
      </div>
    );
  }

  const picker = (
    <label className="mk__month">
      <select value={monthKey(current.month)} onChange={e => setPicked(e.target.value)}
        aria-label="Month">
        {[...source].reverse().map(r => (
          <option key={monthKey(r.month)} value={monthKey(r.month)}>{monthLabel(r)}</option>
        ))}
      </select>
    </label>
  );

  return view === 'leads'
    ? <LeadView ordered={orderedLeads} orderedAcq={orderedAcq} current={current}
        previous={previous} acqCurrent={acqCurrent} picker={picker} drill={drill} />
    : <CostView ordered={orderedAcq} current={current} previous={previous}
        picker={picker} drill={drill} />;
}

/* -------------------------------------------------------------------------- */
/* Lead performance                                                           */
/* -------------------------------------------------------------------------- */

function LeadView({ ordered, orderedAcq, current, previous, acqCurrent, picker, drill }: ViewProps) {
  const totalValid = n(current, 'total_valid');
  const totalInvalid = n(current, 'total_invalid');
  const totalLeads = n(current, 'total_leads');
  const validRate = totalLeads > 0 ? (totalValid / totalLeads) * 100 : null;
  const invalidRate = totalLeads > 0 ? (totalInvalid / totalLeads) * 100 : null;

  /** Valid against invalid, stacked, so the bar height is the month's volume
   *  and the split inside it is quality. Two separate bars would make you do
   *  that addition by eye. */
  const trend = useMemo(() => ordered.slice(-TREND_MONTHS).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: { valid: n(r, 'total_valid'), invalid: n(r, 'total_invalid') },
  })), [ordered]);

  const mix = useMemo(() => CATEGORIES.map(c => ({
    key: c.name, value: n(current, `${c.key}_total`), count: 1, rows: [current!],
  })).filter(d => d.value > 0), [current]);

  /**
   * One series per category, per cost metric, across months.
   *
   * Three separate charts rather than one with nine series: CPL and CAC
   * sit at different orders of magnitude — a CAC in the thousands beside a CPL
   * in the hundreds flattens the CPL bars into the axis. Splitting them keeps
   * each on a scale where a month-to-month move is visible.
   */
  const costSeries = (metric: 'cpl' | 'cac') =>
    (orderedAcq ?? []).slice(-TREND_MONTHS).map(r => ({
      key: String(r.month), label: monthLabel(r), rows: [r],
      values: Object.fromEntries(CATEGORIES.map(c => [c.key, n(r, `${c.key}_${metric}`)])),
    }));

  const cplTrend = useMemo(() => costSeries('cpl'), [orderedAcq]);
  const cacTrend = useMemo(() => costSeries('cac'), [orderedAcq]);

  const catSeries = CATEGORIES.map((c, i) => ({
    id: c.key, label: c.name, kind: 'line' as const, colorIndex: i,
  }));

  return (
    <>
      <section className="section">
        <SectionHeader title="Lead Performance" note={monthLabel(current!)} action={picker} />

        {/* Counts and their shares. No cost here — the cost figures live per
            category below, because that is where a budget decision gets made. */}
        <div className="grid grid--kpi">
          <Kpi i={1} label="Total Leads" value={formatInt(totalLeads)}
            delta={delta(totalLeads, n(previous, 'total_leads'))} good="up"
            note="All leads received" />
          <Kpi i={2} label="Valid Leads" value={formatInt(totalValid)}
            delta={delta(totalValid, n(previous, 'total_valid'))} good="up"
            note={validRate === null ? 'Qualified this month' : `${formatPct(validRate, 1)} of the month`} />
          <Kpi i={3} label="Invalid Leads" value={formatInt(totalInvalid)}
            delta={delta(totalInvalid, n(previous, 'total_invalid'))} good="down"
            note={invalidRate === null ? 'Disqualified this month' : `${formatPct(invalidRate, 1)} of the month`} />
          <Kpi i={4} label="Valid Rate" value={validRate === null ? '—' : formatPct(validRate, 1)}
            delta={delta(validRate ?? 0, rateOf(previous))} good="up"
            note="Share of leads worth working" />
        </div>
      </section>

      <section className="section">
        <SectionHeader title="By category" note={monthLabel(current!)} />
        <div className="mk__cats">
          {CATEGORIES.map(c => {
            const valid = n(current, `${c.key}_valid`);
            const invalid = n(current, `${c.key}_invalid`);
            const total = n(current, `${c.key}_total`);
            const rate = total > 0 ? (valid / total) * 100 : 0;
            const cpl = val(acqCurrent, `${c.key}_cpl`);
            const cac = val(acqCurrent, `${c.key}_cac`);
            return (
              <div key={c.key} className="mk__cat" role="button" tabIndex={0}
                onClick={() => drill(`${c.name} leads`, 'marketing_leads', [current!])}>
                <div className="mk__cat-hd">
                  <span className="mk__cat-nm">{c.name}</span>
                  <span className="mk__cat-rate num">{formatPct(rate, 1)}</span>
                </div>
                <div className="mk__cat-bar">
                  <span style={{ width: `${Math.min(100, rate)}%` }} />
                </div>
                {/* Counts and costs together. An em dash means no spend was
                    recorded for the month — a zero would read as free. */}
                <dl className="mk__cat-rows">
                  <div><dt>Total</dt><dd className="num">{formatInt(total)}</dd></div>
                  <div><dt>Valid</dt><dd className="num">{formatInt(valid)}</dd></div>
                  <div><dt>Invalid</dt><dd className="num">{formatInt(invalid)}</dd></div>
                  <div className="mk__cat-sep">
                    <dt>CPL</dt><dd className="num">{cpl === null ? '—' : formatINR(cpl)}</dd>
                  </div>
                  <div><dt>CAC</dt><dd className="num">{cac === null ? '—' : formatINR(cac)}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <SectionHeader title="Analysis" />

        <div className="grid grid--split">
          <ChartFrame title="Valid against invalid" department="marketing" height={260}
            question="Is lead volume growing, and is the quality holding?"
            isEmpty={trend.length < 2}>
            {h => (
              <StackedBarChart height={h} data={trend} keys={['valid', 'invalid']}
                labels={{ valid: 'Valid', invalid: 'Invalid' }} valueFormat={formatInt}
                onBarClick={d => drill(`Leads — ${d.label}`, 'marketing_leads', d.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Lead mix by category" department="marketing" height={260}
            question="Where is the demand actually coming from?"
            isEmpty={!mix.length}>
            {() => (
              <DonutChart data={mix} centerLabel="Leads" valueFormat={formatInt}
                onSliceClick={s => drill(`${s.key} leads`, 'marketing_leads', s.rows)} />
            )}
          </ChartFrame>
        </div>

        
      </section>
    </>
    
  );
}

/* -------------------------------------------------------------------------- */
/* Acquisition & cost                                                         */
/* -------------------------------------------------------------------------- */

function CostView({ ordered, current, previous, picker, drill }: ViewProps) {
  const spend = n(current, 'total_spend');
  const customers = n(current, 'total_customers');

  /** Spend per category per month. The cost ratios live on the lead view,
   *  where the lead counts they divide by are also visible. */
  const spendTrend = useMemo(() => ordered.slice(-TREND_MONTHS).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: Object.fromEntries(CATEGORIES.map(c => [c.key, n(r, `${c.key}_spend`)])),
  })), [ordered]);

  const spendMix = useMemo(() => CATEGORIES.map(c => ({
    key: c.name, value: n(current, `${c.key}_spend`), count: 1, rows: [current!],
  })).filter(d => d.value > 0), [current]);

  return (
    <>
      <section className="section">
        <SectionHeader title="Acquisition & Cost" note={monthLabel(current!)} action={picker} />

        <div className="grid grid--kpi">
          <Kpi i={1} label="Total Marketing Spend" value={formatINRCompact(spend)}
            delta={delta(spend, n(previous, 'total_spend'))} good="neutral"
            note="All channels, all categories" />
          <Kpi i={2} label="Customers" value={formatInt(customers)}
            delta={delta(customers, n(previous, 'total_customers'))} good="up"
            note="Won this month" />
        </div>

        <p className="mk__disclosure">
          Spend and customers are recorded as entered, per category. CPL and CAC are
          computed from them and the month's lead counts, and are shown on the Lead
          Performance view beside the counts they divide by.
        </p>
      </section>

      <section className="section">
        <SectionHeader title="By category" note={monthLabel(current!)} />
        <div className="mk__cats">
          {CATEGORIES.map(c => {
            const cSpend = n(current, `${c.key}_spend`);
            const cCust = n(current, `${c.key}_customers`);
            const share = spend > 0 ? (cSpend / spend) * 100 : 0;
            return (
              <div key={c.key} className="mk__cat" role="button" tabIndex={0}
                onClick={() => drill(`${c.name} acquisition`, 'marketing_acquisition', [current!])}>
                <div className="mk__cat-hd">
                  <span className="mk__cat-nm">{c.name}</span>
                  <span className="mk__cat-rate num">{formatPct(share, 1)}</span>
                </div>
                <div className="mk__cat-bar">
                  <span style={{ width: `${Math.min(100, share)}%` }} />
                </div>
                <dl className="mk__cat-rows">
                  <div><dt>Spend</dt><dd className="num">{cSpend ? formatINR(cSpend) : '—'}</dd></div>
                  <div><dt>Customers</dt><dd className="num">{cCust ? formatInt(cCust) : '—'}</dd></div>
                  <div><dt>Share of spend</dt><dd className="num">{formatPct(share, 1)}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <SectionHeader title="Analysis" />
        <div className="grid grid--split">
          <ChartFrame title="Cost distribution by category" department="marketing" height={240}
            question="Where is the budget actually going?"
            isEmpty={!spendMix.length}>
            {() => (
              <DonutChart data={spendMix} centerLabel="Total Spend" valueFormat={formatINRCompact}
                onSliceClick={s => drill(`${s.key} spend`, 'marketing_acquisition', s.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Spend composition over time" department="marketing" height={240}
            question="Is the budget shifting between lines of business?"
            isEmpty={spendTrend.length < 2}>
            {h => (
              <StackedBarChart height={h} data={spendTrend}
                keys={CATEGORIES.map(c => c.key)}
                labels={Object.fromEntries(CATEGORIES.map(c => [c.key, c.name]))}
                valueFormat={formatINRCompact}
                onBarClick={d => drill(`Spend — ${d.label}`, 'marketing_acquisition', d.rows)} />
            )}
          </ChartFrame>
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

interface ViewProps {
  ordered: Row[];
  /** Every acquisition month, for the cost charts on the lead view. */
  orderedAcq?: Row[];
  current: Row | null;
  previous: Row | null;
  /** The acquisition row for the same month, when the lead view needs the
   *  per-category cost figures. */
  acqCurrent?: Row | null;
  picker: React.ReactNode;
  drill: (title: string, datasetId: string, rows: Row[]) => void;
}

/** Valid rate for a month, for comparing one rate against another. */
function rateOf(r: Row | null): number {
  const total = n(r, 'total_leads');
  return total > 0 ? (n(r, 'total_valid') / total) * 100 : 0;
}

/** Percentage movement against the previous month, or null when there is no
 *  previous month or nothing to divide by. Null renders nothing at all —
 *  a "0.0%" against an absent baseline reads as "no change", which is a
 *  different and much stronger claim than "we do not know". */
function delta(now: number, prev: number): number | null {
  if (!prev) return null;
  return ((now - prev) / prev) * 100;
}

function Kpi({ i, label, value, note, delta: d, good }: {
  i: number; label: string; value: string; note: string;
  delta: number | null;
  /** Which direction counts as an improvement, for the delta colour. Invalid
   *  leads falling is good news, so this cannot be inferred from the sign. */
  good: 'up' | 'down' | 'neutral';
}) {
  const tone = d === null || good === 'neutral' || d === 0
    ? 'idle'
    : (d > 0) === (good === 'up') ? 'pos' : 'neg';

  return (
    <div className="metric mk__kpi" data-kpi={i}>
      <div className="metric__label">{label}</div>
      <div className="metric__value num">{value}</div>
      <div className="metric__cmp">
        {d !== null && (
          <span className={`mk__delta mk__delta--${tone}`}>
            {d > 0 ? '▲' : d < 0 ? '▼' : '■'} {Math.abs(d).toFixed(1)}%
          </span>
        )}
        <span className="mk__note">{note}</span>
      </div>
    </div>
  );
}
