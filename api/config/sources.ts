import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth';
import { fail, ok } from '../_lib/respond';
import { HttpError, required } from '../_lib/env';
import {
  appendKeyedRows, deleteRowsWhereFirstCol, ensureTab, listTabs, parseSpreadsheetId,
  readRange, spreadsheetTitle, audit,
} from '../_lib/sheets';
import {
  MAPPINGS_HEADERS, MAPPINGS_TAB, SOURCES_HEADERS, SOURCES_TAB,
  invalidateRegistry, listSources,
} from '../_lib/registry';
import { canManageDataSource } from '../../src/lib/permissions/policy';
import { assertActiveDepartment, loadDepartments } from '../_lib/departments';

/** ---------------------------------------------------------------------------
 * Data source connection.
 *
 * The service account reads the target workbook; the browser never holds Google
 * credentials and no Drive scope is involved. An admin pastes a URL and shares
 * the file with the service account — that share IS the authorisation.
 * ------------------------------------------------------------------------- */

/** Guesses a column type from its header and sample values. The admin can
 *  override every guess in the mapping step, so this only has to be helpful. */
function inferType(header: string, samples: string[]): string {
  const h = header.toLowerCase();
  if (/(^|[^a-z])(id|no\.?|number|code)([^a-z]|$)/.test(h) && samples.every(v => v.length < 24)) return 'id';
  if (/cost|amount|revenue|price|rate|paid|value|charge|fee|salary|rent/.test(h)) return 'currency';
  if (/date|_at$|^when|day|due|scheduled|delivered|pickup/.test(h)) return 'date';
  if (/email/.test(h)) return 'email';
  if (/phone|mobile|contact no/.test(h)) return 'phone';
  if (/status|stage|state/.test(h)) return 'enum';
  const nonEmpty = samples.filter(Boolean);
  if (nonEmpty.length && nonEmpty.every(v => !Number.isNaN(Number(String(v).replace(/[,₹\s]/g, ''))))) return 'number';
  if (nonEmpty.length && nonEmpty.every(v => !Number.isNaN(Date.parse(v)))) return 'date';
  return 'text';
}

const keyFor = (header: string) =>
  header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column';

/** Never trust a department id from the browser: it must exist in the runtime
 *  registry before it is used for anything. */
const isDept = async (d: string): Promise<boolean> =>
  (await loadDepartments()).some(x => x.id === d);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const principal = await authenticate(req);
    const control = required('SHEETS_SPREADSHEET_ID');

    /* ------------------------------- LIST ------------------------------- */
    if (req.method === 'GET') {
      const rows = await listSources();
      const known = new Set((await loadDepartments()).map(d => d.id));
      const visible = rows.filter(r => known.has(r.department) && canManageDataSource(principal, r.department));
      return ok(res, {
        sources: visible,
        // Not a secret: it is an address you must share a file WITH. Showing it
        // up front turns a confusing failure into a two-click instruction.
        serviceAccountEmail: required('GOOGLE_SA_EMAIL'),
        manageableDepartments: (await loadDepartments())
          .filter(d => (d.status ?? 'Active') === 'Active' && canManageDataSource(principal, d.id))
          .map(d => ({ id: d.id, label: d.label })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = String(body.action ?? '');

    /* ----------------------------- VALIDATE ------------------------------ */
    // Confirms the service account can actually open the workbook and returns
    // its tabs. This is where a missing share surfaces, with a fixable message.
    if (action === 'validate') {
      const id = parseSpreadsheetId(String(body.url ?? ''));
      if (!id) throw new HttpError(400, 'That does not look like a Google Sheets URL. Paste the full link from the address bar.');
      try {
        const [title, tabs] = await Promise.all([spreadsheetTitle(id), listTabs(id)]);
        return ok(res, { spreadsheetId: id, title, tabs });
      } catch {
        throw new HttpError(400,
          `StowNest cannot open that spreadsheet. Share it with ${required('GOOGLE_SA_EMAIL')} as an Editor, then validate again.`);
      }
    }

    /* ------------------------------ PREVIEW ------------------------------ */
    if (action === 'preview') {
      const id = parseSpreadsheetId(String(body.spreadsheetId ?? ''));
      const tab = String(body.tab ?? '');
      if (!id || !tab) throw new HttpError(400, 'Choose a spreadsheet and a tab first.');

      const values = await readRange(id, `${tab}!A1:ZZ11`);
      if (!values.length) throw new HttpError(400, `The tab "${tab}" is empty. It needs a header row.`);

      const headers = values[0].map(h => String(h ?? '').trim()).filter(Boolean);
      if (!headers.length) throw new HttpError(400, `Row 1 of "${tab}" has no column headings.`);

      const rows = values.slice(1, 6).map(r => headers.map((_, i) => String(r?.[i] ?? '')));
      const columns = headers.map((header, i) => ({
        sheetColumn: header,
        key: keyFor(header),
        header,
        type: inferType(header, rows.map(r => r[i]).filter(Boolean)),
      }));
      return ok(res, { headers, rows, columns, rowsScanned: values.length - 1 });
    }

    /* ------------------------------- SAVE -------------------------------- */
    if (action === 'save') {
      const department = String(body.department ?? '');
      // Must exist AND be active: inactive departments accept no new connections.
      await assertActiveDepartment(department);
      if (!canManageDataSource(principal, department)) {
        throw new HttpError(403, 'You cannot manage the data source for that department.');
      }

      const datasetId = String(body.datasetId ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const spreadsheetId = parseSpreadsheetId(String(body.spreadsheetId ?? ''));
      const tab = String(body.tab ?? '');
      const columns = Array.isArray(body.columns) ? body.columns as Record<string, unknown>[] : [];

      if (!datasetId) throw new HttpError(400, 'Give the dataset a short id, e.g. logistics_ops.');
      if (!spreadsheetId || !tab) throw new HttpError(400, 'Spreadsheet and tab are required.');
      if (!columns.length) throw new HttpError(400, 'At least one column must be mapped.');

      const idColumn = String(body.idColumn ?? '');
      if (!columns.some(c => c.key === idColumn)) {
        throw new HttpError(400, 'Choose which column uniquely identifies a record.');
      }

      // Config tabs are created on demand so an admin never has to build them by hand.
      await ensureTab(control, SOURCES_TAB, SOURCES_HEADERS);
      await ensureTab(control, MAPPINGS_TAB, MAPPINGS_HEADERS);

      // Replace rather than append, so reconnecting does not leave stale mappings.
      await deleteRowsWhereFirstCol(control, SOURCES_TAB, datasetId);
      await deleteRowsWhereFirstCol(control, MAPPINGS_TAB, datasetId);

      await appendKeyedRows(control, SOURCES_TAB, SOURCES_HEADERS, [{
        'Dataset ID': datasetId, 'Department': department,
        'Label': String(body.label ?? datasetId), 'Noun': String(body.noun ?? 'record'),
        'Spreadsheet ID': spreadsheetId, 'Tab Name': tab,
        'ID Column': idColumn, 'Date Column': String(body.dateColumn ?? ''),
        'Status Column': String(body.statusColumn ?? ''),
        'Title Column': String(body.titleColumn ?? idColumn),
        'Status': 'Connected', 'Connected By': principal.email,
        'Connected At': new Date().toISOString(),
      }]);

      await appendKeyedRows(control, MAPPINGS_TAB, MAPPINGS_HEADERS, columns.map(c => ({
        'Dataset ID': datasetId,
        'Sheet Column': String(c.sheetColumn ?? ''),
        'Key': String(c.key ?? ''),
        'Header': String(c.header ?? ''),
        'Type': String(c.type ?? 'text'),
        'Role': String(c.role ?? ''),
        'Editable': c.editable === false ? 'FALSE' : 'TRUE',
        'Required': c.required ? 'TRUE' : 'FALSE',
        'Filterable': c.filterable ? 'TRUE' : 'FALSE',
        'Groupable': c.groupable ? 'TRUE' : 'FALSE',
        'Aggregate': String(c.aggregate ?? ''),
        'Enum Values': Array.isArray(c.enumValues) ? c.enumValues.join(',') : '',
        'Hidden': c.hidden ? 'TRUE' : 'FALSE',
      })));

      invalidateRegistry();
      await audit({ actor: principal.email, action: 'CONNECT_SOURCE', dataset: datasetId,
        recordId: spreadsheetId, detail: `${tab} (${columns.length} columns)` });
      return ok(res, { ok: true, datasetId });
    }

    /* ---------------------------- DISCONNECT ----------------------------- */
    if (action === 'disconnect') {
      const datasetId = String(body.datasetId ?? '');
      const rows = await listSources();
      const row = rows.find(r => r.dataset_id === datasetId);
      if (!row) throw new HttpError(404, 'No such data source.');
      if (!(await isDept(row.department)) || !canManageDataSource(principal, row.department)) {
        throw new HttpError(403, 'You cannot manage the data source for that department.');
      }
      await deleteRowsWhereFirstCol(control, SOURCES_TAB, datasetId);
      await deleteRowsWhereFirstCol(control, MAPPINGS_TAB, datasetId);
      invalidateRegistry();
      await audit({ actor: principal.email, action: 'DISCONNECT_SOURCE', dataset: datasetId, recordId: '' });
      return ok(res, { ok: true });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (e) {
    return fail(res, e);
  }
}
