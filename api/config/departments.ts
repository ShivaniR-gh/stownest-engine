import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth.js';
import { fail, ok } from '../_lib/respond.js';
import { HttpError, required } from '../_lib/env.js';
import { appendKeyedRows, deleteRowsWhereFirstCol, ensureTab, readRange, audit } from '../_lib/sheets.js';
import {
  DEPARTMENTS_HEADERS, DEPARTMENTS_TAB, ID_PATTERN,
  invalidateDepartments, loadDepartments,
} from '../_lib/departments.js';
import { listSources } from '../_lib/registry.js';
import { canManageDepartments } from '../../src/lib/permissions/policy.js';

/** ---------------------------------------------------------------------------
 * Department management. Super admin only, enforced here rather than in the UI.
 *
 * GET is open to any authenticated user (navigation needs the list); every
 * mutation requires super_admin. Creating a department grants no data access —
 * that still comes solely from access_control.
 * ------------------------------------------------------------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const principal = await authenticate(req);
    const control = required('SHEETS_SPREADSHEET_ID');

    if (req.method === 'GET') {
      if (String(req.query.refresh ?? '') === '1') invalidateDepartments();
      const departments = await loadDepartments();
      const sources = await listSources();
      const counts: Record<string, number> = {};
      for (const s of sources) counts[s.department] = (counts[s.department] ?? 0) + 1;
      return ok(res, {
        departments: departments.map(d => ({ ...d, datasetCount: counts[d.id] ?? 0 })),
        canManage: canManageDepartments(principal),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Single gate for every mutation below.
    if (!canManageDepartments(principal)) {
      throw new HttpError(403, 'Only a super admin can manage departments.');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const id = String(body.id ?? '').trim().toLowerCase();
    const existing = await loadDepartments();

    /** Rewrites the whole tab. The list is small and this keeps create, edit and
     *  status changes on one code path with no partial-update states. */
    const persist = async (next: { id: string; label: string; purpose: string; icon: string; status: string; sortOrder: number }[]) => {
      await ensureTab(control, DEPARTMENTS_TAB, DEPARTMENTS_HEADERS);
      const rows = await readRange(control, DEPARTMENTS_TAB);
      for (let r = rows.length - 1; r >= 1; r--) {
        await deleteRowsWhereFirstCol(control, DEPARTMENTS_TAB, String(rows[r]?.[0] ?? ''));
      }
      await appendKeyedRows(control, DEPARTMENTS_TAB, DEPARTMENTS_HEADERS,
        next.map(d => ({
          'ID': d.id, 'Label': d.label, 'Purpose': d.purpose,
          'Icon': d.icon, 'Status': d.status, 'Sort Order': d.sortOrder,
        })));
      invalidateDepartments();
    };

    const asRow = (d: typeof existing[number]) => ({
      id: d.id, label: d.label, purpose: d.purpose, icon: d.icon,
      status: d.status ?? 'Active', sortOrder: d.sortOrder ?? 0,
    });

    if (action === 'create') {
      if (!ID_PATTERN.test(id)) {
        throw new HttpError(400, 'Id must start with a letter and contain only lowercase letters, numbers and underscores.');
      }
      if (existing.some(d => d.id === id)) throw new HttpError(400, `A department with id "${id}" already exists.`);
      const label = String(body.label ?? '').trim();
      if (!label) throw new HttpError(400, 'Display name is required.');

      await persist([...existing.map(asRow), {
        id, label,
        purpose: String(body.purpose ?? ''),
        icon: String(body.icon ?? 'layers'),
        status: 'Active',
        sortOrder: Number(body.sortOrder) || existing.length + 1,
      }]);
      await audit({ actor: principal.email, action: 'CREATE_DEPARTMENT', dataset: 'departments', recordId: id, detail: label });
      return ok(res, { ok: true, id });
    }

    if (action === 'update' || action === 'setStatus') {
      const target = existing.find(d => d.id === id);
      if (!target) throw new HttpError(404, 'No such department.');

      const status = action === 'setStatus'
        ? (String(body.status ?? '') === 'Inactive' ? 'Inactive' : 'Active')
        : (target.status ?? 'Active');
      if (action === 'update' && String(body.label ?? '').trim() === '') {
        throw new HttpError(400, 'Display name is required.');
      }

      await persist(existing.map(d => d.id !== id ? asRow(d) : {
        ...asRow(d),
        label: action === 'update' ? String(body.label).trim() : d.label,
        purpose: action === 'update' ? String(body.purpose ?? '') : d.purpose,
        icon: action === 'update' ? String(body.icon ?? d.icon) : d.icon,
        sortOrder: action === 'update' ? (Number(body.sortOrder) || d.sortOrder || 0) : (d.sortOrder ?? 0),
        status,
      }));
      await audit({ actor: principal.email, action: action === 'setStatus' ? `DEPARTMENT_${status.toUpperCase()}` : 'UPDATE_DEPARTMENT',
        dataset: 'departments', recordId: id });
      return ok(res, { ok: true });
    }

    if (action === 'delete') {
      // Hard delete is refused while anything references the department, so
      // history and access records can never be orphaned.
      const sources = await listSources();
      const used = sources.filter(s => s.department === id);
      if (used.length) {
        throw new HttpError(400,
          `${used.length} data source${used.length > 1 ? 's are' : ' is'} still connected to this department. Deactivate it instead.`);
      }
      if (!existing.some(d => d.id === id)) throw new HttpError(404, 'No such department.');
      await persist(existing.filter(d => d.id !== id).map(asRow));
      await audit({ actor: principal.email, action: 'DELETE_DEPARTMENT', dataset: 'departments', recordId: id });
      return ok(res, { ok: true });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (e) {
    return fail(res, e);
  }
}
