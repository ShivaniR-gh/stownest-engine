import { useMemo, useState } from 'react';
import '@/styles/marketing.css';
import type { Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { Pipeline } from '@/components/charts/Pipeline';
import { Heatmap } from '@/components/charts/Heatmap';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Button, EmptyState } from '@/components/primitives';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import { keysInWindow, defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { SelectField } from '@/components/filters/SelectField';
import { KpiTile } from '@/components/metrics/KpiTile';

/** ---------------------------------------------------------------------------
 * Marketing dashboard.
 *
 * Two views over two datasets that describe the same months: how many leads
 * arrived (Lead Performance) and what they cost (Acquisition & Cost). Which
 * one is showing follows the dataset switcher in the page header.
 *
 * Filters: Period (single month, rolling window, YTD) and Category. Both drive
 * every KPI, card and chart on the page, and Reset returns to last month /
 * all categories.
 *
 * Multi-month periods SUM counts and money, and RECOMPUTE ratios from those
 * sums (valid rate = Σvalid / Σleads, CPL = Σspend / Σvalid, ...). Averaging
 * monthly ratios would weight a 40-lead month the same as a 4,000-lead one.
 * The formulas match api/_lib/derive.ts: CPL is over VALID leads, CAC over
 * customers, lead-to-customer over all leads.
 *
 * Deltas compare the period with the same number of months immediately before
 * it, and are hidden when that earlier period is not fully recorded.
 * ------------------------------------------------------------------------- */

const CATEGORIES = [
  { key: 'b2c', name: 'B2C' },
  { key: 'b2b', name: 'B2B' },
  { key: 'pm', name: 'Packing & Moving' },
] as const;
type CatKey = typeof CATEGORIES[number]['key'];

/** How far back trend charts reach when a single month is picked. */
const TREND_MONTHS = 12;

const n = (r: Row | null | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);
const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + n(r, k), 0);
const per = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const pctOf = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

const monthKey = (v: unknown): string => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const labelOf = (k: string): string => {
  const d = parseDate(`${k}-01`);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : k;
};

/** Newest-first map of yyyy-mm → row (first row wins on duplicates). */
function byMonth(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  const sorted = [...rows].sort((a, b) => monthKey(b.month).localeCompare(monthKey(a.month)));
  for (const r of sorted) {
    const k = monthKey(r.month);
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}

/** Column names for "a category, or everything". */
const leadKeys = (c: CatKey | '') => c
  ? { total: `${c}_total`, valid: `${c}_valid`, invalid: `${c}_invalid` }
  : { total: 'total_leads', valid: 'total_valid', invalid: 'total_invalid' };
const acqKeys = (c: CatKey | '') => c
  ? { spend: `${c}_spend`, customers: `${c}_customers` }
  : { spend: 'total_spend', customers: 'total_customers' };

interface Totals {
  leads: number; valid: number; invalid: number;
  spend: number; customers: number;
  validRate: number | null; cpl: number | null; cac: number | null; l2c: number | null;
  /** False when no acquisition row exists for any month in the period. */
  hasCost: boolean;
}

function totals(leads: Row[], acq: Row[], c: CatKey | ''): Totals {
  const lk = leadKeys(c), ak = acqKeys(c);
  const L = sum(leads, lk.total), V = sum(leads, lk.valid), I = sum(leads, lk.invalid);
  const S = sum(acq, ak.spend), C = sum(acq, ak.customers);
  return {
    leads: L, valid: V, invalid: I, spend: S, customers: C,
    validRate: pctOf(V, L), cpl: acq.length ? per(S, V) : null,
    cac: acq.length ? per(S, C) : null, l2c: acq.length ? pctOf(C, L) : null,
    hasCost: acq.length > 0,
  };
}

function delta(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null || !prev) return null;
  return ((now - prev) / prev) * 100;
}

export function MarketingDashboard({ leads, acq, view, drill }: {
  leads: Row[];
  acq: Row[];
  /** Which dataset the page header has selected. */
  view: 'leads' | 'acquisition';
  drill: (title: string, datasetId: string, rows: Row[]) => void;
}) {
  const leadMap = useMemo(() => byMonth(leads), [leads]);
  const acqMap = useMemo(() => byMonth(acq), [acq]);

  /* The period list follows the selected view's dataset, so the picker never
     offers a month the view has nothing for. */
  const monthKeys = useMemo(
    () => [...(view === 'leads' ? leadMap : acqMap).keys()], [view, leadMap, acqMap]);

  const [pickedRaw, setPicked] = useState('');
  const [cat, setCat] = useState<CatKey | ''>('');
  const picked = pickedRaw || defaultMonthPeriod(monthKeys);
  const filtered = !!pickedRaw || !!cat;

  const windowKeys = useMemo(() => keysInWindow(monthKeys, picked), [monthKeys, picked]);
  /* The equally long run of months just before the window, for deltas. */
  const prevKeys = useMemo(() => {
    if (!windowKeys.length) return [];
    const oldest = windowKeys[windowKeys.length - 1];
    const i = monthKeys.indexOf(oldest);
    const next = monthKeys.slice(i + 1, i + 1 + windowKeys.length);
    return next.length === windowKeys.length ? next : [];
  }, [monthKeys, windowKeys]);
  /* Trend charts: the window itself when it spans months, otherwise the
     12 months ending at the picked one, so a single month still has context. */
  const trendKeys = useMemo(() => {
    if (windowKeys.length > 1) return [...windowKeys].reverse();
    const i = monthKeys.indexOf(windowKeys[0] ?? '');
    return i < 0 ? [] : monthKeys.slice(i, i + TREND_MONTHS).reverse();
  }, [monthKeys, windowKeys]);

  const pick = (m: Map<string, Row>, keys: string[]) =>
    keys.map(k => m.get(k)).filter((r): r is Row => !!r);

  const wLeads = pick(leadMap, windowKeys), wAcq = pick(acqMap, windowKeys);
  const pLeads = pick(leadMap, prevKeys), pAcq = pick(acqMap, prevKeys);
  const now = totals(wLeads, wAcq, cat);
  const before = prevKeys.length ? totals(pLeads, pAcq, cat) : null;

  const periodNote = windowKeys.length === 1
    ? labelOf(windowKeys[0])
    : windowKeys.length
      ? `${labelOf(windowKeys[windowKeys.length - 1])} – ${labelOf(windowKeys[0])}`
      : '';

  if (!monthKeys.length) {
    return (
      <div className="card">
        <EmptyState icon="trending" title="No marketing data"
          body={view === 'leads'
            ? 'Add a month and its lead counts appear here.'
            : 'Add a month of spend and the cost metrics appear here.'} />
      </div>
    );
  }

  const filters = (
    <div className="filter-bar">
      <PeriodSelect value={picked} onChange={setPicked} monthKeys={monthKeys} />
      <SelectField icon="layers" label="Category" value={cat}
        onChange={v => setCat(v as CatKey | '')} isOn={!!cat}
        options={[{ value: '', label: 'All categories' },
          ...CATEGORIES.map(c => ({ value: c.key, label: c.name }))]} />
      {filtered && (
        <Button size="sm" variant="ghost" icon="close"
          onClick={() => { setPicked(''); setCat(''); }}>
          Reset
        </Button>
      )}
    </div>
  );

  const ctx: Ctx = {
    cat, now, before, periodNote, filters, drill,
    windowKeys, trendKeys, leadMap, acqMap, wLeads, wAcq,
  };
  return view === 'leads' ? <LeadView {...ctx} /> : <CostView {...ctx} />;
}

interface Ctx {
  cat: CatKey | '';
  now: Totals;
  before: Totals | null;
  periodNote: string;
  filters: React.ReactNode;
  drill: (title: string, datasetId: string, rows: Row[]) => void;
  windowKeys: string[];
  trendKeys: string[];
  leadMap: Map<string, Row>;
  acqMap: Map<string, Row>;
  wLeads: Row[];
  wAcq: Row[];
}

const cats = (c: CatKey | '') => (c ? CATEGORIES.filter(x => x.key === c) : CATEGORIES);
const colorOf = (k: CatKey) => CATEGORIES.findIndex(c => c.key === k);

/** One point per trend month, values computed per visible category. */
function trendPoints(
  keys: string[], map: Map<string, Row>, catList: readonly { key: CatKey }[],
  value: (r: Row, c: CatKey) => number,
) {
  return keys.flatMap(k => {
    const r = map.get(k);
    if (!r) return [];
    return [{
      key: k, label: labelOf(k), rows: [r],
      values: Object.fromEntries(catList.map(c => [c.key, value(r, c.key)])),
    }];
  });
}

const TWO_MONTHS = 'Two months are needed before a trend means anything. Pick a longer period or add more months.';

/* -------------------------------------------------------------------------- */
/* Lead performance                                                           */
/* -------------------------------------------------------------------------- */

function LeadView({ cat, now, before, periodNote, filters, drill, windowKeys, trendKeys,
  leadMap, acqMap, wLeads, wAcq }: Ctx) {
  const visible = cats(cat);
  const lk = leadKeys(cat);
  const catName = cat ? CATEGORIES.find(c => c.key === cat)!.name : '';
  const h = 240;

  /* Volume as bars, quality as a line on its own % axis: one chart answers
     "more leads?" and "better leads?" without adding two charts by eye. */
  const volume = useMemo(() => trendKeys.flatMap(k => {
    const r = leadMap.get(k);
    if (!r) return [];
    const L = n(r, lk.total), V = n(r, lk.valid);
    return [{ key: k, label: labelOf(k), rows: [r],
      values: { valid: V, invalid: n(r, lk.invalid), rate: L > 0 ? (V / L) * 100 : 0 } }];
  }), [trendKeys, leadMap, lk.total, lk.valid, lk.invalid]);

  const catLeadTrend = useMemo(
    () => trendPoints(trendKeys, leadMap, visible, (r, c) => n(r, `${c}_valid`)),
    [trendKeys, leadMap, visible]);
  const cplTrend = useMemo(
    () => trendPoints(trendKeys, acqMap, visible, (r, c) => n(r, `${c}_cpl`)),
    [trendKeys, acqMap, visible]);
  const cacTrend = useMemo(
    () => trendPoints(trendKeys, acqMap, visible, (r, c) => n(r, `${c}_cac`)),
    [trendKeys, acqMap, visible]);

  const catSeries = (kind: TrendSeries['kind']): TrendSeries[] =>
    visible.map(c => ({ id: c.key, label: c.name, kind, colorIndex: colorOf(c.key) }));

  /* Valid leads only: a category can dominate the raw count and still supply
     almost nothing worth calling, which is the thing worth seeing. */
  const mix = cat
    ? [
      { key: 'Valid', value: now.valid, count: 1, rows: wLeads },
      { key: 'Invalid', value: now.invalid, count: 1, rows: wLeads },
    ].filter(d => d.value > 0)
    : CATEGORIES.map(c => ({
      key: c.name, value: sum(wLeads, `${c.key}_valid`), count: 1, rows: wLeads,
    })).filter(d => d.value > 0);

  /* CPL against CAC, category by category, for the period. Both are costs on
     the same rupee scale, so the gap between them is the cost of converting. */
  const costByCat = useMemo(() => visible.flatMap(c => {
    const t = totals(wLeads, wAcq, c.key);
    if (t.cpl === null && t.cac === null) return [];
    return [{ key: c.key, label: c.name, rows: wAcq,
      values: { cpl: Math.round(t.cpl ?? 0), cac: Math.round(t.cac ?? 0) } }];
  }), [visible, wLeads, wAcq]);

  const funnel = [
    { key: 'leads', label: 'Leads', value: now.leads, rows: wLeads },
    { key: 'valid', label: 'Valid leads', value: now.valid, rows: wLeads },
    ...(now.hasCost ? [{ key: 'customers', label: 'Customers', value: now.customers, rows: wAcq }] : []),
  ];

  /* Valid rate, category × month. Spots a single bad month in one line of
     business that the averaged line charts smooth away. */
  const heatCols = trendKeys.filter(k => leadMap.has(k));
  const heatCells = visible.map(c => heatCols.map(k => {
    const r = leadMap.get(k)!;
    const t = n(r, `${c.key}_total`);
    return { rowKey: c.name, colKey: labelOf(k), value: t > 0 ? Math.round((n(r, `${c.key}_valid`) / t) * 1000) / 10 : 0, rows: [r] };
  }));

  return (
    <>
      <section className="section">
        <SectionHeader title={cat ? `Lead Performance · ${catName}` : 'Lead Performance'} note={periodNote} />
        {filters}

        <div className="grid grid--kpi grid--kpi-std">
          <Kpi label="Total Leads" value={formatInt(now.leads)} lead
            delta={delta(now.leads, before?.leads ?? null)} good="up"
            note={windowKeys.length > 1 ? `${windowKeys.length} months` : 'All leads received'} />
          <Kpi label="Valid Leads" value={formatInt(now.valid)}
            delta={delta(now.valid, before?.valid ?? null)} good="up"
            note={now.validRate === null ? 'Qualified' : `${formatPct(now.validRate, 1)} of leads`} />
          <Kpi label="Invalid Leads" value={formatInt(now.invalid)}
            delta={delta(now.invalid, before?.invalid ?? null)} good="down"
            note={now.validRate === null ? 'Disqualified' : `${formatPct(100 - now.validRate, 1)} of leads`} />
          <Kpi label="Valid Rate" value={now.validRate === null ? '—' : formatPct(now.validRate, 1)}
            delta={delta(now.validRate, before?.validRate ?? null)} good="up"
            note="Share of leads worth working" />
        </div>
      </section>

      <section className="section">
        <SectionHeader title="By category" note={periodNote} />
        <div className="mk__cats">
          {visible.map(c => {
            const t = totals(wLeads, wAcq, c.key);
            const rate = t.validRate ?? 0;
            return (
              <div key={c.key} className="mk__cat" role="button" tabIndex={0}
                onClick={() => drill(`${c.name} leads`, 'marketing_leads', wLeads)}>
                <div className="mk__cat-hd">
                  <span className="mk__cat-nm">{c.name}</span>
                  <span className="mk__cat-rate num">{formatPct(rate, 1)}</span>
                </div>
                <div className="mk__cat-bar">
                  <span style={{ width: `${Math.min(100, rate)}%` }} />
                </div>
                {/* An em dash means no spend was recorded — a zero would read as free. */}
                <dl className="mk__cat-rows">
                  <div><dt>Total</dt><dd className="num">{formatInt(t.leads)}</dd></div>
                  <div><dt>Valid</dt><dd className="num">{formatInt(t.valid)}</dd></div>
                  <div><dt>Invalid</dt><dd className="num">{formatInt(t.invalid)}</dd></div>
                  <div className="mk__cat-sep">
                    <dt>CPL</dt><dd className="num">{t.cpl === null ? '—' : formatINR(Math.round(t.cpl))}</dd>
                  </div>
                  <div><dt>CAC</dt><dd className="num">{t.cac === null ? '—' : formatINR(Math.round(t.cac))}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <SectionHeader title="Analysis" />

        <div className="grid grid--split">
          <ChartFrame title="Lead volume and quality" department="marketing" height={h}
            question="Are leads growing, and is the share worth working holding up?"
            isEmpty={volume.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={volume} valueFormat={formatInt} legendStat="none"
                series={[
                  { id: 'valid', label: 'Valid', kind: 'bar', colorIndex: 1 },
                  { id: 'invalid', label: 'Invalid', kind: 'bar', colorIndex: 3 },
                  { id: 'rate', label: 'Valid rate', kind: 'line', axis: 'right', colorIndex: 0,
                    format: v => formatPct(v, 1) },
                ]}
                onPointClick={pt => drill(`Leads — ${pt.label}`, 'marketing_leads', pt.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Lead funnel" department="marketing" height={h}
            question="How many leads survive to become customers?"
            isEmpty={!now.leads}>
            {() => (
              <Pipeline stages={funnel}
                onStageClick={s => drill(`${s.label} — ${periodNote}`,
                  s.key === 'customers' ? 'marketing_acquisition' : 'marketing_leads', s.rows)} />
            )}
          </ChartFrame>
        </div>

        <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title={cat ? 'Valid against invalid' : 'Valid lead mix by category'} department="marketing" height={h}
            question={cat ? `How much of ${catName} demand is real?` : 'Where are the leads worth working coming from?'}
            isEmpty={!mix.length}>
            {() => (
              <DonutChart data={mix} centerLabel={cat ? 'Leads' : 'Valid'} valueFormat={formatInt}
                onSliceClick={s => drill(`${s.key} leads`, 'marketing_leads', s.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title={cat ? `${catName} valid leads over time` : 'Valid leads by category over time'}
            department="marketing" height={h}
            question="Which line of business is producing the leads worth working?"
            isEmpty={catLeadTrend.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={catLeadTrend} valueFormat={formatInt} smooth
                series={catSeries('area')} legendStat="none"
                onPointClick={pt => drill(`Valid leads — ${pt.label}`, 'marketing_leads', pt.rows)} />
            )}
          </ChartFrame>
        </div>

        <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title="Cost per valid lead over time" department="marketing" height={h}
            question="Which line of business is getting dearer to generate a lead in?"
            isEmpty={cplTrend.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={cplTrend} valueFormat={formatINR} smooth
                series={catSeries('line')} legendStat="avg"
                onPointClick={pt => drill(`Acquisition — ${pt.label}`, 'marketing_acquisition', pt.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Customer acquisition cost over time" department="marketing" height={h}
            question="Which line of business is getting dearer to win a customer in?"
            isEmpty={cacTrend.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={cacTrend} valueFormat={formatINR} smooth
                series={catSeries('line')} legendStat="avg"
                onPointClick={pt => drill(`Acquisition — ${pt.label}`, 'marketing_acquisition', pt.rows)} />
            )}
          </ChartFrame>
        </div>

        <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title="CPL against CAC by category" department="marketing" height={h}
            question="What does a valid lead cost, and what does it cost to convert one?"
            isEmpty={!costByCat.length}
            emptyBody="No spend recorded for this period.">
            {hh => (
              <TrendChart height={hh} data={costByCat} valueFormat={formatINR} legendStat="none"
                series={[
                  { id: 'cpl', label: 'Cost per valid lead', kind: 'bar', colorIndex: 0 },
                  { id: 'cac', label: 'Cost per customer', kind: 'bar', colorIndex: 3 },
                ]}
                onPointClick={pt => drill(`${pt.label} acquisition`, 'marketing_acquisition', pt.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Valid rate heatmap" department="marketing" height={Math.max(140, 56 + visible.length * 44)}
            question="Did one category have a bad month the averages hide?"
            isEmpty={heatCols.length < 2} emptyBody={TWO_MONTHS}>
            {() => (
              <Heatmap rowKeys={visible.map(c => c.name)} colKeys={heatCols.map(labelOf)}
                cells={heatCells} valueFormat={v => formatPct(v, 1)}
                rowLabel="Category" colLabel="Month"
                onCellClick={c => drill(`${c.rowKey} leads — ${c.colKey}`, 'marketing_leads', c.rows)} />
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

function CostView({ cat, now, before, periodNote, filters, drill, windowKeys, trendKeys,
  acqMap, wLeads, wAcq }: Ctx) {
  const visible = cats(cat);
  const ak = acqKeys(cat);
  const catName = cat ? CATEGORIES.find(c => c.key === cat)!.name : '';
  const h = 240;
  const allSpend = sum(wAcq, 'total_spend');

  /* Spend as bars, customers on the right axis: is more money buying more
     customers, or just more spend? */
  const spendVsCustomers = useMemo(() => trendKeys.flatMap(k => {
    const r = acqMap.get(k);
    if (!r) return [];
    return [{ key: k, label: labelOf(k), rows: [r],
      values: { spend: n(r, ak.spend), customers: n(r, ak.customers) } }];
  }), [trendKeys, acqMap, ak.spend, ak.customers]);

  const spendTrend = useMemo(
    () => trendPoints(trendKeys, acqMap, visible, (r, c) => n(r, `${c}_spend`)),
    [trendKeys, acqMap, visible]);
  const l2cTrend = useMemo(
    () => trendPoints(trendKeys, acqMap, visible, (r, c) => n(r, `${c}_l2c`)),
    [trendKeys, acqMap, visible]);

  const catSeries = (kind: TrendSeries['kind']): TrendSeries[] =>
    visible.map(c => ({ id: c.key, label: c.name, kind, colorIndex: colorOf(c.key) }));

  /* All categories: where the budget goes. One category: its share of the total. */
  const spendMix = cat
    ? [
      { key: catName, value: now.spend, count: 1, rows: wAcq },
      { key: 'Other categories', value: Math.max(0, allSpend - now.spend), count: 1, rows: wAcq },
    ].filter(d => d.value > 0)
    : CATEGORIES.map(c => ({
      key: c.name, value: sum(wAcq, `${c.key}_spend`), count: 1, rows: wAcq,
    })).filter(d => d.value > 0);

  /* Every category-month as a point: does spend actually buy customers? */
  const scatter = trendKeys.flatMap(k => {
    const r = acqMap.get(k);
    if (!r) return [];
    return visible.map(c => ({
      x: n(r, `${c.key}_spend`), y: n(r, `${c.key}_customers`),
      label: `${c.name} · ${labelOf(k)}`, rows: [r],
    })).filter(p => p.x > 0 || p.y > 0);
  });

  return (
    <>
      <section className="section">
        <SectionHeader title={cat ? `Acquisition & Cost · ${catName}` : 'Acquisition & Cost'} note={periodNote} />
        {filters}

        <div className="grid grid--kpi grid--kpi-std">
          <Kpi label="Marketing Spend" value={formatINRCompact(now.spend)}
            delta={delta(now.spend, before?.spend ?? null)} good="neutral"
            note={windowKeys.length > 1 ? `${windowKeys.length} months` : 'All channels'} />
          <Kpi label="Customers" value={formatInt(now.customers)} lead
            delta={delta(now.customers, before?.customers ?? null)} good="up"
            note="Won in the period" />
          <Kpi label="CAC" value={now.cac === null ? '—' : formatINR(Math.round(now.cac))}
            delta={delta(now.cac, before?.cac ?? null)} good="down"
            note="Spend per customer" />
          <Kpi label="Lead → Customer" value={now.l2c === null ? '—' : formatPct(now.l2c, 1)}
            delta={delta(now.l2c, before?.l2c ?? null)} good="up"
            note={now.cpl === null ? 'Share of leads won' : `CPL ${formatINR(Math.round(now.cpl))}`} />
        </div>
        {!wLeads.length && (
          <p className="mk__disclosure">
            No lead counts are recorded for this period, so CPL and lead-to-customer rate cannot be computed.
          </p>
        )}
      </section>

      <section className="section">
        <SectionHeader title="By category" note={periodNote} />
        <div className="mk__cats">
          {visible.map(c => {
            const t = totals(wLeads, wAcq, c.key);
            const share = allSpend > 0 ? (t.spend / allSpend) * 100 : 0;
            return (
              <div key={c.key} className="mk__cat" role="button" tabIndex={0}
                onClick={() => drill(`${c.name} acquisition`, 'marketing_acquisition', wAcq)}>
                <div className="mk__cat-hd">
                  <span className="mk__cat-nm">{c.name}</span>
                  <span className="mk__cat-rate num">{formatPct(share, 1)}</span>
                </div>
                <div className="mk__cat-bar">
                  <span style={{ width: `${Math.min(100, share)}%` }} />
                </div>
                <dl className="mk__cat-rows">
                  <div><dt>Spend</dt><dd className="num">{t.spend ? formatINR(t.spend) : '—'}</dd></div>
                  <div><dt>Customers</dt><dd className="num">{t.customers ? formatInt(t.customers) : '—'}</dd></div>
                  <div className="mk__cat-sep">
                    <dt>CAC</dt><dd className="num">{t.cac === null ? '—' : formatINR(Math.round(t.cac))}</dd>
                  </div>
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
          <ChartFrame title="Spend against customers" department="marketing" height={h}
            question="Is more budget buying more customers?"
            isEmpty={spendVsCustomers.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={spendVsCustomers} valueFormat={formatINRCompact} legendStat="none"
                series={[
                  { id: 'spend', label: 'Spend', kind: 'bar', colorIndex: 0 },
                  { id: 'customers', label: 'Customers', kind: 'line', axis: 'right', colorIndex: 1,
                    format: formatInt },
                ]}
                onPointClick={pt => drill(`Acquisition — ${pt.label}`, 'marketing_acquisition', pt.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title={cat ? `${catName} share of spend` : 'Cost distribution by category'}
            department="marketing" height={h}
            question="Where is the budget actually going?"
            isEmpty={!spendMix.length}>
            {() => (
              <DonutChart data={spendMix} centerLabel="Spend" valueFormat={formatINRCompact}
                onSliceClick={s => drill(`${s.key} spend`, 'marketing_acquisition', s.rows)} />
            )}
          </ChartFrame>
        </div>

        <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title="Spend composition over time" department="marketing" height={h}
            question="Is the budget shifting between lines of business?"
            isEmpty={spendTrend.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={spendTrend} valueFormat={formatINRCompact} smooth
                series={catSeries('area')} legendStat="none"
                onPointClick={pt => drill(`Spend — ${pt.label}`, 'marketing_acquisition', pt.rows)} />
            )}
          </ChartFrame>

          <ChartFrame title="Lead-to-customer rate over time" department="marketing" height={h}
            question="Which line of business converts leads best?"
            isEmpty={l2cTrend.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <TrendChart height={hh} data={l2cTrend} valueFormat={v => formatPct(v, 1)} smooth
                series={catSeries('line')} legendStat="avg"
                onPointClick={pt => drill(`Acquisition — ${pt.label}`, 'marketing_acquisition', pt.rows)} />
            )}
          </ChartFrame>
        </div>

        <div style={{ marginTop: 'var(--s4)' }}>
          <ChartFrame title="Spend against customers, per category-month" department="marketing" height={280}
            question="Does spending more in a category actually win more customers there?"
            isEmpty={scatter.length < 2} emptyBody={TWO_MONTHS}>
            {hh => (
              <ScatterChart height={hh} points={scatter}
                xLabel="Spend" yLabel="Customers" xFormat={formatINRCompact} yFormat={formatInt}
                onPointClick={p => drill(p.label, 'marketing_acquisition', p.rows)} />
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

function Kpi({ label, value, note, delta: d, good, lead }: {
  label: string; value: string; note: string;
  delta: number | null;
  /** Which direction counts as an improvement. Invalid leads or CAC falling is
   *  good news, so this cannot be inferred from the sign. */
  good: 'up' | 'down' | 'neutral';
  lead?: boolean;
}) {
  const tone = d === null || good === 'neutral' || d === 0
    ? 'idle'
    : (d > 0) === (good === 'up') ? 'pos' : 'neg';

  return (
    <KpiTile label={label} value={value} lead={lead}
      note={<>
        {d !== null && (
          <span className={`mk__delta mk__delta--${tone}`} title="Against the previous period of the same length">
            {d > 0 ? '\u25b2' : d < 0 ? '\u25bc' : '\u25a0'} {Math.abs(d).toFixed(1)}%
          </span>
        )}
        <span className="mk__note">{note}</span>
      </>} />
  );
}
