import type { MetricDef, MetricCtx, Row } from './types';

/* ------------------------------ helpers ------------------------------- */
const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = parseFloat(v.replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const sum = (rows: Row[], key: string) => rows.reduce((a, r) => a + num(r[key]), 0);
const sumWhere = (rows: Row[], key: string, pred: (r: Row) => boolean) =>
  rows.reduce((a, r) => (pred(r) ? a + num(r[key]) : a), 0);
const countWhere = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred).length;
const eq = (k: string, ...vals: string[]) => (r: Row) =>
  vals.some(v => String(r[k] ?? '').trim().toLowerCase() === v.toLowerCase());
const notEq = (k: string, ...vals: string[]) => (r: Row) => !eq(k, ...vals)(r);
const ratio = (a: number, b: number) => (b === 0 ? null : (a / b) * 100);

/** Every metric goes through this so a missing column can never silently
 *  become a zero that looks like a real business number. */
const guard = (ctx: MetricCtx, dataset: string, cols: string[], fn: () => number | null): number | null =>
  cols.every(c => ctx.mapped(dataset, c)) ? fn() : null;

/* ------------------------------ registry ------------------------------ */
export const METRICS: MetricDef[] = [
  /* ================================ SALES ============================== */
  {
    id: 'sales.leads', label: 'Leads', department: 'sales', dataset: 'leads',
    requires: ['lead_id'], format: 'int', goodDirection: 'up',
    formula: 'COUNT(leads) WHERE created_at IN period',
    definition: 'Every enquiry captured in the period, regardless of quality.',
    compute: ctx => guard(ctx, 'leads', ['lead_id'], () => ctx.rows.length),
    drillTo: { dataset: 'leads' },
  },
  {
    id: 'sales.qualified', label: 'Qualified leads', department: 'sales', dataset: 'leads',
    requires: ['status'], format: 'int', goodDirection: 'up',
    formula: "COUNT(leads) WHERE status IN ('Qualified','Opportunity','Won')",
    definition: 'Leads that passed qualification and entered the pipeline.',
    compute: ctx => guard(ctx, 'leads', ['status'], () =>
      countWhere(ctx.rows, eq('status', 'Qualified', 'Opportunity', 'Won'))),
    drillTo: { dataset: 'leads', filter: { status: 'Qualified' } },
  },
  {
    id: 'sales.conversions', label: 'Conversions', department: 'sales', dataset: 'leads',
    requires: ['status'], format: 'int', goodDirection: 'up',
    formula: "COUNT(leads) WHERE status = 'Won'",
    definition: 'Leads that became paying customers in the period.',
    compute: ctx => guard(ctx, 'leads', ['status'], () => countWhere(ctx.rows, eq('status', 'Won'))),
    drillTo: { dataset: 'leads', filter: { status: 'Won' } },
  },
  {
    id: 'sales.conv_rate', label: 'Conversion rate', department: 'sales', dataset: 'leads',
    requires: ['status'], format: 'pct', goodDirection: 'up',
    formula: "COUNT(status = 'Won') ÷ COUNT(leads) × 100",
    definition: 'Share of all leads in the period that closed as won.',
    compute: ctx => guard(ctx, 'leads', ['status'], () =>
      ratio(countWhere(ctx.rows, eq('status', 'Won')), ctx.rows.length)),
  },
  {
    id: 'sales.cpl', label: 'Cost per lead', department: 'sales', dataset: 'leads',
    requires: ['lead_id'], requiresDatasets: ['expenses'],
    requiresFrom: { expenses: ['amount', 'is_marketing_spend'] },
    format: 'inr', goodDirection: 'down',
    formula: 'SUM(expenses.amount WHERE is_marketing_spend) ÷ COUNT(leads)',
    definition: 'Marketing spend divided by leads generated. Needs a spend feed.',
    compute: ctx => {
      // is_marketing_spend is unmapped today, so this correctly reports unavailable.
      if (!ctx.mapped('expenses', 'is_marketing_spend') || !ctx.mapped('expenses', 'amount')) return null;
      const spend = sumWhere(ctx.related.expenses ?? [], 'amount', r => Boolean(r.is_marketing_spend));
      return ctx.rows.length === 0 ? null : spend / ctx.rows.length;
    },
  },
  {
    id: 'sales.cac', label: 'CAC', department: 'sales', dataset: 'leads',
    requires: ['status'], requiresDatasets: ['expenses'],
    requiresFrom: { expenses: ['amount', 'is_marketing_spend'] },
    format: 'inr', goodDirection: 'down',
    formula: "SUM(expenses.amount WHERE is_marketing_spend) ÷ COUNT(leads WHERE status = 'Won')",
    definition: 'Marketing spend divided by customers acquired. Needs a spend feed.',
    compute: ctx => {
      if (!ctx.mapped('expenses', 'is_marketing_spend') || !ctx.mapped('expenses', 'amount')) return null;
      const spend = sumWhere(ctx.related.expenses ?? [], 'amount', r => Boolean(r.is_marketing_spend));
      const won = countWhere(ctx.rows, eq('status', 'Won'));
      return won === 0 ? null : spend / won;
    },
  },
  {
    id: 'sales.revenue', label: 'Won value', department: 'sales', dataset: 'leads',
    requires: ['won_value', 'status'], format: 'inr_compact', goodDirection: 'up',
    formula: "SUM(leads.won_value) WHERE status = 'Won'",
    definition: 'Contracted value of deals won. Recognised revenue lives in Finance.',
    compute: ctx => guard(ctx, 'leads', ['won_value', 'status'], () =>
      sumWhere(ctx.rows, 'won_value', eq('status', 'Won'))),
  },

  /* ============================== LOGISTICS ============================ */
  {
    id: 'log.jobs', label: 'Total jobs', department: 'logistics', dataset: 'jobs',
    requires: ['job_id'], format: 'int', goodDirection: 'up',
    formula: 'COUNT(jobs) WHERE scheduled_at IN period',
    definition: 'All movement jobs scheduled in the period.',
    compute: ctx => guard(ctx, 'jobs', ['job_id'], () => ctx.rows.length),
    drillTo: { dataset: 'jobs' },
  },
  {
    id: 'log.pending', label: 'Pending', department: 'logistics', dataset: 'jobs',
    requires: ['status'], format: 'int', goodDirection: 'down',
    formula: "COUNT(jobs) WHERE status = 'Pending'",
    definition: 'Jobs with no vendor or crew allocated yet.',
    compute: ctx => guard(ctx, 'jobs', ['status'], () => countWhere(ctx.rows, eq('status', 'Pending'))),
    drillTo: { dataset: 'jobs', filter: { status: 'Pending' } },
  },
  {
    id: 'log.in_progress', label: 'In progress', department: 'logistics', dataset: 'jobs',
    requires: ['status'], format: 'int', goodDirection: 'neutral',
    formula: "COUNT(jobs) WHERE status IN ('Assigned','In Progress')",
    definition: 'Jobs allocated and currently running.',
    compute: ctx => guard(ctx, 'jobs', ['status'], () => countWhere(ctx.rows, eq('status', 'Assigned', 'In Progress'))),
    drillTo: { dataset: 'jobs', filter: { status: 'In Progress' } },
  },
  {
    id: 'log.completed', label: 'Completed', department: 'logistics', dataset: 'jobs',
    requires: ['status'], format: 'int', goodDirection: 'up',
    formula: "COUNT(jobs) WHERE status = 'Completed'",
    definition: 'Jobs closed out in the period.',
    compute: ctx => guard(ctx, 'jobs', ['status'], () => countWhere(ctx.rows, eq('status', 'Completed'))),
    drillTo: { dataset: 'jobs', filter: { status: 'Completed' } },
  },
  {
    id: 'log.delayed', label: 'Delayed', department: 'logistics', dataset: 'jobs',
    requires: ['status'], format: 'int', goodDirection: 'down',
    formula: "COUNT(jobs) WHERE status = 'Delayed'",
    definition: 'Jobs past their scheduled date and not yet completed.',
    compute: ctx => guard(ctx, 'jobs', ['status'], () => countWhere(ctx.rows, eq('status', 'Delayed'))),
    drillTo: { dataset: 'jobs', filter: { status: 'Delayed' } },
  },
  {
    id: 'log.revenue', label: 'Logistics revenue', department: 'logistics', dataset: 'jobs',
    requires: ['revenue'], format: 'inr_compact', goodDirection: 'up',
    formula: "SUM(jobs.revenue) WHERE status ≠ 'Cancelled'",
    definition: 'Value billed for movement jobs in the period.',
    compute: ctx => guard(ctx, 'jobs', ['revenue'], () => sumWhere(ctx.rows, 'revenue', notEq('status', 'Cancelled'))),
    drillTo: { dataset: 'jobs' },
  },
  {
    id: 'log.vendor_cost', label: 'Vendor cost', department: 'logistics', dataset: 'jobs',
    requires: ['vendor_cost'], format: 'inr_compact', goodDirection: 'down',
    formula: "SUM(jobs.vendor_cost) WHERE status ≠ 'Cancelled'",
    definition: 'Amount payable to third-party movers for these jobs.',
    compute: ctx => guard(ctx, 'jobs', ['vendor_cost'], () => sumWhere(ctx.rows, 'vendor_cost', notEq('status', 'Cancelled'))),
  },
  {
    id: 'log.margin', label: 'Logistics margin', department: 'logistics', dataset: 'jobs',
    requires: ['revenue', 'vendor_cost', 'other_cost'], format: 'pct', goodDirection: 'up',
    formula: '(SUM(revenue) − SUM(vendor_cost) − SUM(other_cost)) ÷ SUM(revenue) × 100',
    definition: 'Gross margin on movement work after direct job costs.',
    compute: ctx => guard(ctx, 'jobs', ['revenue', 'vendor_cost', 'other_cost'], () => {
      const live = ctx.rows.filter(notEq('status', 'Cancelled'));
      const rev = sum(live, 'revenue');
      return ratio(rev - sum(live, 'vendor_cost') - sum(live, 'other_cost'), rev);
    }),
  },

  /* ============================== WAREHOUSE ============================ */
  {
    id: 'space.total', label: 'Total space', department: 'warehouse', dataset: 'space',
    requires: ['sqft'], format: 'int', unit: 'sq ft', goodDirection: 'neutral',
    formula: "SUM(space.sqft) WHERE status ≠ 'Blocked'",
    definition: 'Lettable floor area across all facilities.',
    compute: ctx => guard(ctx, 'space', ['sqft'], () => sumWhere(ctx.rows, 'sqft', notEq('status', 'Blocked'))),
  },
  {
    id: 'space.occupied', label: 'Occupied', department: 'warehouse', dataset: 'space',
    requires: ['sqft', 'status'], format: 'int', unit: 'sq ft', goodDirection: 'up',
    formula: "SUM(space.sqft) WHERE status = 'Occupied'",
    definition: 'Area currently let to customers.',
    compute: ctx => guard(ctx, 'space', ['sqft', 'status'], () => sumWhere(ctx.rows, 'sqft', eq('status', 'Occupied'))),
    drillTo: { dataset: 'space', filter: { status: 'Occupied' } },
  },
  {
    id: 'space.available', label: 'Available', department: 'warehouse', dataset: 'space',
    requires: ['sqft', 'status'], format: 'int', unit: 'sq ft', goodDirection: 'neutral',
    formula: "SUM(space.sqft) WHERE status = 'Vacant'",
    definition: 'Area ready to let today.',
    compute: ctx => guard(ctx, 'space', ['sqft', 'status'], () => sumWhere(ctx.rows, 'sqft', eq('status', 'Vacant'))),
    drillTo: { dataset: 'space', filter: { status: 'Vacant' } },
  },
  {
    id: 'space.utilisation', label: 'Utilisation', department: 'warehouse', dataset: 'space',
    requires: ['sqft', 'status'], format: 'pct', goodDirection: 'up',
    formula: "SUM(sqft WHERE status = 'Occupied') ÷ SUM(sqft WHERE status ≠ 'Blocked') × 100",
    definition: 'Share of lettable area that is earning rent.',
    compute: ctx => guard(ctx, 'space', ['sqft', 'status'], () =>
      ratio(sumWhere(ctx.rows, 'sqft', eq('status', 'Occupied')), sumWhere(ctx.rows, 'sqft', notEq('status', 'Blocked')))),
  },
  {
    id: 'space.inward', label: 'Inward', department: 'warehouse', dataset: 'movements',
    requires: ['sqft', 'direction'], format: 'int', unit: 'sq ft', goodDirection: 'up',
    formula: "SUM(movements.sqft) WHERE direction = 'Inward'",
    definition: 'Area taken up by new storage in the period.',
    compute: ctx => guard(ctx, 'movements', ['sqft', 'direction'], () => sumWhere(ctx.rows, 'sqft', eq('direction', 'Inward'))),
    drillTo: { dataset: 'movements', filter: { direction: 'Inward' } },
  },
  {
    id: 'space.outward', label: 'Outward', department: 'warehouse', dataset: 'movements',
    requires: ['sqft', 'direction'], format: 'int', unit: 'sq ft', goodDirection: 'down',
    formula: "SUM(movements.sqft) WHERE direction = 'Outward'",
    definition: 'Area released by customers moving out.',
    compute: ctx => guard(ctx, 'movements', ['sqft', 'direction'], () => sumWhere(ctx.rows, 'sqft', eq('direction', 'Outward'))),
    drillTo: { dataset: 'movements', filter: { direction: 'Outward' } },
  },

  /* ============================== OPERATIONS =========================== */
  {
    id: 'ops.total', label: 'Total tasks', department: 'operations', dataset: 'tasks',
    requires: ['task_id'], format: 'int', goodDirection: 'neutral',
    formula: 'COUNT(tasks) WHERE due_at IN period',
    definition: 'Everything due in the period across all cities.',
    compute: ctx => guard(ctx, 'tasks', ['task_id'], () => ctx.rows.length),
    drillTo: { dataset: 'tasks' },
  },
  {
    id: 'ops.pending', label: 'Pending', department: 'operations', dataset: 'tasks',
    requires: ['status'], format: 'int', goodDirection: 'down',
    formula: "COUNT(tasks) WHERE status = 'Pending'",
    definition: 'Not started yet.',
    compute: ctx => guard(ctx, 'tasks', ['status'], () => countWhere(ctx.rows, eq('status', 'Pending'))),
    drillTo: { dataset: 'tasks', filter: { status: 'Pending' } },
  },
  {
    id: 'ops.in_progress', label: 'In progress', department: 'operations', dataset: 'tasks',
    requires: ['status'], format: 'int', goodDirection: 'neutral',
    formula: "COUNT(tasks) WHERE status = 'In Progress'",
    definition: 'Actively being worked.',
    compute: ctx => guard(ctx, 'tasks', ['status'], () => countWhere(ctx.rows, eq('status', 'In Progress'))),
    drillTo: { dataset: 'tasks', filter: { status: 'In Progress' } },
  },
  {
    id: 'ops.completed', label: 'Completed', department: 'operations', dataset: 'tasks',
    requires: ['status'], format: 'int', goodDirection: 'up',
    formula: "COUNT(tasks) WHERE status = 'Completed'",
    definition: 'Closed out in the period.',
    compute: ctx => guard(ctx, 'tasks', ['status'], () => countWhere(ctx.rows, eq('status', 'Completed'))),
    drillTo: { dataset: 'tasks', filter: { status: 'Completed' } },
  },
  {
    id: 'ops.delayed', label: 'Delayed', department: 'operations', dataset: 'tasks',
    requires: ['status'], format: 'int', goodDirection: 'down',
    formula: "COUNT(tasks) WHERE status = 'Delayed'",
    definition: 'Past due and still open. These need a decision today.',
    compute: ctx => guard(ctx, 'tasks', ['status'], () => countWhere(ctx.rows, eq('status', 'Delayed'))),
    drillTo: { dataset: 'tasks', filter: { status: 'Delayed' } },
  },
  {
    id: 'ops.on_time_rate', label: 'On-time rate', department: 'operations', dataset: 'tasks',
    requires: ['status'], format: 'pct', goodDirection: 'up',
    formula: "COUNT(status = 'Completed') ÷ COUNT(status IN ('Completed','Delayed')) × 100",
    definition: 'Of everything that reached an end state, the share that landed on time.',
    compute: ctx => guard(ctx, 'tasks', ['status'], () => {
      const done = countWhere(ctx.rows, eq('status', 'Completed'));
      const late = countWhere(ctx.rows, eq('status', 'Delayed'));
      return ratio(done, done + late);
    }),
  },

  /* ============================= COLLECTIONS =========================== */
  {
    id: 'coll.receivable', label: 'Total receivable', department: 'collections', dataset: 'invoices',
    requires: ['amount', 'payment_status'], format: 'inr_compact', goodDirection: 'neutral',
    formula: "SUM(invoices.amount) WHERE payment_status ≠ 'Void'",
    definition: 'Everything billed in the period. Not cash.',
    compute: ctx => guard(ctx, 'invoices', ['amount', 'payment_status'], () =>
      sumWhere(ctx.rows, 'amount', notEq('payment_status', 'Void'))),
  },
  {
    id: 'coll.collected', label: 'Collected', department: 'collections', dataset: 'invoices',
    requires: ['amount_paid', 'payment_status'], format: 'inr_compact', goodDirection: 'up',
    formula: "SUM(invoices.amount_paid) WHERE payment_status ≠ 'Void'",
    definition: 'Cash actually received against those invoices.',
    compute: ctx => guard(ctx, 'invoices', ['amount_paid', 'payment_status'], () =>
      sumWhere(ctx.rows, 'amount_paid', notEq('payment_status', 'Void'))),
  },
  {
    id: 'coll.outstanding', label: 'Outstanding', department: 'collections', dataset: 'invoices',
    requires: ['amount', 'amount_paid', 'payment_status'], format: 'inr_compact', goodDirection: 'down',
    formula: "SUM(amount − amount_paid) WHERE payment_status ≠ 'Void'",
    definition: 'Billed but not yet received.',
    compute: ctx => guard(ctx, 'invoices', ['amount', 'amount_paid', 'payment_status'], () => {
      const live = ctx.rows.filter(notEq('payment_status', 'Void'));
      return sum(live, 'amount') - sum(live, 'amount_paid');
    }),
    drillTo: { dataset: 'invoices', filter: { payment_status: 'Unpaid' } },
  },
  {
    id: 'coll.overdue', label: 'Overdue', department: 'collections', dataset: 'invoices',
    requires: ['amount', 'amount_paid', 'payment_status'], format: 'inr_compact', goodDirection: 'down',
    formula: "SUM(amount − amount_paid) WHERE payment_status = 'Overdue'",
    definition: 'Past the due date and unrecovered.',
    compute: ctx => guard(ctx, 'invoices', ['amount', 'amount_paid', 'payment_status'], () => {
      const od = ctx.rows.filter(eq('payment_status', 'Overdue'));
      return sum(od, 'amount') - sum(od, 'amount_paid');
    }),
    drillTo: { dataset: 'invoices', filter: { payment_status: 'Overdue' } },
  },
  {
    id: 'coll.rate', label: 'Collection rate', department: 'collections', dataset: 'invoices',
    requires: ['amount', 'amount_paid', 'payment_status'], format: 'pct', goodDirection: 'up',
    formula: 'SUM(amount_paid) ÷ SUM(amount) × 100',
    definition: 'Share of billed value recovered as cash.',
    compute: ctx => guard(ctx, 'invoices', ['amount', 'amount_paid', 'payment_status'], () => {
      const live = ctx.rows.filter(notEq('payment_status', 'Void'));
      return ratio(sum(live, 'amount_paid'), sum(live, 'amount'));
    }),
  },
  {
    id: 'coll.dso', label: 'Avg days to pay', department: 'collections', dataset: 'invoices',
    requires: ['issued_at', 'paid_at'], format: 'days', goodDirection: 'down',
    formula: 'AVG(paid_at − issued_at) WHERE paid_at IS NOT NULL',
    definition: 'How long a paid invoice takes to convert into cash.',
    compute: ctx => guard(ctx, 'invoices', ['issued_at', 'paid_at'], () => {
      const spans = ctx.rows
        .map(r => {
          const a = Date.parse(String(r.issued_at)), b = Date.parse(String(r.paid_at));
          return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 86400000 : null;
        })
        .filter((n): n is number => n !== null && n >= 0);
      return spans.length ? spans.reduce((x, y) => x + y, 0) / spans.length : null;
    }),
  },

  /* =============================== FINANCE ============================= */
  {
    id: 'fin.revenue', label: 'Revenue', department: 'finance', dataset: 'invoices',
    requires: ['amount', 'payment_status'], format: 'inr_compact', goodDirection: 'up',
    formula: "SUM(invoices.amount) WHERE payment_status ≠ 'Void'",
    definition: 'Value invoiced in the period. Revenue is not cash and not profit.',
    compute: ctx => guard(ctx, 'invoices', ['amount', 'payment_status'], () =>
      sumWhere(ctx.rows, 'amount', notEq('payment_status', 'Void'))),
    drillTo: { dataset: 'invoices' },
  },
  {
    id: 'fin.collections', label: 'Collections', department: 'finance', dataset: 'invoices',
    requires: ['amount_paid', 'payment_status'], format: 'inr_compact', goodDirection: 'up',
    formula: "SUM(invoices.amount_paid) WHERE payment_status ≠ 'Void'",
    definition: 'Cash received in the period. Separate from revenue by design.',
    compute: ctx => guard(ctx, 'invoices', ['amount_paid', 'payment_status'], () =>
      sumWhere(ctx.rows, 'amount_paid', notEq('payment_status', 'Void'))),
  },
  {
    id: 'fin.outstanding', label: 'Outstanding', department: 'finance', dataset: 'invoices',
    requires: ['amount', 'amount_paid', 'payment_status'], format: 'inr_compact', goodDirection: 'down',
    formula: 'SUM(amount) − SUM(amount_paid)',
    definition: 'Revenue recognised that has not yet turned into cash.',
    compute: ctx => guard(ctx, 'invoices', ['amount', 'amount_paid', 'payment_status'], () => {
      const live = ctx.rows.filter(notEq('payment_status', 'Void'));
      return sum(live, 'amount') - sum(live, 'amount_paid');
    }),
  },
  {
    id: 'fin.expenses', label: 'Expenses', department: 'finance', dataset: 'expenses',
    requires: ['amount'], format: 'inr_compact', goodDirection: 'down',
    formula: 'SUM(expenses.amount) WHERE booked_at IN period',
    definition: 'Everything booked as cost in the period.',
    compute: ctx => guard(ctx, 'expenses', ['amount'], () => sum(ctx.rows, 'amount')),
    drillTo: { dataset: 'expenses' },
  },
  {
    id: 'fin.profit', label: 'Profit', department: 'finance', dataset: 'invoices',
    requires: ['amount', 'payment_status'], requiresDatasets: ['expenses'],
    requiresFrom: { expenses: ['amount'] },
    format: 'inr_compact', goodDirection: 'up',
    formula: 'SUM(invoices.amount) − SUM(expenses.amount)',
    definition: 'Revenue less booked expenses. Accrual basis, not cash basis.',
    compute: ctx => {
      if (!ctx.mapped('invoices', 'amount') || !ctx.mapped('expenses', 'amount')) return null;
      const rev = sumWhere(ctx.rows, 'amount', notEq('payment_status', 'Void'));
      return rev - sum(ctx.related.expenses ?? [], 'amount');
    },
  },
  {
    id: 'fin.margin', label: 'Net margin', department: 'finance', dataset: 'invoices',
    requires: ['amount', 'payment_status'], requiresDatasets: ['expenses'],
    requiresFrom: { expenses: ['amount'] },
    format: 'pct', goodDirection: 'up',
    formula: '(SUM(invoices.amount) − SUM(expenses.amount)) ÷ SUM(invoices.amount) × 100',
    definition: 'Profit as a share of revenue.',
    compute: ctx => {
      if (!ctx.mapped('invoices', 'amount') || !ctx.mapped('expenses', 'amount')) return null;
      const rev = sumWhere(ctx.rows, 'amount', notEq('payment_status', 'Void'));
      return ratio(rev - sum(ctx.related.expenses ?? [], 'amount'), rev);
    },
  },

  /* ============================== CUSTOMER ============================= */
  {
    id: 'cust.total', label: 'Total customers', department: 'business', dataset: 'customers',
    requires: ['customer_id'], format: 'int', goodDirection: 'up',
    formula: 'COUNT(customers) — all time, ignores period filter',
    definition: 'Every customer ever onboarded.',
    compute: ctx => guard(ctx, 'customers', ['customer_id'], () => ctx.rows.length),
    drillTo: { dataset: 'customers' },
  },
  {
    id: 'cust.active', label: 'Active customers', department: 'business', dataset: 'customers',
    requires: ['status'], format: 'int', goodDirection: 'up',
    formula: "COUNT(customers) WHERE status = 'Active'",
    definition: 'Customers currently storing with us or under contract.',
    compute: ctx => guard(ctx, 'customers', ['status'], () => countWhere(ctx.rows, eq('status', 'Active'))),
    drillTo: { dataset: 'customers', filter: { status: 'Active' } },
  },
  {
    id: 'cust.new', label: 'New customers', department: 'business', dataset: 'customers',
    requires: ['onboarded_at'], format: 'int', goodDirection: 'up',
    formula: 'COUNT(customers) WHERE onboarded_at IN period',
    definition: 'First-time customers added in the period.',
    compute: ctx => guard(ctx, 'customers', ['onboarded_at'], () => ctx.rows.length),
  },
  {
    id: 'cust.arpu', label: 'ARPU', department: 'business', dataset: 'customers',
    requires: ['monthly_rent', 'status'], format: 'inr', goodDirection: 'up',
    formula: "SUM(monthly_rent WHERE status = 'Active') ÷ COUNT(status = 'Active')",
    definition: 'Average monthly rent per active customer.',
    compute: ctx => guard(ctx, 'customers', ['monthly_rent', 'status'], () => {
      const active = ctx.rows.filter(eq('status', 'Active'));
      return active.length ? sum(active, 'monthly_rent') / active.length : null;
    }),
  },
  {
    id: 'cust.churn', label: 'Churn', department: 'business', dataset: 'customers',
    requires: ['status', 'churned_at'], format: 'int', goodDirection: 'down',
    formula: 'COUNT(customers) WHERE churned_at IN period',
    definition: 'Customers who ended their contract in the period.',
    compute: ctx => guard(ctx, 'customers', ['status', 'churned_at'], () =>
      countWhere(ctx.rows, r => Boolean(r.churned_at))),
    drillTo: { dataset: 'customers', filter: { status: 'Churned' } },
  },
  {
    id: 'cust.retention', label: 'Retention', department: 'business', dataset: 'customers',
    requires: ['status'], format: 'pct', goodDirection: 'up',
    formula: "COUNT(status = 'Active') ÷ COUNT(customers) × 100",
    definition: 'Share of all customers still active.',
    compute: ctx => guard(ctx, 'customers', ['status'], () =>
      ratio(countWhere(ctx.rows, eq('status', 'Active')), ctx.rows.length)),
  },
];

export const METRIC_BY_ID = Object.fromEntries(METRICS.map(m => [m.id, m])) as Record<string, MetricDef>;
export const getMetric = (id: string) => METRIC_BY_ID[id];
export { num as toNumber, sum as sumBy, countWhere, eq as whereEq };
