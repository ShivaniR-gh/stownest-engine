import { useMemo, useState, type ReactNode } from 'react';
import '@/styles/collections.css';
import type { Row } from '@/config/types';
import { Button, EmptyState, Icon } from '@/components/primitives';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { formatINR, formatINRCompact, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import type { SeriesPoint } from '@/lib/analytics/aggregate';
import { PeriodSelect } from '@/components/filters/PeriodSelect';
import { SelectField } from '@/components/filters/SelectField';
import { defaultMonthPeriod } from '@/lib/analytics/monthWindow';
import { ChartsHeading } from '@/components/charts/chartKind';

const n = (r: Row | undefined, k: string) => (r ? toNum(r[k]) ?? 0 : 0);
const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};
const monthLabel = (k: string) => {
  const d = parseDate(`${k}-01`);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : k;
};
const normCity = (c: string) => c === 'Bangalore' ? 'Bengaluru' : c;

const LOST: { key: string; label: string }[] = [
  { key: 'lost_too_far', label: 'Location too far' },
  { key: 'lost_no_need', label: 'No longer requires service' },
  { key: 'lost_unsuitable', label: 'Requirement not suitable' },
  { key: 'lost_ops', label: 'Ops not accommodated' },
  { key: 'lost_other_loc', label: 'Requires another location' },
  { key: 'lost_other', label: 'Other' },
];

function chip(p: number | null, tag: string) {
  if (p == null || !Number.isFinite(p)) return <span className="delta delta--na">N/A {tag}</span>;
  const pos = p >= 0;
  return (
    <span className={`delta ${pos ? 'delta--pos' : 'delta--neg'}`}>
      {pos ? '▲' : '▼'} {Math.abs(p).toFixed(1)}% {tag}
    </span>
  );
}

function Tile({ label, value, sub, lead, icon, spark }: {
  label: string; value: string; sub?: ReactNode; lead?: boolean; icon?: string; spark?: number[];
}) {
  return (
    <div className={`metric coll__kpi kpi2${lead ? ' metric--lead' : ''}`}>
      <div className="kpi2__hd">
        {icon && <span className="kpi2__chip"><Icon name={icon} size={15} /></span>}
        <span className="metric__label">{label}</span>
      </div>
      <div className="metric__value num">{value}</div>
      {sub && <div className="metric__cmp">{sub}</div>}
      {spark && spark.length > 1 && (
        <div className="kpi2__spark"><Sparkline values={spark} tone={lead ? 'var(--kpi2-spark-lead)' : 'var(--accent)'} height={30} /></div>
      )}
    </div>
  );
}

function sum(rows: Row[], k: string) { return rows.reduce((a, r) => a + n(r, k), 0); }

function windowKeys(months: string[], period: string) {
  if (period === '3m') return months.slice(0, 3);
  if (period === '6m') return months.slice(0, 6);
  if (period === '12m') return months.slice(0, 12);
  if (period.startsWith('ytd-')) return months.filter(k => k.startsWith(period.slice(4)));
  return months.filter(k => k === period);
}

function shift(k: string, back: number) {
  if (!k) return '';
  const [y, m] = k.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function pct(now: number, then: number): number | null {
  if (!Number.isFinite(then) || then === 0) return null;
  if (!Number.isFinite(now)) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

export function B2BSalesDashboard({ rows }: { rows: Record<string, Row[]> }) {
  const all = rows.b2b_sales ?? [];
  const months = useMemo(() => {
    const s = new Set<string>();
    for (const r of all) { const k = monthKey(r.month); if (k) s.add(k); }
    return [...s].sort().reverse();
  }, [all]);
  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const r of all) { const c = normCity(String(r.city ?? '').trim()); if (c) s.add(c); }
    return [...s].sort();
  }, [all]);
  const [periodRaw, setPeriod] = useState('');
  const period = periodRaw || defaultMonthPeriod(months);
  const [city, setCity] = useState('All');
  const [clientType, setClientType] = useState('All');

  const keys = windowKeys(months, period);
  const latest = keys[0] ?? '';
  const span = period === '3m' ? 3 : period === '6m' ? 6 : period === '12m' ? 12 : 1;
  const momTag = span === 1 ? 'MoM' : `Prev. ${span}M`;
  const prevKeys = span === 1
    ? [shift(latest, 1)].filter(Boolean)
    : keys.map(k => shift(k, span)).filter(Boolean);
  const yoyKeys = keys.map(k => shift(k, 12)).filter(Boolean);

  const pass = (list: Row[]) => list.filter(r => {
    if (city !== 'All' && normCity(String(r.city ?? '')) !== city) return false;
    return true;
  });

  const inKeys = (list: Row[], ks: string[]) =>
    pass(list).filter(r => ks.includes(monthKey(r.month)));

  const now = inKeys(all, keys);
  const prev = inKeys(all, prevKeys);
  const yoy = inKeys(all, yoyKeys);

  const typeKey = clientType === 'Transactional' ? 'txn_leads'
    : clientType === 'Non Transactional' ? 'nontxn_leads'
    : clientType === 'Document' ? 'doc_leads' : '';

  const tot = (list: Row[]) => typeKey ? sum(list, typeKey) : sum(list, 'total_leads');
  const validOf = (list: Row[]) => {
    if (typeKey === 'nontxn_leads') return 0;
    if (typeKey === 'txn_leads') return sum(list, 'txn_leads');
    if (typeKey === 'doc_leads') return sum(list, 'doc_leads');
    return sum(list, 'txn_leads') + sum(list, 'doc_leads');
  };

  const total = tot(now);
  const invalid = typeKey ? 0 : sum(now, 'invalid');
  const unresp = typeKey ? 0 : sum(now, 'unresponsive');
  const valid = validOf(now);
  const txn = sum(now, 'txn_leads');
  const nontxn = sum(now, 'nontxn_leads');
  const doc = sum(now, 'doc_leads');
  const follow = sum(now, 'following_up');
  const won = sum(now, 'closed_won');
  const lostN = sum(now, 'closed_lost');
  const cold = sum(now, 'cold');
  const conv = valid ? (won / valid) * 100 : null;
  const sqft = sum(now, 'sqft_won');
  const est = sum(now, 'est_rev');
  const avgSq = won ? sqft / won : null;
  const avgPx = sqft ? est / sqft : null;

  const cmp = (cur: number, list: Row[], key: 'total' | 'valid' | 'won' | 'lost' | 'sqft' | 'est' | 'conv') => {
    const v = key === 'total' ? tot(list)
      : key === 'valid' ? validOf(list)
      : key === 'won' ? sum(list, 'closed_won')
      : key === 'lost' ? sum(list, 'closed_lost')
      : key === 'sqft' ? sum(list, 'sqft_won')
      : key === 'est' ? sum(list, 'est_rev')
      : (() => { const va = validOf(list); return va ? (sum(list, 'closed_won') / va) * 100 : 0; })();
    if (!list.length) return null;
    return pct(cur, v);
  };

  const trend: SeriesPoint[] = useMemo(() => {
    const byM = new Map<string, Row[]>();
    for (const r of pass(all)) {
      const k = monthKey(r.month);
      if (!k || !keys.includes(k)) continue;
      const arr = byM.get(k) ?? [];
      arr.push(r);
      byM.set(k, arr);
    }
    return [...keys].reverse().map(k => {
      const rs = byM.get(k) ?? [];
      const v = validOf(rs);
      const w = sum(rs, 'closed_won');
      return {
        key: k, label: monthLabel(k), rows: rs,
        values: {
          leads: tot(rs), valid: v, won: w, lost: sum(rs, 'closed_lost'),
          follow: sum(rs, 'following_up'), cold: sum(rs, 'cold'),
          conv: v ? (w / v) * 100 : 0,
          sqft: sum(rs, 'sqft_won'), rev: sum(rs, 'est_rev'),
          txn: sum(rs, 'txn_leads'), nontxn: sum(rs, 'nontxn_leads'), doc: sum(rs, 'doc_leads'),
        },
      };
    });
  }, [all, keys, city, clientType]);

  const cityRows = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of now) {
      const c = normCity(String(r.city ?? '').trim()) || '—';
      const arr = map.get(c) ?? [];
      arr.push(r);
      map.set(c, arr);
    }
    return [...map.entries()].sort((a, b) => tot(b[1]) - tot(a[1]));
  }, [now, clientType]);

  const lostMix = LOST.map(x => ({
    key: x.label, value: sum(now, x.key), count: 1, rows: now.filter(r => n(r, x.key) > 0),
  })).filter(d => d.value).sort((a, b) => b.value - a.value);

  if (!all.length) {
    return (
      <EmptyState icon="trending" title="No sales months yet"
        body="Open Records → New record. Enter one city-month of the sales report. The dashboard calculates valid leads, conversion, averages and lost-reason mix." />
    );
  }

  const h = 260;
  const money = formatINRCompact;
  const spark = (id: string) => trend.map(p => Number(p.values[id] ?? 0));

  return (
    <>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="filter-bar">
          <PeriodSelect id="b2b-sales-period" value={period} onChange={setPeriod} monthKeys={months} />
          <SelectField icon="filter" label="City" value={city} onChange={setCity} isOn={city !== 'All'}
            options={[{ value: 'All', label: 'All cities' }, ...cities.map(c => ({ value: c, label: c }))]} />
          <SelectField icon="users" label="Client type" value={clientType} onChange={setClientType} isOn={clientType !== 'All'}
            options={[
              { value: 'All', label: 'All client types' },
              { value: 'Transactional', label: 'Transactional' },
              { value: 'Non Transactional', label: 'Non-Transactional' },
              { value: 'Document', label: 'Document' },
            ]} />
          {(city !== 'All' || clientType !== 'All') && (
            <Button size="sm" variant="ghost" icon="close"
              onClick={() => { setCity('All'); setClientType('All'); }}>
              Reset
            </Button>
          )}
        </div>

        <div className="grid grid--kpi grid--kpi-std">
          <Tile icon="trending" lead label="Total leads" value={formatInt(total)} spark={spark('leads')}
            sub={<>{chip(cmp(total, prev, 'total'), momTag)} {chip(cmp(total, yoy, 'total'), 'YoY')}</>} />
          <Tile icon="users" label="Valid leads" value={formatInt(valid)} spark={spark('valid')}
            sub={<>{chip(cmp(valid, prev, 'valid'), momTag)} {valid && total ? `${formatPct((valid / total) * 100, 1)} of total` : null}</>} />
          <Tile icon="close" label="Invalid" value={formatInt(invalid)} />
          <Tile icon="alert" label="Unresponsive" value={formatInt(unresp)} />
          <Tile icon="box" label="Transactional" value={formatInt(txn)} spark={spark('txn')} />
          <Tile icon="box" label="Non-transactional" value={formatInt(nontxn)} spark={spark('nontxn')} />
          <Tile icon="box" label="Document" value={formatInt(doc)} spark={spark('doc')} />
          <Tile icon="clock" label="Following up" value={formatInt(follow)} spark={spark('follow')} />
          <Tile icon="check" label="Closed won" value={formatInt(won)} spark={spark('won')}
            sub={chip(cmp(won, prev, 'won'), momTag)} />
          <Tile icon="close" label="Closed lost" value={formatInt(lostN)} spark={spark('lost')}
            sub={chip(cmp(lostN, prev, 'lost'), momTag)} />
          <Tile icon="clock" label="Cold" value={formatInt(cold)} spark={spark('cold')} />
          <Tile icon="chart" label="Conversion" value={conv == null ? '—' : formatPct(conv, 1)} spark={spark('conv')}
            sub={chip(cmp(conv ?? 0, prev, 'conv'), momTag)} />
          <Tile icon="box" label="SQFT won" value={formatInt(sqft)} spark={spark('sqft')}
            sub={chip(cmp(sqft, prev, 'sqft'), momTag)} />
          <Tile icon="receipt" label="Est. monthly revenue" value={money(est)} spark={spark('rev')}
            sub={chip(cmp(est, prev, 'est'), momTag)} />
          <Tile icon="users" label="Avg SQFT / client" value={avgSq == null ? '—' : formatInt(avgSq)} />
          <Tile icon="receipt" label="Avg price / SQFT" value={avgPx == null ? '—' : formatINR(avgPx)} />
        </div>
      </section>

      <section className="section">
        <ChartsHeading />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
          <ChartFrame title="Lead generation" question="Are leads increasing or decreasing?" height={h}
            isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'leads', label: 'Total leads', kind: 'line', colorIndex: 0 },
                { id: 'txn', label: 'Transactional', kind: 'line', colorIndex: 2 },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Conversion" question="Are wins keeping pace with conversion?" height={h}
            isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt} legendStat="none"
              series={[
                { id: 'won', label: 'Closed won', kind: 'line', colorIndex: 0 },
                { id: 'conv', label: 'Conversion %', kind: 'line', colorIndex: 1, axis: 'right',
                  format: v => formatPct(v, 1) },
              ]} />}
          </ChartFrame>
          <ChartFrame title="Client type mix" question="What type of customers are we receiving?" height={h}
            isEmpty={!(txn + nontxn + doc)}>
            {hh => <CategoryChart height={hh} valueFormat={formatInt} colorIndex={0} data={[
              { key: 'Transactional', value: txn, count: 1, rows: [] },
              { key: 'Non-Transactional', value: nontxn, count: 1, rows: [] },
              { key: 'Document', value: doc, count: 1, rows: [] },
            ].filter(d => d.value)} />}
          </ChartFrame>
          <ChartFrame title="SQFT won" question="How much space are we converting?" height={h}
            isEmpty={!trend.some(p => p.values.sqft)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[{ id: 'sqft', label: 'SQFT won', kind: 'line', colorIndex: 2 }]} />}
          </ChartFrame>
          <ChartFrame title="Revenue potential" question="What revenue potential are we creating?" height={h}
            isEmpty={!trend.some(p => p.values.rev)}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={money}
              series={[{ id: 'rev', label: 'Est. monthly revenue', kind: 'area', colorIndex: 0 }]} />}
          </ChartFrame>
          <ChartFrame title="Leads by city" question="Which cities are generating leads?" height={h}
            isEmpty={!cityRows.length}>
            {hh => <CategoryChart height={hh} valueFormat={formatInt} colorIndex={0}
              data={cityRows.map(([c, rs]) => ({ key: c, value: tot(rs), count: rs.length, rows: rs }))} />}
          </ChartFrame>
          <ChartFrame title="Closed won by city" question="Which cities are converting?" height={h}
            isEmpty={!cityRows.some(([, rs]) => sum(rs, 'closed_won'))}>
            {hh => <CategoryChart height={hh} valueFormat={formatInt} colorIndex={2}
              data={cityRows.map(([c, rs]) => ({ key: c, value: sum(rs, 'closed_won'), count: rs.length, rows: rs })).filter(d => d.value)} />}
          </ChartFrame>
          <ChartFrame title="Lost reasons" question="Where are we losing business?" height={h}
            isEmpty={!lostMix.length}>
            {hh => <CategoryChart height={hh} valueFormat={formatInt} colorIndex={3} data={lostMix} />}
          </ChartFrame>
          <ChartFrame title="Conversion by city" question="What is the conversion rate by city?" height={h}
            isEmpty={!cityRows.length}>
            {hh => <CategoryChart height={hh} valueFormat={v => formatPct(v, 1)} colorIndex={1}
              data={cityRows.map(([c, rs]) => {
                const v = validOf(rs);
                return { key: c, value: v ? (sum(rs, 'closed_won') / v) * 100 : 0, count: rs.length, rows: rs };
              })} />}
          </ChartFrame>
          <ChartFrame title="Lost by city" question="Which cities have the highest lost business?" height={h}
            isEmpty={!cityRows.some(([, rs]) => sum(rs, 'closed_lost'))}>
            {hh => <CategoryChart height={hh} valueFormat={formatInt} colorIndex={3}
              data={cityRows.map(([c, rs]) => ({ key: c, value: sum(rs, 'closed_lost'), count: rs.length, rows: rs })).filter(d => d.value)} />}
          </ChartFrame>
          <ChartFrame title="Lead status" question="What happens after generation?" height={h}
            isEmpty={trend.length < 1}>
            {hh => <TrendChart height={hh} data={trend} valueFormat={formatInt}
              series={[
                { id: 'follow', label: 'Follow-up', kind: 'bar', colorIndex: 0 },
                { id: 'won', label: 'Won', kind: 'bar', colorIndex: 2 },
                { id: 'lost', label: 'Lost', kind: 'bar', colorIndex: 3 },
                { id: 'cold', label: 'Cold', kind: 'bar', colorIndex: 4 },
              ]} />}
          </ChartFrame>
        </div>
      </section>

      <section className="section">
        <h3 className="cef__sec" style={{ marginTop: 0 }}>City funnel</h3>
        <div className="card"><div className="card__bd">
          <table className="xpose">
            <thead>
              <tr>
                <th className="xpose__rowhd">City</th>
                <th className="is-num">Leads</th>
                <th className="is-num">Follow-up</th>
                <th className="is-num">Won</th>
                <th className="is-num">Lost</th>
                <th className="is-num">Cold</th>
                <th className="is-num">Conversion</th>
                <th className="is-num">SQFT won</th>
                <th className="is-num">Est. revenue</th>
              </tr>
            </thead>
            <tbody>
              {cityRows.map(([c, rs]) => {
                const v = validOf(rs);
                const w = sum(rs, 'closed_won');
                return (
                  <tr key={c}>
                    <th className="xpose__rowhd">{c}</th>
                    <td className="is-num">{formatInt(tot(rs))}</td>
                    <td className="is-num">{formatInt(sum(rs, 'following_up'))}</td>
                    <td className="is-num">{formatInt(w)}</td>
                    <td className="is-num">{formatInt(sum(rs, 'closed_lost'))}</td>
                    <td className="is-num">{formatInt(sum(rs, 'cold'))}</td>
                    <td className="is-num">{v ? formatPct((w / v) * 100, 1) : '—'}</td>
                    <td className="is-num">{formatInt(sum(rs, 'sqft_won'))}</td>
                    <td className="is-num">{formatINR(sum(rs, 'est_rev'))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      </section>

    </>
  );
}
