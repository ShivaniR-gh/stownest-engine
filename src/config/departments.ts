import type { DepartmentId } from './types';

export interface DepartmentDef {
  id: DepartmentId;
  label: string;
  /** Short line shown under the page title. */
  purpose: string;
  icon: string;
  /** Inactive departments keep their data and access records but accept no new
   *  dataset connections and disappear from navigation. */
  status?: 'Active' | 'Inactive';
  sortOrder?: number;
  /** Metric ids for the KPI row. Empty for runtime departments until the
   *  declarative metric engine lands. */
  metrics: string[];
  /** Appears in the sidebar WORKSPACE group. */
  inWorkspace: boolean;
}

const SEED: DepartmentDef[] = [
  {
    id: 'sales',
    label: 'Sales',
    purpose: 'Lead flow, qualification and conversion into paying customers.',
    icon: 'trending',
    metrics: ['sales.leads', 'sales.qualified', 'sales.conversions', 'sales.conv_rate', 'sales.cpl', 'sales.cac', 'sales.revenue'],
    inWorkspace: true,
  },
  {
    id: 'logistics',
    label: 'Logistics',
    purpose: 'Movement jobs, vendor allocation, cost and margin per job.',
    icon: 'truck',
    metrics: ['log.jobs', 'log.pending', 'log.in_progress', 'log.completed', 'log.delayed', 'log.revenue', 'log.vendor_cost', 'log.margin'],
    inWorkspace: true,
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    purpose: 'Space inventory, occupancy and storage movement across facilities.',
    icon: 'box',
    metrics: ['space.total', 'space.occupied', 'space.available', 'space.utilisation', 'space.inward', 'space.outward'],
    inWorkspace: true,
  },
  {
    id: 'operations',
    label: 'Operations',
    purpose: 'Day-to-day task execution, completion and delay management.',
    icon: 'checklist',
    metrics: ['ops.total', 'ops.pending', 'ops.in_progress', 'ops.completed', 'ops.delayed', 'ops.on_time_rate'],
    inWorkspace: true,
  },
  {
    id: 'control_tower',
    label: 'Control Tower',
    purpose: 'Live exceptions across every department that need a decision today.',
    icon: 'radar',
    metrics: ['ops.delayed', 'log.delayed', 'coll.overdue', 'ops.on_time_rate'],
    inWorkspace: true,
  },
  {
    id: 'collections',
    label: 'Collections',
    purpose: 'Receivables, ageing and recovery against issued invoices.',
    icon: 'receipt',
    metrics: ['coll.receivable', 'coll.collected', 'coll.outstanding', 'coll.overdue', 'coll.rate', 'coll.dso'],
    inWorkspace: true,
  },
  {
    id: 'finance',
    label: 'Finance',
    purpose: 'Revenue recognised, expenses booked and resulting profit.',
    icon: 'ledger',
    metrics: ['fin.revenue', 'fin.expenses', 'fin.collections', 'fin.outstanding', 'fin.profit', 'fin.margin'],
    inWorkspace: true,
  },
  {
    id: 'administration',
    label: 'Administration',
    purpose: 'Platform access, roles and audit trail.',
    icon: 'shield',
    metrics: [],
    inWorkspace: false,
  },
];

/** ---------------------------------------------------------------------------
 * Runtime department registry.
 *
 * SEED above is the fallback compiled into the bundle. After sign-in the app
 * fetches the live list from the `departments` tab and calls hydrate(), which
 * swaps it in place. DEPT_BY_ID and DEPARTMENTS stay synchronous so no page,
 * sidebar or guard needs to change — the same approach used for datasets.
 * ------------------------------------------------------------------------- */

export const SEED_DEPARTMENTS = SEED;

let registry: DepartmentDef[] = SEED;
let byId: Record<string, DepartmentDef> = Object.fromEntries(SEED.map(d => [d.id, d]));

export function hydrateDepartments(defs: DepartmentDef[]): void {
  if (!defs.length) return;
  registry = defs;
  byId = Object.fromEntries(defs.map(d => [d.id, d]));
}

/** Active departments only — what navigation and pickers should offer. */
export const DEPARTMENTS_ALL = (): DepartmentDef[] => registry;
export const activeDepartments = (): DepartmentDef[] =>
  registry.filter(d => (d.status ?? 'Active') === 'Active');

export const getDepartment = (id: string): DepartmentDef | undefined => byId[id];
export const departmentLabel = (id: string) => byId[id]?.label ?? id;
export const isKnownDepartment = (id: string) => Boolean(byId[id]);

/** Compatibility shims so existing call sites keep working unchanged. */
export const DEPT_BY_ID = new Proxy({} as Record<string, DepartmentDef>, {
  get: (_t, k: string) => byId[k],
  has: (_t, k: string) => k in byId,
  ownKeys: () => Reflect.ownKeys(byId),
  getOwnPropertyDescriptor: (_t, k: string) =>
    k in byId ? { value: byId[k], enumerable: true, configurable: true } : undefined,
});
