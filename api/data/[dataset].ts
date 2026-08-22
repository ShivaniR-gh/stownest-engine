import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth';
import { fail, ok } from '../_lib/respond';
import { HttpError } from '../_lib/env';
import { appendRow, audit, deleteRowByIndex, readDataset, updateRowByIndex } from '../_lib/sheets';
import { getDatasetDef } from '../_lib/registry';
import { can } from '../../src/lib/permissions/policy';
import type { Action, Row } from '../../src/config/types';

/** ---------------------------------------------------------------------------
 * Dataset CRUD.
 *
 * Every method runs the SAME `can()` used by the interface, against a Principal
 * resolved from the access sheet rather than anything the caller supplied. The
 * browser hiding a Delete button is a courtesy; this check is the control.
 * ------------------------------------------------------------------------- */

const METHOD_ACTION: Record<string, Action> = {
  GET: 'VIEW', POST: 'CREATE', PATCH: 'UPDATE', DELETE: 'DELETE',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const principal = await authenticate(req);

    const id = String(req.query.dataset ?? '');
    // Resolved from the runtime registry so a connected sheet works immediately.
    const ds = await getDatasetDef(id);

    const action = METHOD_ACTION[req.method ?? ''];
    if (!action) return res.status(405).json({ error: 'Method not allowed' });

    if (!can(principal, action, ds.department)) {
      throw new HttpError(403, `You do not have permission to ${action.toLowerCase()} ${ds.label.toLowerCase()}.`);
    }

    switch (req.method) {
      case 'GET': {
        const { rows, unmappedSourceColumns, fetchedAt } = await readDataset(ds);
        return ok(res, { rows, unmappedSourceColumns, fetchedAt });
      }

      case 'POST': {
        const values = await sanitise(req.body?.values, ds.id, false);
        const missing = ds.columns.filter(c => c.sheetColumn && c.required && !String(values[c.key] ?? '').trim());
        if (missing.length) {
          throw new HttpError(400, `${missing.map(c => c.header).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`);
        }
        const row = await appendRow(ds, values);
        await audit({ actor: principal.email, action: 'CREATE', dataset: ds.id, recordId: String(row.__id) });
        return ok(res, { row });
      }

      case 'PATCH': {
        const rowNumber = await locate(ds.id, String(req.query.id ?? ''));
        const values = await sanitise(req.body?.values, ds.id, true);
        const row = await updateRowByIndex(ds, rowNumber, values);
        await audit({
          actor: principal.email, action: 'UPDATE', dataset: ds.id, recordId: String(req.query.id ?? ''),
          detail: Object.keys(values).join(','),
        });
        return ok(res, { row });
      }

      case 'DELETE': {
        const rowNumber = await locate(ds.id, String(req.query.id ?? ''));
        await deleteRowByIndex(ds, rowNumber);
        await audit({ actor: principal.email, action: 'DELETE', dataset: ds.id, recordId: String(req.query.id ?? '') });
        return ok(res, { ok: true });
      }
    }
  } catch (e) {
    return fail(res, e);
  }
}

/**
 * Drops any key the caller sent that is not an editable, mapped column.
 * A crafted request cannot write to `invoice_id`, to an unmapped field, or to a
 * column that does not exist — the config is the allow-list.
 */
async function sanitise(input: unknown, datasetId: string, isUpdate: boolean): Promise<Row> {
  const ds = await getDatasetDef(datasetId);
  if (!input || typeof input !== 'object') throw new HttpError(400, 'No values supplied.');
  const src = input as Record<string, unknown>;
  const out: Row = {};
  for (const c of ds.columns) {
    if (!c.sheetColumn) continue;
    if (isUpdate && !c.editable) continue;
    if (!isUpdate && !c.editable && !c.required) continue;
    if (!(c.key in src)) continue;
    const v = src[c.key];
    if (v === null || v === undefined) { out[c.key] = ''; continue; }
    if (typeof v === 'object') throw new HttpError(400, `${c.header} must be a simple value.`);
    const s = String(v).trim();
    if (s.length > 2000) throw new HttpError(400, `${c.header} is too long.`);
    if ((c.type === 'currency' || c.type === 'number') && s && Number.isNaN(Number(s.replace(/[₹,\s]/g, '')))) {
      throw new HttpError(400, `${c.header} must be a number.`);
    }
    if (c.enumValues && s && !c.enumValues.includes(s)) {
      throw new HttpError(400, `${c.header} must be one of: ${c.enumValues.join(', ')}.`);
    }
    // Neutralise spreadsheet formula injection: a value starting with = or +
    // would otherwise execute inside the sheet.
    out[c.key] = /^[=+\-@]/.test(s) ? `'${s}` : s;
  }
  if (!Object.keys(out).length) throw new HttpError(400, 'Nothing to write. No editable fields were supplied.');
  return out;
}

/** Resolves a record id to its live sheet row number at write time. Never
 *  trusts a row number sent by the client — rows shift when anyone edits the
 *  spreadsheet directly. */
async function locate(datasetId: string, recordId: string): Promise<number> {
  if (!recordId) throw new HttpError(400, 'No record id supplied.');
  const ds = await getDatasetDef(datasetId);
  const { rows } = await readDataset(ds);
  const match = rows.find(r => String(r.__id) === recordId);
  if (!match) throw new HttpError(404, 'That record no longer exists. Someone may have deleted it in the sheet.');
  return Number(match.__row);
}
