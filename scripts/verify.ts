/* Sanity checks on the parts that decide what numbers appear on screen. */
import { resolveMetric } from '../src/lib/analytics/resolveMetric';
import { getMetric } from '../src/config/metrics';
import { resolvePeriod, previousPeriod, inPeriod } from '../src/lib/analytics/period';
import { timeSeries, ageingBuckets } from '../src/lib/analytics/aggregate';
import { parseDate, formatINRCompact, formatINR } from '../src/lib/format';
import { can } from '../src/lib/permissions/policy';
import type { Principal } from '../src/lib/permissions/policy';

let fails = 0;
const check = (name: string, cond: boolean, got?: unknown) => {
  if (cond) console.log(`  pass  ${name}`);
  else { console.log(`  FAIL  ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ''}`); fails++; }
};

console.log('\nDate parsing (Indian dd/mm/yyyy must not be read as US mm/dd)');
check('03/04/2025 is 3 April', parseDate('03/04/2025')?.getMonth() === 3);
check('Sheets serial 45000 parses', parseDate(45000)?.getFullYear() === 2023, parseDate(45000)?.toISOString());
check('garbage returns null', parseDate('not a date') === null);

console.log('\nIndian currency formatting');
check('12,40,000 grouping', formatINR(1240000) === '₹12,40,000', formatINR(1240000));
check('crore short form', formatINRCompact(12400000) === '₹1.24 Cr', formatINRCompact(12400000));
check('lakh short form', formatINRCompact(240000) === '₹2.40 L', formatINRCompact(240000));

console.log('\nMetric honesty: unmapped column must never become zero');
const cpl = getMetric('sales.cpl')!;
const r1 = resolveMetric(cpl, [{ __id: '1' }], [], { expenses: [] });
check('CPL reports unavailable (is_marketing_spend unmapped)', r1.display === 'Data unavailable', r1.display);
check('CPL value is null, not 0', r1.value === null, r1.value);

console.log('\nMetric correctness: revenue vs collections must not collapse');
const rows = [
  { __id: 'a', amount: 100000, amount_paid: 100000, payment_status: 'Paid' },
  { __id: 'b', amount: 50000, amount_paid: 20000, payment_status: 'Partially Paid' },
  { __id: 'c', amount: 999999, amount_paid: 999999, payment_status: 'Void' },
];
const rev = resolveMetric(getMetric('fin.revenue')!, rows, [], {});
const col = resolveMetric(getMetric('fin.collections')!, rows, [], {});
const out = resolveMetric(getMetric('fin.outstanding')!, rows, [], {});
check('revenue excludes void = 150000', rev.value === 150000, rev.value);
check('collections = 120000', col.value === 120000, col.value);
check('outstanding = 30000', out.value === 30000, out.value);
check('revenue !== collections', rev.value !== col.value);

console.log('\nUndefined arithmetic is reported, not shown as 0%');
const rate = resolveMetric(getMetric('coll.rate')!, [], [], {});
check('empty set gives No records', rate.status === 'no_rows', rate.status);
check('no fabricated 0%', rate.value === null);

console.log('\nPeriod maths');
const p = resolvePeriod('last30');
const prev = previousPeriod(p);
check('previous window is same length', Math.round(((p.to!.getTime()-p.from!.getTime()) - (prev.to!.getTime()-prev.from!.getTime()))/1000) === 0);
check('windows do not overlap', prev.to!.getTime() < p.from!.getTime());
check('all-time suppresses comparison', previousPeriod(resolvePeriod('all')).from === null);
check('date inside window', inPeriod(new Date(), p));

console.log('\nTime series zero-fills empty buckets');
const ts = timeSeries(
  [{ __id: '1', d: new Date().toISOString(), v: 10 }],
  'd', resolvePeriod('last7'),
  [{ id: 'v', agg: 'sum', measure: 'v' }],
);
check('7 buckets for a 7-day window', ts.length === 7, ts.length);
check('empty buckets are 0 not missing', ts.every(b => typeof b.values.v === 'number'));

console.log('\nAgeing buckets');
const old = new Date(); old.setDate(old.getDate() - 75);
const age = ageingBuckets([{ __id: '1', due_at: old.toISOString(), amount: 5000, amount_paid: 1000 }], 'due_at', 'amount', 'amount_paid');
check('75 days lands in 61-90', age.find(b => b.key === '61–90 days')!.value === 4000, age.map(b => [b.key, b.value]));
check('fully paid rows excluded', ageingBuckets([{ __id: '2', due_at: old.toISOString(), amount: 100, amount_paid: 100 }], 'due_at', 'amount', 'amount_paid').every(b => b.value === 0));

console.log('\nPermissions fail closed');
const emp: Principal = { email: 'e@x.com', name: 'E', role: 'employee', departments: ['sales'], grants: [] };
const sup: Principal = { email: 's@x.com', name: 'S', role: 'super_admin', departments: [], grants: [] };
check('employee cannot DELETE', !can(emp, 'DELETE', 'sales'));
check('employee cannot EXPORT by default', !can(emp, 'EXPORT', 'sales'));
check('granted EXPORT works', can({ ...emp, grants: ['EXPORT'] }, 'EXPORT', 'sales'));
check('grant does not cross departments', !can({ ...emp, grants: ['EXPORT'] }, 'EXPORT', 'finance'));
check('employee cannot MANAGE_USERS', !can(emp, 'MANAGE_USERS'));
check('super admin holds every department', can(sup, 'DELETE', 'finance'));
check('null principal denied', !can(null, 'VIEW', 'sales'));
check('missing department denied', !can(emp, 'VIEW'));


console.log('\nAn inaccessible dataset must never render as a real zero');
{
  const rm = resolveMetric;
  const def = getMetric('fin.revenue')!;
  const open = rm(def, [], [], {});
  const blocked = rm(def, [], [], {}, new Set(['invoices']));
  check('empty-but-loaded gives 0 (a real zero)', open.value === 0, open.display);
  check('unloaded dataset does NOT give 0', blocked.value === null, blocked.value);
  check('unloaded dataset says Not available', blocked.display === 'Not available', blocked.display);
  check('reason names the dataset', blocked.reason.includes('invoices'));
  const cross = rm(getMetric('fin.profit')!, [], [], {}, new Set(['expenses']));
  check('blocked via requiresDatasets also caught', cross.status === 'no_access', cross.status);
}

console.log(fails === 0 ? '\nAll checks passed.\n' : `\n${fails} CHECK(S) FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
