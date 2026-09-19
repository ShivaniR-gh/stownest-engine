import type { ColumnType, DatasetDef } from './types';

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

/** ---------------------------------------------------------------------------
 * DATASET SCHEMA — the application's definition of its own data.
 *
 * This file is the source of truth. It decides what the entry form shows, what
 * the API accepts, what header row a newly created tab gets, and which sheet
 * column each value lands in. One list, four uses, so they cannot drift apart.
 *
 * The spreadsheet is the storage destination, never the definition. Nothing
 * here is inferred from what a sheet happens to contain.
 * ------------------------------------------------------------------------- */

/* =========================================================================
 
 * line `export const DATASETS: DatasetDef[] = [`.
 *
 * Then add ONE line as the first entry inside that array:
 *
 *     export const DATASETS: DatasetDef[] = [
 *       ...SALES_DATASETS,
 *
 * Nothing else in datasets.ts changes.
 * ========================================================================= */

/* ------------------------------------------------------------------ *
 * Sales — city performance, one dataset per line of business.
 *
 * The three lines record exactly the same things, so the columns are built
 * once and reused. Writing them out three times would guarantee they drift:
 * someone adds a field to storage, forgets moving, and the two dashboards
 * quietly stop being comparable.
 *
 * Cities are column groups rather than rows because a month must stay one
 * write — a half-saved month with four cities and no total is worse than a
 * refused one. The cost is that an eighth city is a schema change here plus
 * four sheet columns per line.
 *
 * Four figures are ENTERED per city: leads, orders, value, add-ons.
 * Conversion and total are ARITHMETIC over them and are never typed —
 * checked against the August report, every row reconciles:
 *   Total      = Orders + Add on      163 + 29 = 192
 *   Conversion = Orders / Leads       163 / 526 = 31%
 * A person retyping either is a person who can make the total disagree with
 * the two numbers beside it.
 * ------------------------------------------------------------------ */

const SALES_CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'pun', name: 'Pune' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
] as const;

/** The per-city column set, plus the month roll-up. Identical for all three
 *  lines of business. */
function salesColumns(): DatasetDef['columns'] {
  const perCity = SALES_CITIES.flatMap(c => ([
    { key: `${c.key}_leads`, header: `${c.name} Leads`, type: 'number' as const,
      sheetColumn: `${c.name} Leads`,
      editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const },

    { key: `${c.key}_orders`, header: `${c.name} Orders`, type: 'number' as const,
      sheetColumn: `${c.name} Orders`,
      editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const },

    { key: `${c.key}_conv`, header: `${c.name} Conversion`, type: 'percent' as const,
      sheetColumn: `${c.name} Conversion`, derived: true,
      help: 'Orders as a share of leads. Computed, never entered.' },

    { key: `${c.key}_value`, header: `${c.name} Value`, type: 'currency' as const,
      sheetColumn: `${c.name} Value`,
      editable: true, min: 0, aggregate: 'sum' as const, role: 'amount' as const },

    { key: `${c.key}_addon`, header: `${c.name} Add on`, type: 'number' as const,
      sheetColumn: `${c.name} Add on`,
      editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const,
      help: 'Count of add-on orders, not an amount. Adds into the total.' },

    { key: `${c.key}_total`, header: `${c.name} Total`, type: 'number' as const,
      sheetColumn: `${c.name} Total`, derived: true, aggregate: 'sum' as const,
      help: 'Orders plus add-ons. Computed, never entered.' },
  ]));

  return [
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, unique: true, role: 'date',
      help: 'First of the month. One row per month.' },

    ...perCity,

    /* --- month roll-up, all derived --- */
    { key: 'tot_leads', header: 'Total Leads', type: 'number', sheetColumn: 'Total Leads',
      derived: true, aggregate: 'sum' },
    { key: 'tot_orders', header: 'Total Orders', type: 'number', sheetColumn: 'Total Orders',
      derived: true, aggregate: 'sum' },
    { key: 'tot_conv', header: 'Total Conversion', type: 'percent', sheetColumn: 'Total Conversion',
      derived: true },
    { key: 'tot_value', header: 'Total Value', type: 'currency', sheetColumn: 'Total Value',
      derived: true, aggregate: 'sum' },
    { key: 'tot_addon', header: 'Total Add on', type: 'number', sheetColumn: 'Total Add on',
      derived: true, aggregate: 'sum' },
    { key: 'tot_total', header: 'Total', type: 'number', sheetColumn: 'Total',
      derived: true, aggregate: 'sum' },

    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ];
}

function salesDataset(
  id: string, label: string, line: string, icon: string, sheetName: string,
): DatasetDef {
  return {
    id, label, icon,
    noun: 'month',
    department: 'sales',
    businessLine: line,
    spreadsheetEnv: 'SHEETS_ID_SALES',
    // Created on first write if absent. Rename the tab in Sheets and change
    // this line with it; nothing else in the app knows the name.
    sheetName,
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'sales',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: salesColumns(),
  };
}

export const SALES_DATASETS: DatasetDef[] = [
  salesDataset('sales_storage', 'Storage', 'Storage', 'box', 'storage_monthly'),
  salesDataset('sales_moving', 'Moving', 'Moving', 'truck', 'moving_monthly'),
];


/* ------------------------------------------------------------------ *
 * Operations — the monthly OPS report, one dataset per block.
 *
 * The circulated report is four tables that describe the same month:
 * deliveries, pickups, inter-state, and a small ticket count. They are four
 * datasets rather than one because they have genuinely different shapes — a
 * single flat row carrying all of them would be 120 columns wide and the
 * ticket block, which is two figures with no city split, would be padded out
 * with sixty blanks.
 *
 * Cities are column groups rather than rows, for the same reason sales does
 * it: a month must stay ONE write. A half-saved month with four cities and no
 * total is worse than a refused one. The cost is that an eighth city is a
 * schema change here plus four sheet columns per block.
 *
 * The report order differs from the sales one — Pune prints before Mumbai
 * here. Following the report the team actually reads matters more than
 * matching the other department, so the order below is the ops order.
 *
 * WHAT IS ENTERED AND WHAT IS NOT. Every roll-up in the source sheet was
 * checked against the circulated figures and all of them reconcile:
 *   Full Delivery    = Stownest (All)  + Customer (All)      133 + 43  = 176
 *   Partial Delivery = Stownest (Part) + Customer (Part)      46 + 28  = 74
 *   Total            = Full + Partial                        176 + 74  = 250
 *   Total New        = Stownest + Customer                   186 + 7   = 193
 *   Total Add on     = Stownest add-on + Customer add-on      16 + 2   = 18
 *   Total Pickups    = New + Add on                          193 + 18  = 211
 * Because they reconcile, they are ARITHMETIC and are marked derived. A person
 * retyping any of them is a person who can make a total disagree with the two
 * numbers beside it.
 *
 * The space block of the report is NOT a dataset here. It is the same thing
 * `warehouse_readings` already stores — occupied space per warehouse per month,
 * against a total held once in the `warehouses` master. Copying it under
 * operations would give the company two places to record June's occupancy for
 * Rampura, and the first month only one of them was filled is the month the
 * two dashboards start disagreeing. Instead that dataset now names operations
 * in `alsoIn`, so the ops team enters and reads space on their own page while
 * the figures stay in one tab.
 * ------------------------------------------------------------------ */

const OPS_CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi' },
  { key: 'kol', name: 'Kolkata' },
] as const;

interface OpsField {
  suffix: string;
  /** Header text, prefixed with the city name in the sheet. */
  label: string;
  derived?: boolean;
  help?: string;
}

/** The month column, one group of columns per city, then the roll-up and the
 *  audit stamp. Written once because all three city blocks are the same
 *  skeleton with different fields in the middle. */
function opsColumns(fields: readonly OpsField[], rollup: OpsField[]): DatasetDef['columns'] {
  const perCity = OPS_CITIES.flatMap(c => fields.map(f => ({
    key: `${c.key}_${f.suffix}`,
    header: `${c.name} ${f.label}`,
    type: 'number' as const,
    sheetColumn: `${c.name} ${f.label}`,
    ...(f.derived
      ? { derived: true, aggregate: 'sum' as const, help: f.help }
      : { editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const, help: f.help }),
  })));

  return [
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, unique: true, role: 'date',
      help: 'First of the month. One row per month.' },

    ...perCity,

    ...rollup.map(f => ({
      key: f.suffix,
      header: f.label,
      type: (f.suffix.endsWith('_pct') ? 'percent' : 'number') as ColumnType,
      sheetColumn: f.label,
      derived: true,
      ...(f.suffix.endsWith('_pct') ? {} : { aggregate: 'sum' as const }),
      help: f.help,
    })),

    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ];
}

const DELIVERY_FIELDS: OpsField[] = [
  { suffix: 'sn_all', label: 'Delivery by Stownest (All)' },
  { suffix: 'sn_part', label: 'Delivery by Stownest (Partial)' },
  { suffix: 'cust_all', label: 'Delivery by Customer (All)' },
  { suffix: 'cust_part', label: 'Delivery by Customer (Partial)' },
  { suffix: 'full', label: 'Full Delivery', derived: true,
    help: 'Stownest (All) + Customer (All). Computed, never entered.' },
  { suffix: 'partial', label: 'Partial Delivery', derived: true,
    help: 'Stownest (Partial) + Customer (Partial). Computed, never entered.' },
  { suffix: 'total', label: 'Total Deliveries', derived: true,
    help: 'Full + Partial. Computed, never entered.' },
];

const PICKUP_FIELDS: OpsField[] = [
  { suffix: 'sn', label: 'Pick up by Stownest' },
  { suffix: 'cust', label: 'Pick up by Customer' },
  { suffix: 'sn_addon', label: 'Pick up by Stownest (Add on)' },
  { suffix: 'cust_addon', label: 'Pick up by Customer (Add on)' },
  { suffix: 'addon', label: 'Total Add on', derived: true,
    help: 'Both add-on columns. Computed, never entered.' },
  { suffix: 'new', label: 'Total New', derived: true,
    help: 'Stownest + Customer, excluding add-ons. Computed, never entered.' },
  { suffix: 'total', label: 'Total Pickups', derived: true,
    help: 'New + Add on. Computed, never entered.' },
];

/**
 * Moving. The report files all three under "Inter-State", including the local
 * moving column, which is not inter-state at all. The columns are named for
 * what they hold rather than for the block they were found in.
 */
const MOVING_FIELDS: OpsField[] = [
  { suffix: 'del_is', label: 'Delivery by Stownest (Interstate)' },
  { suffix: 'pick_is', label: 'Pick up by Stownest (Interstate)' },
  { suffix: 'pick_local', label: 'Pick up by Stownest (Local Moving)' },
];

export const OPERATIONS_DATASETS: DatasetDef[] = [
  {
    id: 'ops_deliveries',
    label: 'Deliveries',
    noun: 'month',
    icon: 'truck',
    department: 'operations',
    spreadsheetEnv: 'SHEETS_ID_OPERATIONS',
    sheetName: 'ops_deliveries_monthly',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'operations',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: opsColumns(DELIVERY_FIELDS, [
      { suffix: 'tot_sn_all', label: 'Total Delivery by Stownest (All)' },
      { suffix: 'tot_sn_part', label: 'Total Delivery by Stownest (Partial)' },
      { suffix: 'tot_cust_all', label: 'Total Delivery by Customer (All)' },
      { suffix: 'tot_cust_part', label: 'Total Delivery by Customer (Partial)' },
      { suffix: 'tot_full', label: 'Total Full Delivery' },
      { suffix: 'tot_partial', label: 'Total Partial Delivery' },
      { suffix: 'tot_total', label: 'Total Deliveries' },
      { suffix: 'full_pct', label: 'Full Delivery Share',
        help: 'Full deliveries as a share of all deliveries.' },
      { suffix: 'partial_pct', label: 'Partial Delivery Share',
        help: 'Partial deliveries as a share of all deliveries.' },
    ]),
  },

  {
    id: 'ops_pickups',
    label: 'Pick-ups',
    noun: 'month',
    icon: 'box',
    department: 'operations',
    spreadsheetEnv: 'SHEETS_ID_OPERATIONS',
    sheetName: 'ops_pickups_monthly',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'operations',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: opsColumns(PICKUP_FIELDS, [
      { suffix: 'tot_sn', label: 'Total Pick up by Stownest' },
      { suffix: 'tot_cust', label: 'Total Pick up by Customer' },
      { suffix: 'tot_sn_addon', label: 'Total Pick up by Stownest (Add on)' },
      { suffix: 'tot_cust_addon', label: 'Total Pick up by Customer (Add on)' },
      { suffix: 'tot_addon', label: 'Total Add on' },
      { suffix: 'tot_new', label: 'Total New' },
      { suffix: 'tot_total', label: 'Total Pickups' },
    ]),
  },

  {
    id: 'ops_moving',
    label: 'Moving',
    noun: 'month',
    icon: 'truck',
    department: 'operations',
    spreadsheetEnv: 'SHEETS_ID_OPERATIONS',
    sheetName: 'ops_moving_monthly',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'operations',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: opsColumns(MOVING_FIELDS, [
      { suffix: 'tot_del_is', label: 'Total Delivery by Stownest (Interstate)' },
      { suffix: 'tot_pick_is', label: 'Total Pick up by Stownest (Interstate)' },
      { suffix: 'tot_pick_local', label: 'Total Pick up by Stownest (Local Moving)' },
    ]),
  },

  /**
   * Tickets. Two figures for the whole month, no city split — that is how the
   * report records them, and inventing a split the team does not collect would
   * produce seven columns of zero.
   */
  {
    id: 'ops_tickets',
    label: 'Tickets',
    noun: 'month',
    icon: 'checklist',
    department: 'operations',
    spreadsheetEnv: 'SHEETS_ID_OPERATIONS',
    sheetName: 'ops_tickets_monthly',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'operations',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    transposable: true,
    columns: [
      { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
        required: true, filterable: true, sortable: true, unique: true, role: 'date',
        help: 'First of the month. One row per month.' },
      { key: 'warehouse_visit', header: 'Warehouse Visit', type: 'number',
        sheetColumn: 'Warehouse Visit', editable: true, min: 0, aggregate: 'sum',
        role: 'quantity' },
      { key: 'photo_request', header: 'Photo Request', type: 'number',
        sheetColumn: 'Photo Request', editable: true, min: 0, aggregate: 'sum',
        role: 'quantity' },
      { key: 'tot_tickets', header: 'Total Tickets', type: 'number',
        sheetColumn: 'Total Tickets', derived: true, aggregate: 'sum',
        help: 'Warehouse visits + photo requests. Computed, never entered.' },
      { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
        derived: true, hiddenByDefault: true },
    ],
  },
];


const CT_CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi/Gurugram' },
  { key: 'kol', name: 'Kolkata' },
] as const;

function ctBase(id: string, label: string, icon: string, sheetName: string, columns: DatasetDef['columns']): DatasetDef {
  return {
    id, label, icon,
    noun: 'month',
    department: 'control_tower',
    spreadsheetEnv: 'SHEETS_ID_CONTROL_TOWER',
    sheetName,
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'control_tower',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns,
  };
}

const CT_MONTH: DatasetDef['columns'] = [
  { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
    required: true, filterable: true, sortable: true, unique: true, role: 'date',
    help: 'First of the month. One row per month.' },
];

const CT_AUDIT: DatasetDef['columns'] = [
  { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
    derived: true, hiddenByDefault: true },
];

const CT_INCOME_CITIES = [
  { key: 'blr', name: 'Bangalore' },
  { key: 'hyd', name: 'Hyderabad' },
  { key: 'che', name: 'Chennai' },
  { key: 'pun', name: 'Pune' },
  { key: 'mum', name: 'Mumbai' },
  { key: 'del', name: 'Delhi/Haryana' },
  { key: 'kol', name: 'Kolkata' },
] as const;

export const CONTROL_TOWER_DATASETS: DatasetDef[] = [
  ctBase('ct_city_income', 'City income', 'receipt', 'ct_city_income', [
    ...CT_MONTH,
    ...CT_INCOME_CITIES.flatMap(c => [
      { key: `${c.key}_clients`, header: `${c.name} Active Clients`, type: 'number' as const,
        sheetColumn: `${c.name} Active Clients`, editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const },
      { key: `${c.key}_rental`, header: `${c.name} Rental Income`, type: 'currency' as const,
        sheetColumn: `${c.name} Rental Income`, editable: true, min: 0, aggregate: 'sum' as const, role: 'revenue' as const },
      { key: `${c.key}_logistic`, header: `${c.name} Logistic Income`, type: 'currency' as const,
        sheetColumn: `${c.name} Logistic Income`, editable: true, min: 0, aggregate: 'sum' as const, role: 'revenue' as const },
    ]),
    { key: 'tot_clients', header: 'Total Active Clients', type: 'number',
      sheetColumn: 'Total Active Clients', derived: true, aggregate: 'sum' },
    { key: 'tot_rental', header: 'Total Rental Income', type: 'currency',
      sheetColumn: 'Total Rental Income', derived: true, aggregate: 'sum' },
    { key: 'tot_logistic', header: 'Total Logistic Income', type: 'currency',
      sheetColumn: 'Total Logistic Income', derived: true, aggregate: 'sum' },
    { key: 'tot_income', header: 'Total Income', type: 'currency',
      sheetColumn: 'Total Income', derived: true, aggregate: 'sum' },
    ...CT_AUDIT,
  ]),

  ctBase('ct_rental_trends', 'Rental trends', 'trending', 'ct_rental_trends', [
    ...CT_MONTH,
    { key: 'pk_rental', header: 'Pickup Rental', type: 'currency',
      sheetColumn: 'Pickup Rental', editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'pk_count', header: 'Number of Pickup', type: 'number',
      sheetColumn: 'Number of Pickup', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'dl_rental', header: 'Delivery Rental', type: 'currency',
      sheetColumn: 'Delivery Rental', editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'dl_count', header: 'Number of Delivery', type: 'number',
      sheetColumn: 'Number of Delivery', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'rental_diff', header: 'Difference', type: 'currency',
      sheetColumn: 'Difference', derived: true, aggregate: 'sum',
      help: 'Pickup rental minus delivery rental.' },
    { key: 'count_diff', header: 'Count', type: 'number',
      sheetColumn: 'Count', derived: true, aggregate: 'sum',
      help: 'Pickups minus deliveries.' },
    ...CT_AUDIT,
  ]),

  ctBase('ct_city_gap', 'City gap', 'radar', 'ct_city_gap', [
    ...CT_MONTH,
    ...CT_CITIES.flatMap(c => [
      { key: `${c.key}_pickups`, header: `${c.name} Pick-ups`, type: 'number' as const,
        sheetColumn: `${c.name} Pick-ups`, editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const },
      { key: `${c.key}_deliveries`, header: `${c.name} Deliveries`, type: 'number' as const,
        sheetColumn: `${c.name} Deliveries`, editable: true, min: 0, aggregate: 'sum' as const, role: 'quantity' as const },
      { key: `${c.key}_diff`, header: `${c.name} Difference`, type: 'number' as const,
        sheetColumn: `${c.name} Difference`, derived: true, aggregate: 'sum' as const },
      { key: `${c.key}_pct`, header: `${c.name} Percentage`, type: 'percent' as const,
        sheetColumn: `${c.name} Percentage`, derived: true },
    ]),
    { key: 'tot_pickups', header: 'Total Pick-ups', type: 'number',
      sheetColumn: 'Total Pick-ups', derived: true, aggregate: 'sum' },
    { key: 'tot_deliveries', header: 'Total Deliveries', type: 'number',
      sheetColumn: 'Total Deliveries', derived: true, aggregate: 'sum' },
    { key: 'tot_diff', header: 'Total Difference', type: 'number',
      sheetColumn: 'Total Difference', derived: true, aggregate: 'sum' },
    { key: 'tot_pct', header: 'Total Percentage', type: 'percent',
      sheetColumn: 'Total Percentage', derived: true },
    ...CT_AUDIT,
  ]),

  ctBase('ct_interstate', 'Interstate', 'truck', 'ct_interstate', [
    ...CT_MONTH,
    { key: 'pk_done', header: 'Pickup Completed', type: 'number',
      sheetColumn: 'Pickup Completed', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'pk_transit', header: 'Pickup Intransit', type: 'number',
      sheetColumn: 'Pickup Intransit', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'pk_total', header: 'Pickup Total', type: 'number',
      sheetColumn: 'Pickup Total', derived: true, aggregate: 'sum' },
    { key: 'dl_done', header: 'Delivery Completed', type: 'number',
      sheetColumn: 'Delivery Completed', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'dl_transit', header: 'Delivery Intransit', type: 'number',
      sheetColumn: 'Delivery Intransit', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'dl_total', header: 'Delivery Total', type: 'number',
      sheetColumn: 'Delivery Total', derived: true, aggregate: 'sum' },
    ...CT_AUDIT,
  ]),

  ctBase('ct_reviews', 'Reviews', 'checklist', 'ct_reviews', [
    ...CT_MONTH,
    { key: 'dl_count', header: 'No of Deliveries', type: 'number',
      sheetColumn: 'No of Deliveries', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'review_count', header: 'No of reviews', type: 'number',
      sheetColumn: 'No of reviews', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'bad_comm', header: 'Bad reviews communication/pricing/stars', type: 'number',
      sheetColumn: 'Bad reviews communication/pricing/stars', editable: true, min: 0, aggregate: 'sum' },
    { key: 'bad_dmg', header: 'Bad reviews damage & missing', type: 'number',
      sheetColumn: 'Bad reviews damage & missing', editable: true, min: 0, aggregate: 'sum' },
    ...CT_CITIES.flatMap(c => [
      { key: `${c.key}_pk_req`, header: `${c.name} Pickup Requested`, type: 'number' as const,
        sheetColumn: `${c.name} Pickup Requested`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_pk_rev`, header: `${c.name} Pickup Reviewed`, type: 'number' as const,
        sheetColumn: `${c.name} Pickup Reviewed`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_pk_neg`, header: `${c.name} Pickup Negative`, type: 'number' as const,
        sheetColumn: `${c.name} Pickup Negative`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_dl_req`, header: `${c.name} Delivery Requested`, type: 'number' as const,
        sheetColumn: `${c.name} Delivery Requested`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_dl_rev`, header: `${c.name} Delivery Reviewed`, type: 'number' as const,
        sheetColumn: `${c.name} Delivery Reviewed`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_comm`, header: `${c.name} Communication`, type: 'number' as const,
        sheetColumn: `${c.name} Communication`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_price`, header: `${c.name} Pricing/Estimation`, type: 'number' as const,
        sheetColumn: `${c.name} Pricing/Estimation`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_dmg`, header: `${c.name} Damage/Missing`, type: 'number' as const,
        sheetColumn: `${c.name} Damage/Missing`, editable: true, min: 0, aggregate: 'sum' as const },
      { key: `${c.key}_star`, header: `${c.name} Only Star`, type: 'number' as const,
        sheetColumn: `${c.name} Only Star`, editable: true, min: 0, aggregate: 'sum' as const },
    ]),
    { key: 'tot_pk_req', header: 'Total Pickup Requested', type: 'number', sheetColumn: 'Total Pickup Requested', derived: true, aggregate: 'sum' },
    { key: 'tot_pk_rev', header: 'Total Pickup Reviewed', type: 'number', sheetColumn: 'Total Pickup Reviewed', derived: true, aggregate: 'sum' },
    { key: 'tot_pk_neg', header: 'Total Pickup Negative', type: 'number', sheetColumn: 'Total Pickup Negative', derived: true, aggregate: 'sum' },
    { key: 'tot_dl_req', header: 'Total Delivery Requested', type: 'number', sheetColumn: 'Total Delivery Requested', derived: true, aggregate: 'sum' },
    { key: 'tot_dl_rev', header: 'Total Delivery Reviewed', type: 'number', sheetColumn: 'Total Delivery Reviewed', derived: true, aggregate: 'sum' },
    ...CT_AUDIT,
  ]),

  ctBase('ct_tickets', 'Tickets', 'checklist', 'ct_tickets', [
    ...CT_MONTH,
    { key: 'dmg_exp', header: 'Damages Expense', type: 'currency',
      sheetColumn: 'Damages Expense', editable: true, min: 0, aggregate: 'sum', role: 'cost' },
    { key: 'dmg_tix', header: 'Damages Tickets', type: 'number',
      sheetColumn: 'Damages Tickets', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'miss_exp', header: 'Missing Expense', type: 'currency',
      sheetColumn: 'Missing Expense', editable: true, min: 0, aggregate: 'sum', role: 'cost' },
    { key: 'miss_tix', header: 'Missing Tickets', type: 'number',
      sheetColumn: 'Missing Tickets', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'exp_total', header: 'Expense Total', type: 'currency',
      sheetColumn: 'Expense Total', derived: true, aggregate: 'sum' },
    { key: 'tix_dmg_total', header: 'Damage & Missing Tickets', type: 'number',
      sheetColumn: 'Damage & Missing Tickets', derived: true, aggregate: 'sum' },
    { key: 'inv_queries', header: 'Invoice queries', type: 'number',
      sheetColumn: 'Invoice queries', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'escalations', header: 'Service Escalations', type: 'number',
      sheetColumn: 'Service Escalations', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'wh_visits', header: 'Warehouse Visits', type: 'number',
      sheetColumn: 'Warehouse Visits', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'photo_video', header: 'Photo and Video request', type: 'number',
      sheetColumn: 'Photo and Video request', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'other_total', header: 'Other Tickets Total', type: 'number',
      sheetColumn: 'Other Tickets Total', derived: true, aggregate: 'sum' },
    ...CT_AUDIT,
  ]),

  ctBase('ct_delivery_econ', 'Economics', 'receipt', 'ct_delivery_econ', [
    ...CT_MONTH,
    { key: 'tot_del', header: 'Total Deliveries', type: 'number',
      sheetColumn: 'Total Deliveries', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'by_cust', header: 'Delivery By Customer', type: 'number',
      sheetColumn: 'Delivery By Customer', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'by_sn', header: 'Delivery By StowNest', type: 'number',
      sheetColumn: 'Delivery By StowNest', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'items', header: 'No Of Items', type: 'number',
      sheetColumn: 'No Of Items', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'revenue', header: 'Delivery Revenue', type: 'currency',
      sheetColumn: 'Delivery Revenue', editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'conv_rate', header: 'Conversion Rate', type: 'percent',
      sheetColumn: 'Conversion Rate', derived: true },
    { key: 'earn_per', header: 'Earnings/Delivery Requests', type: 'currency',
      sheetColumn: 'Earnings/Delivery Requests', derived: true },
    ...CT_AUDIT,
  ]),

  ctBase('ct_calls', 'Calls', 'users', 'ct_calls', [
    ...CT_MONTH,
    { key: 'cq_new', header: 'Call New Query', type: 'number', sheetColumn: 'Call New Query', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_rm', header: 'Call RM Query', type: 'number', sheetColumn: 'Call RM Query', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_enq', header: 'Call Enquiry', type: 'number', sheetColumn: 'Call Enquiry', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_pd', header: 'Call P&D Confirmation', type: 'number', sheetColumn: 'Call P&D Confirmation', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_biz', header: 'Call Business', type: 'number', sheetColumn: 'Call Business', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_inv_ct', header: 'Call Invoice CT', type: 'number', sheetColumn: 'Call Invoice CT', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_inv_ac', header: 'Call Invoice A/c', type: 'number', sheetColumn: 'Call Invoice A/c', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_new_del', header: 'Call New Delivery', type: 'number', sheetColumn: 'Call New Delivery', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_rep_del', header: 'Call Repeated Delivery', type: 'number', sheetColumn: 'Call Repeated Delivery', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_dmg', header: 'Call Damage/Missing', type: 'number', sheetColumn: 'Call Damage/Missing', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_rep_dmg', header: 'Call Repeated Damage/Missing', type: 'number', sheetColumn: 'Call Repeated Damage/Missing', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_other', header: 'Call Other City', type: 'number', sheetColumn: 'Call Other City', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_invalid', header: 'Call Invalid', type: 'number', sheetColumn: 'Call Invalid', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_miss', header: 'Missed Calls', type: 'number', sheetColumn: 'Missed Calls', editable: true, min: 0, aggregate: 'sum' },
    { key: 'cq_total', header: 'Call Total', type: 'number', sheetColumn: 'Call Total', derived: true, aggregate: 'sum' },
    { key: 'ik_new', header: 'Interakt New Query', type: 'number', sheetColumn: 'Interakt New Query', editable: true, min: 0, aggregate: 'sum' },
    { key: 'ik_enq', header: 'Interakt Enquiry', type: 'number', sheetColumn: 'Interakt Enquiry', editable: true, min: 0, aggregate: 'sum' },
    { key: 'ik_new_del', header: 'Interakt New Delivery', type: 'number', sheetColumn: 'Interakt New Delivery', editable: true, min: 0, aggregate: 'sum' },
    { key: 'ik_other', header: 'Interakt Other City', type: 'number', sheetColumn: 'Interakt Other City', editable: true, min: 0, aggregate: 'sum' },
    { key: 'ik_invalid', header: 'Interakt Invalid', type: 'number', sheetColumn: 'Interakt Invalid', editable: true, min: 0, aggregate: 'sum' },
    { key: 'ik_total', header: 'Interakt Total', type: 'number', sheetColumn: 'Interakt Total', derived: true, aggregate: 'sum' },
    ...CT_AUDIT,
  ]),
];

function moneyCol(key: string, header: string, derived = false): DatasetDef['columns'][number] {
  return {
    key, header, type: 'currency', sheetColumn: header,
    ...(derived
      ? { derived: true, aggregate: 'sum' as const }
      : { editable: true, min: 0, aggregate: 'sum' as const, role: 'revenue' as const }),
  };
}

export const FINANCE_DATASETS: DatasetDef[] = [
  {
    id: 'finance_pnl',
    label: 'P&L',
    icon: 'ledger',
    noun: 'month',
    department: 'finance',
    spreadsheetEnv: 'SHEETS_ID_FINANCE',
    sheetName: 'finance_pnl',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'finance',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: [
      { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
        required: true, filterable: true, sortable: true, unique: true, role: 'date' },
      moneyCol('b2c_storage', 'B2C Storage Service'),
      moneyCol('b2c_transport', 'B2C Transportation'),
      moneyCol('b2c_packing', 'B2C Packing and moving'),
      moneyCol('b2b_storage', 'B2B Storage service'),
      moneyCol('b2b_transport', 'B2B Transportation'),
      moneyCol('b2c_rev', 'B2C Revenue', true),
      moneyCol('b2b_rev', 'B2B Revenue', true),
      moneyCol('tot_rev', 'Total Revenue', true),
      moneyCol('cogs_wh_rent', 'COGS WH Rent'),
      moneyCol('cogs_logistics', 'COGS Logistics'),
      moneyCol('cogs_labour', 'COGS Contract / Labour'),
      moneyCol('cogs_damages', 'COGS Damages'),
      moneyCol('cogs_packing', 'COGS Packing material'),
      moneyCol('tot_cogs', 'Total COGS', true),
      moneyCol('gross_profit', 'Gross Profit', true),
      moneyCol('exp_salary', 'Employee Salary'),
      moneyCol('exp_marketing', 'Marketing Exp'),
      moneyCol('exp_intermediary', 'Intermediary charges'),
      moneyCol('exp_other', 'Other expenses'),
      moneyCol('exp_emi', 'EMI and interest'),
      moneyCol('tot_indirect', 'Total Indirect Expenses', true),
      moneyCol('net_profit', 'Net Profit (PBT)', true),
      moneyCol('tax_gst', 'Tax (GST)'),
      moneyCol('profit_after_tax', 'Profit after Tax', true),
      { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
        derived: true, hiddenByDefault: true },
    ],
  },
];

const B2B_CITIES = [
  'Bengaluru', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi', 'Kolkata',
] as const;

function b2bBase(id: string, label: string, icon: string, sheetName: string, columns: DatasetDef['columns']): DatasetDef {
  return {
    id, label, icon,
    noun: 'row',
    department: 'b2b',
    spreadsheetEnv: 'SHEETS_ID_B2B',
    sheetName,
    createMissingTab: true,
    idColumn: 'row_key',
    titleColumn: 'city',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'b2b',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns,
  };
}

export const B2B_DATASETS: DatasetDef[] = [
  b2bBase('b2b_occupancy', 'Occupancy', 'box', 'b2b_occupancy', [
    { key: 'row_key', header: 'Row key', type: 'id', sheetColumn: 'Row key',
      derived: true, unique: true, hiddenByDefault: true },
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, role: 'date' },
    { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
      required: true, filterable: true, groupable: true, editable: true,
      enumValues: [...B2B_CITIES], role: 'location' },
    { key: 'txn_clients', header: 'Transactional Client', type: 'number',
      sheetColumn: 'Transactional Client', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'txn_sqft', header: 'Transactional SQFT', type: 'number',
      sheetColumn: 'Transactional SQFT', editable: true, min: 0, aggregate: 'sum' },
    { key: 'nontxn_clients', header: 'Non-Transactional Clients', type: 'number',
      sheetColumn: 'Non-Transactional Clients', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'nontxn_sqft', header: 'Non-Transactional SQFT', type: 'number',
      sheetColumn: 'Non-Transactional SQFT', editable: true, min: 0, aggregate: 'sum' },
    { key: 'doc_clients', header: 'Document Clients', type: 'number',
      sheetColumn: 'Document Clients', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'active_clients', header: 'Active Clients', type: 'number',
      sheetColumn: 'Active Clients', derived: true, aggregate: 'sum',
      help: 'Transactional + non-transactional + document.' },
    { key: 'occupied_sqft', header: 'Total Occupied SQFT', type: 'number',
      sheetColumn: 'Total Occupied SQFT', derived: true, aggregate: 'sum',
      help: 'Transactional sqft + non-transactional sqft.' },
    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ]),

  b2bBase('b2b_moves', 'Moves', 'truck', 'b2b_moves', [
    { key: 'row_key', header: 'Row key', type: 'id', sheetColumn: 'Row key',
      derived: true, unique: true, hiddenByDefault: true },
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, role: 'date' },
    { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
      required: true, filterable: true, groupable: true, editable: true,
      enumValues: [...B2B_CITIES], role: 'location' },
    { key: 'inward', header: 'Inward', type: 'number',
      sheetColumn: 'Inward', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'outward', header: 'Outward', type: 'number',
      sheetColumn: 'Outward', editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'txn_revenue', header: 'Transaction Revenue', type: 'currency',
      sheetColumn: 'Transaction Revenue', editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'total_txns', header: 'Total Transactions', type: 'number',
      sheetColumn: 'Total Transactions', derived: true, aggregate: 'sum',
      help: 'Inward + outward.' },
    { key: 'rev_per_move', header: 'Revenue per move', type: 'currency',
      sheetColumn: 'Revenue per move', derived: true,
      help: 'Transaction revenue ÷ (inward + outward).' },
    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ]),

  b2bBase('b2b_revenue', 'Revenue', 'receipt', 'b2b_revenue', [
    { key: 'row_key', header: 'Row key', type: 'id', sheetColumn: 'Row key',
      derived: true, unique: true, hiddenByDefault: true },
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, role: 'date' },
    { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
      required: true, filterable: true, groupable: true, editable: true,
      enumValues: [...B2B_CITIES], role: 'location' },
    { key: 'rental_rev', header: 'Rental Revenue', type: 'currency',
      sheetColumn: 'Rental Revenue', editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'txn_rev', header: 'Transaction Revenue', type: 'currency',
      sheetColumn: 'Transaction Revenue', editable: true, min: 0, aggregate: 'sum', role: 'revenue',
      help: 'Same figure as Moves for this city and month.' },
    { key: 'logistics_rev', header: 'Logistics Revenue', type: 'currency',
      sheetColumn: 'Logistics Revenue', editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'total_rev', header: 'Total Revenue', type: 'currency',
      sheetColumn: 'Total Revenue', derived: true, aggregate: 'sum',
      help: 'Rental + transaction + logistics.' },
    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ]),

  b2bBase('b2b_movement', 'Client movement', 'users', 'b2b_movement', [
    { key: 'row_key', header: 'Row key', type: 'id', sheetColumn: 'Row key',
      derived: true, unique: true, hiddenByDefault: true },
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, role: 'date' },
    { key: 'client_name', header: 'Client Name', type: 'text', sheetColumn: 'Client Name',
      required: true, editable: true, sortable: true },
    { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
      required: true, filterable: true, groupable: true, editable: true,
      enumValues: ['Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi', 'Kolkata'],
      role: 'location' },
    { key: 'movement', header: 'Movement', type: 'enum', sheetColumn: 'Movement',
      required: true, editable: true, filterable: true, groupable: true,
      enumValues: ['New Client', 'Vacated'] },
    { key: 'client_type', header: 'Client Type', type: 'enum', sheetColumn: 'Client Type',
      required: true, editable: true, filterable: true, groupable: true,
      enumValues: ['Transactional', 'Non Transactional', 'Document'] },
    { key: 'sqft_change', header: 'SQFT Change', type: 'number', sheetColumn: 'SQFT Change',
      editable: true, aggregate: 'sum' },
    { key: 'reason', header: 'Reason', type: 'enum', sheetColumn: 'Reason',
      editable: true, filterable: true, groupable: true,
      enumValues: ['New Business', 'Own Warehouse', 'Project/Business Closed'] },
    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ]),

  b2bBase('b2b_summary', 'Monthly summary', 'chart', 'b2b_summary', [
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, unique: true, role: 'date' },
    { key: 'active_clients', header: 'Active Clients', type: 'number', sheetColumn: 'Active Clients', derived: true, aggregate: 'sum' },
    { key: 'new_clients', header: 'New Clients', type: 'number', sheetColumn: 'New Clients', derived: true, aggregate: 'sum' },
    { key: 'vacated_clients', header: 'Vacated Clients', type: 'number', sheetColumn: 'Vacated Clients', derived: true, aggregate: 'sum' },
    { key: 'net_clients', header: 'Net Clients', type: 'number', sheetColumn: 'Net Clients', derived: true },
    { key: 'occupied_sqft', header: 'Occupied SQFT', type: 'number', sheetColumn: 'Occupied SQFT', derived: true, aggregate: 'sum' },
    { key: 'sqft_added', header: 'SQFT Added', type: 'number', sheetColumn: 'SQFT Added', derived: true },
    { key: 'sqft_lost', header: 'SQFT Lost', type: 'number', sheetColumn: 'SQFT Lost', derived: true },
    { key: 'net_sqft', header: 'Net SQFT', type: 'number', sheetColumn: 'Net SQFT', derived: true },
    { key: 'inward', header: 'Inward', type: 'number', sheetColumn: 'Inward', derived: true, aggregate: 'sum' },
    { key: 'outward', header: 'Outward', type: 'number', sheetColumn: 'Outward', derived: true, aggregate: 'sum' },
    { key: 'total_txns', header: 'Total Transactions', type: 'number', sheetColumn: 'Total Transactions', derived: true },
    { key: 'rental_rev', header: 'Rental Revenue', type: 'currency', sheetColumn: 'Rental Revenue', derived: true, aggregate: 'sum' },
    { key: 'txn_rev', header: 'Transaction Revenue', type: 'currency', sheetColumn: 'Transaction Revenue', derived: true, aggregate: 'sum' },
    { key: 'logistics_rev', header: 'Logistics Revenue', type: 'currency', sheetColumn: 'Logistics Revenue', derived: true, aggregate: 'sum' },
    { key: 'total_rev', header: 'Total Revenue', type: 'currency', sheetColumn: 'Total Revenue', derived: true },
    { key: 'rev_per_sqft', header: 'Revenue / SQFT', type: 'currency', sheetColumn: 'Revenue / SQFT', derived: true },
    { key: 'rev_per_client', header: 'Revenue / Client', type: 'currency', sheetColumn: 'Revenue / Client', derived: true },
    { key: 'rev_per_move', header: 'Revenue / Transaction', type: 'currency', sheetColumn: 'Revenue / Transaction', derived: true },
    { key: 'client_churn', header: 'Client Churn %', type: 'percent', sheetColumn: 'Client Churn %', derived: true },
    { key: 'space_churn', header: 'Space Churn %', type: 'percent', sheetColumn: 'Space Churn %', derived: true },
    { key: 'client_growth', header: 'Client Growth %', type: 'percent', sheetColumn: 'Client Growth %', derived: true },
    { key: 'sqft_growth', header: 'SQFT Growth %', type: 'percent', sheetColumn: 'SQFT Growth %', derived: true },
    { key: 'rev_growth', header: 'Revenue Growth %', type: 'percent', sheetColumn: 'Revenue Growth %', derived: true },
    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By', derived: true, hiddenByDefault: true },
  ]),

  b2bBase('b2b_sales', 'Sales', 'trending', 'b2b_sales', [
    { key: 'row_key', header: 'Row key', type: 'id', sheetColumn: 'Row key',
      derived: true, unique: true, hiddenByDefault: true },
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
      required: true, filterable: true, sortable: true, role: 'date' },
    { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
      required: true, filterable: true, groupable: true, editable: true,
      enumValues: [...B2B_CITIES], role: 'location' },
    { key: 'total_leads', header: 'Total Leads', type: 'number', sheetColumn: 'Total Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'invalid', header: 'Invalid Leads', type: 'number', sheetColumn: 'Invalid Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'unresponsive', header: 'Unresponsive Leads', type: 'number', sheetColumn: 'Unresponsive Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'valid', header: 'Valid Leads', type: 'number', sheetColumn: 'Valid Leads',
      derived: true, aggregate: 'sum', help: 'Total − invalid − unresponsive.' },
    { key: 'txn_leads', header: 'Transactional Leads', type: 'number', sheetColumn: 'Transactional Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'nontxn_leads', header: 'Non-Transactional Leads', type: 'number', sheetColumn: 'Non-Transactional Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'doc_leads', header: 'Document Leads', type: 'number', sheetColumn: 'Document Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'following_up', header: 'Following Up', type: 'number', sheetColumn: 'Following Up',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'closed_won', header: 'Closed Won', type: 'number', sheetColumn: 'Closed Won',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'closed_lost', header: 'Closed Lost', type: 'number', sheetColumn: 'Closed Lost',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'cold', header: 'Cold Leads', type: 'number', sheetColumn: 'Cold Leads',
      editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
    { key: 'conversion', header: 'Conversion Rate', type: 'percent', sheetColumn: 'Conversion Rate',
      derived: true, help: 'Closed won ÷ valid leads.' },
    { key: 'sqft_won', header: 'SQFT Won', type: 'number', sheetColumn: 'SQFT Won',
      editable: true, min: 0, aggregate: 'sum' },
    { key: 'est_rev', header: 'Estimated Monthly Revenue', type: 'currency', sheetColumn: 'Estimated Monthly Revenue',
      editable: true, min: 0, aggregate: 'sum', role: 'revenue' },
    { key: 'avg_sqft', header: 'Avg SQFT / Client', type: 'number', sheetColumn: 'Avg SQFT / Client', derived: true },
    { key: 'avg_price', header: 'Avg Price / SQFT', type: 'currency', sheetColumn: 'Avg Price / SQFT', derived: true },
    { key: 'lost_too_far', header: 'Lost — location too far', type: 'number',
      sheetColumn: 'Lost location too far', editable: true, min: 0, aggregate: 'sum' },
    { key: 'lost_no_need', header: 'Lost — no longer requires service', type: 'number',
      sheetColumn: 'Lost no longer requires', editable: true, min: 0, aggregate: 'sum' },
    { key: 'lost_unsuitable', header: 'Lost — requirement not suitable', type: 'number',
      sheetColumn: 'Lost requirement not suitable', editable: true, min: 0, aggregate: 'sum' },
    { key: 'lost_ops', header: 'Lost — operational not accommodated', type: 'number',
      sheetColumn: 'Lost operational', editable: true, min: 0, aggregate: 'sum' },
    { key: 'lost_other_loc', header: 'Lost — requires another location', type: 'number',
      sheetColumn: 'Lost another location', editable: true, min: 0, aggregate: 'sum' },
    { key: 'lost_other', header: 'Lost — other', type: 'number',
      sheetColumn: 'Lost other', editable: true, min: 0, aggregate: 'sum' },
    { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
      derived: true, hiddenByDefault: true },
  ]),
];

export const DATASETS: DatasetDef[] = [
  ...SALES_DATASETS,
  ...OPERATIONS_DATASETS,
  ...CONTROL_TOWER_DATASETS,
  ...FINANCE_DATASETS,
  ...B2B_DATASETS,
  /* ------------------------------------------------------------------ *
   * Warehouses — the master list.
   *
   * One row per warehouse, no months. This is what fills the dropdown on the
   * readings form, and the only place total space is edited. Employees hold
   * VIEW here but not UPDATE, so they can select a warehouse without being
   * able to change its size.
   * ------------------------------------------------------------------ */
  {
    id: 'warehouses',
    label: 'Warehouses',
    noun: 'warehouse',
    department: 'facility',
    spreadsheetEnv: 'SHEETS_ID_FACILITY',
    sheetName: 'Warehouses',
    createMissingTab: true,
    idColumn: 'wh_code',
    titleColumn: 'wh_name',
    subtitleColumns: ['city', 'location'],
    statusColumn: 'status',
    defaultSort: { key: 'wh_code', dir: 'asc' },
    auditable: true,
    columns: [
      { key: 'wh_code', header: 'WH Code', type: 'id', sheetColumn: 'WH Code',
        required: true, editable: true, unique: true, filterable: true, sortable: true,
        pattern: '^[A-Za-z0-9:_-]{3,32}$', patternHint: 'PUN:002',
        help: 'Unique code for this warehouse. Used by every monthly reading.' },

      { key: 'wh_name', header: 'WH Name', type: 'text', sheetColumn: 'WH Name',
        required: true, editable: true, sortable: true },

      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
        required: true, editable: true, filterable: true, groupable: true,
        enumValues: ['Bangalore', 'Chennai', 'Delhi', 'Hyderabad', 'Mumbai', 'Pune', 'Kolkata'], role: 'location' },

      { key: 'location', header: 'Location', type: 'text', sheetColumn: 'Location',
        editable: true, filterable: true, groupable: true,
        help: 'Area within the city, e.g. Alur or Rampura.' },

      { key: 'total_space', header: 'Total Space (sqft)', type: 'number', sheetColumn: 'Total Space',
        required: true, editable: true, min: 1, aggregate: 'sum', role: 'capacity',
        help: 'Changing this affects future readings only. Past months keep the figure recorded at the time.' },

      { key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status',
        required: true, editable: true, filterable: true,
        enumValues: ['Active', 'Inactive'], role: 'status',
        tone: { Active: 'pos', Inactive: 'idle' },
        help: 'Inactive warehouses stay in past readings but leave the dropdown.' },
        
    ],
  },

  /* ------------------------------------------------------------------ *
   * Warehouse space readings — one tab per month.
   *
   * The employee supplies two values: which warehouse, and how much of it is
   * occupied this month. Everything else is filled by the server.
   *
   * wh_name / city / location / total_space are SNAPSHOT from the master at
   * write time rather than joined at read time. If a warehouse is expanded in
   * June, March must keep showing March's figures — a live join would rewrite
   * history and reshape every trend chart behind it.
   * ------------------------------------------------------------------ */
  {
    id: 'warehouse_readings',
    label: 'Warehouse Space',
    noun: 'reading',
    department: 'facility',
    /* The ops report carries a space block that is this dataset. Surfacing it
     * rather than copying it is what keeps one month of occupancy in one tab. */
    alsoIn: ['operations'],
    spreadsheetEnv: 'SHEETS_ID_FACILITY',
    sheetName: 'Readings',
    tabStrategy: 'monthly',
    tabPrefix: 'Readings',
    monthsBack: 24,
    monthsForward: 1,
    createMissingTab: true,
    idColumn: 'wh_code',
    titleColumn: 'wh_name',
    subtitleColumns: ['city'],
    dateColumn: 'recorded_on',
    defaultSort: { key: 'city', dir: 'asc' },
    auditable: true,
    columns: [
      // --- entered by the user ---
      { key: 'wh_code', header: 'WH Code', type: 'id', sheetColumn: 'WH Code',
        required: true, editable: true, unique: true, filterable: true, sortable: true,
        help: 'Chosen from the warehouse list. One reading per warehouse per month.' },

      { key: 'occupied_space', header: 'Occupied Space (sqft)', type: 'number', sheetColumn: 'Occupied Space',
        required: true, editable: true, min: 0, aggregate: 'sum', role: 'occupied',
        help: 'Space in use this month. Cannot exceed the warehouse total.' },

      { key: 'recorded_on', header: 'Recorded On', type: 'date', sheetColumn: 'Recorded On',
        editable: true, role: 'date',
        help: 'Defaults to today if left blank.' },

      // --- filled by the server (api/_lib/derive.ts) ---
      // Written into the row as well as computed, so the tab reads properly
      // when someone opens the spreadsheet directly.
      { key: 'wh_name', header: 'WH Name', type: 'text', sheetColumn: 'WH Name',
        derived: true, sortable: true },

      { key: 'city', header: 'City', type: 'enum', sheetColumn: 'City',
        derived: true, filterable: true, groupable: true,
        enumValues: ['Bangalore', 'Chennai', 'Delhi', 'Hyderabad', 'Mumbai', 'Pune'], role: 'location' },

      { key: 'location', header: 'Location', type: 'text', sheetColumn: 'Location',
        derived: true, filterable: true, groupable: true },

      { key: 'total_space', header: 'Total Space (sqft)', type: 'number', sheetColumn: 'Total Space',
        derived: true, aggregate: 'sum', role: 'capacity',
        help: 'Snapshot of the warehouse total at the time this reading was entered.' },

      { key: 'available_space', header: 'Available Space (sqft)', type: 'number', sheetColumn: 'Available Space',
        derived: true, aggregate: 'sum',
        help: 'Total minus occupied. Computed, never entered.' },

      
      { key: 'utilisation_pct', header: 'Utilisation %', type: 'percent', sheetColumn: 'Utilisation %',
        derived: true },

      { key: 'avg_space', header: 'Average Space (sqft)', type: 'number',
        sheetColumn: 'Average Space', derived: true,
        help: 'Occupied space per active customer. Blank when there are no customers, '
          + 'because an average over nobody is not zero.' },

      /* --- customers, entered monthly per warehouse ---
       *
       * Churn = customers left ÷ closing total × 100. Average space is
       * occupied sqft ÷ closing total. */
      { key: 'total_customers', header: 'Total Customers', type: 'number',
        sheetColumn: 'Total Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity',
        help: 'Customers at the end of this month.' },

      { key: 'new_customers', header: 'New Customers', type: 'number',
        sheetColumn: 'New Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity',
        help: 'Joined during this month.' },

      { key: 'churned_customers', header: 'Customers Left', type: 'number',
        sheetColumn: 'Customers Left',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity',
        help: 'Left during this month.' },

      { key: 'churn_pct', header: 'Churn %', type: 'percent',
        sheetColumn: 'Churn %', derived: true,
        help: 'Customers left ÷ customers at the start of the month (total − new + left) × 100. Computed, never entered.' },

      { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
        derived: true, hiddenByDefault: true },
    ],
    crossFieldRules: [
      (v) => {
        const occ = Number(String(v.occupied_space ?? '').replace(/[,\s]/g, ''));
        return occ < 0 ? { key: 'occupied_space', message: 'Occupied space cannot be negative.' } : null;
      },
    ],
  },

  /* ------------------------------------------------------------------ *
   * Collections — monthly summary.
   *
   * One row per month. The team's working sheet is transposed (months across
   * columns, metrics down rows), which the platform cannot read: row 1 must be
   * headers and every later row a record. Point sheetName at a helper tab that
   * TRANSPOSE()s the working grid, so the team keeps editing the layout they
   * already use and the app reads a shape it understands.
   * ------------------------------------------------------------------ */
  {
    id: 'collections_monthly',
    label: 'Collection Summary',
    icon: 'trending',
    businessLine: 'B2C',
    noun: 'month',
    department: 'collections',
    spreadsheetEnv: 'SHEETS_ID_COLLECTIONS',
    sheetName: 'monthly_summary',
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    transposable: true,
    combinedEntry: true,
    entryForm: 'collections',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: [
      { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
        required: true, filterable: true, sortable: true, role: 'date',
        help: 'First of the month. One row per month.' },

      { key: 'collection_amount', header: 'Collection Amount', type: 'currency',
        sheetColumn: 'Collection Amount', aggregate: 'sum', editable: true, min: 0,
        help: 'Total collected against all outstanding, not only this month.' },

      { key: 'collection_month', header: 'Collection (this month)', type: 'currency',
        sheetColumn: 'Collection amount for the month', aggregate: 'sum', editable: true, min: 0,
        help: 'Received against this month only, not the running total.' },

      { key: 'raised_amount', header: 'Raised Invoice Amount', type: 'currency',
        sheetColumn: 'Raised Invoice amount', aggregate: 'sum', role: 'amount',
        editable: true, min: 0 },

      { key: 'pending_amount', header: 'Pending Collection', type: 'currency',
        sheetColumn: 'Pending collection amount', aggregate: 'sum', derived: true,
        help: 'Raised minus collected. Computed, never entered.' },

      { key: 'gap_pct', header: 'Gap %', type: 'percent', sheetColumn: 'Gap in %',
        derived: true, help: 'Share of raised invoicing not yet collected. Computed.' },

      { key: 'pending_to_date', header: 'Pending To Date', type: 'currency',
        sheetColumn: 'Total Pending Invoice amount till date', editable: true, min: 0,
        help: 'Cumulative, not this month alone.' },

      /* Comparison is deliberately NOT a column here. It is a relationship
         between two months, so storing it makes every stored value wrong the
         moment a month is inserted before it. The app computes it on read from
         the rows in view, where all the months are present and sortable. The
         sheet keeps its own Comparison column for people reading the sheet. */

      /* ---------------------------------------------------------------- *
       * Source of revenue, one set of columns per segment.
       *
       * Held on the month's own row rather than in a second tab: a month is
       * then a single write, so it cannot be half saved, and the three
       * segments cannot drift out of step with the totals above them.
       *
       * The cost is that a new line of business is a schema change here plus
       * five new sheet columns, not a row someone types. That is the right
       * trade while the three segments are fixed.
       * ---------------------------------------------------------------- */
      /* --- Pickup --- */
      { key: 'pk_raised', header: 'Pickup Raised', type: 'currency',
        sheetColumn: 'Pickup Raised Invoices Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'pk_collected', header: 'Pickup Collected', type: 'currency',
        sheetColumn: 'Pickup Collection Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'pk_gap', header: 'Pickup Gap in Rs.', type: 'currency',
        sheetColumn: 'Pickup Gap in Rs.', aggregate: 'sum', derived: true },
      { key: 'pk_gap_pct', header: 'Pickup Gap %', type: 'percent',
        sheetColumn: 'Pickup Gap in %', derived: true },
      { key: 'pk_share', header: 'Pickup Share in revenue', type: 'percent',
        sheetColumn: 'Pickup Share in revenue', derived: true },
      /* --- Delivery --- */
      { key: 'dl_raised', header: 'Delivery Raised', type: 'currency',
        sheetColumn: 'Delivery Raised Invoices Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'dl_collected', header: 'Delivery Collected', type: 'currency',
        sheetColumn: 'Delivery Collection Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'dl_gap', header: 'Delivery Gap in Rs.', type: 'currency',
        sheetColumn: 'Delivery Gap in Rs.', aggregate: 'sum', derived: true },
      { key: 'dl_gap_pct', header: 'Delivery Gap %', type: 'percent',
        sheetColumn: 'Delivery Gap in %', derived: true },
      { key: 'dl_share', header: 'Delivery Share in revenue', type: 'percent',
        sheetColumn: 'Delivery Share in revenue', derived: true },
      /* --- Storage --- */
      { key: 'st_raised', header: 'Storage Raised', type: 'currency',
        sheetColumn: 'Storage Raised Invoices Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'st_collected', header: 'Storage Collected', type: 'currency',
        sheetColumn: 'Storage Collection Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'st_gap', header: 'Storage Gap in Rs.', type: 'currency',
        sheetColumn: 'Storage Gap in Rs.', aggregate: 'sum', derived: true },
      { key: 'st_gap_pct', header: 'Storage Gap %', type: 'percent',
        sheetColumn: 'Storage Gap in %', derived: true },
      { key: 'st_share', header: 'Storage Share in revenue', type: 'percent',
        sheetColumn: 'Storage Share in revenue', derived: true },
    ],
  },


  /* ------------------------------------------------------------------ *
   * Collections — B2C monthly report.
   *
   * The two report tables the team circulates: a customer/amount summary and
   * a per-city invoice/collection split. One row per month holds both, so a
   * month is a single write and the city figures cannot drift out of step
   * with the summary above them — the same shape, and the same reason, as
   * the revenue segments on collections_monthly.
   *
   * `header` matches `sheetColumn` and both match the report images exactly,
   * including "Receivables Amount (>60 Days)" with its plural and its
   * bracket. The report is circulated as-is to people outside this app, and a
   * label that reads differently here is a label someone will query.
   *
   * TOTALS ARE DERIVED, not entered. Total Raised Amount is the sum of the
   * city invoice figures and Total Collection Amount the sum of the city
   * collections — the source images show 2.33Cr and 2.39Cr in both places.
   * Typing them again is one more chance for the two halves of a report to
   * contradict each other in front of management.
   *
   * Cities are column groups rather than rows because a month must stay one
   * write. The cost is that a ninth city is a schema change here plus two
   * sheet columns. That is the right trade while the list is stable; if
   * cities start moving, this becomes a per-city-row dataset keyed on
   * month + city instead.
   * ------------------------------------------------------------------ */
  {
    id: 'collections_b2c_report',
    label: 'Report',
    noun: 'month',
    department: 'collections',
    businessLine: 'B2C',
    spreadsheetEnv: 'SHEETS_ID_COLLECTIONS',
    // Created on first write if absent. Rename the tab in Sheets and change
    // this line with it; nothing else in the app knows the name.
    sheetName: 'b2c_monthly_report',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'b2c_report',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: [
      { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
        required: true, filterable: true, sortable: true, unique: true, role: 'date',
        help: 'First of the month. One row per month.' },

      /* --- customer & amount summary --- */
      { key: 'customers_raised', header: 'Total Customers Raised', type: 'number',
        sheetColumn: 'Total Customers Raised',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },

      { key: 'raised_amount', header: 'Total Raised Amount', type: 'currency',
        sheetColumn: 'Total Raised Amount', aggregate: 'sum', role: 'amount',
        derived: true,
        help: 'Sum of the city invoice amounts. Computed, never entered.' },

      { key: 'collected_customers', header: 'Total Collected Customers', type: 'number',
        sheetColumn: 'Total Collected Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity',
        help: 'Can exceed customers raised — collections land against earlier months too.' },

      { key: 'collection_amount', header: 'Total Collection Amount', type: 'currency',
        sheetColumn: 'Total Collection Amount', aggregate: 'sum',
        derived: true,
        help: 'Sum of the city collection amounts. Computed, never entered.' },

      { key: 'pending_customers', header: 'Pending Customers', type: 'number',
        sheetColumn: 'Pending Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },

      /* Deliberately NOT the same figure as "Pending collection amount" on
         collections_monthly. That one is this month's raised less this
         month's collected; this is the value of invoices still unpaid across
         all months. Both are correct and they will not match — which is why
         each keeps the name its own report uses. */
      { key: 'pending_amount', header: 'Pending Amount', type: 'currency',
        sheetColumn: 'Pending Amount', aggregate: 'sum',
        editable: true, min: 0,
        help: 'Value of unpaid invoices outstanding. Not the monthly raised-minus-collected gap.' },

      { key: 'receivable_customers_60', header: 'Receivable Customers (>60 Days)', type: 'number',
        sheetColumn: 'Receivable Customers (>60 Days)',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },

      { key: 'receivables_amount_60', header: 'Receivables Amount (>60 Days)', type: 'currency',
        sheetColumn: 'Receivables Amount (>60 Days)', aggregate: 'sum',
        editable: true, min: 0 },

      /* --- per city: invoice + collection --- */
      { key: 'blr_invoice', header: 'Bangalore Invoice Amount', type: 'currency',
        sheetColumn: 'Bangalore Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'blr_collection', header: 'Bangalore Collection Amount', type: 'currency',
        sheetColumn: 'Bangalore Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'hyd_invoice', header: 'Hyderabad Invoice Amount', type: 'currency',
        sheetColumn: 'Hyderabad Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'hyd_collection', header: 'Hyderabad Collection Amount', type: 'currency',
        sheetColumn: 'Hyderabad Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'che_invoice', header: 'Chennai Invoice Amount', type: 'currency',
        sheetColumn: 'Chennai Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'che_collection', header: 'Chennai Collection Amount', type: 'currency',
        sheetColumn: 'Chennai Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'pun_invoice', header: 'Pune Invoice Amount', type: 'currency',
        sheetColumn: 'Pune Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'pun_collection', header: 'Pune Collection Amount', type: 'currency',
        sheetColumn: 'Pune Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'mum_invoice', header: 'Mumbai Invoice Amount', type: 'currency',
        sheetColumn: 'Mumbai Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'mum_collection', header: 'Mumbai Collection Amount', type: 'currency',
        sheetColumn: 'Mumbai Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'del_invoice', header: 'Delhi Invoice Amount', type: 'currency',
        sheetColumn: 'Delhi Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'del_collection', header: 'Delhi Collection Amount', type: 'currency',
        sheetColumn: 'Delhi Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'kol_invoice', header: 'Kolkata Invoice Amount', type: 'currency',
        sheetColumn: 'Kolkata Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'kol_collection', header: 'Kolkata Collection Amount', type: 'currency',
        sheetColumn: 'Kolkata Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'gur_invoice', header: 'Gurugram Invoice Amount', type: 'currency',
        sheetColumn: 'Gurugram Invoice Amount', aggregate: 'sum', editable: true, min: 0 },
      { key: 'gur_collection', header: 'Gurugram Collection Amount', type: 'currency',
        sheetColumn: 'Gurugram Collection Amount', aggregate: 'sum', editable: true, min: 0 },

      { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
        derived: true, hiddenByDefault: true },
    ],
  },


  /* ------------------------------------------------------------------ *
   * Marketing — monthly lead performance.
   *
   * One row per month, three categories as column groups on that row. The
   * same shape collections uses for its revenue segments, and for the same
   * reason: a month is then a single write, so the three categories cannot
   * drift out of step with the totals above them.
   *
   * Totals are derived, never entered. The mockup shows Total Leads beside
   * Valid and Invalid, and a person retyping a sum is a person who can make
   * it disagree with the two numbers next to it.
   * ------------------------------------------------------------------ */
  {
    id: 'marketing_leads',
    label: 'Lead Performance',
    noun: 'month',
    department: 'marketing',
    spreadsheetEnv: 'SHEETS_ID_MARKETING',
    sheetName: 'lead_performance',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'marketing',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: [
      { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
        required: true, filterable: true, sortable: true, unique: true, role: 'date',
        help: 'First of the month. One row per month.' },

      /* --- B2B --- */
      { key: 'b2b_valid', header: 'B2B Valid Leads', type: 'number', sheetColumn: 'B2B Valid Leads',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'b2b_invalid', header: 'B2B Invalid Leads', type: 'number', sheetColumn: 'B2B Invalid Leads',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'b2b_total', header: 'B2B Total Leads', type: 'number', sheetColumn: 'B2B Total Leads',
        derived: true, aggregate: 'sum',
        help: 'Valid plus invalid. Computed, never entered.' },

      /* --- B2C --- */
      { key: 'b2c_valid', header: 'B2C Valid Leads', type: 'number', sheetColumn: 'B2C Valid Leads',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'b2c_invalid', header: 'B2C Invalid Leads', type: 'number', sheetColumn: 'B2C Invalid Leads',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'b2c_total', header: 'B2C Total Leads', type: 'number', sheetColumn: 'B2C Total Leads',
        derived: true, aggregate: 'sum' },

      /* --- Packing & Moving --- */
      { key: 'pm_valid', header: 'P&M Valid Leads', type: 'number', sheetColumn: 'P&M Valid Leads',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'pm_invalid', header: 'P&M Invalid Leads', type: 'number', sheetColumn: 'P&M Invalid Leads',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'pm_total', header: 'P&M Total Leads', type: 'number', sheetColumn: 'P&M Total Leads',
        derived: true, aggregate: 'sum' },

      /* --- month roll-up --- */
      { key: 'total_valid', header: 'Total Valid Leads', type: 'number', sheetColumn: 'Total Valid Leads',
        derived: true, aggregate: 'sum' },
      { key: 'total_invalid', header: 'Total Invalid Leads', type: 'number', sheetColumn: 'Total Invalid Leads',
        derived: true, aggregate: 'sum' },
      { key: 'total_leads', header: 'Total Leads', type: 'number', sheetColumn: 'Total Leads',
        derived: true, aggregate: 'sum' },
      { key: 'valid_rate_pct', header: 'Valid Lead Rate', type: 'percent', sheetColumn: 'Valid Lead Rate',
        derived: true, help: 'Valid leads as a share of all leads received.' },

      { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
        derived: true, hiddenByDefault: true },
    ],
  },

  /* ------------------------------------------------------------------ *
   * Marketing — acquisition and cost.
   *
   * Only two things per category are ENTERED here: what was spent, and how
   * many customers it produced. CPL, CPVL, CAC and lead-to-customer rate are
   * all arithmetic over that spend and the lead counts in marketing_leads,
   * so they are derived server-side against the matching month.
   *
   * Storing them as typed columns instead would let them go stale the moment
   * someone corrects a lead count — the figures would still render, they
   * would just quietly be wrong, which is worse than "Data unavailable".
   * ------------------------------------------------------------------ */
  {
    id: 'marketing_acquisition',
    label: 'Acquisition & Cost',
    noun: 'month',
    department: 'marketing',
    spreadsheetEnv: 'SHEETS_ID_MARKETING',
    sheetName: 'acquisition_cost',
    createMissingTab: true,
    idColumn: 'month',
    titleColumn: 'month',
    dateColumn: 'month',
    combinedEntry: true,
    entryForm: 'marketing',
    defaultSort: { key: 'month', dir: 'desc' },
    auditable: true,
    columns: [
      { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month',
        required: true, filterable: true, sortable: true, unique: true, role: 'date',
        help: 'Must match a month already present in Lead Performance.' },
      { key: 'b2c_spend', header: 'B2C Marketing Spend', type: 'currency',
        sheetColumn: 'B2C Marketing Spend',
        editable: true, min: 0, aggregate: 'sum', role: 'cost' },
      { key: 'b2b_spend', header: 'B2B Marketing Spend', type: 'currency',
        sheetColumn: 'B2B Marketing Spend',
        editable: true, min: 0, aggregate: 'sum', role: 'cost' },
      { key: 'pm_spend', header: 'P&M Marketing Spend', type: 'currency',
        sheetColumn: 'P&M Marketing Spend',
        editable: true, min: 0, aggregate: 'sum', role: 'cost' },
 
      /* --- ENTERED: customers won per category ---
       *
       * Counted, not implied. CAC divides spend by this, so without it there
       * is no honest CAC — which is why it is entered rather than derived
       * from a CAC the team would otherwise have to supply. */
      { key: 'b2c_customers', header: 'B2C Customers', type: 'number',
        sheetColumn: 'B2C Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity',
        help: 'Leads that became paying customers this month.' },
      { key: 'b2b_customers', header: 'B2B Customers', type: 'number',
        sheetColumn: 'B2B Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
      { key: 'pm_customers', header: 'P&M Customers', type: 'number',
        sheetColumn: 'P&M Customers',
        editable: true, min: 0, aggregate: 'sum', role: 'quantity' },
 
      /* --- DERIVED: month roll-up ---
       *
       * Summed, never typed. A typed total that disagrees with three typed
       * parts leaves nothing to say which of the four is wrong. */
      { key: 'total_spend', header: 'Total Marketing Spend', type: 'currency',
        sheetColumn: 'Total Marketing Spend', derived: true, aggregate: 'sum', role: 'cost' },
      { key: 'total_customers', header: 'Total Customers', type: 'number',
        sheetColumn: 'Total Customers', derived: true, aggregate: 'sum' },
 
      /* --- DERIVED: cost per lead = spend / total leads --- */
      { key: 'b2c_cpl', header: 'B2C CPL', type: 'currency', sheetColumn: 'B2C CPL',
        derived: true, role: 'cost' },
      { key: 'b2b_cpl', header: 'B2B CPL', type: 'currency', sheetColumn: 'B2B CPL',
        derived: true, role: 'cost' },
      { key: 'pm_cpl', header: 'P&M CPL', type: 'currency', sheetColumn: 'P&M CPL',
        derived: true, role: 'cost' },
 
    
      /* --- DERIVED: customer acquisition cost = spend / customers --- */
      { key: 'b2c_cac', header: 'B2C CAC', type: 'currency', sheetColumn: 'B2C CAC',
        derived: true, role: 'cost' },
      { key: 'b2b_cac', header: 'B2B CAC', type: 'currency', sheetColumn: 'B2B CAC',
        derived: true, role: 'cost' },
      { key: 'pm_cac', header: 'P&M CAC', type: 'currency', sheetColumn: 'P&M CAC',
        derived: true, role: 'cost' },
 
      /* --- DERIVED: lead to customer rate = customers / total leads --- */
      { key: 'b2c_l2c', header: 'B2C Lead to Customer Rate', type: 'percent',
        sheetColumn: 'B2C Lead to Customer Rate', derived: true },
      { key: 'b2b_l2c', header: 'B2B Lead to Customer Rate', type: 'percent',
        sheetColumn: 'B2B Lead to Customer Rate', derived: true },
      { key: 'pm_l2c', header: 'P&M Lead to Customer Rate', type: 'percent',
        sheetColumn: 'P&M Lead to Customer Rate', derived: true },
 
      /* --- DERIVED: blended across all three categories ---
       *
       * Weighted by construction — total spend over total leads, not an
       * average of the three CPLs. A straight average would treat a category
       * bringing 226 leads as equal to one bringing 2,551. */
      { key: 'cpl', header: 'Blended CPL', type: 'currency', sheetColumn: 'Blended CPL', derived: true },
      { key: 'cac', header: 'Blended CAC', type: 'currency', sheetColumn: 'Blended CAC', derived: true },
      { key: 'l2c_rate', header: 'Lead to Customer Rate', type: 'percent',
        sheetColumn: 'Lead to Customer Rate', derived: true },
 
      /* --- DERIVED: the lead counts everything above was divided by ---
       *
       * Snapshotted at write time, not joined at read time. Correcting March's
       * leads in June must not silently rewrite March's CPL — the figure would
       * still render, it would just quietly describe a denominator that no
       * longer exists. Same reasoning as the warehouse readings snapshot. */
      { key: 'leads_at_entry', header: 'Total Leads (at entry)', type: 'number',
        sheetColumn: 'Total Leads (at entry)', derived: true, hiddenByDefault: true },
      { key: 'valid_at_entry', header: 'Valid Leads (at entry)', type: 'number',
        sheetColumn: 'Valid Leads (at entry)', derived: true, hiddenByDefault: true },
 
      { key: 'entered_by', header: 'Entered By', type: 'email', sheetColumn: 'Entered By',
        derived: true, hiddenByDefault: true },
    ],
  },

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
/**
 * Schema for a dataset id.
 *
 * Accepts a month-scoped id ("warehouse_readings::Readings SEP 2026") as well
 * as a plain one. A month is a different set of ROWS, not a different schema,
 * so both resolve to the same definition.
 */
export const getDataset = (id: string): DatasetDef | undefined =>
  byId[id.includes('::') ? id.slice(0, id.indexOf('::')) : id];
export const isMapped = (datasetId: string, columnKey: string) =>
  Boolean(byId[datasetId]?.columns.find(c => c.key === columnKey)?.sheetColumn);
export const visibleColumns = (d: DatasetDef) => d.columns.filter(c => c.sheetColumn);

/** @deprecated reads the seed only; use getDataset() or allDatasets(). */
export const DATASET_BY_ID = byId;

