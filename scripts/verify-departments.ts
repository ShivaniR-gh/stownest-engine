/** Runtime-department behaviour that can be proven without Google. */
import { principalFromRow, can, canManageDepartments, canManageDataSource } from '../src/lib/permissions/policy';
import { hydrateDepartments, activeDepartments, DEPARTMENTS_ALL, getDepartment, SEED_DEPARTMENTS, DEPT_BY_ID } from '../src/config/departments';
import { ID_PATTERN } from '../api/_lib/departments';

let f = 0;
const ck = (n: string, c: boolean, g?: unknown) => { console.log(`  ${c ? 'pass' : 'FAIL'}  ${n}${c ? '' : ' -> ' + JSON.stringify(g)}`); if (!c) f++; };
const mk = (role: string, departments: string, known?: string[]) =>
  principalFromRow({ email: 't@x.com', name: 'T', role, departments, grants: '', status: 'Active' }, [], known)!;

console.log('\nId format validation');
ck('facility accepted', ID_PATTERN.test('facility'));
ck('snake_case accepted', ID_PATTERN.test('control_tower'));
ck('leading digit rejected', !ID_PATTERN.test('2facility'));
ck('spaces rejected', !ID_PATTERN.test('my dept'));
ck('uppercase rejected', !ID_PATTERN.test('Facility'));
ck('injection-ish rejected', !ID_PATTERN.test('a;drop'));

console.log('\nSeed fallback, then runtime override');
ck('seed present before hydrate', DEPARTMENTS_ALL().length === SEED_DEPARTMENTS.length);
hydrateDepartments([
  { id: 'facility', label: 'Facility', purpose: 'Space', icon: 'box', status: 'Active', sortOrder: 1, metrics: [], inWorkspace: true },
  { id: 'sales', label: 'Sales', purpose: 'Leads', icon: 'trending', status: 'Active', sortOrder: 2, metrics: [], inWorkspace: true },
  { id: 'legacy', label: 'Legacy', purpose: 'Old', icon: 'layers', status: 'Inactive', sortOrder: 9, metrics: [], inWorkspace: true },
]);
ck('facility exists with no code change', getDepartment('facility')?.label === 'Facility');
ck('inactive excluded from navigation', !activeDepartments().some(d => d.id === 'legacy'), activeDepartments().map(d => d.id));
ck('inactive still listed for administration', DEPARTMENTS_ALL().some(d => d.id === 'legacy'));
ck('DEPT_BY_ID shim resolves runtime departments', DEPT_BY_ID['facility']?.label === 'Facility');

console.log('\nAuthorization on a department that never existed at build time');
const facEmp = mk('employee', 'facility');
const facAdmin = mk('department_admin', 'facility');
ck('employee can VIEW facility', can(facEmp, 'VIEW', 'facility'));
ck('employee can CREATE facility', can(facEmp, 'CREATE', 'facility'));
ck('employee can UPDATE facility', can(facEmp, 'UPDATE', 'facility'));
ck('employee CANNOT DELETE facility', !can(facEmp, 'DELETE', 'facility'));
ck('department admin CAN DELETE facility', can(facAdmin, 'DELETE', 'facility'));
ck('facility staff cannot reach sales', !can(facEmp, 'VIEW', 'sales'));

console.log('\nCreating a department grants nothing');
const outsider = mk('employee', 'sales');
ck('unassigned user has no facility access', !can(outsider, 'VIEW', 'facility'));

console.log('\nOnly super admin manages departments');
ck('super admin may', canManageDepartments(mk('super_admin', '')));
ck('department admin may NOT', !canManageDepartments(facAdmin));
ck('employee may NOT', !canManageDepartments(facEmp));
ck('department admin may still manage its own data source', canManageDataSource(facAdmin, 'facility'));
ck('department admin may not manage another data source', !canManageDataSource(facAdmin, 'sales'));

console.log('\nUnknown ids in access_control are rejected, not cast through');
const typo = mk('employee', 'facilty,sales', ['facility', 'sales']);
ck('typo dropped', !typo.departments.includes('facilty'), typo.departments);
ck('valid id kept', typo.departments.includes('sales'));
ck('no access via the typo', !can(typo, 'VIEW', 'facilty'));

console.log(f === 0 ? '\nAll runtime-department checks passed.\n' : `\n${f} FAILED\n`);
process.exit(f ? 1 : 0);
