import type { DepartmentDef } from '../../src/config/departments';
import { SEED_DEPARTMENTS } from '../../src/config/departments';
import { readRange } from './sheets';
import { HttpError, required } from './env';

/** ---------------------------------------------------------------------------
 * Runtime department registry.
 *
 * Departments are identity only — id, label, purpose, icon, status. They own no
 * columns and no metrics. Business data comes from data_sources, which is the
 * single owner of the department -> dataset relationship.
 *
 * Creating a department grants nobody anything. Access continues to come solely
 * from access_control, so creation and membership stay separate concerns.
 * ------------------------------------------------------------------------- */

export const DEPARTMENTS_TAB = 'departments';
export const DEPARTMENTS_HEADERS = ['ID', 'Label', 'Purpose', 'Icon', 'Status', 'Sort Order'] as const;

/** Safe identifier: lowercase, digits, underscore. Used in URLs and sheet cells. */
export const ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

const TTL = 30_000;
let cache: { at: number; defs: DepartmentDef[] } | null = null;

function objectify(values: string[][]): Record<string, string>[] {
  if (!values.length) return [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '_');
  const headers = values[0].map(h => norm(String(h ?? '')));
  return values.slice(1)
    .filter(r => r && r.some(c => String(c ?? '').trim()))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])));
}

/**
 * Live departments, runtime rows overriding seed by id, seed preserved for ids
 * with no runtime row. A failure to read the tab falls back to seed rather than
 * leaving a system with no departments and therefore no access.
 */
export async function loadDepartments(force = false): Promise<DepartmentDef[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.defs;

  let rows: Record<string, string>[] = [];
  try {
    rows = objectify(await readRange(required('SHEETS_SPREADSHEET_ID'), DEPARTMENTS_TAB));
  } catch (e) {
    console.error('[departments] could not read the departments tab; using seed configuration.', e);
    cache = { at: Date.now(), defs: SEED_DEPARTMENTS };
    return SEED_DEPARTMENTS;
  }

  const runtime: DepartmentDef[] = rows
    .filter(r => ID_PATTERN.test(r.id ?? ''))
        .map(r => ({
      id: r.id,
      label: r.label || r.id,
      purpose: r.purpose ?? '',
      icon: r.icon || 'layers',
      status: (r.status ?? 'Active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active',
      sortOrder: Number(r.sort_order) || 0,
      metrics: SEED_DEPARTMENTS.find(s => s.id === r.id)?.metrics ?? [],
      // The sheet owns identity — id, label, purpose, icon, status — but has no
      // column for a flag that selects a compiled component. Without this line
      // the runtime row drops it and the department falls back to the generic
      // dashboard and the generic record form.
      customDashboard: SEED_DEPARTMENTS.find(s => s.id === r.id)?.customDashboard,
            // Same reason as customDashboard above: the sheet has no column for it,
      // so a runtime row silently drops it and the department loses its
      // line-of-business tabs.
      businessLines: SEED_DEPARTMENTS.find(s => s.id === r.id)?.businessLines,
      inWorkspace: r.id !== 'administration',
    }));

  const ids = new Set(runtime.map(d => d.id));
  const defs = [...runtime, ...SEED_DEPARTMENTS.filter(d => !ids.has(d.id))]
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.label.localeCompare(b.label));

  cache = { at: Date.now(), defs };
  return defs;
}

export const invalidateDepartments = () => { cache = null; };

/* ------------------------------ validation ------------------------------- */

/** Department must exist. Never trust an id supplied by the browser. */
export async function assertDepartment(id: string): Promise<DepartmentDef> {
  const found = (await loadDepartments()).find(d => d.id === id);
  if (!found) throw new HttpError(400, `Unknown department "${id}".`);
  return found;
}

/** Department must exist AND be active — for operations that add configuration. */
export async function assertActiveDepartment(id: string): Promise<DepartmentDef> {
  const dept = await assertDepartment(id);
  if ((dept.status ?? 'Active') !== 'Active') {
    throw new HttpError(400, `${dept.label} is inactive. Reactivate it before connecting new data.`);
  }
  return dept;
}

export const knownDepartmentIds = async (): Promise<string[]> =>
  (await loadDepartments()).map(d => d.id);
