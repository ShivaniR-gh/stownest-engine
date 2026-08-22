/** Schema derivation must work from mapping alone, with no domain knowledge. */
import { deriveSchema, deriveKpis, summariseBy, utilisationBy, insights, band } from '../src/lib/analytics/deriveSchema';
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

console.log('\nSemantic roles unlock real metrics — generically');
{
  // Same sheet, now with roles declared by the admin in the mapping step.
  const withRoles = {
    ...facility,
    columns: facility.columns.map(c => ({
      ...c,
      role: c.key === 'warehouse' ? 'name'
        : c.key === 'location' ? 'location'
        : c.key === 'month' ? 'date'
        : c.key === 'total_space' ? 'capacity'
        : c.key === 'occupied_space' ? 'occupied'
        : c.key === 'status' ? 'status' : undefined,
    })),
  } as DatasetDef;

  const before = deriveSchema(facility, rows);
  const after = deriveSchema(withRoles, rows);
  ck('without roles, utilisation is not computable', !before.hasUtilisation);
  ck('with roles, it is', after.hasUtilisation);

  const k = deriveKpis(withRoles, rows, [], after);
  const labels = k.map(x => x.def.label);
  ck('Utilisation KPI appears', labels.includes('Utilisation'), labels);
  ck('Available is derived, not read', labels.includes('Available'));
  const util = k.find(x => x.def.label === 'Utilisation')!;
  // 60 rows: 54 at 9500/10000, 6 at 3000/10000 -> (54*9500+6*3000)/600000
  const expected = ((54 * 9500 + 6 * 3000) / (60 * 10000)) * 100;
  ck('utilisation is arithmetically correct', Math.abs((util.value ?? 0) - expected) < 0.01,
    { got: util.value, expected });
  ck('formula names the real sheet columns',
    util.def.formula.includes('Occupied Space (sqft)') && util.def.formula.includes('Total Space (sqft)'),
    util.def.formula);
  const avail = k.find(x => x.def.label === 'Available')!;
  ck('available = capacity − occupied', avail.value === 60 * 10000 - (54 * 9500 + 6 * 3000), avail.value);

  console.log('\nUtilisation bands drive colour consistently');
  ck('50% is low', band(50) === 'low');
  ck('75% is healthy', band(75) === 'healthy');
  ck('90% is high', band(90) === 'high');
  ck('100% is full', band(100) === 'full');

  const byLoc = utilisationBy(rows, withRoles.columns[1], after);
  ck('utilisation computed per location', byLoc.length === 3, byLoc.map(x => [x.key, x.pct.toFixed(1)]));
  ck('sorted by utilisation descending', byLoc[0].pct >= byLoc[byLoc.length - 1].pct);
  ck('available per group is capacity − occupied',
    byLoc.every(g => Math.abs(g.available - (g.capacity - g.occupied)) < 0.01));

  console.log('\nInsights are stated only when supported');
  ck('no insights without roles', insights(rows, before).length === 0);
  const ins = insights(rows, after);
  ck('insights produced with roles', ins.length > 0, ins);
  ck('insights never invent a percentage above 100',
    !ins.some(t => /(\d+(\.\d+)?)%/.test(t) && Number(RegExp.$1) > 100), ins);
  ck('no insights on an empty set', insights([], after).length === 0);
}

console.log(f === 0 ? '\nAll derivation checks passed.\n' : `\n${f} FAILED\n`);
process.exit(f ? 1 : 0);
