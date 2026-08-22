import { parseSpreadsheetId } from '../api/_lib/sheets';
import { canManageDataSource, principalFromRow } from '../src/lib/permissions/policy';
import { hydrateDatasets, getDataset, allDatasets } from '../src/config/datasets';

let f = 0;
const ck = (n: string, c: boolean, g?: unknown) => { console.log(`  ${c ? 'pass' : 'FAIL'}  ${n}${c ? '' : ' -> ' + JSON.stringify(g)}`); if (!c) f++; };
const mk = (role: string, departments: string) =>
  principalFromRow({ email: 't@x.com', name: 'T', role, departments, grants: '', status: 'Active' }, [])!;

console.log('\nURL parsing');
ck('full edit URL', parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1WohUt75L5NrsLTshdTetn9o-tlK1zvaiDVhbct_QbtM/edit?gid=0#gid=0') === '1WohUt75L5NrsLTshdTetn9o-tlK1zvaiDVhbct_QbtM');
ck('bare id accepted', parseSpreadsheetId('1WohUt75L5NrsLTshdTetn9o-tlK1zvaiDVhbct_QbtM') !== null);
ck('a Docs URL is rejected', parseSpreadsheetId('https://docs.google.com/document/d/abc/edit') === null);
ck('junk rejected', parseSpreadsheetId('hello') === null);

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
