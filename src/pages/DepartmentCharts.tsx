import { useMemo } from 'react';
import type { DepartmentId, Row } from '@/config/types';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart, StackedBarChart } from '@/components/charts/CategoryChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { Pipeline } from '@/components/charts/Pipeline';
import { RankedList } from '@/components/charts/RankedList';
import { Heatmap } from '@/components/charts/Heatmap';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { ageingBuckets, crosstab, groupBy, timeSeries } from '@/lib/analytics/aggregate';
import { formatINRCompact, formatInt, formatPct, toNum } from '@/lib/format';
import type { Period } from '@/lib/analytics/period';

interface Ctx {
  rows: Record<string, Row[]>;
  period: Period;
  drill: (title: string, datasetId: string, rows: Row[]) => void;
}

/**
 * Per-department visualisations. Each chart is registered against the question
 * it answers; a chart that cannot be given a question does not belong on the
 * page and is not in this file.
 */
export function DepartmentCharts({ department, ctx }: { department: DepartmentId; ctx: Ctx }) {
  switch (department) {
    case 'sales': return <SalesCharts {...ctx} />;
    case 'logistics': return <LogisticsCharts {...ctx} />;
    case 'warehouse': return <WarehouseCharts {...ctx} />;
    case 'operations': return <OperationsCharts {...ctx} />;
    case 'control_tower': return <ControlTowerCharts {...ctx} />;
    case 'collections': return <CollectionsCharts {...ctx} />;
    case 'finance': return <FinanceCharts {...ctx} />;
    default: return null;
  }
}

/* --------------------------------- Sales --------------------------------- */
function SalesCharts({ rows, period, drill }: Ctx) {
  const leads = rows.leads ?? [];
  const trend = useMemo(() => timeSeries(leads, 'created_at', period, [
    { id: 'leads', agg: 'count' },
    { id: 'won', agg: 'count', filter: r => String(r.status) === 'Won' },
  ]), [leads, period]);

  const stages = useMemo(() => {
    const c = (...s: string[]) => leads.filter(r => s.includes(String(r.status)));
    return [
      { key: 'a', label: 'Leads', value: leads.length, rows: leads },
      { key: 'q', label: 'Qualified', value: c('Qualified', 'Opportunity', 'Won').length, rows: c('Qualified', 'Opportunity', 'Won') },
      { key: 'o', label: 'Opportunity', value: c('Opportunity', 'Won').length, rows: c('Opportunity', 'Won') },
      { key: 'w', label: 'Won', value: c('Won').length, rows: c('Won') },
    ];
  }, [leads]);

  const bySource = useMemo(() => groupBy(leads, 'source'), [leads]);
  const ownerWon = useMemo(
    () => groupBy(leads.filter(r => String(r.status) === 'Won'), 'owner', { agg: 'sum', measure: 'won_value' }),
    [leads]);
  const heat = useMemo(() => crosstab(leads, 'city', 'status'), [leads]);

  return (
    <>
      <div className="grid grid--split">
        <ChartFrame title="Lead flow and conversions" question="Is demand growing, and is more of it closing?"
          department="sales" isEmpty={!leads.length}>
          {h => <TrendChart height={h} data={trend} valueFormat={formatInt}
            series={[
              { id: 'leads', label: 'Leads', kind: 'area', colorIndex: 0 },
              { id: 'won', label: 'Won', kind: 'line', colorIndex: 1 },
            ]}
            onPointClick={p => drill(`Leads — ${p.label}`, 'leads', p.rows)} />}
        </ChartFrame>

        <ChartFrame title="Conversion funnel" question="At which stage is the pipeline leaking?"
          department="sales" isEmpty={!leads.length}>
          {() => <Pipeline stages={stages} onStageClick={s => drill(`Leads — ${s.label}`, 'leads', s.rows)} />}
        </ChartFrame>
      </div>

      <div className="grid grid--2" style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="Leads by source" question="Which channels bring volume?"
          department="sales" isEmpty={!bySource.length}>
          {h => <CategoryChart height={h} data={bySource} valueFormat={formatInt}
            onBarClick={d => drill(`Leads — ${d.key}`, 'leads', d.rows)} />}
        </ChartFrame>

        <ChartFrame title="Won value by owner" question="Who is actually closing business?"
          department="sales" isEmpty={!ownerWon.length}>
          {() => <RankedList items={ownerWon} valueFormat={formatINRCompact} metaLabel="deals won"
            onClick={i => drill(`Won by ${i.key}`, 'leads', i.rows)} />}
        </ChartFrame>
      </div>

      <div style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="City against lead status" question="Which markets stall and which convert?"
          department="sales" isEmpty={!leads.length} height={260}>
          {() => <Heatmap rowKeys={heat.rowKeys} colKeys={heat.colKeys} cells={heat.cells}
            rowLabel="City" valueFormat={formatInt}
            onCellClick={c => drill(`${c.rowKey} · ${c.colKey}`, 'leads', c.rows)} />}
        </ChartFrame>
      </div>
    </>
  );
}

/* ------------------------------- Logistics -------------------------------- */
function LogisticsCharts({ rows, period, drill }: Ctx) {
  const jobs = rows.jobs ?? [];
  const trend = useMemo(() => timeSeries(jobs, 'scheduled_at', period, [
    { id: 'revenue', agg: 'sum', measure: 'revenue' },
    { id: 'cost', agg: 'sum', measure: 'vendor_cost' },
  ]), [jobs, period]);

  const byVendor = useMemo(() => groupBy(jobs, 'vendor', { agg: 'sum', measure: 'revenue' }), [jobs]);
  const byStatus = useMemo(() => groupBy(jobs, 'status'), [jobs]);
  const scatter = useMemo(() => byVendor.map(v => ({
    x: v.rows.reduce((a, r) => a + (toNum(r.vendor_cost) ?? 0), 0),
    y: v.value, label: v.key, rows: v.rows,
  })), [byVendor]);

  return (
    <>
      <div className="grid grid--split">
        <ChartFrame title="Job revenue against vendor cost" question="Is the margin on movement work holding?"
          department="logistics" isEmpty={!jobs.length}>
          {h => <TrendChart height={h} data={trend} valueFormat={formatINRCompact}
            series={[
              { id: 'revenue', label: 'Revenue', kind: 'bar', colorIndex: 0 },
              { id: 'cost', label: 'Vendor cost', kind: 'line', colorIndex: 2 },
            ]}
            onPointClick={p => drill(`Jobs — ${p.label}`, 'jobs', p.rows)} />}
        </ChartFrame>

        <ChartFrame title="Job status mix" question="How much of the book is unallocated or stuck?"
          department="logistics" isEmpty={!byStatus.length}>
          {() => <DonutChart data={byStatus} centerLabel="Jobs" valueFormat={formatInt}
            onSliceClick={s => drill(`Jobs — ${s.key}`, 'jobs', s.rows)} />}
        </ChartFrame>
      </div>

      <div className="grid grid--2" style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="Revenue by vendor" question="Which partners are we most exposed to?"
          department="logistics" isEmpty={!byVendor.length}>
          {() => <RankedList items={byVendor} valueFormat={formatINRCompact} metaLabel="jobs"
            onClick={i => drill(`Jobs — ${i.key}`, 'jobs', i.rows)} />}
        </ChartFrame>

        <ChartFrame title="Vendor cost against revenue" question="Is any vendor priced out of line with the work they bring?"
          department="logistics" isEmpty={scatter.length < 2} height={260}>
          {h => <ScatterChart height={h} points={scatter} xLabel="Vendor cost" yLabel="Revenue"
            xFormat={formatINRCompact} yFormat={formatINRCompact}
            onPointClick={p => drill(`Jobs — ${p.label}`, 'jobs', p.rows)} />}
        </ChartFrame>
      </div>
    </>
  );
}

/* ------------------------------- Warehouse -------------------------------- */
function WarehouseCharts({ rows, period, drill }: Ctx) {
  const space = rows.space ?? [];
  const moves = rows.movements ?? [];

  const byFacility = useMemo(() => groupBy(space, 'facility', { agg: 'sum', measure: 'sqft' }), [space]);
  const statusMix = useMemo(() => groupBy(space, 'status', { agg: 'sum', measure: 'sqft' }), [space]);
  const flow = useMemo(() => timeSeries(moves, 'moved_at', period, [
    { id: 'in', agg: 'sum', measure: 'sqft', filter: r => String(r.direction) === 'Inward' },
    { id: 'out', agg: 'sum', measure: 'sqft', filter: r => String(r.direction) === 'Outward' },
  ]), [moves, period]);

  const utilByFacility = useMemo(() => byFacility.map(f => {
    const occ = f.rows.filter(r => String(r.status) === 'Occupied').reduce((a, r) => a + (toNum(r.sqft) ?? 0), 0);
    const lettable = f.rows.filter(r => String(r.status) !== 'Blocked').reduce((a, r) => a + (toNum(r.sqft) ?? 0), 0);
    return { key: f.key, value: lettable ? (occ / lettable) * 100 : 0, count: f.count, rows: f.rows };
  }), [byFacility]);

  return (
    <>
      <div className="grid grid--split">
        <ChartFrame title="Inward against outward" question="Is the warehouse filling or emptying?"
          department="warehouse" isEmpty={!moves.length}>
          {h => <TrendChart height={h} data={flow} valueFormat={formatInt}
            series={[
              { id: 'in', label: 'Inward sq ft', kind: 'bar', colorIndex: 1 },
              { id: 'out', label: 'Outward sq ft', kind: 'bar', colorIndex: 2 },
            ]}
            onPointClick={p => drill(`Movements — ${p.label}`, 'movements', p.rows)} />}
        </ChartFrame>

        <ChartFrame title="Space status" question="How much lettable area is idle right now?"
          department="warehouse" isEmpty={!statusMix.length}>
          {() => <DonutChart data={statusMix} centerLabel="Sq ft" valueFormat={formatInt}
            onSliceClick={s => drill(`Space — ${s.key}`, 'space', s.rows)} />}
        </ChartFrame>
      </div>

      <div className="grid grid--2" style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="Utilisation by facility" question="Which sites are underused?"
          department="warehouse" isEmpty={!utilByFacility.length}>
          {h => <CategoryChart height={h} data={utilByFacility} valueFormat={n => formatPct(n, 1)}
            onBarClick={d => drill(`Space — ${d.key}`, 'space', d.rows)} />}
        </ChartFrame>

        <ChartFrame title="Area by facility" question="Where is the floor area concentrated?"
          department="warehouse" isEmpty={!byFacility.length}>
          {() => <RankedList items={byFacility} valueFormat={formatInt} metaLabel="units"
            onClick={i => drill(`Space — ${i.key}`, 'space', i.rows)} />}
        </ChartFrame>
      </div>
    </>
  );
}

/* ------------------------------- Operations ------------------------------- */
function OperationsCharts({ rows, period, drill }: Ctx) {
  const tasks = rows.tasks ?? [];
  const trend = useMemo(() => timeSeries(tasks, 'due_at', period, [
    { id: 'completed', agg: 'count', filter: r => String(r.status) === 'Completed' },
    { id: 'delayed', agg: 'count', filter: r => String(r.status) === 'Delayed' },
  ]), [tasks, period]);

  const byAssignee = useMemo(() => groupBy(tasks, 'assignee'), [tasks]);
  const byCategory = useMemo(() => groupBy(tasks, 'category'), [tasks]);
  const heat = useMemo(() => crosstab(tasks, 'assignee', 'status'), [tasks]);

  return (
    <>
      <div className="grid grid--split">
        <ChartFrame title="Completed against delayed" question="Is execution keeping pace with what is due?"
          department="operations" isEmpty={!tasks.length}>
          {h => <TrendChart height={h} data={trend} valueFormat={formatInt}
            series={[
              { id: 'completed', label: 'Completed', kind: 'bar', colorIndex: 1 },
              { id: 'delayed', label: 'Delayed', kind: 'bar', colorIndex: 2 },
            ]}
            onPointClick={p => drill(`Tasks — ${p.label}`, 'tasks', p.rows)} />}
        </ChartFrame>

        <ChartFrame title="Tasks by category" question="What kind of work dominates the queue?"
          department="operations" isEmpty={!byCategory.length}>
          {() => <DonutChart data={byCategory} centerLabel="Tasks" valueFormat={formatInt}
            onSliceClick={s => drill(`Tasks — ${s.key}`, 'tasks', s.rows)} />}
        </ChartFrame>
      </div>

      <div className="grid grid--2" style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="Load by assignee" question="Is the work spread evenly across the team?"
          department="operations" isEmpty={!byAssignee.length}>
          {h => <CategoryChart height={h} data={byAssignee} valueFormat={formatInt}
            onBarClick={d => drill(`Tasks — ${d.key}`, 'tasks', d.rows)} />}
        </ChartFrame>

        <ChartFrame title="Assignee against status" question="Whose queue is slipping?"
          department="operations" isEmpty={!tasks.length}>
          {() => <Heatmap rowKeys={heat.rowKeys} colKeys={heat.colKeys} cells={heat.cells}
            rowLabel="Assignee" valueFormat={formatInt}
            onCellClick={c => drill(`${c.rowKey} · ${c.colKey}`, 'tasks', c.rows)} />}
        </ChartFrame>
      </div>
    </>
  );
}

/* ------------------------------ Control Tower ----------------------------- */
function ControlTowerCharts({ rows, drill }: Ctx) {
  const tasks = rows.tasks ?? [];
  const jobs = rows.jobs ?? [];
  const delayedTasks = tasks.filter(r => String(r.status) === 'Delayed');
  const delayedJobs = jobs.filter(r => String(r.status) === 'Delayed');

  const byCity = useMemo(() => groupBy([...delayedTasks, ...delayedJobs], 'city'), [delayedTasks, delayedJobs]);
  const reasons = useMemo(() => groupBy(delayedJobs.filter(r => r.delay_reason), 'delay_reason'), [delayedJobs]);

  return (
    <div className="grid grid--2">
      <ChartFrame title="Exceptions by city" question="Where should a manager be looking today?"
        department="control_tower" isEmpty={!byCity.length}
        emptyBody="Nothing is delayed in this period. That is the good outcome.">
        {h => <CategoryChart height={h} data={byCity} valueFormat={formatInt} colorIndex={2}
          onBarClick={d => drill(`Delayed — ${d.key}`, 'tasks', d.rows.filter(r => 'task_id' in r))} />}
      </ChartFrame>

      <ChartFrame title="Why jobs are delayed" question="Is this one systemic cause or many one-offs?"
        department="control_tower" isEmpty={!reasons.length}
        emptyBody="No delay reasons recorded against delayed jobs.">
        {() => <RankedList items={reasons} valueFormat={formatInt} metaLabel="jobs"
          onClick={i => drill(`Delayed — ${i.key}`, 'jobs', i.rows)} />}
      </ChartFrame>
    </div>
  );
}

/* ------------------------------- Collections ------------------------------ */
function CollectionsCharts({ rows, period, drill }: Ctx) {
  const inv = (rows.invoices ?? []).filter(r => String(r.payment_status) !== 'Void');

  const ageing = useMemo(() => ageingBuckets(inv, 'due_at', 'amount', 'amount_paid'), [inv]);
  const trend = useMemo(() => timeSeries(inv, 'issued_at', period, [
    { id: 'billed', agg: 'sum', measure: 'amount' },
    { id: 'received', agg: 'sum', measure: 'amount_paid' },
  ]), [inv, period]);
  const byCity = useMemo(() => groupBy(inv, 'city', { agg: 'sum', measure: 'amount' })
    .map(g => ({ ...g, value: g.rows.reduce((a, r) => a + ((toNum(r.amount) ?? 0) - (toNum(r.amount_paid) ?? 0)), 0) }))
    .sort((a, b) => b.value - a.value), [inv]);
  const statusMix = useMemo(() => groupBy(inv, 'payment_status', { agg: 'sum', measure: 'amount' }), [inv]);

  return (
    <>
      <div className="grid grid--split">
        <ChartFrame title="Receivables ageing" question="How old is the money we are owed?"
          department="collections" isEmpty={!ageing.some(b => b.value)}
          emptyBody="Nothing outstanding against invoices with a due date.">
          {h => <CategoryChart height={h} data={ageing} valueFormat={formatINRCompact} colorIndex={2}
            onBarClick={d => drill(`Outstanding — ${d.key}`, 'invoices', d.rows)} />}
        </ChartFrame>

        <ChartFrame title="Payment status" question="What share of billing is fully settled?"
          department="collections" isEmpty={!statusMix.length}>
          {() => <DonutChart data={statusMix} centerLabel="Billed" valueFormat={formatINRCompact}
            onSliceClick={s => drill(`Invoices — ${s.key}`, 'invoices', s.rows)} />}
        </ChartFrame>
      </div>

      <div className="grid grid--2" style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="Billed against received" question="Is collection keeping up with invoicing?"
          department="collections" isEmpty={!trend.length}>
          {h => <TrendChart height={h} data={trend} valueFormat={formatINRCompact}
            series={[
              { id: 'billed', label: 'Billed', kind: 'area', colorIndex: 0 },
              { id: 'received', label: 'Received', kind: 'line', colorIndex: 1 },
            ]}
            onPointClick={p => drill(`Invoices — ${p.label}`, 'invoices', p.rows)} />}
        </ChartFrame>

        <ChartFrame title="Outstanding by city" question="Which market needs a collections push?"
          department="collections" isEmpty={!byCity.length}>
          {() => <RankedList items={byCity} valueFormat={formatINRCompact} metaLabel="invoices"
            onClick={i => drill(`Outstanding — ${i.key}`, 'invoices', i.rows)} />}
        </ChartFrame>
      </div>
    </>
  );
}

/* --------------------------------- Finance -------------------------------- */
function FinanceCharts({ rows, period, drill }: Ctx) {
  const inv = (rows.invoices ?? []).filter(r => String(r.payment_status) !== 'Void');
  const exp = rows.expenses ?? [];

  const revenue = useMemo(() => timeSeries(inv, 'issued_at', period, [
    { id: 'revenue', agg: 'sum', measure: 'amount' },
  ]), [inv, period]);
  const expense = useMemo(() => timeSeries(exp, 'booked_at', period, [
    { id: 'expenses', agg: 'sum', measure: 'amount' },
  ]), [exp, period]);

  /* Revenue and expenses share a bucket axis so profit is readable as the gap. */
  const combined = useMemo(() => revenue.map((p, i) => ({
    key: p.key, label: p.label, rows: [...p.rows, ...(expense[i]?.rows ?? [])],
    values: { revenue: p.values.revenue, expenses: expense[i]?.values.expenses ?? 0 },
  })), [revenue, expense]);

  const byCategory = useMemo(() => groupBy(exp, 'category', { agg: 'sum', measure: 'amount' }), [exp]);
  const byDept = useMemo(() => groupBy(exp, 'department', { agg: 'sum', measure: 'amount' }), [exp]);
  const revLine = useMemo(() => timeSeries(inv, 'issued_at', period,
    [...new Set(inv.map(r => String(r.revenue_line ?? 'Unspecified')))].map(l => ({
      id: l, agg: 'sum' as const, measure: 'amount', filter: (r: Row) => String(r.revenue_line ?? 'Unspecified') === l,
    }))), [inv, period]);
  const revLineKeys = useMemo(() => [...new Set(inv.map(r => String(r.revenue_line ?? 'Unspecified')))], [inv]);

  return (
    <>
      <div className="grid grid--split">
        <ChartFrame title="Revenue against expenses" question="Is the gap between earning and spending widening?"
          department="finance" isEmpty={!combined.length}>
          {h => <TrendChart height={h} data={combined} valueFormat={formatINRCompact}
            series={[
              { id: 'revenue', label: 'Revenue', kind: 'bar', colorIndex: 0 },
              { id: 'expenses', label: 'Expenses', kind: 'line', colorIndex: 3 },
            ]}
            onPointClick={p => drill(`Records — ${p.label}`, 'invoices', p.rows.filter(r => 'invoice_id' in r))} />}
        </ChartFrame>

        <ChartFrame title="Expense categories" question="What are we actually spending on?"
          department="finance" isEmpty={!byCategory.length}>
          {() => <DonutChart data={byCategory} centerLabel="Spend" valueFormat={formatINRCompact}
            onSliceClick={s => drill(`Expenses — ${s.key}`, 'expenses', s.rows)} />}
        </ChartFrame>
      </div>

      <div className="grid grid--2" style={{ marginTop: 'var(--s4)' }}>
        <ChartFrame title="Revenue composition over time" question="Is the revenue mix shifting between lines?"
          department="finance" isEmpty={!revLineKeys.length}>
          {h => <StackedBarChart height={h} data={revLine} keys={revLineKeys}
            labels={Object.fromEntries(revLineKeys.map(k => [k, k]))}
            valueFormat={formatINRCompact}
            onBarClick={d => drill(`Invoices — ${d.label}`, 'invoices', d.rows)} />}
        </ChartFrame>

        <ChartFrame title="Spend by department" question="Which function is consuming the budget?"
          department="finance" isEmpty={!byDept.length}>
          {() => <RankedList items={byDept} valueFormat={formatINRCompact} metaLabel="entries"
            onClick={i => drill(`Expenses — ${i.key}`, 'expenses', i.rows)} />}
        </ChartFrame>
      </div>
    </>
  );
}
