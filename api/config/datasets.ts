import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth';
import { fail, ok } from '../_lib/respond';
import { invalidateRegistry, loadRegistry } from '../_lib/registry';
import { can } from '../../src/lib/permissions/policy';

/**
 * The live dataset registry, already filtered to what this principal may read.
 * The browser cannot widen it: a dataset absent here is also refused by
 * /api/data/[dataset], which runs the same check.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const principal = await authenticate(req);
    if (String(req.query.refresh ?? '') === '1') invalidateRegistry();

    const all = await loadRegistry();
    const datasets = all.filter(d => can(principal, 'VIEW', d.department));

    // Never ship spreadsheet ids to the browser — they are not secrets, but the
    // client has no use for them and they invite direct-access attempts.
    return ok(res, {
      datasets: datasets.map(({ spreadsheetId: _omit, spreadsheetEnv: _omit2, ...rest }) => rest),
    });
  } catch (e) {
    return fail(res, e);
  }
}
