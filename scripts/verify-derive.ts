/** Schema derivation must work from mapping alone, with no domain knowledge. */
import { deriveSchema, deriveKpis, summariseBy } from '../src/lib/analytics/deriveSchema';
import type { DatasetDef, Row } from '../src/config/types';

let f = 0;
const ck = (n: string, c: boolean, g?: unknown) => { console.log(`  ${c ? 'pass' : 'FAIL'}  ${n}${c ? '' : ' -> ' + JSON.stringify(g)}`); if (!c) f++; };

/* A facility-shaped sheet. Headers StowNest has never seen. */
const facility = {
  id: 'facility_data', label: 'Facility data', noun: 'record', department: 'facility',
  sheetName: 'Facility_Data', idColumn: 'warehouse', titleColumn: 'warehouse', dateColumn: 'month',
  statusColumn: 'status',
  columns: [
    { key: 'warehouse', header: 'Warehouse', type: 'text', sheetColumn: 'Warehouse', groupable: true },
    { key: 'location', header: 'Location', type: 'enum', sheetColumn: 'Location', groupable: true },
    { key: 'month', header: 'Month', type: 'date', sheetColumn: 'Month' },
    { key: 'total_space', header: 'Total Space (sqft)', type: 'number', sheetColumn: 'Total Space (sqft)' },
    { key: 'occupied_space', header: 'Occupied Space (sqft)', type: 'number', sheetColumn: 'Occupied Space (sqft)' },
    { key: 'status', header: 'Status', type: 'enum', sheetColumn: 'Status' },
  ],
} as unknown as DatasetDef;

const cities = ['Bangalore', 'Hyderabad', 'Chennai'];
const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({
  __id: `W${i}`, warehouse: `WH-${i % 12}`, location: cities[i % 3],
  month: `${['Jan', 'Feb', 'Mar'][i % 3]} 2026`,
  total_space: 10000, occupied_space: i % 10 === 0 ? 3000 : 9500,
  status: i % 10 === 0 ? 'Low Utilization' : 'Near Full',
}));

console.log('\nDerivation from mapping alone');
const s = deriveSchema(facility, rows);
ck('numeric columns become measures',
  s.measures.map(m => m.key).sort().join(',') === 'occupied_space,total_space', s.measures.map(m => m.key));
ck('date column detected', s.dateColumn?.key === 'month', s.dateColumn?.key);
ck('status column detected', s.statusColumn?.key === 'status', s.statusColumn?.key);
ck('low-cardinality columns become dimensions', s.dimensions.some(d => d.key === 'location'));
ck('primary dimension is not the status column', s.primaryDimension?.key !== 'status', s.primaryDimension?.key);

/* Cardinality guard: a free-text column with a unique value per row is not a dimension. */
const noisy = {
  ...facility,
  columns: [...facility.columns, { key: 'notes', header: 'Notes', type: 'text', sheetColumn: 'Notes' }],
} as DatasetDef;
const noisyRows = rows.map((r, i) => ({ ...r, notes: `unique note ${i}` }));
ck('high-cardinality text is NOT a dimension',
  !deriveSchema(noisy, noisyRows).dimensions.some(d => d.key === 'notes'));

console.log('\nDerived KPIs are labelled by the sheet, not invented');
const kpis = deriveKpis(facility, rows, [], s);
const labels = kpis.map(k => k.def.label);
ck('record count present', labels.includes('Facility data records'), labels);
ck('sums use the column header verbatim', labels.includes('Total Total Space (sqft)'), labels);
ck('no invented business names', !labels.some(l => /utilisation|utilization|revenue|margin|profit/i.test(l)), labels);
ck('distinct count of the primary dimension', labels.some(l => l.startsWith('Distinct')), labels);
ck('formula names the real sheet column',
  kpis.some(k => k.def.formula.includes('Facility_Data.Total Space (sqft)')),
  kpis.map(k => k.def.formula));
ck('every KPI carries a source', kpis.every(k => k.sources.length > 0));

console.log('\nEmpty data must not fabricate zeros');
const empty = deriveKpis(facility, [], [], deriveSchema(facility, []));
ck('sums report no records rather than 0',
  empty.filter(k => k.def.id.includes('.sum.')).every(k => k.value === null && k.display === 'No records'),
  empty.map(k => [k.def.label, k.display]));

console.log('\nGrouping works on whichever dimension exists');
const byCity = summariseBy(rows, facility.columns[1], s.measures);
ck('one group per distinct value', byCity.length === 3, byCity.map(g => g.key));
ck('counts add back to the total', byCity.reduce((a, g) => a + g.count, 0) === rows.length);
ck('measures summed per group', byCity[0].measures.total_space === byCity[0].count * 10000, byCity[0].measures);

console.log(f === 0 ? '\nAll derivation checks passed.\n' : `\n${f} FAILED\n`);
process.exit(f ? 1 : 0);
