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
  salesDataset('sales_business', 'Business', 'Business', 'trending', 'business_monthly'),
];


export const DATASETS: DatasetDef[] = [
  ...SALES_DATASETS,
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

      /* --- customers, entered monthly per warehouse ---
       *
       * Churn divides by the OPENING balance, not the closing total: the
       * customers who joined this month were never at risk of leaving it.
       * Opening is derived from the three entered figures, so a month is
       * self-contained and can be corrected without touching its neighbour —
       * and it doubles as a check, since it should equal last month's total. */
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

      { key: 'opening_customers', header: 'Opening Customers', type: 'number',
        sheetColumn: 'Opening Customers', derived: true, aggregate: 'sum',
        help: 'Total minus new plus left. Should match last month closing.' },

              { key: 'churn_pct', header: 'Churn %', type: 'percent',
        sheetColumn: 'Churn %', derived: true,
        help: 'Left as a share of the opening balance. Computed, never entered.' },

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
 
      /* --- DERIVED: cost per valid lead = spend / valid leads --- */
      { key: 'b2c_cpvl', header: 'B2C CPVL', type: 'currency', sheetColumn: 'B2C CPVL',
        derived: true, role: 'cost' },
      { key: 'b2b_cpvl', header: 'B2B CPVL', type: 'currency', sheetColumn: 'B2B CPVL',
        derived: true, role: 'cost' },
      { key: 'pm_cpvl', header: 'P&M CPVL', type: 'currency', sheetColumn: 'P&M CPVL',
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
      { key: 'cpvl', header: 'Blended CPVL', type: 'currency', sheetColumn: 'Blended CPVL', derived: true },
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

