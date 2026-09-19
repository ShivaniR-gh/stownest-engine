import { useMemo, useState } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Button, EmptyState } from '@/components/primitives';
import { isRowOpen } from '@/lib/data/editable';
import { formatINR, formatINRCompact, formatPct, parseDate, toNum } from '@/lib/format';
import { keysInWindow, defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { KpiTile } from '@/components/metrics/KpiTile';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import type { SeriesPoint } from '@/lib/analytics/aggregate';

const n = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);

function pnl(r: Row | undefined) {
  const b2c = n(r, 'b2c_storage') + n(r, 'b2c_transport') + n(r, 'b2c_packing');
  const b2b = n(r, 'b2b_storage') + n(r, 'b2b_transport');
  const rev = b2c + b2b;
  const cogs = n(r, 'cogs_wh_rent') + n(r, 'cogs_logistics') + n(r, 'cogs_labour')
    + n(r, 'cogs_damages') + n(r, 'cogs_packing');
  const gp = rev - cogs;
  const indirect = n(r, 'exp_salary') + n(r, 'exp_marketing') + n(r, 'exp_intermediary')
    + n(r, 'exp_other') + n(r, 'exp_emi');
  const pbt = gp - indirect;
  const tax = n(r, 'tax_gst');
  return {
    b2c_rev: b2c,
    b2b_rev: b2b,
    tot_rev: rev,
    tot_cogs: cogs,
    gross_profit: gp,
    tot_indirect: indirect,
    net_profit: pbt,
    tax_gst: tax,
    profit_after_tax: pbt - tax,
  };
}

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (k: string) => {
  const d = parseDate(`${k}-01`);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : k;
};

function Kpi({ label, value, lead }: { i?: number; label: string; value: string; lead?: boolean }) {
  return <KpiTile label={label} value={value} lead={lead} />;
}

const LINES: { label: string; key: string; strong?: boolean }[] = [
  { label: 'B2C storage', key: 'b2c_storage' },
  { label: 'B2C transportation', key: 'b2c_transport' },
  { label: 'B2C packing and moving', key: 'b2c_packing' },
  { label: 'B2C revenue', key: 'b2c_rev', strong: true },
  { label: 'B2B storage', key: 'b2b_storage' },
  { label: 'B2B transportation', key: 'b2b_transport' },
  { label: 'B2B revenue', key: 'b2b_rev', strong: true },
  { label: 'Total revenue', key: 'tot_rev', strong: true },
  { label: 'WH rent', key: 'cogs_wh_rent' },
  { label: 'Logistics', key: 'cogs_logistics' },
  { label: 'Contract / labour', key: 'cogs_labour' },
  { label: 'Damages', key: 'cogs_damages' },
  { label: 'Packing material', key: 'cogs_packing' },
  { label: 'Total COGS', key: 'tot_cogs', strong: true },
  { label: 'Gross profit', key: 'gross_profit', strong: true },
  { label: 'Employee salary', key: 'exp_salary' },
  { label: 'Marketing exp', key: 'exp_marketing' },
  { label: 'Intermediary charges', key: 'exp_intermediary' },
  { label: 'Other expenses', key: 'exp_other' },
  { label: 'EMI and interest', key: 'exp_emi' },
  { label: 'Total indirect', key: 'tot_indirect', strong: true },
  { label: 'Net profit (PBT)', key: 'net_profit', strong: true },
  { label: 'Tax (GST)', key: 'tax_gst' },
  { label: 'Profit after tax', key: 'profit_after_tax', strong: true },
];

export function FinanceDashboard({ rows, mode = 'dashboard', onEdit }: {
  rows: Record<string, Row[]>;
  mode?: 'dashboard' | 'records';
  /** Records only. Offered when a single month is picked and it is the
   *  newest recorded month; older months and multi-month windows are closed. */
  onEdit?: (r: Row) => void;
}) {
  const list = rows.finance_pnl ?? [];
  const newest = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of list) {
      const k = monthKey(r.month);
      if (k && !m.has(k)) m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [list]);
  const monthKeys = newest.map(([k]) => k);

  const [pickRaw, setPick] = useState<string>('');
  const pick = pickRaw || defaultMonthPeriod(monthKeys);
  const windowed = useMemo(() => {
    const keys = keysInWindow(monthKeys, pick);
    return newest.filter(([k]) => keys.includes(k));
  }, [newest, monthKeys, pick]);
  const cur = windowed[0]?.[1];
  const t = useMemo(() => {
    if (windowed.length <= 1) return pnl(cur);
    return windowed.reduce((acc, [, r]) => {
      const p = pnl(r);
      (Object.keys(acc) as (keyof typeof acc)[]).forEach(k => { acc[k] += p[k]; });
      return acc;
    }, pnl(undefined));
  }, [windowed, cur]);

  const trend: SeriesPoint[] = useMemo(() => (
    [...windowed].reverse().map(([k, r]) => {
      const p = pnl(r);
      return {
        key: k,
        label: monthLabel(k),
        values: {
          revenue: p.tot_rev,
          b2c: p.b2c_rev,
          b2b: p.b2b_rev,
          cogs: p.tot_cogs,
          gp: p.gross_profit,
          pbt: p.net_profit,
          pat: p.profit_after_tax,
          gpMargin: p.tot_rev ? (p.gross_profit / p.tot_rev) * 100 : 0,
          patMargin: p.tot_rev ? (p.profit_after_tax / p.tot_rev) * 100 : 0,
        },
        rows: [r],
      };
    })
  ), [windowed]);

  const mix = [
    { key: 'B2C revenue', value: t.b2c_rev, count: 1, rows: [] as Row[] },
    { key: 'B2B revenue', value: t.b2b_rev, count: 1, rows: [] as Row[] },
  ].filter(d => d.value);
  const cogsMix = [
    { key: 'WH rent', value: windowed.reduce((a, [, r]) => a + n(r, 'cogs_wh_rent'), 0), count: 1, rows: [] as Row[] },
    { key: 'Logistics', value: windowed.reduce((a, [, r]) => a + n(r, 'cogs_logistics'), 0), count: 1, rows: [] as Row[] },
    { key: 'Labour', value: windowed.reduce((a, [, r]) => a + n(r, 'cogs_labour'), 0), count: 1, rows: [] as Row[] },
    { key: 'Damages', value: windowed.reduce((a, [, r]) => a + n(r, 'cogs_damages'), 0), count: 1, rows: [] as Row[] },
    { key: 'Packing', value: windowed.reduce((a, [, r]) => a + n(r, 'cogs_packing'), 0), count: 1, rows: [] as Row[] },
  ].filter(d => d.value).sort((a, b) => b.value - a.value);
  const expMix = [
    { key: 'Salary', value: windowed.reduce((a, [, r]) => a + n(r, 'exp_salary'), 0), count: 1, rows: [] as Row[] },
    { key: 'Marketing', value: windowed.reduce((a, [, r]) => a + n(r, 'exp_marketing'), 0), count: 1, rows: [] as Row[] },
    { key: 'Intermediary', value: windowed.reduce((a, [, r]) => a + n(r, 'exp_intermediary'), 0), count: 1, rows: [] as Row[] },
    { key: 'Other', value: windowed.reduce((a, [, r]) => a + n(r, 'exp_other'), 0), count: 1, rows: [] as Row[] },
    { key: 'EMI / interest', value: windowed.reduce((a, [, r]) => a + n(r, 'exp_emi'), 0), count: 1, rows: [] as Row[] },
  ].filter(d => d.value).sort((a, b) => b.value - a.value);

  if (!newest.length) {
    return (
      <EmptyState icon="chart" title="No P&L months yet"
        body="Save a month from New record. Totals and profit are computed." />
    );
  }

  const val = (key: string) => {
    if (key in t) return t[key as keyof typeof t];
    return windowed.reduce((a, [, r]) => a + n(r, key), 0);
  };

  const h = 220;
  const records = mode === 'records';
  const editRow = records && onEdit && windowed.length === 1 && /^\d{4}-\d{2}$/.test(pick)
    && isRowOpen(cur, list) ? cur : undefined;

  return (
    <>
      <section className="section" style={records ? { marginTop: 0 } : undefined}>
        <div className="filter-bar">
          <PeriodSelect id="fin-pick" value={pick} onChange={setPick} monthKeys={monthKeys} />
        </div>
        {!records && (
          <div className="grid grid--kpi grid--kpi-std">
            <Kpi i={0} label="Revenue" value={formatINR(t.tot_rev)} />
            <Kpi i={1} label="Gross profit" value={formatINR(t.gross_profit)} />
            <Kpi i={2} label="PBT" value={formatINR(t.net_profit)} />
            <Kpi i={3} label="Profit after tax" value={formatINR(t.profit_after_tax)} lead />
          </div>
        )}
      </section>

      <section className="section">
        <SectionHeader title="P&L"
          note={records && windowed.length === 1 ? monthLabel(windowed[0][0]) : undefined}
          action={editRow && onEdit ? (
            <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(editRow)}>
              Edit
            </Button>
          ) : undefined} />
        <div className="card"><div className="card__bd">
          <table className="xpose">
            <tbody>
              {LINES.map(line => (
                <tr key={line.key} className={line.strong ? 'xpose__foot' : undefined}>
                  <th className="xpose__rowhd">{line.label}</th>
                  <td className="is-num">{formatINR(val(line.key))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </section>

      {!records && (
        <section className="section">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <ChartFrame title="Revenue by month" question="How is booked revenue moving?" height={h}
              isEmpty={!trend.some(p => p.values.revenue)}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
                series={[{ id: 'revenue', label: 'Revenue', kind: 'area', colorIndex: 0 }]} />}
            </ChartFrame>
            <ChartFrame title="B2C vs B2B revenue" question="Which book is carrying the month?" height={h}
              isEmpty={!trend.some(p => p.values.b2c || p.values.b2b)}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
                series={[
                  { id: 'b2c', label: 'B2C', kind: 'line', colorIndex: 1 },
                  { id: 'b2b', label: 'B2B', kind: 'line', colorIndex: 2 },
                ]} />}
            </ChartFrame>
            <ChartFrame title="Revenue, COGS and gross profit" question="Is the margin holding as we scale?" height={h}
              isEmpty={!trend.some(p => p.values.revenue)}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
                series={[
                  { id: 'revenue', label: 'Revenue', kind: 'bar', colorIndex: 0 },
                  { id: 'cogs', label: 'COGS', kind: 'bar', colorIndex: 3 },
                  { id: 'gp', label: 'Gross profit', kind: 'line', colorIndex: 2 },
                ]} />}
            </ChartFrame>
            <ChartFrame title="PBT vs profit after tax" question="What does tax take from the month?" height={h}
              isEmpty={!trend.some(p => p.values.pbt || p.values.pat)}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={formatINRCompact}
                series={[
                  { id: 'pbt', label: 'PBT', kind: 'line', colorIndex: 1 },
                  { id: 'pat', label: 'PAT', kind: 'line', colorIndex: 4 },
                ]} />}
            </ChartFrame>
            <ChartFrame title="Gross and PAT margin" question="Are we keeping more of each rupee?" height={h}
              isEmpty={!trend.some(p => p.values.gpMargin)}>
              {hh => <TrendChart height={hh} data={trend} valueFormat={v => formatPct(v, 1)}
                series={[
                  { id: 'gpMargin', label: 'GP %', kind: 'line', colorIndex: 2 },
                  { id: 'patMargin', label: 'PAT %', kind: 'line', colorIndex: 3 },
                ]} />}
            </ChartFrame>
            <ChartFrame title="Revenue mix" question="B2C vs B2B in this window?" height={h}
              isEmpty={!mix.length}>
              {hh => <CategoryChart height={hh} data={mix} valueFormat={formatINRCompact} colorIndex={0} />}
            </ChartFrame>
            <ChartFrame title="COGS mix" question="Where does cost of goods sit?" height={h}
              isEmpty={!cogsMix.length}>
              {hh => <CategoryChart height={hh} data={cogsMix} valueFormat={formatINRCompact} colorIndex={3} />}
            </ChartFrame>
            <ChartFrame title="Indirect expenses" question="What is eating operating profit?" height={h}
              isEmpty={!expMix.length}>
              {hh => <CategoryChart height={hh} data={expMix} valueFormat={formatINRCompact} colorIndex={1} />}
            </ChartFrame>
          </div>
        </section>
      )}

    </>
  );
}
