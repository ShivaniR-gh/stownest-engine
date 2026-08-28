import { JWT } from 'google-auth-library';
import { HttpError } from '../api/_lib/env';
import { parseSpreadsheetId, quoteSheetNameForA1, rangeForSheet, resolveTab } from '../api/_lib/sheets';
import { canManageDataSource, principalFromRow } from '../src/lib/permissions/policy';
import { hydrateDatasets, getDataset, allDatasets } from '../src/config/datasets';

process.env.GOOGLE_SA_EMAIL ??= 'test@test.iam.gserviceaccount.com';
process.env.GOOGLE_SA_PRIVATE_KEY ??= '-----BEGIN PRIVATE KEY-----\nstub\n-----END PRIVATE KEY-----\n';

let f = 0;
const ck = (n: string, c: boolean, g?: unknown) => { console.log(`  ${c ? 'pass' : 'FAIL'}  ${n}${c ? '' : ' -> ' + JSON.stringify(g)}`); if (!c) f++; };
const mk = (role: string, departments: string) =>
  principalFromRow({ email: 't@x.com', name: 'T', role, departments, grants: '', status: 'Active' }, [])!;

const withMockFetch = async <T>(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> => {
  const originalFetch = globalThis.fetch;
  const originalGetAccessToken = JWT.prototype.getAccessToken;
  // @ts-expect-error intentionally replacing fetch for local verification
  globalThis.fetch = impl;
  JWT.prototype.getAccessToken = async () => ({ token: 'stub-token' } as never);
  try { return await fn(); }
  finally {
    globalThis.fetch = originalFetch;
    JWT.prototype.getAccessToken = originalGetAccessToken;
  }
};

(async () => {
  console.log('\nURL parsing');
  ck('full edit URL', parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1WohUt75L5NrsLTshdTetn9o-tlK1zvaiDVhbct_QbtM/edit?gid=0#gid=0') === '1WohUt75L5NrsLTshdTetn9o-tlK1zvaiDVhbct_QbtM');
  ck('bare id accepted', parseSpreadsheetId('1WohUt75L5NrsLTshdTetn9o-tlK1zvaiDVhbct_QbtM') !== null);
  ck('a Docs URL is rejected', parseSpreadsheetId('https://docs.google.com/document/d/abc/edit') === null);
  ck('junk rejected', parseSpreadsheetId('hello') === null);

  console.log('\nSheet name resolution');
  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ sheets: [{ properties: { title: 'Data', sheetId: 1 } }, { properties: { title: 'Sales', sheetId: 2 } }] }) }) as never,
    async () => {
      const exact = await resolveTab('abc', 'Data');
      ck('exact tab title wins', exact === 'Data');
      const fuzzy = await resolveTab('abc', '  sales  ');
      ck('case + whitespace-insensitive match resolves live title', fuzzy === 'Sales');
    },
  );

  let duplicateCalls = 0;
  await withMockFetch(
    async () => {
      duplicateCalls += 1;
      return { ok: true, json: async () => ({ sheets: [{ properties: { title: 'Alpha', sheetId: 1 } }, { properties: { title: 'alpha ', sheetId: 2 } }] }) } as never;
    },
    async () => {
      try {
        await resolveTab('dup', ' alpha ');
        ck('duplicate normalized matches are rejected', false, 'expected 409');
      } catch (e) {
        const err = e as HttpError;
        ck('duplicate normalized matches produce 409', err instanceof HttpError && err.status === 409, err?.message);
      }
    },
  );

  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ sheets: [{ properties: { title: 'Archive', sheetId: 1 } }] }) }) as never,
    async () => {
      try {
        await resolveTab('missing', 'MISSING');
        ck('missing tab produces 404', false, 'expected 404');
      } catch (e) {
        const err = e as HttpError;
        ck('missing tab lists available names', err instanceof HttpError && err.status === 404 && err.message.includes('Archive'), err?.message);
      }
    },
  );

  let reusedCalls = 0;
  await withMockFetch(
    async () => {
      reusedCalls += 1;
      return { ok: true, json: async () => ({ sheets: [{ properties: { title: 'Quarterly', sheetId: 123 } }] }) } as never;
    },
    async () => {
      await resolveTab('cache', 'Quarterly');
      await resolveTab('cache', ' quarterly ');
      ck('sheet metadata cache is reused', reusedCalls === 1, { calls: reusedCalls });
    },
  );

  ck('apostrophe-safe A1 quoting', quoteSheetNameForA1("O'Reilly") === "'O''Reilly'", quoteSheetNameForA1("O'Reilly"));
  ck('rangeForSheet quotes tab names safely', rangeForSheet("O'Reilly", 'A1:ZZ11') === "'O''Reilly'!A1:ZZ11", rangeForSheet("O'Reilly", 'A1:ZZ11'));

  console.log('\nWho may connect a data source');
  ck('super admin: any department', canManageDataSource(mk('super_admin', ''), 'logistics'));
  ck('logistics admin: own department', canManageDataSource(mk('department_admin', 'logistics'), 'logistics'));
  ck('logistics admin: NOT finance', !canManageDataSource(mk('department_admin', 'logistics'), 'finance'));
  ck('employee: never, even own dept', !canManageDataSource(mk('employee', 'logistics'), 'logistics'));

  console.log('\nRuntime registry replaces compiled schema');
  const before = getDataset('jobs')!;
  ck('seed jobs has vendor_cost', before.columns.some(c => c.key === 'vendor_cost'));
  hydrateDatasets([{
    id: 'logistics_ops', label: 'Operations', noun: 'job', department: 'logistics',
    sheetName: 'Operations', spreadsheetId: 'ABC', idColumn: 'job_no', titleColumn: 'job_no',
    columns: [
      { key: 'job_no', header: 'Job No', type: 'id', sheetColumn: 'Job No' },
      { key: 'partner', header: 'Partner', type: 'text', sheetColumn: 'Partner', editable: true },
    ],
  } as never]);
  ck('runtime dataset resolvable', getDataset('logistics_ops')?.sheetName === 'Operations');
  ck('columns come from config, not code', getDataset('logistics_ops')!.columns.map(c => c.key).join(',') === 'job_no,partner');
  ck('registry replaced, seed no longer present', getDataset('jobs') === undefined);
  ck('allDatasets reflects runtime', allDatasets().length === 1);

  console.log(f === 0 ? '\nAll phase 1-4 checks passed.\n' : `\n${f} FAILED\n`);
  process.exit(f ? 1 : 0);
})().catch(e => {
  console.error('verify-config failed:', e);
  process.exit(1);
});
