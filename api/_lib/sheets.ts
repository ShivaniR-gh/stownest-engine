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

/**
 * Google answers a burst of reads with 429, and occasionally with a 5xx, for a
 * few hundred milliseconds. One dashboard opens a dozen datasets at once, so
 * this happens often enough to be seen as "the page is empty sometimes".
 *
 * Reads are retried twice with a short backoff. Writes are NOT retried: a POST
 * that actually succeeded before the connection broke would be applied twice,
 * and a duplicate row is worse than an error message.
 */
const RETRY_DELAYS_MS = [250, 750];

async function call<T>(sid: string, path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const retryable = method === 'GET';
  let attempt = 0;
  for (;;) {
    try {
      return await callOnce<T>(sid, path, init);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      const worthRetry = retryable && (status === 429 || status === 502 || status >= 500);
      if (!worthRetry || attempt >= RETRY_DELAYS_MS.length) throw e;
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      attempt += 1;
    }
  }
}

async function callOnce<T>(sid: string, path: string, init?: RequestInit): Promise<T> {
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
    console.error("[sheets 502]", res.status, body.slice(0, 500));
    throw new HttpError(502, `Sheets API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------ tab metadata ------------------------------ */
const sheetIds = new Map<string, Record<string, number>>();

function normalizeTabName(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

async function loadSheetMeta(sid: string): Promise<Record<string, number>> {
  if (!sheetIds.has(sid)) {
    const meta = await call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      sid, '?fields=sheets.properties(sheetId,title)');
    sheetIds.set(sid, Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties.sheetId])));
  }
  return sheetIds.get(sid)!;
}

export function quoteSheetNameForA1(name: string): string {
  const value = String(name ?? '').replace(/'/g, "''");
  return `'${value}'`;
}

export function rangeForSheet(tabName: string, range: string): string {
  return `${quoteSheetNameForA1(tabName)}!${range}`;
}

export async function resolveTab(spreadsheetId: string, rawTabName: string): Promise<string> {
  const requested = String(rawTabName ?? '').trim();
  if (!requested) throw new HttpError(400, 'A tab name is required.');

  const meta = await loadSheetMeta(spreadsheetId);
  if (meta[requested] !== undefined) return requested;

  const normalized = normalizeTabName(requested);
  const matches = Object.keys(meta)
    .filter(title => normalizeTabName(title) === normalized)
    .sort();

  if (matches.length > 1) {
    throw new HttpError(409,
      `Multiple tabs match "${requested}" after case/whitespace normalization: ${matches.join(', ')}.`);
  }
  if (matches.length === 1) return matches[0];

  const available = Object.keys(meta).sort();
  throw new HttpError(404,
    `No tab named "${requested}" was found in this spreadsheet. Available tabs: ${available.join(', ') || '(none)'}.`);
}

async function tabId(sid: string, name: string): Promise<number> {
  const meta = await loadSheetMeta(sid);
  const exact = meta[name];
  if (exact !== undefined) return exact;
  const resolved = await resolveTab(sid, name);
  const id = meta[resolved];
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
export async function readDataset(ds: DatasetDef, tabName?: string): Promise<SheetRead> {
  const sid = spreadsheetIdFor(ds);
  const tab = await resolveTab(sid, tabName ?? ds.sheetName);
  const res = await call<{ values?: string[][] }>(sid,
    `/values/${encodeURIComponent(quoteSheetNameForA1(tab))}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);

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
    // A row with no identifier cannot be updated or deleted safely, so it is
    // keyed by its sheet position instead of being dropped.
    row.__id = recordId(ds, row, r + 1);
    rows.push(row);
  }

  return { rows, unmappedSourceColumns, fetchedAt: Date.now() };
}

/* -------------------------------- writing --------------------------------- */
async function headerRow(ds: DatasetDef, tabName?: string): Promise<string[]> {
  const sid = spreadsheetIdFor(ds);
  const tab = await resolveTab(sid, tabName ?? ds.sheetName);
  const res = await call<{ values?: string[][] }>(sid, `/values/${encodeURIComponent(rangeForSheet(tab, '1:1'))}`);
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

/**
 * Stable record id for a row.
 *
 * A date-typed id column is the problem this solves: Sheets renders the same
 * cell as "2026-07-01" or "01/07/2026" depending on locale and how it was
 * written, so the raw string is not a stable key. Editing a record twice would
 * fail the second time with "that record no longer exists" — the row is there,
 * the id just changed shape. Normalising dates to ISO makes the id survive a
 * round trip through the sheet.
 */
export function recordId(ds: DatasetDef, row: Row, rowNumber: number): string {
  const raw = String(row[ds.idColumn] ?? '').trim();
  if (!raw) return `row-${rowNumber}`;
  const col = ds.columns.find(c => c.key === ds.idColumn);
  if (col?.type !== 'date') return raw;

  // Sheets returns an unformatted date cell as a serial: days since
  // 1899-12-30. Date.parse reads "46174" as the year 46174, which is how a
  // July 2026 row acquired the id "+046173-12" and stopped matching.
  if (/^\d{1,6}(\.\d+)?$/.test(raw)) {
    const ms = Math.round(Number(raw)) * 86400000 + Date.UTC(1899, 11, 30);
    return new Date(ms).toISOString().slice(0, 10);
  }

  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : raw;
}

export async function appendRow(ds: DatasetDef, values: Row, tabName?: string): Promise<Row> {
  const sid = spreadsheetIdFor(ds);
  const tab = await resolveTab(sid, tabName ?? ds.sheetName);
  const headers = await headerRow(ds, tab);
  const row = toSheetRow(ds, headers, values);
  const res = await call<{ updates: { updatedRange: string } }>(sid,
    `/values/${encodeURIComponent(rangeForSheet(tab, 'A1')) + ':append'}?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) });

  const rowNumber = Number(res.updates.updatedRange.match(/!\w+?(\d+)/)?.[1] ?? 0);
  return { ...values, __row: rowNumber, __id: recordId(ds, values, rowNumber) };
}

export async function updateRowByIndex(ds: DatasetDef, rowNumber: number, values: Row, tabName?: string): Promise<Row> {
  const sid = spreadsheetIdFor(ds);
  const tab = await resolveTab(sid, tabName ?? ds.sheetName);
  const headers = await headerRow(ds, tab);
  const current = await call<{ values?: string[][] }>(sid,
    `/values/${encodeURIComponent(rangeForSheet(tab, `${rowNumber}:${rowNumber}`))}`);
  const existing = current.values?.[0] ?? [];
  const row = toSheetRow(ds, headers, values, existing);

  await call(sid, `/values/${encodeURIComponent(rangeForSheet(tab, `A${rowNumber}`))}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: [row] }) });

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const out: Row = { __row: rowNumber };
  for (const c of ds.columns) {
    if (!c.sheetColumn) continue;
    const i = headers.findIndex(h => norm(h) === norm(c.sheetColumn!));
    if (i >= 0) out[c.key] = row[i] ?? '';
  }
  out.__id = recordId(ds, out, rowNumber);
  return out;
}

export async function deleteRowByIndex(ds: DatasetDef, rowNumber: number, tabName?: string): Promise<void> {
  const sid = spreadsheetIdFor(ds);
  await call(sid, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId: await tabId(sid, tabName ?? ds.sheetName),
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
      `/values/${encodeURIComponent(rangeForSheet('audit_log', 'A1')) + ':append'}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
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
  console.log("[ensureTab]", spreadsheetId.slice(0,12), "wants:", title, "found:", JSON.stringify(tabs));
  if (!tabs.includes(title)) {
    await call(spreadsheetId, ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    sheetIds.delete(spreadsheetId);
  }
  const resolvedTitle = await resolveTab(spreadsheetId, title);
  const existing = await readRange(spreadsheetId, rangeForSheet(resolvedTitle, '1:1'));
  if (!existing.length || !existing[0]?.length) {
    await call(spreadsheetId, `/values/${encodeURIComponent(rangeForSheet(resolvedTitle, 'A1'))}?valueInputOption=RAW`,
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

  const resolvedTab = await resolveTab(spreadsheetId, tab);
  const existing = await readRange(spreadsheetId, rangeForSheet(resolvedTab, '1:1'));
  let headers = (existing[0] ?? []).map(h => String(h ?? '').trim()).filter(Boolean);

  // Extend the header row rather than reordering it: existing data stays put.
  const missing = expectedHeaders.filter(h => !headers.some(x => x.toLowerCase() === h.toLowerCase()));
  if (!headers.length) {
    headers = [...expectedHeaders];
    await call(spreadsheetId, `/values/${encodeURIComponent(rangeForSheet(resolvedTab, 'A1'))}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [headers] }) });
  } else if (missing.length) {
    headers = [...headers, ...missing];
    await call(spreadsheetId, `/values/${encodeURIComponent(rangeForSheet(resolvedTab, 'A1'))}?valueInputOption=RAW`,
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
  await appendRows(spreadsheetId, resolvedTab, rows);
}

export async function appendRows(spreadsheetId: string, tab: string, rows: (string | number)[][]): Promise<void> {
  if (!rows.length) return;
  const resolvedTab = await resolveTab(spreadsheetId, tab);
  await call(spreadsheetId,
    `/values/${encodeURIComponent(rangeForSheet(resolvedTab, 'A1')) + ':append'}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) });
}

/** Removes every row whose first column equals `key`. Used to replace a
 *  dataset's mapping rows atomically enough for a config tab. */
export async function deleteRowsWhereFirstCol(spreadsheetId: string, tab: string, key: string): Promise<void> {
  const resolvedTab = await resolveTab(spreadsheetId, tab);
  const values = await readRange(spreadsheetId, quoteSheetNameForA1(resolvedTab));
  const targets: number[] = [];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r]?.[0] ?? '').trim() === key) targets.push(r + 1);
  }
  if (!targets.length) return;
  const sid = await tabId(spreadsheetId, resolvedTab);
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