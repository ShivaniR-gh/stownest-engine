import type { DatasetDef } from './types';

/** ---------------------------------------------------------------------------
 * SHEET MAPPING.
 * `sheetColumn` is the exact header text in the Google Sheet tab. This file is
 * the ONLY place that knows about sheet headers — rename a header in Sheets and
 * you change one line here.
 *
 * A column with no `sheetColumn` is treated as unmapped: it is hidden from
 * tables and every metric that requires it renders "Data unavailable" naming
 * the missing column. Nothing is ever estimated to fill a gap.
 * ------------------------------------------------------------------------- */

const STATUS_TONE = {
  Completed: 'pos', Closed: 'pos', Won: 'pos', Paid: 'pos', Active: 'pos', Delivered: 'pos',
  Delayed: 'signal', Overdue: 'signal', 'On Hold': 'signal', 'Partially Paid': 'signal',
  Cancelled: 'neg', Lost: 'neg', Churned: 'neg', Void: 'neg',
  Pending: 'idle', New: 'idle', Draft: 'idle', Unpaid: 'idle', Vacant: 'idle',
  Assigned: 'accent', 'In Progress': 'accent', Qualified: 'accent', Occupied: 'accent',
} as const;

export const DATASETS: DatasetDef[] = [
  /* ------------------------------- SALES ------------------------------- */
  {
    id: 'leads',
    label: 'Leads',
    noun: 'lead',
    department: 'sales',
    sheetName: 'leads',
    idColumn: 'lead_id',
    dateColumn: 'created_at',
    statusColumn: 'status',
    titleColumn: 'customer_name',
    subtitleColumns: ['city', 'source'],
    auditable: true,
    defaultSort: { key: 'created_at', dir: 'desc' },
    columns: [
      { key: 'lead_id', header: 'Lead ID', type: 'id', sheetColumn: 'Lead ID', width: 110, sortable: true },
      { key: 'created_at', header: 'Created', type: 'date', sheetColumn: 'Created At', width: 100, sortable: true, filterable: true },
      { key: 'customer_name', header: 'Customer', type: 'text', sheetColumn: 'Customer Name', width: 180, sortable: true, editable: true, required: true },
      { key: 'phone', header: 'Phone', type: 'phone', sheetColumn: 'Phone', width: 130, editable: true },
      { key: 'email', header: 'Email', type: 'email', sheetColumn: 'Email', width: 200, editable: true, hiddenByDefault: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 120, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'source', header: 'Source', type: 'enum', sheetColumn: 'Source', width: 130, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'service', header: 'Service', type: 'enum', sheetColumn: 'Service', width: 150, filterable: true, groupable: true, editable: true },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 120,
        enumValues: ['New', 'Qualified', 'Opportunity', 'Won', 'Lost'],
        tone: { New: 'idle', Qualified: 'accent', Opportunity: 'accent', Won: 'pos', Lost: 'neg' },
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'owner', header: 'Owner', type: 'enum', sheetColumn: 'Owner', width: 140, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'quoted_value', header: 'Quoted', type: 'currency', sheetColumn: 'Quoted Value', width: 110, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'won_value', header: 'Won value', type: 'currency', sheetColumn: 'Won Value', width: 110, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'closed_at', header: 'Closed', type: 'date', sheetColumn: 'Closed At', width: 100, sortable: true, editable: true },
      { key: 'notes', header: 'Notes', type: 'longtext', sheetColumn: 'Notes', editable: true, hiddenByDefault: true },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    noun: 'customer',
    department: 'sales',
    sheetName: 'customers',
    idColumn: 'customer_id',
    dateColumn: 'onboarded_at',
    statusColumn: 'status',
    titleColumn: 'name',
    subtitleColumns: ['city', 'category'],
    auditable: true,
    defaultSort: { key: 'onboarded_at', dir: 'desc' },
    columns: [
      { key: 'customer_id', header: 'Customer ID', type: 'id', sheetColumn: 'Customer ID', width: 120, sortable: true },
      { key: 'name', header: 'Name', type: 'text', sheetColumn: 'Name', width: 190, sortable: true, editable: true, required: true },
      { key: 'phone', header: 'Phone', type: 'phone', sheetColumn: 'Phone', width: 130, editable: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 120, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'category', header: 'Category', type: 'enum', sheetColumn: 'Category', width: 130, filterable: true, groupable: true, editable: true },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 110,
        enumValues: ['Active', 'Churned', 'On Hold'],
        tone: { Active: 'pos', Churned: 'neg', 'On Hold': 'signal' },
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'onboarded_at', header: 'Onboarded', type: 'date', sheetColumn: 'Onboarded At', width: 105, sortable: true, filterable: true },
      { key: 'churned_at', header: 'Churned', type: 'date', sheetColumn: 'Churned At', width: 100, sortable: true, editable: true },
      { key: 'monthly_rent', header: 'Monthly rent', type: 'currency', sheetColumn: 'Monthly Rent', width: 120, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'sqft', header: 'Sq ft', type: 'number', sheetColumn: 'Sq Ft', width: 85, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'facility', header: 'Facility', type: 'enum', sheetColumn: 'Facility', width: 140, filterable: true, groupable: true, editable: true },
    ],
  },

  /* ----------------------------- LOGISTICS ----------------------------- */
  {
    id: 'jobs',
    label: 'Jobs',
    noun: 'job',
    department: 'logistics',
    sheetName: 'jobs',
    idColumn: 'job_id',
    dateColumn: 'scheduled_at',
    statusColumn: 'status',
    titleColumn: 'job_id',
    subtitleColumns: ['customer_name', 'city'],
    auditable: true,
    defaultSort: { key: 'scheduled_at', dir: 'desc' },
    columns: [
      { key: 'job_id', header: 'Job ID', type: 'id', sheetColumn: 'Job ID', width: 110, sortable: true },
      { key: 'scheduled_at', header: 'Scheduled', type: 'date', sheetColumn: 'Scheduled At', width: 105, sortable: true, filterable: true },
      { key: 'completed_at', header: 'Completed', type: 'date', sheetColumn: 'Completed At', width: 105, sortable: true, editable: true },
      { key: 'customer_name', header: 'Customer', type: 'text', sheetColumn: 'Customer Name', width: 170, sortable: true, editable: true, required: true },
      { key: 'job_type', header: 'Type', type: 'enum', sheetColumn: 'Job Type', width: 140, filterable: true, groupable: true, editable: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 115, filterable: true, groupable: true, sortable: true, editable: true },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 120,
        enumValues: ['Pending', 'Assigned', 'In Progress', 'Completed', 'Delayed', 'Cancelled'],
        tone: STATUS_TONE as never,
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'vendor', header: 'Vendor', type: 'enum', sheetColumn: 'Vendor', width: 150, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'crew_lead', header: 'Crew lead', type: 'enum', sheetColumn: 'Crew Lead', width: 140, filterable: true, groupable: true, editable: true },
      { key: 'revenue', header: 'Revenue', type: 'currency', sheetColumn: 'Revenue', width: 110, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'vendor_cost', header: 'Vendor cost', type: 'currency', sheetColumn: 'Vendor Cost', width: 115, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'other_cost', header: 'Other cost', type: 'currency', sheetColumn: 'Other Cost', width: 110, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'delay_reason', header: 'Delay reason', type: 'text', sheetColumn: 'Delay Reason', width: 180, editable: true, hiddenByDefault: true },
    ],
  },
  {
    id: 'vendors',
    label: 'Vendors',
    noun: 'vendor',
    department: 'logistics',
    sheetName: 'vendors',
    idColumn: 'vendor_id',
    statusColumn: 'status',
    titleColumn: 'name',
    subtitleColumns: ['city'],
    auditable: true,
    columns: [
      { key: 'vendor_id', header: 'Vendor ID', type: 'id', sheetColumn: 'Vendor ID', width: 110, sortable: true },
      { key: 'name', header: 'Name', type: 'text', sheetColumn: 'Name', width: 190, sortable: true, editable: true, required: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 120, filterable: true, groupable: true, editable: true },
      { key: 'contact', header: 'Contact', type: 'phone', sheetColumn: 'Contact', width: 130, editable: true },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 110,
        enumValues: ['Active', 'On Hold', 'Inactive'],
        tone: { Active: 'pos', 'On Hold': 'signal', Inactive: 'idle' },
        filterable: true, editable: true,
      },
      { key: 'rate_card', header: 'Rate card', type: 'currency', sheetColumn: 'Rate Card', width: 110, sortable: true, editable: true },
    ],
  },

  /* ----------------------------- WAREHOUSE ----------------------------- */
  {
    id: 'space',
    label: 'Space inventory',
    noun: 'unit',
    department: 'warehouse',
    sheetName: 'space',
    idColumn: 'unit_id',
    statusColumn: 'status',
    titleColumn: 'unit_id',
    subtitleColumns: ['facility', 'unit_type'],
    auditable: true,
    defaultSort: { key: 'facility', dir: 'asc' },
    columns: [
      { key: 'unit_id', header: 'Unit', type: 'id', sheetColumn: 'Unit ID', width: 100, sortable: true },
      { key: 'facility', header: 'Facility', type: 'enum', sheetColumn: 'Facility', width: 160, filterable: true, groupable: true, sortable: true, editable: true, required: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 115, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'unit_type', header: 'Type', type: 'enum', sheetColumn: 'Unit Type', width: 130, filterable: true, groupable: true, editable: true },
      { key: 'sqft', header: 'Sq ft', type: 'number', sheetColumn: 'Sq Ft', width: 85, sortable: true, editable: true, aggregate: 'sum' },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 110,
        enumValues: ['Occupied', 'Vacant', 'Blocked', 'Maintenance'],
        tone: { Occupied: 'accent', Vacant: 'idle', Blocked: 'signal', Maintenance: 'signal' },
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'customer_name', header: 'Occupied by', type: 'text', sheetColumn: 'Customer Name', width: 170, editable: true },
      { key: 'monthly_rent', header: 'Monthly rent', type: 'currency', sheetColumn: 'Monthly Rent', width: 120, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'occupied_since', header: 'Since', type: 'date', sheetColumn: 'Occupied Since', width: 100, sortable: true, editable: true },
    ],
  },
  {
    id: 'movements',
    label: 'Storage movement',
    noun: 'movement',
    department: 'warehouse',
    sheetName: 'movements',
    idColumn: 'movement_id',
    dateColumn: 'moved_at',
    statusColumn: 'direction',
    titleColumn: 'movement_id',
    subtitleColumns: ['facility', 'direction'],
    auditable: true,
    defaultSort: { key: 'moved_at', dir: 'desc' },
    columns: [
      { key: 'movement_id', header: 'Movement', type: 'id', sheetColumn: 'Movement ID', width: 120, sortable: true },
      { key: 'moved_at', header: 'Date', type: 'date', sheetColumn: 'Moved At', width: 100, sortable: true, filterable: true },
      {
        key: 'direction', header: 'Direction', type: 'enum', sheetColumn: 'Direction', width: 110,
        enumValues: ['Inward', 'Outward'],
        tone: { Inward: 'pos', Outward: 'signal' },
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'facility', header: 'Facility', type: 'enum', sheetColumn: 'Facility', width: 160, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'customer_name', header: 'Customer', type: 'text', sheetColumn: 'Customer Name', width: 170, editable: true },
      { key: 'sqft', header: 'Sq ft', type: 'number', sheetColumn: 'Sq Ft', width: 85, sortable: true, editable: true, aggregate: 'sum' },
      { key: 'unit_id', header: 'Unit', type: 'text', sheetColumn: 'Unit ID', width: 100, editable: true },
    ],
  },

  /* ----------------------------- OPERATIONS ---------------------------- */
  {
    id: 'tasks',
    label: 'Operations tasks',
    noun: 'task',
    department: 'operations',
    sheetName: 'tasks',
    idColumn: 'task_id',
    dateColumn: 'due_at',
    statusColumn: 'status',
    titleColumn: 'title',
    subtitleColumns: ['assignee', 'city'],
    auditable: true,
    defaultSort: { key: 'due_at', dir: 'asc' },
    columns: [
      { key: 'task_id', header: 'Task', type: 'id', sheetColumn: 'Task ID', width: 105, sortable: true },
      { key: 'title', header: 'Task', type: 'text', sheetColumn: 'Title', width: 240, sortable: true, editable: true, required: true },
      { key: 'category', header: 'Category', type: 'enum', sheetColumn: 'Category', width: 140, filterable: true, groupable: true, editable: true },
      { key: 'due_at', header: 'Due', type: 'date', sheetColumn: 'Due At', width: 100, sortable: true, filterable: true, editable: true },
      { key: 'completed_at', header: 'Completed', type: 'date', sheetColumn: 'Completed At', width: 105, sortable: true, editable: true },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 120,
        enumValues: ['Pending', 'In Progress', 'Completed', 'Delayed', 'Cancelled'],
        tone: STATUS_TONE as never,
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'assignee', header: 'Assignee', type: 'enum', sheetColumn: 'Assignee', width: 150, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 115, filterable: true, groupable: true, editable: true },
      { key: 'priority', header: 'Priority', type: 'enum', sheetColumn: 'Priority', width: 100,
        enumValues: ['Low', 'Medium', 'High'], tone: { High: 'signal', Medium: 'idle', Low: 'idle' },
        filterable: true, groupable: true, editable: true },
    ],
  },

  /* ------------------------ FINANCE / COLLECTIONS ---------------------- */
  {
    id: 'invoices',
    label: 'Invoices',
    noun: 'invoice',
    department: 'finance',
    sheetName: 'invoices',
    idColumn: 'invoice_id',
    dateColumn: 'issued_at',
    statusColumn: 'payment_status',
    titleColumn: 'invoice_id',
    subtitleColumns: ['customer_name', 'payment_status'],
    auditable: true,
    defaultSort: { key: 'issued_at', dir: 'desc' },
    columns: [
      { key: 'invoice_id', header: 'Invoice', type: 'id', sheetColumn: 'Invoice ID', width: 120, sortable: true },
      { key: 'issued_at', header: 'Issued', type: 'date', sheetColumn: 'Issued At', width: 100, sortable: true, filterable: true },
      { key: 'due_at', header: 'Due', type: 'date', sheetColumn: 'Due At', width: 100, sortable: true },
      { key: 'customer_name', header: 'Customer', type: 'text', sheetColumn: 'Customer Name', width: 180, sortable: true, editable: true, required: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 115, filterable: true, groupable: true, editable: true },
      { key: 'revenue_line', header: 'Revenue line', type: 'enum', sheetColumn: 'Revenue Line', width: 150, filterable: true, groupable: true, editable: true,
        help: 'Storage vs moving vs packing. Drives the revenue mix chart.' },
      { key: 'amount', header: 'Invoiced', type: 'currency', sheetColumn: 'Amount', width: 115, sortable: true, editable: true, aggregate: 'sum',
        help: 'Gross invoiced value. This is revenue, not cash.' },
      { key: 'amount_paid', header: 'Received', type: 'currency', sheetColumn: 'Amount Paid', width: 115, sortable: true, editable: true, aggregate: 'sum',
        help: 'Cash actually received against this invoice. This is collections.' },
      {
        key: 'payment_status', header: 'Payment', type: 'enum', sheetColumn: 'Payment Status', width: 130,
        enumValues: ['Paid', 'Partially Paid', 'Unpaid', 'Overdue', 'Void'],
        tone: { Paid: 'pos', 'Partially Paid': 'signal', Unpaid: 'idle', Overdue: 'signal', Void: 'neg' },
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'paid_at', header: 'Paid on', type: 'date', sheetColumn: 'Paid At', width: 100, sortable: true, editable: true },
      { key: 'mode', header: 'Mode', type: 'enum', sheetColumn: 'Payment Mode', width: 110, filterable: true, groupable: true, editable: true, hiddenByDefault: true },
    ],
  },
  {
    id: 'expenses',
    label: 'Expenses',
    noun: 'expense',
    department: 'finance',
    sheetName: 'expenses',
    idColumn: 'expense_id',
    dateColumn: 'booked_at',
    statusColumn: 'category',
    titleColumn: 'description',
    subtitleColumns: ['category', 'department'],
    auditable: true,
    defaultSort: { key: 'booked_at', dir: 'desc' },
    columns: [
      { key: 'expense_id', header: 'Expense', type: 'id', sheetColumn: 'Expense ID', width: 115, sortable: true },
      { key: 'booked_at', header: 'Booked', type: 'date', sheetColumn: 'Booked At', width: 100, sortable: true, filterable: true },
      { key: 'description', header: 'Description', type: 'text', sheetColumn: 'Description', width: 240, sortable: true, editable: true, required: true },
      { key: 'category', header: 'Category', type: 'enum', sheetColumn: 'Category', width: 150, filterable: true, groupable: true, sortable: true, editable: true, required: true },
      { key: 'department', header: 'Department', type: 'enum', sheetColumn: 'Department', width: 140, filterable: true, groupable: true, sortable: true, editable: true },
      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City', width: 115, filterable: true, groupable: true, editable: true },
      { key: 'amount', header: 'Amount', type: 'currency', sheetColumn: 'Amount', width: 115, sortable: true, editable: true, aggregate: 'sum' },
      // Marketing spend is what CPL and CAC need. Until a real spend feed exists,
      // this stays unmapped and both metrics correctly report themselves unavailable.
      { key: 'is_marketing_spend', header: 'Marketing spend', type: 'boolean', /* sheetColumn: 'Is Marketing Spend' */ width: 130, filterable: true },
    ],
  },

  /* --------------------------- ADMINISTRATION -------------------------- */
  {
    id: 'access_control',
    label: 'Users & access',
    noun: 'user',
    department: 'administration',
    sheetName: 'access_control',
    idColumn: 'email',
    statusColumn: 'status',
    titleColumn: 'name',
    subtitleColumns: ['email', 'role'],
    auditable: true,
    columns: [
      { key: 'email', header: 'Email', type: 'email', sheetColumn: 'Email', width: 230, sortable: true, required: true },
      { key: 'name', header: 'Name', type: 'text', sheetColumn: 'Name', width: 170, sortable: true, editable: true, required: true },
      {
        key: 'role', header: 'Role', type: 'enum', sheetColumn: 'Role', width: 160,
        enumValues: ['super_admin', 'department_admin', 'employee'],
        tone: { super_admin: 'accent', department_admin: 'idle', employee: 'idle' },
        filterable: true, groupable: true, sortable: true, editable: true, required: true,
      },
      { key: 'departments', header: 'Departments', type: 'text', sheetColumn: 'Departments', width: 240, editable: true,
        help: 'Comma-separated department ids. Ignored for super_admin.' },
      { key: 'grants', header: 'Extra grants', type: 'text', sheetColumn: 'Grants', width: 180, editable: true,
        help: 'Comma-separated actions granted beyond the role default, e.g. DELETE,EXPORT.' },
      {
        key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status', width: 110,
        enumValues: ['Active', 'Suspended'], tone: { Active: 'pos', Suspended: 'neg' },
        filterable: true, sortable: true, editable: true, required: true,
      },
    ],
  },
];

/** ---------------------------------------------------------------------------
 * Runtime registry.
 *
 * DATASETS above is the SEED: defaults compiled into the bundle. At sign-in the
 * app fetches the live registry (assembled from the data_sources and
 * field_mappings tabs) and calls hydrate(), which swaps these in place.
 *
 * getDataset() deliberately stays SYNCHRONOUS. Every page, table, form and chart
 * already reads schema through it, so hydrating a module-level map means the
 * whole UI becomes configuration-driven without a single one of them changing.
 * ------------------------------------------------------------------------- */

let registry: DatasetDef[] = DATASETS;
let byId: Record<string, DatasetDef> = Object.fromEntries(DATASETS.map(d => [d.id, d]));
const listeners = new Set<() => void>();

export function hydrateDatasets(defs: DatasetDef[]): void {
  if (!defs.length) return;
  registry = defs;
  byId = Object.fromEntries(defs.map(d => [d.id, d]));
  listeners.forEach(fn => fn());
}

export const onRegistryChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export const allDatasets = (): DatasetDef[] => registry;
export const getDataset = (id: string): DatasetDef | undefined => byId[id];
export const isMapped = (datasetId: string, columnKey: string) =>
  Boolean(byId[datasetId]?.columns.find(c => c.key === columnKey)?.sheetColumn);
export const visibleColumns = (d: DatasetDef) => d.columns.filter(c => c.sheetColumn);

/** @deprecated reads the seed only; use getDataset() or allDatasets(). */
export const DATASET_BY_ID = byId;
