/** ---------------------------------------------------------------------------
 * Configuration contracts.
 * Departments, datasets and metrics are DATA, not code branches. Adding a
 * department means adding an entry here — no page, route or guard changes.
 * ------------------------------------------------------------------------- */

/**
 * Department identifier.
 *
 * A runtime string, not a compile-time union: super admins create departments
 * from the UI, so the set cannot be known at build time. Safety comes from
 * server-side validation against the runtime registry (api/_lib/departments.ts)
 * rather than from the type — which is stronger than before, since
 * access_control already accepted arbitrary strings by cast.
 */
export type DepartmentId = string;

export type Action =
  | 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'EXPORT' | 'ANALYTICS' | 'MANAGE_USERS' | 'MANAGE_PERMISSIONS';

export type RoleId = 'super_admin' | 'department_admin' | 'employee';

export type ColumnType =
  | 'text' | 'longtext' | 'number' | 'currency' | 'percent'
  | 'date' | 'datetime' | 'enum' | 'boolean' | 'email' | 'phone' | 'id';

/**
 * What a column MEANS, as distinct from what it holds.
 *
 * `type` says "Total Space (sqft)" is a number. `role` says it is a CAPACITY —
 * which is what lets utilisation be expressed once, generically, instead of
 * once per department in React.
 */
export type SemanticRole =
  | 'identifier' | 'name' | 'location' | 'category' | 'status' | 'date'
  | 'quantity' | 'capacity' | 'occupied' | 'amount' | 'cost' | 'revenue';

export interface ColumnDef {
  /** Stable internal key. Metrics and code reference this, never the sheet header. */
  key: string;
  header: string;
  type: ColumnType;
  /** Exact header text in the Google Sheet. Unset => column is unmapped and any
   *  metric depending on it renders "Data unavailable". */
  sheetColumn?: string;
  /** Semantic meaning, set by the admin in the field-mapping step. */
  role?: SemanticRole;
  enumValues?: string[];
  /** Maps an enum value to a semantic tone for badges. */
  tone?: Record<string, 'pos' | 'neg' | 'signal' | 'idle' | 'accent'>;
  width?: number;
  hiddenByDefault?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  sortable?: boolean;
  editable?: boolean;
  required?: boolean;
  /** Show a column total in the table footer. */
  aggregate?: 'sum' | 'avg' | 'count';
  help?: string;
}

export interface DatasetDef {
  id: string;
  label: string;
  /** Singular noun used in buttons and detail headers: "New job", "Delete lead". */
  noun: string;
  department: DepartmentId;
  /** Tab name inside the spreadsheet. */
  sheetName: string;
  /**
   * Name of the env var holding the spreadsheet id for THIS dataset. Omit to
   * use SHEETS_SPREADSHEET_ID. Teams that keep their own workbook get their own
   * variable, e.g. 'SHEETS_ID_LOGISTICS' — the app reads across all of them and
   * nothing else in the codebase needs to know there is more than one file.
   */
  spreadsheetEnv?: string;
  /** Literal spreadsheet id, set by runtime configuration from data_sources.
   *  Takes precedence over spreadsheetEnv. Never committed to source. */
  spreadsheetId?: string;
  /** Column key holding the stable row identifier. */
  idColumn: string;
  /** Column key used for date filtering across the app. */
  dateColumn?: string;
  /** Column key that drives the status badge and pipeline views. */
  statusColumn?: string;
  /** Columns shown in the detail page title block. */
  titleColumn: string;
  subtitleColumns?: string[];
  columns: ColumnDef[];
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** Written to an audit tab on every mutation. */
  auditable?: boolean;
}

export type MetricFormat = 'inr' | 'inr_compact' | 'int' | 'pct' | 'pp' | 'decimal' | 'days';

export interface MetricCtx {
  rows: Row[];
  /** Rows from the immediately preceding period of equal length, for deltas. */
  prevRows: Row[];
  /** Other datasets a metric may need to join against. */
  related: Record<string, Row[]>;
  mapped: (dataset: string, columnKey: string) => boolean;
}

export interface MetricDef {
  id: string;
  label: string;
  department: DepartmentId | 'business';
  dataset: string;
  /** Column keys in this metric's own dataset that must be mapped. */
  requires: string[];
  /** Extra datasets loaded into ctx.related. */
  requiresDatasets?: string[];
  /**
   * Column keys required from OTHER datasets, as { datasetId: [columnKey] }.
   * Without this, a metric joining two tables would pass the mapping check on
   * its own columns and then fail opaquely inside compute() — reporting
   * "Insufficient data" instead of naming the column that is actually missing.
   */
  requiresFrom?: Record<string, string[]>;
  format: MetricFormat;
  /** Which direction is good news — drives delta colour. */
  goodDirection?: 'up' | 'down' | 'neutral';
  /** Human-readable formula shown in the provenance panel. */
  formula: string;
  /** One line explaining what the number means in business terms. */
  definition: string;
  compute: (ctx: MetricCtx) => number | null;
  /** Optional drill-down target: dataset + prefilter. */
  drillTo?: { dataset: string; filter?: Record<string, string> };
  unit?: string;
}

export type Row = Record<string, unknown> & { __row?: number; __id?: string };
