import type { Row } from '@/config/types';
import type { DataAdapter, FetchResult } from './adapter';

/** ---------------------------------------------------------------------------
 * DEMO ADAPTER — synthetic rows, deterministic, in-memory only.
 *
 * This exists so the interface can be reviewed before the spreadsheet is wired
 * up. When it is active the app shows a permanent banner on every screen. It is
 * never a fallback: if the Sheets adapter fails, the app shows an error, it
 * does not quietly substitute invented numbers.
 * ------------------------------------------------------------------------- */

let seed = 20260821;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));

const CITIES = ['Bengaluru', 'Hyderabad', 'Chennai', 'Pune', 'Mumbai', 'Delhi NCR', 'Kolkata', 'Coimbatore'] as const;
const SOURCES = ['Google Ads', 'Meta Ads', 'Organic', 'Referral', 'Walk-in', 'Justdial'] as const;
const SERVICES = ['Household Storage', 'Business Storage', 'Intra-city Transport', 'Packing & Moving'] as const;
const OWNERS = ['A. Nair', 'R. Kulkarni', 'S. Iyer', 'M. Fernandes', 'T. Bhatt'] as const;
const VENDORS = ['Sunrise Movers', 'Bharat Cargo', 'Metro Shift', 'Velocity Logistics', 'Anand Transport'] as const;
const FACILITIES = ['Bommasandra W1', 'Whitefield W2', 'Medchal H1', 'Ambattur C1', 'Chakan P1'] as const;
const REVLINES = ['Storage rent', 'Moving', 'Packing material', 'Handling'] as const;
const EXPCATS = ['Rent & utilities', 'Vendor payouts', 'Salaries', 'Marketing', 'Fuel', 'Packing material', 'Maintenance'] as const;

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const pad = (p: string, i: number) => `${p}-${String(1000 + i)}`;

function build(): Record<string, Row[]> {
  seed = 20260821;
  const HORIZON = 400;

  const leads: Row[] = Array.from({ length: 720 }, (_, i) => {
    const age = between(0, HORIZON);
    const st = pick(['New', 'Qualified', 'Opportunity', 'Won', 'Lost', 'Won', 'Lost', 'Qualified'] as const);
    const quoted = between(6, 90) * 1000;
    return {
      __id: pad('LD', i), __row: i + 2,
      lead_id: pad('LD', i), created_at: daysAgo(age),
      customer_name: `${pick(['Aarav', 'Divya', 'Rohan', 'Meera', 'Karthik', 'Sneha', 'Vikram', 'Ananya'])} ${pick(['Sharma', 'Reddy', 'Menon', 'Patel', 'Rao', 'Joshi', 'Das'])}`,
      phone: `+9198${between(10000000, 99999999)}`, email: `lead${i}@example.com`,
      city: pick(CITIES), source: pick(SOURCES), service: pick(SERVICES), status: st, owner: pick(OWNERS),
      quoted_value: quoted, won_value: st === 'Won' ? quoted : '',
      closed_at: st === 'Won' || st === 'Lost' ? daysAgo(Math.max(0, age - between(1, 14))) : '',
      notes: '',
    };
  });

  const customers: Row[] = Array.from({ length: 296 }, (_, i) => {
    const age = between(5, HORIZON);
    const churned = rnd() < 0.14;
    return {
      __id: pad('CU', i), __row: i + 2,
      customer_id: pad('CU', i),
      name: `${pick(['Aarav', 'Divya', 'Rohan', 'Meera', 'Karthik', 'Sneha'])} ${pick(['Sharma', 'Reddy', 'Menon', 'Patel', 'Rao'])}`,
      phone: `+9198${between(10000000, 99999999)}`, city: pick(CITIES),
      category: pick(['Household', 'Business', 'SME', 'Enterprise'] as const),
      status: churned ? 'Churned' : rnd() < 0.05 ? 'On Hold' : 'Active',
      onboarded_at: daysAgo(age), churned_at: churned ? daysAgo(between(0, age)) : '',
      monthly_rent: between(3, 42) * 1000, sqft: between(40, 900), facility: pick(FACILITIES),
    };
  });

  const jobs: Row[] = Array.from({ length: 540 }, (_, i) => {
    const age = between(0, HORIZON);
    const st = pick(['Pending', 'Assigned', 'In Progress', 'Completed', 'Completed', 'Completed', 'Delayed', 'Cancelled'] as const);
    const rev = between(8, 120) * 1000;
    return {
      __id: pad('JB', i), __row: i + 2,
      job_id: pad('JB', i), scheduled_at: daysAgo(age),
      completed_at: st === 'Completed' ? daysAgo(Math.max(0, age - between(0, 3))) : '',
      customer_name: `${pick(['Aarav', 'Divya', 'Rohan', 'Meera'])} ${pick(['Sharma', 'Reddy', 'Menon'])}`,
      job_type: pick(['Pickup', 'Delivery', 'Inter-city Move', 'Intra-city Move', 'Warehouse Transfer'] as const),
      city: pick(CITIES), status: st, vendor: pick(VENDORS), crew_lead: pick(OWNERS),
      revenue: rev, vendor_cost: Math.round(rev * (0.5 + rnd() * 0.22)), other_cost: between(400, 6000),
      delay_reason: st === 'Delayed' ? pick(['Vehicle breakdown', 'Customer unavailable', 'Access denied', 'Crew shortage']) : '',
    };
  });

  const vendors: Row[] = VENDORS.map((v, i) => ({
    __id: pad('VN', i), __row: i + 2,
    vendor_id: pad('VN', i), name: v, city: pick(CITIES), contact: `+9180${between(10000000, 99999999)}`,
    status: i === 4 ? 'On Hold' : 'Active', rate_card: between(9, 30) * 1000,
  }));

  const space: Row[] = Array.from({ length: 420 }, (_, i) => {
    const st = pick(['Occupied', 'Occupied', 'Occupied', 'Vacant', 'Vacant', 'Blocked', 'Maintenance'] as const);
    const sqft = between(40, 600);
    return {
      __id: pad('UN', i), __row: i + 2,
      unit_id: pad('UN', i), facility: pick(FACILITIES), city: pick(CITIES),
      unit_type: pick(['Palletised', 'Caged', 'Open floor', 'Mezzanine'] as const),
      sqft, status: st,
      customer_name: st === 'Occupied' ? `${pick(['Aarav', 'Divya', 'Rohan'])} ${pick(['Sharma', 'Reddy'])}` : '',
      monthly_rent: st === 'Occupied' ? Math.round(sqft * between(28, 46)) : '',
      occupied_since: st === 'Occupied' ? daysAgo(between(10, HORIZON)) : '',
    };
  });

  const movements: Row[] = Array.from({ length: 380 }, (_, i) => ({
    __id: pad('MV', i), __row: i + 2,
    movement_id: pad('MV', i), moved_at: daysAgo(between(0, HORIZON)),
    direction: rnd() < 0.56 ? 'Inward' : 'Outward',
    facility: pick(FACILITIES), customer_name: `${pick(['Aarav', 'Meera', 'Karthik'])} ${pick(['Sharma', 'Rao'])}`,
    sqft: between(30, 480), unit_id: pad('UN', between(0, 419)),
  }));

  const tasks: Row[] = Array.from({ length: 460 }, (_, i) => {
    const st = pick(['Pending', 'In Progress', 'Completed', 'Completed', 'Completed', 'Delayed', 'Cancelled'] as const);
    const age = between(0, HORIZON);
    return {
      __id: pad('TK', i), __row: i + 2,
      task_id: pad('TK', i),
      title: `${pick(['Verify inventory at', 'Schedule pickup for', 'Reconcile handover at', 'Quality audit at', 'Customer callback for'])} ${pick(FACILITIES)}`,
      category: pick(['Inventory', 'Customer', 'Compliance', 'Facility', 'Billing'] as const),
      due_at: daysAgo(age), completed_at: st === 'Completed' ? daysAgo(Math.max(0, age - 1)) : '',
      status: st, assignee: pick(OWNERS), city: pick(CITIES), priority: pick(['Low', 'Medium', 'High'] as const),
    };
  });

  const invoices: Row[] = Array.from({ length: 880 }, (_, i) => {
    const age = between(0, HORIZON);
    const amount = between(5, 180) * 1000;
    const st = pick(['Paid', 'Paid', 'Paid', 'Paid', 'Partially Paid', 'Unpaid', 'Overdue', 'Void'] as const);
    const paid = st === 'Paid' ? amount : st === 'Partially Paid' ? Math.round(amount * (0.2 + rnd() * 0.6)) : 0;
    return {
      __id: pad('IN', i), __row: i + 2,
      invoice_id: pad('IN', i), issued_at: daysAgo(age), due_at: daysAgo(Math.max(0, age - 30)),
      customer_name: `${pick(['Aarav', 'Divya', 'Rohan', 'Meera', 'Karthik'])} ${pick(['Sharma', 'Reddy', 'Menon', 'Patel'])}`,
      city: pick(CITIES), revenue_line: pick(REVLINES),
      amount, amount_paid: paid, payment_status: st,
      paid_at: paid > 0 ? daysAgo(Math.max(0, age - between(2, 45))) : '',
      mode: pick(['UPI', 'NEFT', 'Cashfree', 'Cash', 'Cheque'] as const),
    };
  });

  const expenses: Row[] = Array.from({ length: 620 }, (_, i) => ({
    __id: pad('EX', i), __row: i + 2,
    expense_id: pad('EX', i), booked_at: daysAgo(between(0, HORIZON)),
    description: `${pick(EXPCATS)} — ${pick(CITIES)}`,
    category: pick(EXPCATS), department: pick(['Sales', 'Logistics', 'Warehouse', 'Operations', 'Finance'] as const),
    city: pick(CITIES), amount: between(2, 140) * 1000,
  }));

  const access_control: Row[] = [
    { __id: 'demo.super@stownest.com', __row: 2, email: 'demo.super@stownest.com', name: 'Demo Super Admin', role: 'super_admin', departments: '', grants: '', status: 'Active' },
    { __id: 'demo.sales@stownest.com', __row: 3, email: 'demo.sales@stownest.com', name: 'Demo Sales Admin', role: 'department_admin', departments: 'sales', grants: '', status: 'Active' },
    { __id: 'demo.fin@stownest.com', __row: 4, email: 'demo.fin@stownest.com', name: 'Demo Finance Admin', role: 'department_admin', departments: 'finance,collections', grants: '', status: 'Active' },
    { __id: 'demo.ops@stownest.com', __row: 5, email: 'demo.ops@stownest.com', name: 'Demo Ops Employee', role: 'employee', departments: 'operations,logistics', grants: 'EXPORT', status: 'Active' },
  ];

  return { leads, customers, jobs, vendors, space, movements, tasks, invoices, expenses, access_control };
}

const DB = build();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export class DemoAdapter implements DataAdapter {
  readonly kind = 'demo' as const;

  async list(datasetId: string): Promise<FetchResult> {
    await wait(120 + Math.random() * 260);
    return { rows: (DB[datasetId] ?? []).map(r => ({ ...r })), fetchedAt: Date.now() };
  }
  async create(datasetId: string, values: Row): Promise<Row> {
    await wait(220);
    const list = (DB[datasetId] ??= []);
    const row: Row = { ...values, __id: `NEW-${Date.now()}`, __row: list.length + 2 };
    list.unshift(row);
    return row;
  }
  async update(datasetId: string, id: string, values: Row): Promise<Row> {
    await wait(220);
    const list = DB[datasetId] ?? [];
    const i = list.findIndex(r => r.__id === id);
    if (i < 0) throw new Error('Record not found');
    list[i] = { ...list[i], ...values };
    return list[i];
  }
  async remove(datasetId: string, id: string): Promise<void> {
    await wait(200);
    DB[datasetId] = (DB[datasetId] ?? []).filter(r => r.__id !== id);
  }
}
