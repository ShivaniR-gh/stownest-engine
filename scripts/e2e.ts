/**
 * End-to-end verification against a REAL Google Sheet.
 *
 * Mutations go through the HTTP API (so authentication and authorization are
 * genuinely exercised). Verification reads the spreadsheet DIRECTLY via the
 * service account, so a passing result means the row really is in Google — not
 * merely that the API said so.
 *
 *   npm run e2e
 *
 * Environment (put in .env or export):
 *   E2E_TOKEN     Google ID token of the signed-in user. In the browser console:
 *                 copy(sessionStorage.getItem('sn.idtoken'))
 *   E2E_DATASET   dataset id to exercise, e.g. logistics_operations
 *   E2E_SHEET_URL optional: also runs validate/preview against this URL
 *   E2E_FOREIGN   optional: a dataset id in a department the user must NOT reach
 */
import { readFileSync } from 'node:fs';
import { readRange } from '../api/_lib/sheets';
import { loadRegistry, invalidateRegistry } from '../api/_lib/registry';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

const API = process.env.E2E_API ?? 'http://localhost:3001';
const TOKEN = process.env.E2E_TOKEN ?? '';
const DATASET = process.env.E2E_DATASET ?? '';
const SHEET_URL = process.env.E2E_SHEET_URL ?? '';
const FOREIGN = process.env.E2E_FOREIGN ?? '';
const STAMP = `E2E-${Date.now()}`;

let pass = 0, fail = 0, skip = 0;
const ok = (n: string, note = '') => { console.log(`  \x1b[32mPASS\x1b[0m  ${n}${note ? '  — ' + note : ''}`); pass++; };
const no = (n: string, note = '') => { console.log(`  \x1b[31mFAIL\x1b[0m  ${n}${note ? '  — ' + note : ''}`); fail++; };
const sk = (n: string, why: string) => { console.log(`  \x1b[33mSKIP\x1b[0m  ${n}  — ${why}`); skip++; };
const step = (n: string) => console.log(`\n\x1b[1m${n}\x1b[0m`);

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: body as Record<string, unknown> };
}

/** Reads the target sheet directly — the independent check. */
async function sheetRows(dsId: string) {
  invalidateRegistry();
  const ds = (await loadRegistry(true)).find(d => d.id === dsId);
  if (!ds) throw new Error(`dataset ${dsId} is not in the registry`);
  const values = await readRange(
    ds.spreadsheetId ?? process.env.SHEETS_SPREADSHEET_ID!, ds.sheetName);
  const headers = (values[0] ?? []).map(h => String(h ?? '').trim());
  return {
    ds,
    headers,
    rows: values.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, String(r?.[i] ?? '')]))),
  };
}

(async () => {
  console.log(`\nStowNest end-to-end verification\n  API      ${API}\n  dataset  ${DATASET || '(not set)'}\n  stamp    ${STAMP}`);

  if (!TOKEN) { console.log('\nE2E_TOKEN is not set. Grab it in the browser console:\n  copy(sessionStorage.getItem("sn.idtoken"))\n'); process.exit(1); }
  if (!DATASET) { console.log('\nE2E_DATASET is not set.\n'); process.exit(1); }

  /* -------- who am I -------- */
  step('Session');
  const s = await api('/api/auth/session');
  if (s.status !== 200) { no('authenticate', `HTTP ${s.status} ${JSON.stringify(s.body)}`); process.exit(1); }
  const principal = s.body.principal as { email: string; role: string; departments: string[] };
  ok('authenticated', `${principal.email} · ${principal.role} · [${principal.departments.join(',') || 'all'}]`);
  const isAdminRole = principal.role === 'super_admin' || principal.role === 'department_admin';

  /* -------- 2,3,4: validate + tab + headers -------- */
  step('2-4  Validate URL, detect tabs, detect headers');
  if (!SHEET_URL) sk('validate / preview', 'E2E_SHEET_URL not set');
  else {
    const v = await api('/api/config/sources', { method: 'POST', body: JSON.stringify({ action: 'validate', url: SHEET_URL }) });
    if (v.status === 200) {
      ok('URL validated', `"${v.body.title}" · ${(v.body.tabs as string[]).length} tabs`);
      const tabs = v.body.tabs as string[];
      const p = await api('/api/config/sources', {
        method: 'POST',
        body: JSON.stringify({ action: 'preview', spreadsheetId: v.body.spreadsheetId, tab: tabs[0] }),
      });
      if (p.status === 200) ok('headers detected', `${(p.body.headers as string[]).length} columns in "${tabs[0]}"`);
      else no('preview', JSON.stringify(p.body));
    } else no('validate URL', JSON.stringify(v.body));
  }

  /* -------- 6: configuration saved / registry -------- */
  step('6  Configuration is live');
  const reg = await api('/api/config/datasets');
  const defs = (reg.body.datasets ?? []) as { id: string; sheetName: string; columns: { key: string; sheetColumn?: string; editable?: boolean; required?: boolean; type: string }[] }[];
  const def = defs.find(d => d.id === DATASET);
  if (!def) { no('dataset present in registry', `${DATASET} not returned for this user`); process.exit(1); }
  ok('dataset in registry', `tab "${def.sheetName}" · ${def.columns.length} mapped columns`);

  /* -------- 7: READ -------- */
  step('7  READ from the actual sheet');
  const readRes = await api(`/api/data/${DATASET}`);
  if (readRes.status !== 200) { no('read via API', `HTTP ${readRes.status} ${JSON.stringify(readRes.body)}`); process.exit(1); }
  const apiRows = (readRes.body.rows ?? []) as Record<string, unknown>[];
  const direct = await sheetRows(DATASET);
  ok('read via API', `${apiRows.length} rows`);
  if (apiRows.length === direct.rows.length) ok('API row count matches the sheet', `${direct.rows.length}`);
  else no('API row count matches the sheet', `api=${apiRows.length} sheet=${direct.rows.length}`);

  /* -------- 8,9: CREATE + verify in Google -------- */
  step('8-9  CREATE, then verify the row exists in Google Sheets');
  const writable = def.columns.filter(c => c.sheetColumn && (c.editable || c.required));
  if (!writable.length) { no('create', 'no editable columns configured'); process.exit(1); }
  const idCol = (direct.ds as { idColumn: string }).idColumn;
  const values: Record<string, string> = {};
  for (const c of writable) {
    values[c.key] = c.key === idCol ? STAMP
      : c.type === 'currency' || c.type === 'number' ? '1234'
      : c.type === 'date' ? new Date().toISOString().slice(0, 10)
      : `${STAMP}`;
  }
  if (!(idCol in values)) values[idCol] = STAMP;

  const created = await api(`/api/data/${DATASET}`, { method: 'POST', body: JSON.stringify({ values }) });
  if (created.status !== 200) no('CREATE via API', `HTTP ${created.status} ${JSON.stringify(created.body)}`);
  else {
    ok('CREATE via API');
    const after = await sheetRows(DATASET);
    const found = after.rows.find(r => Object.values(r).some(v => String(v).includes(STAMP)));
    if (found) ok('row IS present in the Google Sheet', `${after.rows.length} rows now`);
    else no('row IS present in the Google Sheet', 'stamp not found after create');
  }

  /* -------- 10,11: UPDATE + verify -------- */
  step('10-11  UPDATE, then verify the sheet row changed');
  const editable = writable.find(c => c.key !== idCol && c.type !== 'date');
  if (!editable) sk('update', 'no editable non-id column');
  else {
    const newVal = `${STAMP}-UPDATED`;
    const upd = await api(`/api/data/${DATASET}?id=${encodeURIComponent(STAMP)}`, {
      method: 'PATCH', body: JSON.stringify({ values: { [editable.key]: newVal } }),
    });
    if (upd.status !== 200) no('UPDATE via API', `HTTP ${upd.status} ${JSON.stringify(upd.body)}`);
    else {
      ok('UPDATE via API');
      const after = await sheetRows(DATASET);
      const hit = after.rows.find(r => Object.values(r).some(v => String(v) === STAMP));
      const changed = hit && Object.values(hit).some(v => String(v) === newVal);
      if (changed) ok('sheet row DID change in Google', `${editable.header ?? editable.key} = ${newVal}`);
      else no('sheet row DID change in Google', JSON.stringify(hit ?? {}).slice(0, 160));
    }
  }

  /* -------- 12/13/14: DELETE permission + verify -------- */
  step('12-14  DELETE permission and real removal');
  const del = await api(`/api/data/${DATASET}?id=${encodeURIComponent(STAMP)}`, { method: 'DELETE' });
  if (!isAdminRole) {
    if (del.status === 403) {
      ok('employee DELETE refused with 403', String(del.body.error).slice(0, 70));
      const after = await sheetRows(DATASET);
      const still = after.rows.some(r => Object.values(r).some(v => String(v) === STAMP));
      if (still) ok('Google Sheet UNCHANGED after refused delete');
      else no('Google Sheet UNCHANGED after refused delete', 'the row disappeared — enforcement leak');
      console.log(`\n  \x1b[33mNOTE\x1b[0m  test row ${STAMP} left in the sheet. Re-run as an admin, or remove it by hand.`);
    } else no('employee DELETE refused', `expected 403, got ${del.status}`);
  } else {
    if (del.status !== 200) no('admin DELETE via API', `HTTP ${del.status} ${JSON.stringify(del.body)}`);
    else {
      ok('admin DELETE via API');
      const after = await sheetRows(DATASET);
      const gone = !after.rows.some(r => Object.values(r).some(v => String(v) === STAMP));
      if (gone) ok('row IS removed from the Google Sheet', `${after.rows.length} rows now`);
      else no('row IS removed from the Google Sheet', 'stamp still present');
    }
    sk('employee DELETE refused', 'run again with an employee token');
  }

  /* -------- 15: refresh reflects the sheet -------- */
  step('15  Refresh reflects current sheet contents');
  const again = await api(`/api/data/${DATASET}`);
  const nowDirect = await sheetRows(DATASET);
  if (again.status === 200 && ((again.body.rows ?? []) as unknown[]).length === nowDirect.rows.length)
    ok('re-read matches the sheet', `${nowDirect.rows.length} rows`);
  else no('re-read matches the sheet', `api=${((again.body.rows ?? []) as unknown[]).length} sheet=${nowDirect.rows.length}`);

  /* -------- 16: cross-department isolation -------- */
  step('16  Cannot reach another department');
  if (!FOREIGN) sk('foreign dataset refused', 'E2E_FOREIGN not set');
  else {
    const f = await api(`/api/data/${FOREIGN}`);
    if (f.status === 403) ok('foreign dataset refused with 403', String(f.body.error).slice(0, 70));
    else if (principal.role === 'super_admin') sk('foreign dataset refused', 'super admin legitimately has access');
    else no('foreign dataset refused', `expected 403, got ${f.status}`);
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${pass} passed   ${fail} failed   ${skip} skipped`);
  console.log(fail === 0
    ? '\n  Verified against the real Google Sheet.\n'
    : '\n  NOT verified — failures above are real.\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nharness error:', e); process.exit(1); });
