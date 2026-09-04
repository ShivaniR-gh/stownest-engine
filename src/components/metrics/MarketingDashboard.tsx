import { useMemo, useState } from 'react';
import '@/styles/marketing.css';
import type { Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart, StackedBarChart } from '@/components/charts/CategoryChart';
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
 * Category names ARE fixed here, unlike the collections segments. That is a
 * deliberate difference: collections reads its segments from sheet rows, but
 * these three are schema columns (b2b_/b2c_/pm_ prefixes), so a fourth line of
 * business is a schema change either way. Naming them once here and reading
 * the prefix off the column keys keeps the two files honest with each other.
 * ------------------------------------------------------------------------- */

const CATEGORIES = [
  { key: 'b2c', name: 'B2C' },
  { key: 'b2b', name: 'B2B' },
  { key: 'pm', name: 'Packing & Moving' },
] as const;

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
    ? <LeadView ordered={orderedLeads} current={current} previous={previous}
        picker={picker} drill={drill} />
    : <CostView ordered={orderedAcq} current={current} previous={previous}
        picker={picker} drill={drill} />;
}

/* -------------------------------------------------------------------------- */
/* Lead performance                                                           */
/* -------------------------------------------------------------------------- */

function LeadView({ ordered, current, previous, picker, drill }: ViewProps) {
  const totalValid = n(current, 'total_valid');
  const totalInvalid = n(current, 'total_invalid');
  const totalLeads = n(current, 'total_leads');
  const validRate = val(current, 'valid_rate_pct');

  /** Valid against invalid, stacked, so the bar height is the month's volume
   *  and the split inside it is quality. Two separate bars would make you do
   *  that addition by eye. */
  const trend = useMemo(() => ordered.slice(-12).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: { valid: n(r, 'total_valid'), invalid: n(r, 'total_invalid') },
  })), [ordered]);

  const rateTrend = useMemo(() => ordered.slice(-12).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: { rate: n(r, 'valid_rate_pct') },
  })), [ordered]);

  const mix = useMemo(() => CATEGORIES.map(c => ({
    key: c.name, value: n(current, `${c.key}_total`), count: 1, rows: [current!],
  })).filter(d => d.value > 0), [current]);

  return (
    <>
      <section className="section">
        <SectionHeader title="Lead Performance" note={monthLabel(current!)} action={picker} />

        <div className="grid grid--kpi">
          <Kpi i={1} label="Total Valid Leads" value={formatInt(totalValid)}
            delta={delta(totalValid, n(previous, 'total_valid'))} good="up"
            note="Qualified this month" />
          <Kpi i={2} label="Total Invalid Leads" value={formatInt(totalInvalid)}
            delta={delta(totalInvalid, n(previous, 'total_invalid'))} good="down"
            note="Disqualified this month" />
          <Kpi i={3} label="Total Leads" value={formatInt(totalLeads)}
            delta={delta(totalLeads, n(previous, 'total_leads'))} good="up"
            note="All leads received" />
          <Kpi i={4} label="Valid Lead Rate"
            value={validRate === null ? '—' : formatPct(validRate, 1)}
            delta={delta(validRate ?? 0, n(previous, 'valid_rate_pct'))} good="up"
            note="Valid as a share of total" />
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
                <dl className="mk__cat-rows">
                  <div><dt>Valid</dt><dd className="num">{formatInt(valid)}</dd></div>
                  <div><dt>Invalid</dt><dd className="num">{formatInt(invalid)}</dd></div>
                  <div><dt>Total</dt><dd className="num">{formatInt(total)}</dd></div>
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

        <div style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title="Valid lead rate over time" department="marketing" height={240}
            question="Is qualification improving or slipping?"
            isEmpty={rateTrend.length < 2}>
            {h => (
              <TrendChart height={h} data={rateTrend} valueFormat={v => formatPct(v, 1)}
                series={[{ id: 'rate', label: 'Valid lead rate', kind: 'area', colorIndex: 1 }]}
                onPointClick={p => drill(`Leads — ${p.label}`, 'marketing_leads', p.rows)} />
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
  const cpl = val(current, 'cpl');
  const cpvl = val(current, 'cpvl');
  const cac = val(current, 'cac');
  const l2c = val(current, 'l2c_rate');

  /** The three blended cost curves on one axis. All rupees per something, so
   *  they compare directly; CAC sitting well above the other two is the point
   *  of the chart rather than a scaling problem. */
  const costTrend = useMemo(() => ordered.slice(-12).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: { cpl: n(r, 'cpl'), cpvl: n(r, 'cpvl'), cac: n(r, 'cac') },
  })), [ordered]);

  const spendTrend = useMemo(() => ordered.slice(-12).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: Object.fromEntries(CATEGORIES.map(c => [c.key, n(r, `${c.key}_spend`)])),
  })), [ordered]);

  /** Per-category CPL over time. This is the comparison the blended figures
   *  cannot make, and the reason the three metrics are recorded per category
   *  at all — B2B costing an order of magnitude more per lead than B2C is
   *  invisible in a single blended line. */
  const cplByCat = useMemo(() => ordered.slice(-12).map(r => ({
    key: String(r.month), label: monthLabel(r), rows: [r],
    values: Object.fromEntries(CATEGORIES.map(c => [c.key, n(r, `${c.key}_cpl`)])),
  })), [ordered]);

  const cacByCat = useMemo(() => CATEGORIES.map(c => ({
    key: c.name, value: val(current, `${c.key}_cac`) ?? 0, count: 1, rows: [current!],
  })), [current]);

  /** Spend per category exists again now that it is back-computed from CPL x
   *  leads, so the distribution is real rather than an allocation someone
   *  chose. */
  const spendMix = useMemo(() => CATEGORIES.map(c => ({
    key: c.name, value: n(current, `${c.key}_spend`), count: 1, rows: [current!],
  })).filter(d => d.value > 0), [current]);

  return (
    <>
      <section className="section">
        <SectionHeader title="Acquisition & Cost" note={monthLabel(current!)} action={picker} />

        <div className="grid grid--kpi mk__kpi5">
          <Kpi i={1} label="Total Marketing Spend" value={formatINRCompact(spend)}
            delta={delta(spend, n(previous, 'total_spend'))} good="neutral"
            note="All channels, all categories" />
          <Kpi i={2} label="Cost Per Lead (CPL)"
            value={cpl === null ? '—' : formatINR(cpl)}
            delta={delta(cpl ?? 0, n(previous, 'cpl'))} good="down"
            note="Blended, spend ÷ total leads" />
          <Kpi i={3} label="Cost Per Valid Lead (CPVL)"
            value={cpvl === null ? '—' : formatINR(cpvl)}
            delta={delta(cpvl ?? 0, n(previous, 'cpvl'))} good="down"
            note="Blended, spend ÷ valid leads" />
          <Kpi i={4} label="Customer Acquisition Cost (CAC)"
            value={cac === null ? '—' : formatINR(cac)}
            delta={delta(cac ?? 0, n(previous, 'cac'))} good="down"
            note="Blended, spend ÷ customers" />
          <Kpi i={5} label="Lead to Customer Rate"
            value={l2c === null ? '—' : formatPct(l2c, 1)}
            delta={delta(l2c ?? 0, n(previous, 'l2c_rate'))} good="up"
            note="Customers ÷ total leads" />
        </div>

        {/* The five cards above blend all three categories; the cards below are
            as entered. Saying which is which once, here, beats repeating a
            caveat on each of eight tiles. */}
        <p className="mk__disclosure">
          CPL, CPVL and CAC are recorded as entered for each category. Spend, customers and
          the lead-to-customer rate are computed from them and the month's lead counts, so
          the per-category figures always sum to the totals above.
        </p>
      </section>

      <section className="section">
        <SectionHeader title="By category" note={monthLabel(current!)} />
        <div className="mk__cats">
          {CATEGORIES.map(c => {
            const cCpl = val(current, `${c.key}_cpl`);
            const cCpvl = val(current, `${c.key}_cpvl`);
            const cCac = val(current, `${c.key}_cac`);
            const cL2c = val(current, `${c.key}_l2c`);
            const leads = n(current, `${c.key}_total`);
            return (
              <div key={c.key} className="mk__cat" role="button" tabIndex={0}
                onClick={() => drill(`${c.name} acquisition`, 'marketing_acquisition', [current!])}>
                <div className="mk__cat-hd">
                  <span className="mk__cat-nm">{c.name}</span>
                  <span className="mk__cat-rate num">{cCpl === null ? '—' : formatINR(cCpl)}</span>
                </div>
                <div className="mk__cat-bar">
                  <span style={{ width: `${Math.min(100, cL2c ?? 0)}%` }} />
                </div>
                <dl className="mk__cat-rows">
                  <div><dt>Leads</dt><dd className="num">{leads ? formatInt(leads) : '—'}</dd></div>
                  <div><dt>CPL</dt><dd className="num">{cCpl === null ? '—' : formatINR(cCpl)}</dd></div>
                  <div><dt>CPVL</dt><dd className="num">{cCpvl === null ? '—' : formatINR(cCpvl)}</dd></div>
                  <div><dt>CAC</dt><dd className="num">{cCac === null ? '—' : formatINR(cCac)}</dd></div>
                  <div><dt>L2C rate</dt><dd className="num">{cL2c === null ? '—' : formatPct(cL2c, 1)}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <SectionHeader title="Analysis" />
        <div className="grid grid--split">
          <ChartFrame title="Cost per lead by category" department="marketing" height={260}
            question="Which line of business is getting dearer to reach?"
            isEmpty={cplByCat.length < 2}>
            {h => (
              <TrendChart height={h} data={cplByCat} valueFormat={formatINR}
                series={CATEGORIES.map((c, i) => ({
                  id: c.key, label: c.name, kind: 'line' as const, colorIndex: i,
                }))}
                onPointClick={p => drill(`Acquisition — ${p.label}`, 'marketing_acquisition', p.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Blended cost trend" department="marketing" height={260}
            question="Across everything, is a lead or a customer getting cheaper?"
            isEmpty={costTrend.length < 2}>
            {h => (
              <TrendChart height={h} data={costTrend} valueFormat={formatINR}
                series={[
                  { id: 'cpl', label: 'CPL', kind: 'line', colorIndex: 1 },
                  { id: 'cpvl', label: 'CPVL', kind: 'line', colorIndex: 0 },
                  { id: 'cac', label: 'CAC', kind: 'line', colorIndex: 3 },
                ]}
                onPointClick={p => drill(`Acquisition — ${p.label}`, 'marketing_acquisition', p.rows)} />
            )}
          </ChartFrame>
        </div>

        <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title="Cost distribution by category" department="marketing" height={240}
            question="Where is the budget actually going?"
            isEmpty={!spendMix.length}>
            {() => (
              <DonutChart data={spendMix} centerLabel="Total Spend" valueFormat={formatINRCompact}
                onSliceClick={s => drill(`${s.key} spend`, 'marketing_acquisition', s.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Customer acquisition cost by category" department="marketing" height={240}
            question="What does a customer cost in each line of business?"
            isEmpty={!cacByCat.some(d => d.value > 0)}>
            {h => (
              <CategoryChart height={h} data={cacByCat} valueFormat={formatINR}
                colorIndex={3}
                onBarClick={s => drill(`${s.key} acquisition`, 'marketing_acquisition', s.rows)} />
            )}
          </ChartFrame>
        </div>

        <div style={{ marginTop: 'var(--s4)' }}>
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
  current: Row | null;
  previous: Row | null;
  picker: React.ReactNode;
  drill: (title: string, datasetId: string, rows: Row[]) => void;
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
  /** Which direction counts as an improvement, for the delta colour. Cost
   *  metrics falling is good news, so this cannot be inferred from the sign. */
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
