import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth';
import { fail, ok } from '../_lib/respond';
import { effectiveActions, visibleDepartments } from '../../src/lib/permissions/policy';
import { loadDepartments } from '../_lib/departments';

/** Resolves the signed-in user to a Principal. The client renders from this;
 *  it does not decide it. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const principal = await authenticate(req);
    return ok(res, {
      principal,
      // Convenience only — every route re-derives these server-side before acting.
      effectiveActions: effectiveActions(principal),
      departments: visibleDepartments(principal, (await loadDepartments()).map(d => d.id)),
    });
  } catch (e) {
    return fail(res, e);
  }
}
