import type { Action, DepartmentId, RoleId } from '../../config/types';
/** ---------------------------------------------------------------------------
 * Single source of truth for authorisation.
 *
 * This module is imported by BOTH the React app and the Vercel functions. The
 * UI uses it to decide what to render; the API uses it to decide what to allow.
 * The UI decision is a convenience — the API decision is the actual control.
 * ------------------------------------------------------------------------- */

export interface Principal {
  email: string;
  name: string;
  picture?: string;
  role: RoleId;
  /** Ignored for super_admin, who implicitly holds every department. */
  departments: DepartmentId[];
  /** Actions granted beyond the role default, e.g. an employee given DELETE. */
  grants: Action[];
  /** Actions explicitly withheld, applied last and winning over everything. */
  denies?: Action[];
}

const ROLE_ACTIONS: Record<RoleId, Action[]> = {
  super_admin: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'ANALYTICS', 'MANAGE_USERS', 'MANAGE_PERMISSIONS'],
  department_admin: ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'ANALYTICS'],
  // Deliberately no DELETE and no EXPORT. Both must be granted explicitly.
  employee: ['VIEW', 'CREATE', 'UPDATE', 'ANALYTICS'],
};

export const ROLE_LABEL: Record<RoleId, string> = {
  super_admin: 'Super admin',
  department_admin: 'Department admin',
  employee: 'Employee',
};

export const ALL_ACTIONS: Action[] = [
  'VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'ANALYTICS', 'MANAGE_USERS', 'MANAGE_PERMISSIONS',
];

export const ACTION_LABEL: Record<Action, string> = {
  VIEW: 'View records',
  CREATE: 'Add records',
  UPDATE: 'Edit records',
  DELETE: 'Delete records',
  EXPORT: 'Export data',
  ANALYTICS: 'View analytics',
  MANAGE_USERS: 'Manage users',
  MANAGE_PERMISSIONS: 'Manage permissions',
};

/** Global actions are not scoped to a department. */
const GLOBAL_ACTIONS = new Set<Action>(['MANAGE_USERS', 'MANAGE_PERMISSIONS']);

export function hasDepartment(p: Principal | null, dept: DepartmentId): boolean {
  if (!p) return false;
  if (p.role === 'super_admin') return true;
  return p.departments.includes(dept);
}

/**
 * The one authorisation question in the system.
 * `dept` is required for every non-global action; omitting it fails closed.
 */
export function can(p: Principal | null, action: Action, dept?: DepartmentId): boolean {
  if (!p) return false;
  if (p.denies?.includes(action)) return false;

  const allowed = new Set<Action>([...ROLE_ACTIONS[p.role], ...p.grants]);
  if (!allowed.has(action)) return false;

  if (GLOBAL_ACTIONS.has(action)) return p.role === 'super_admin' || p.grants.includes(action);
  if (!dept) return false;
  return hasDepartment(p, dept);
}

/** Departments this principal may see at all — drives sidebar and routing. */
export function visibleDepartments(p: Principal | null, all: DepartmentId[]): DepartmentId[] {
  if (!p) return [];
  if (p.role === 'super_admin') return all;
  return all.filter(d => p.departments.includes(d));
}

export function effectiveActions(p: Principal | null): Action[] {
  if (!p) return [];
  const set = new Set<Action>([...ROLE_ACTIONS[p.role], ...p.grants]);
  p.denies?.forEach(d => set.delete(d));
  return ALL_ACTIONS.filter(a => set.has(a));
}

export const roleDefaults = (r: RoleId) => ROLE_ACTIONS[r];

/** Parses an access_control sheet row into a Principal. Used server-side. */
export function principalFromRow(
  row: Record<string, unknown>,
  superAdmins: string[],
  /** Known department ids. When supplied, unknown ids in the sheet are dropped
   *  and logged instead of being cast through — a typo must not silently look
   *  like access to a department that does not exist. */
  knownDepartments?: string[],
): Principal | null {
  const email = String(row.email ?? '').trim().toLowerCase();
  if (!email) return null;
  if (String(row.status ?? 'Active').trim().toLowerCase() === 'suspended') return null;

  const isBootstrapSuper = superAdmins.includes(email);
  const rawRole = String(row.role ?? 'employee').trim() as RoleId;
  const role: RoleId = isBootstrapSuper
    ? 'super_admin'
    : (['super_admin', 'department_admin', 'employee'] as const).includes(rawRole) ? rawRole : 'employee';

  const split = (v: unknown) =>
    String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);

  return {
    email,
    name: String(row.name ?? email.split('@')[0]),
    role,
    departments: (() => {
      const declared = split(row.departments);
      if (!knownDepartments) return declared;
      const valid = declared.filter(d => knownDepartments.includes(d));
      const bad = declared.filter(d => !knownDepartments.includes(d));
      if (bad.length) console.warn(`[access_control] ${email}: unknown department(s) ignored: ${bad.join(', ')}`);
      return valid;
    })(),
    grants: split(row.grants).filter(g => (ALL_ACTIONS as string[]).includes(g)) as Action[],
  };
}

/**
 * Who may connect or reconfigure a department's data source.
 * Super admins anywhere; department admins only for a department they hold.
 * Employees never — connecting a sheet changes what everyone else sees.
 */
export function canManageDataSource(p: Principal | null, dept: DepartmentId): boolean {
  if (!p) return false;
  if (p.role === 'super_admin') return true;
  return p.role === 'department_admin' && p.departments.includes(dept);
}

/**
 * Department management is super-admin only. A department admin runs a
 * department; they do not get to invent new ones, because creating a department
 * changes what every other admin can connect data to.
 */
export const canManageDepartments = (p: Principal | null): boolean =>
  p?.role === 'super_admin';
