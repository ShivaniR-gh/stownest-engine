import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth.js';
import { fail, ok } from '../_lib/respond.js';
import { HttpError } from '../_lib/env.js';
import { appendRow, audit, deleteRowByIndex, readDataset, updateRowByIndex } from '../_lib/sheets.js';
import { getDatasetDef } from '../_lib/registry.js';
import { allowedTabs, ensureTabWithSchema, resolveDestinationTab } from '../_lib/tabs.js';
import { escapeForSheet, validateRecord } from '../_lib/validate.js';
import { derive } from '../_lib/derive.js';
import { can } from '../../src/lib/permissions/policy.js';
import type { Action, DatasetDef, Row } from '../../src/config/types.js';

/** ---------------------------------------------------------------------------
 * Dataset CRUD.
 *
 * Every method runs the SAME `can()` the interface uses, against a Principal
 * resolved from the access sheet rather than anything the caller supplied. The
 * browser hiding a Delete button is a courtesy; this check is the control.
 *
 * Order matters: authenticate → authorise → resolve tab → validate → derive →
 * write. Nothing touches Google Sheets until every check has passed, so there
 * is no partial-success state and no false success in the UI.
 * ------------------------------------------------------------------------- */

const METHOD_ACTION: Record<string, Action> = {
  GET: 'VIEW', POST: 'CREATE', PATCH: 'UPDATE', DELETE: 'DELETE',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const principal = await authenticate(req);

    const id = String(req.query.dataset ?? '');
    const ds = await getDatasetDef(id);

    const action = METHOD_ACTION[req.method ?? ''];
    if (!action) return res.status(405).json({ error: 'Method not allowed' });

    if (!can(principal, action, ds.department)) {
      throw new HttpError(403, `You do not have permission to ${action.toLowerCase()} ${ds.label.toLowerCase()}.`);
    }

    // The tab arrives from the browser and is treated as untrusted: it must
    // match one of a server-computed set. See api/_lib/months.ts.
    // A read with no month falls back to the current one; a write must say
    // explicitly which month it belongs to.
    const tab = resolveDestinationTab(
      ds,
      req.query.tab ? String(req.query.tab) : undefined,
      req.method === 'GET',
    );

    switch (req.method) {
      case 'GET': {
        // A month with no tab yet is an empty month, not an error.
        try {
          const { rows, unmappedSourceColumns, fetchedAt } = await readDataset(ds, tab);
          return ok(res, { rows, unmappedSourceColumns, fetchedAt, tab, tabs: allowedTabs(ds) });
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) {
            return ok(res, { rows: [], unmappedSourceColumns: [], fetchedAt: Date.now(), tab, tabs: allowedTabs(ds) });
          }
          throw e;
        }
      }

      case 'POST': {
        const values = sanitise(ds, req.body?.values, false);

        const errors = validateRecord(ds, values, false);
        if (errors.length) throw new HttpError(400, errors[0].message);

        const complete = await derive(ds, values, { principal, tab });

        // Uniqueness is scoped to the destination tab: one reading per
        // warehouse per month. Checked against live rows immediately before
        // the write, to keep the window as small as possible.
        await assertUnique(ds, complete, tab);

        // The application owns the structure, so a missing tab is created with
        // the schema's headers rather than being an error. Opt out per dataset
        // with createMissingTab: false.
        const resolvedTab = ds.createMissingTab === false
          ? tab
          : await ensureTabWithSchema(ds, tab);

        const row = await appendRow(ds, escapeAll(complete), resolvedTab);
        await audit({
          actor: principal.email, action: 'CREATE', dataset: ds.id,
          recordId: String(row.__id), detail: resolvedTab,
        });
        return ok(res, { row });
      }

      case 'PATCH': {
        const rowNumber = await locate(ds, String(req.query.id ?? ''), tab);
        const values = sanitise(ds, req.body?.values, true);

        const errors = validateRecord(ds, values, true);
        if (errors.length) throw new HttpError(400, errors[0].message);

        const complete = await derive(ds, values, { principal, tab });
        const row = await updateRowByIndex(ds, rowNumber, escapeAll(complete), tab);
        await audit({
          actor: principal.email, action: 'UPDATE', dataset: ds.id,
          recordId: String(req.query.id ?? ''), detail: `${tab}: ${Object.keys(values).join(',')}`,
        });
        return ok(res, { row });
      }

      case 'DELETE': {
        const rowNumber = await locate(ds, String(req.query.id ?? ''), tab);
        await deleteRowByIndex(ds, rowNumber, tab);
        await audit({
          actor: principal.email, action: 'DELETE', dataset: ds.id,
          recordId: String(req.query.id ?? ''), detail: tab,
        });
        return ok(res, { ok: true });
      }
    }
  } catch (e) {
    return fail(res, e);
  }
}

/**
 * Drops any key the caller sent that is not a writable column.
 *
 * Iterates the SCHEMA rather than the request body, so the config is the
 * allow-list: a crafted request cannot write to a derived field, an unmapped
 * field, or a column that does not exist.
 */
function sanitise(ds: DatasetDef, input: unknown, isUpdate: boolean): Row {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'No values supplied.');
  const src = input as Record<string, unknown>;
  const out: Row = {};

  for (const c of ds.columns) {
    if (!c.sheetColumn) continue;
    if (c.derived) continue;                                   // server fills these
    if (isUpdate && !c.editable) continue;
    if (!isUpdate && !c.editable && !c.required) continue;
    if (!(c.key in src)) continue;

    const v = src[c.key];
    if (v === null || v === undefined) { out[c.key] = ''; continue; }
    if (typeof v === 'object') throw new HttpError(400, `${c.header} must be a simple value.`);
    out[c.key] = String(v).trim();
  }

  if (!Object.keys(out).length) {
    throw new HttpError(400, 'Nothing to write. No editable fields were supplied.');
  }
  return out;
}

/** Neutralises formula injection on every value about to be written. */
function escapeAll(values: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = typeof v === 'string' ? escapeForSheet(v) : v;
  }
  return out;
}

/**
 * Rejects a duplicate value in any column marked `unique`, scoped to the
 * destination tab.
 *
 * Sheets has no unique constraint, so two submissions in the same instant can
 * both pass this check before either writes. Rare at these volumes, but it
 * means uniqueness here is a strong check rather than a guarantee.
 */
async function assertUnique(ds: DatasetDef, values: Row, tab: string): Promise<void> {
  const uniques = ds.columns.filter(c => c.unique && c.sheetColumn);
  if (!uniques.length) return;

  let rows: Row[];
  try {
    ({ rows } = await readDataset(ds, tab));
  } catch (e) {
    // Tab does not exist yet, so nothing can collide with this record.
    if (e instanceof HttpError && e.status === 404) return;
    throw e;
  }

  for (const c of uniques) {
    const v = String(values[c.key] ?? '').trim().toLowerCase();
    if (!v) continue;
    if (rows.some(r => String(r[c.key] ?? '').trim().toLowerCase() === v)) {
      throw new HttpError(409,
        `${c.header} "${values[c.key]}" already has an entry in ${tab}. Edit that record instead of adding a second one.`);
    }
  }
}

/** Resolves a record id to its live sheet row number at write time. Never
 *  trusts a row number sent by the client — rows shift when anyone edits the
 *  spreadsheet directly. */
async function locate(ds: DatasetDef, recordId: string, tab: string): Promise<number> {
  if (!recordId) throw new HttpError(400, 'No record id supplied.');
  const { rows } = await readDataset(ds, tab);
  const match = rows.find(r => String(r.__id) === recordId);
  if (!match) {
    throw new HttpError(404, 'That record no longer exists. Someone may have deleted it in the sheet.');
  }
  return Number(match.__row);
}
