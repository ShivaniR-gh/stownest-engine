import type { ColumnDef, ColumnType, DatasetDef, DepartmentId, SemanticRole } from '../../src/config/types.js';
import { DATASETS as SEED } from '../../src/config/datasets.js';
import { readRange } from './sheets.js';
import { HttpError, required } from './env.js';

/** ---------------------------------------------------------------------------
 * Runtime dataset registry.
 *
 * Schema lives in two tabs of the control spreadsheet rather than in compiled
 * TypeScript, so a department admin can connect a sheet without a deploy:
 *
 *   data_sources    one row per connected dataset (which workbook, which tab)
 *   field_mappings  one row per column (sheet header -> internal key + type)
 *
 * Configuration is kept strictly separate from business data. The seed defs in
 * src/config/datasets.ts remain as the fallback for datasets that have not been
 * migrated, so nothing that works today stops working.
 * ------------------------------------------------------------------------- */

export const SOURCES_TAB = 'data_sources';
export const MAPPINGS_TAB = 'field_mappings';

export const SOURCES_HEADERS = [
  'Dataset ID', 'Department', 'Label', 'Noun', 'Spreadsheet ID', 'Tab Name',
  'ID Column', 'Date Column', 'Status Column', 'Title Column', 'Status',
  'Connected By', 'Connected At',
] as const;

export const MAPPINGS_HEADERS = [
  'Dataset ID', 'Sheet Column', 'Key', 'Header', 'Type', 'Role', 'Editable', 'Required',
  'Filterable', 'Groupable', 'Aggregate', 'Enum Values', 'Hidden',
] as const;

export const ROLES: SemanticRole[] = [
  'identifier', 'name', 'location', 'category', 'status', 'date',
  'quantity', 'capacity', 'occupied', 'amount', 'cost', 'revenue',
];

const TTL = 30_000;
let cache: { at: number; defs: DatasetDef[] } | null = null;

const truthy = (v: unknown) => ['true', 'yes', '1', 'y'].includes(String(v ?? '').trim().toLowerCase());

/** Rows -> objects keyed by normalised header, so column order in the tab is irrelevant. */
function objectify(values: string[][]): Record<string, string>[] {
  if (!values.length) return [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '_');
  const headers = values[0].map(h => norm(String(h ?? '')));
  return values.slice(1)
    .filter(r => r && r.some(c => String(c ?? '').trim()))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])));
}

const VALID_TYPES: ColumnType[] = [
  'text', 'longtext', 'number', 'currency', 'percent', 'date', 'datetime',
  'enum', 'boolean', 'email', 'phone', 'id',
];

function toColumn(row: Record<string, string>): ColumnDef | null {
  const key = row.key || row.sheet_column;
  if (!key || !row.sheet_column) return null;
  const type = (VALID_TYPES as string[]).includes(row.type) ? (row.type as ColumnType) : 'text';
  const role = (ROLES as string[]).includes(row.role) ? (row.role as SemanticRole) : undefined;
  const enumValues = row.enum_values ? row.enum_values.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  return {
    key,
    header: row.header || row.sheet_column,
    type,
    role,
    sheetColumn: row.sheet_column,
    enumValues: type === 'enum' ? enumValues : undefined,
    editable: truthy(row.editable),
    required: truthy(row.required),
    filterable: truthy(row.filterable),
    groupable: truthy(row.groupable),
    sortable: true,
    hiddenByDefault: truthy(row.hidden),
    aggregate: ['sum', 'avg', 'count'].includes(row.aggregate) ? (row.aggregate as 'sum') : undefined,
  };
}

function toDataset(src: Record<string, string>, cols: ColumnDef[]): DatasetDef | null {
  const id = src.dataset_id;
  if (!id || !cols.length) return null;
  if (src.status && src.status.toLowerCase() !== 'connected') return null;

  const has = (k: string) => cols.some(c => c.key === k);
  const idColumn = has(src.id_column) ? src.id_column : cols[0].key;

  return {
    id,
    label: src.label || id,
    noun: src.noun || 'record',
    department: src.department as DepartmentId,
    sheetName: src.tab_name,
    spreadsheetEnv: undefined,
    // Runtime sources carry a literal id rather than an env var name.
    spreadsheetId: src.spreadsheet_id,
    idColumn,
    dateColumn: has(src.date_column) ? src.date_column : undefined,
    statusColumn: has(src.status_column) ? src.status_column : undefined,
    titleColumn: has(src.title_column) ? src.title_column : idColumn,
    subtitleColumns: [],
    columns: cols,
    auditable: true,
    defaultSort: has(src.date_column) ? { key: src.date_column, dir: 'desc' } : undefined,
  } as DatasetDef;
}

/**
 * The full registry: runtime-configured datasets override seed defs of the same
 * id; seed defs that have no runtime row are preserved.
 */
export async function loadRegistry(force = false): Promise<DatasetDef[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.defs;

  const control = required('SHEETS_SPREADSHEET_ID');
  let sources: Record<string, string>[] = [];
  let mappings: Record<string, string>[] = [];

  try {
    sources = objectify(await readRange(control, SOURCES_TAB));
    mappings = objectify(await readRange(control, MAPPINGS_TAB));
  } catch {
    // Tabs not created yet — the platform runs on seed defs until an admin
    // connects something. This is a valid state, not an error.
    cache = { at: Date.now(), defs: SEED };
    return SEED;
  }

  const byDataset = new Map<string, ColumnDef[]>();
  for (const m of mappings) {
    const col = toColumn(m);
    if (!col || !m.dataset_id) continue;
    if (!byDataset.has(m.dataset_id)) byDataset.set(m.dataset_id, []);
    byDataset.get(m.dataset_id)!.push(col);
  }

  const runtime = sources
    .map(s => toDataset(s, byDataset.get(s.dataset_id) ?? []))
    .filter((d): d is DatasetDef => d !== null);

  /**
   * Application-defined schema wins.
   *
   * These definitions are the source of truth: they decide what the entry form
   * shows, what the API accepts, what header row a new tab gets, and which
   * sheet column each value lands in. A runtime row in data_sources cannot
   * override one, because that row was produced by inspecting a spreadsheet and
   * guessing at its columns — the approach this architecture replaced.
   *
   * Runtime sources are still honoured for ids the code does not define, so a
   * sheet an admin connected previously keeps working until it is either given
   * a schema here or removed from the data_sources tab.
   */
  const codeIds = new Set(SEED.map(d => d.id));
  const defs = [...SEED, ...runtime.filter(d => !codeIds.has(d.id))];

  cache = { at: Date.now(), defs };
  return defs;
}

export const invalidateRegistry = () => { cache = null; };

export async function getDatasetDef(id: string): Promise<DatasetDef> {
  const def = (await loadRegistry()).find(d => d.id === id);
  if (!def) throw new HttpError(404, 'Unknown dataset.');
  return def;
}

/** Raw rows from data_sources, for the management UI (includes disconnected). */
export async function listSources(): Promise<Record<string, string>[]> {
  try { return objectify(await readRange(required('SHEETS_SPREADSHEET_ID'), SOURCES_TAB)); }
  catch { return []; }
}
