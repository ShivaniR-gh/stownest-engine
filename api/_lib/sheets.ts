import { JWT } from 'google-auth-library';
import type { DatasetDef, Row } from '../../src/config/types';
import { HttpError, required } from './env';

/** ---------------------------------------------------------------------------
 * Google Sheets access.
 *
 * The service-account key exists only here, in server memory, sourced from an
 * environment variable. It is never sent to the browser and never written to a
 * file in the repository. The browser can only ask this module for a dataset it
 * has already been authorised for.
 * ------------------------------------------------------------------------- */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

let cachedClient: JWT | null = null;
let cachedToken: { value: string; expires: number } | null = null;

function client(): JWT {
  if (cachedClient) return cachedClient;
  cachedClient = new JWT({
    email: required('GOOGLE_SA_EMAIL'),
    // Vercel stores newlines escaped; restore them before the key is parsed.
    key: required('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
    scopes: SCOPES,
  });
  return cachedClient;
}

async function token(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await client().getAccessToken();
  if (!res.token) throw new HttpError(500, 'Could not authenticate with Google Sheets.');
  cachedToken = { value: res.token, expires: Date.now() + 50 * 60_000 };
  return res.token;
}

/** Which workbook holds this dataset. Defaults to the single-sheet setup. */
export function spreadsheetIdFor(ds: Pick<DatasetDef, 'spreadsheetEnv' | 'spreadsheetId'>): string {
  if (ds.spreadsheetId) return ds.spreadsheetId;          // runtime-connected source
  if (ds.spreadsheetEnv) return required(ds.spreadsheetEnv); // env-pinned source
  return required('SHEETS_SPREADSHEET_ID');                // default workbook
}

async function call<T>(sid: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/${sid}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) throw new HttpError(500, 'The service account cannot open this spreadsheet. Share the sheet with it as an Editor.');
    if (res.status === 404) throw new HttpError(500, `Spreadsheet ${sid.slice(0, 8)}… or the tab was not found. Check the id and tab names.`);
    if (res.status === 429) throw new HttpError(429, 'Google is rate-limiting requests to this spreadsheet.');
    throw new HttpError(502, `Sheets API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------ tab metadata ------------------------------ */
const sheetIds = new Map<string, Record<string, number>>();

async function tabId(sid: string, name: string): Promise<number> {
  if (!sheetIds.has(sid)) {
    const meta = await call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      sid, '?fields=sheets.properties(sheetId,title)');
    sheetIds.set(sid, Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties.sheetId])));
  }
  const id = sheetIds.get(sid)![name];
  if (id === undefined) throw new HttpError(500, `Spreadsheet ${sid.slice(0, 8)}… has no tab named "${name}".`);
  return id;
}

/* -------------------------------- reading --------------------------------- */
export interface SheetRead { rows: Row[]; unmappedSourceColumns: string[]; fetchedAt: number }

/**
 * Reads a tab and projects it onto the dataset's internal keys.
 *
 * Headers are matched by the `sheetColumn` declared in config, case- and
 * whitespace-insensitively. Columns present in the sheet but unknown to config
 * are reported back so a new column added by ops shows up in Settings rather
 * than disappearing.
 */
export async function readDataset(ds: DatasetDef): Promise<SheetRead> {
  const res = await call<{ values?: string[][] }>(spreadsheetIdFor(ds),
    `/values/${encodeURIComponent(ds.sheetName)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);

  const values = res.values ?? [];
  if (!values.length) return { rows: [], unmappedSourceColumns: [], fetchedAt: Date.now() };

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const headers = values[0].map(h => norm(String(h ?? '')));

  const columnIndex = new Map<string, number>();
  for (const c of ds.columns) {
    if (!c.sheetColumn) continue;
    const i = headers.indexOf(norm(c.sheetColumn));
    if (i >= 0) columnIndex.set(c.key, i);
  }

  const known = new Set(ds.columns.filter(c => c.sheetColumn).map(c => norm(c.sheetColumn!)));
  const unmappedSourceColumns = values[0]
    .map(h => String(h ?? ''))
    .filter(h => h.trim() && !known.has(norm(h)));

  const rows: Row[] = [];
  for (let r = 1; r < values.length; r++) {
    const raw = values[r];
    if (!raw || raw.every(v => v === '' || v === null || v === undefined)) continue;
    const row: Row = { __row: r + 1 };
    for (const [key, i] of columnIndex) row[key] = raw[i] ?? '';
    const id = String(row[ds.idColumn] ?? '').trim();
    // A row with no identifier cannot be updated or deleted safely, so it is
    // keyed by its sheet position instead of being dropped.
    row.__id = id || `row-${r + 1}`;
    rows.push(row);
  }

  return { rows, unmappedSourceColumns, fetchedAt: Date.now() };
}

/* -------------------------------- writing --------------------------------- */
async function headerRow(ds: DatasetDef): Promise<string[]> {
  const res = await call<{ values?: string[][] }>(spreadsheetIdFor(ds), `/values/${encodeURIComponent(ds.sheetName)}!1:1`);
  return (res.values?.[0] ?? []).map(h => String(h ?? ''));
}

/** Builds a full-width row array positioned against the live header order, so a
 *  reordered sheet cannot shift values into the wrong columns. */
function toSheetRow(ds: DatasetDef, headers: string[], values: Row, existing?: string[]): string[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const out = headers.map((_, i) => existing?.[i] ?? '');
  for (const c of ds.columns) {
    if (!c.sheetColumn || !(c.key in values)) continue;
    if (!c.editable && existing) continue;
    const i = headers.findIndex(h => norm(h) === norm(c.sheetColumn!));
    if (i >= 0) out[i] = values[c.key] === null || values[c.key] === undefined ? '' : String(values[c.key]);
  }
  return out;
}

export async function appendRow(ds: DatasetDef, values: Row): Promise<Row> {
  const headers = await headerRow(ds);
  const row = toSheetRow(ds, headers, values);
  const res = await call<{ updates: { updatedRange: string } }>(spreadsheetIdFor(ds),
    `/values/${encodeURIComponent(ds.sheetName)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) });

  const rowNumber = Number(res.updates.updatedRange.match(/!\w+?(\d+)/)?.[1] ?? 0);
  return { ...values, __row: rowNumber, __id: String(values[ds.idColumn] ?? `row-${rowNumber}`) };
}

export async function updateRowByIndex(ds: DatasetDef, rowNumber: number, values: Row): Promise<Row> {
  const headers = await headerRow(ds);
  const current = await call<{ values?: string[][] }>(spreadsheetIdFor(ds),
    `/values/${encodeURIComponent(ds.sheetName)}!${rowNumber}:${rowNumber}`);
  const existing = current.values?.[0] ?? [];
  const row = toSheetRow(ds, headers, values, existing);

  await call(spreadsheetIdFor(ds), `/values/${encodeURIComponent(ds.sheetName)}!A${rowNumber}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: [row] }) });

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const out: Row = { __row: rowNumber };
  for (const c of ds.columns) {
    if (!c.sheetColumn) continue;
    const i = headers.findIndex(h => norm(h) === norm(c.sheetColumn!));
    if (i >= 0) out[c.key] = row[i] ?? '';
  }
  out.__id = String(out[ds.idColumn] ?? `row-${rowNumber}`);
  return out;
}

export async function deleteRowByIndex(ds: DatasetDef, rowNumber: number): Promise<void> {
  const sid = spreadsheetIdFor(ds);
  await call(sid, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId: await tabId(sid, ds.sheetName),
            dimension: 'ROWS',
            startIndex: rowNumber - 1, // API is zero-based, sheet rows are one-based
            endIndex: rowNumber,
          },
        },
      }],
    }),
  });
}

/** Append-only audit trail. Failure to write the audit row must not roll back
 *  the user's successful edit, so it is logged and swallowed. */
export async function audit(entry: {
  actor: string; action: string; dataset: string; recordId: string; detail?: string;
}): Promise<void> {
  try {
    await call(required('SHEETS_SPREADSHEET_ID'),
      `/values/${encodeURIComponent('audit_log')}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({
        values: [[new Date().toISOString(), entry.actor, entry.action, entry.dataset, entry.recordId, entry.detail ?? '']],
      }),
    });
  } catch (e) {
    console.error('[audit] could not write audit row', e);
  }
}

/* --------------------- helpers for the connection flow --------------------- */

/** Tab names in a workbook. Doubles as the access check: if the service account
 *  cannot open the file, this is where it fails, with a message an admin can act on. */
export async function listTabs(spreadsheetId: string): Promise<string[]> {
  const meta = await call<{ properties?: { title?: string }; sheets: { properties: { title: string } }[] }>(
    spreadsheetId, '?fields=properties.title,sheets.properties.title');
  return meta.sheets.map(s => s.properties.title);
}

export async function spreadsheetTitle(spreadsheetId: string): Promise<string> {
  const meta = await call<{ properties?: { title?: string } }>(spreadsheetId, '?fields=properties.title');
  return meta.properties?.title ?? 'Untitled spreadsheet';
}

/** Raw values from any workbook + range. Used for header detection and preview. */
export async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await call<{ values?: string[][] }>(spreadsheetId,
    `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
  return res.values ?? [];
}

/** Creates a tab with the given headers if it does not already exist. Lets an
 *  admin connect a source without hand-building the config tabs first. */
export async function ensureTab(spreadsheetId: string, title: string, headers: readonly string[]): Promise<void> {
  const tabs = await listTabs(spreadsheetId);
  if (!tabs.includes(title)) {
    await call(spreadsheetId, ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    sheetIds.delete(spreadsheetId);
  }
  const existing = await readRange(spreadsheetId, `${title}!1:1`);
  if (!existing.length || !existing[0]?.length) {
    await call(spreadsheetId, `/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [headers] }) });
  }
}

/**
 * Appends rows aligned to the tab's LIVE header row, adding any header the
 * caller needs but the sheet lacks.
 *
 * Positional appends break silently the moment the schema gains a column: an
 * existing tab keeps its old headers, and every value after the insertion point
 * lands under the wrong one. Writing by name makes schema changes safe.
 */
export async function appendKeyedRows(
  spreadsheetId: string,
  tab: string,
  expectedHeaders: readonly string[],
  records: Record<string, string | number>[],
): Promise<void> {
  if (!records.length) return;

  const existing = await readRange(spreadsheetId, `${tab}!1:1`);
  let headers = (existing[0] ?? []).map(h => String(h ?? '').trim()).filter(Boolean);

  // Extend the header row rather than reordering it: existing data stays put.
  const missing = expectedHeaders.filter(h => !headers.some(x => x.toLowerCase() === h.toLowerCase()));
  if (!headers.length) {
    headers = [...expectedHeaders];
    await call(spreadsheetId, `/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [headers] }) });
  } else if (missing.length) {
    headers = [...headers, ...missing];
    await call(spreadsheetId, `/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [headers] }) });
  }

  const idx = new Map(headers.map((h, i) => [h.toLowerCase(), i]));
  const rows = records.map(rec => {
    const out: (string | number)[] = headers.map(() => '');
    for (const [k, v] of Object.entries(rec)) {
      const i = idx.get(k.toLowerCase());
      if (i !== undefined) out[i] = v;
    }
    return out;
  });
  await appendRows(spreadsheetId, tab, rows);
}

export async function appendRows(spreadsheetId: string, tab: string, rows: (string | number)[][]): Promise<void> {
  if (!rows.length) return;
  await call(spreadsheetId,
    `/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) });
}

/** Removes every row whose first column equals `key`. Used to replace a
 *  dataset's mapping rows atomically enough for a config tab. */
export async function deleteRowsWhereFirstCol(spreadsheetId: string, tab: string, key: string): Promise<void> {
  const values = await readRange(spreadsheetId, tab);
  const targets: number[] = [];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r]?.[0] ?? '').trim() === key) targets.push(r + 1);
  }
  if (!targets.length) return;
  const sid = await tabId(spreadsheetId, tab);
  // Delete bottom-up so earlier indices stay valid.
  await call(spreadsheetId, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: targets.sort((a, b) => b - a).map(rowNumber => ({
        deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } },
      })),
    }),
  });
}

/** Extracts the spreadsheet id from a full URL or accepts a bare id. */
export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null;
}
