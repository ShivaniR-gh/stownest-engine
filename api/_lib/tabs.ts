import type { DatasetDef } from '../../src/config/types.js';
import { HttpError } from './env.js';
import { ensureTab, readRange, rangeForSheet, resolveTab, spreadsheetIdFor } from './sheets.js';
import { monthTabOptions } from './months.js';

/** ---------------------------------------------------------------------------
 * Where a record is written.
 *
 * Static datasets always use ds.sheetName and ignore anything the caller sends.
 * Monthly datasets take a tab from the request, but ONLY if it appears in a
 * server-computed allow-list — see months.ts for why that matters.
 * ------------------------------------------------------------------------- */

export function allowedTabs(ds: DatasetDef): string[] {
  if (ds.tabStrategy !== 'monthly') return [ds.sheetName];
  return monthTabOptions(ds.tabPrefix ?? ds.sheetName, {
    back: ds.monthsBack ?? 24,
    forward: ds.monthsForward ?? 1,
  });
}

/**
 * Resolves and authorises the destination tab.
 *
 * `allowMissing` is for reads: opening a monthly dataset without having picked
 * a month yet should show the current month, not an error. Writes pass false,
 * because guessing which month a record belongs to is exactly the kind of
 * inference this architecture removed.
 */
export function resolveDestinationTab(
  ds: DatasetDef,
  requested?: string,
  allowMissing = false,
): string {
  if (ds.tabStrategy !== 'monthly') return ds.sheetName;

  const want = String(requested ?? '').trim();
  if (!want) {
    if (!allowMissing) throw new HttpError(400, 'A month must be selected for this record.');
    return allowedTabs(ds)[0];   // newest month — see monthTabOptions()
  }

  const allowed = allowedTabs(ds);
  const match = allowed.find(t => t.toLowerCase() === want.toLowerCase());
  if (!match) {
    throw new HttpError(400,
      `"${want}" is not a month this dataset accepts. Choose one of the listed months.`);
  }
  return match;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Guarantees the tab exists with the schema's headers before a write.
 *
 * A missing tab is created and given the header row from ds.columns — never
 * copied from another tab, whose structure cannot be trusted.
 *
 * An existing tab is verified: if a required column's header is absent, the
 * write is refused. Without this check the value would be silently dropped and
 * the row would land in the sheet with a blank where the figure should be —
 * invisible until someone totals the column and finds it short.
 */
export async function ensureTabWithSchema(ds: DatasetDef, tab: string): Promise<string> {
  const sid = spreadsheetIdFor(ds);
  const headers = ds.columns.filter(c => c.sheetColumn).map(c => c.sheetColumn!);

  await ensureTab(sid, tab, headers);

  const resolved = await resolveTab(sid, tab);
  const live = await readRange(sid, rangeForSheet(resolved, '1:1'));
  const present = new Set((live[0] ?? []).map(h => norm(String(h ?? ''))));

  const missing = ds.columns
    .filter(c => c.sheetColumn && (c.required || c.derived) && !present.has(norm(c.sheetColumn)))
    .map(c => c.sheetColumn!);

  if (missing.length) {
    throw new HttpError(409,
      `The "${resolved}" tab is missing required column(s): ${missing.join(', ')}. ` +
      `Ask an admin to correct the header row, or delete the tab so it can be recreated.`);
  }

  return resolved;
}
