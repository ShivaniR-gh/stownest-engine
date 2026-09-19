import { OAuth2Client } from 'google-auth-library';
import type { VercelRequest } from '@vercel/node';
import { principalFromRow, type Principal } from '../../src/lib/permissions/policy.js';
import { getDataset } from '../../src/config/datasets.js';
import { readDataset } from './sheets.js';
import { HttpError, list, optional, required } from './env.js';
import { knownDepartmentIds } from './departments.js';

/** ---------------------------------------------------------------------------
 * Request authentication.
 *
 * Two independent checks, both required:
 *   1. The bearer token is a real Google ID token issued for OUR client id.
 *   2. That verified email appears, active, on the access_control tab.
 *
 * A valid Google account alone grants nothing. The role in the token is
 * irrelevant — role always comes from the sheet, so nobody can promote
 * themselves by editing a request.
 * ------------------------------------------------------------------------- */

let verifier: OAuth2Client | null = null;

/** Small TTL cache so a burst of requests from one screen doesn't re-read the
 *  access sheet each time. Short enough that revoking access takes effect fast. */
const ACL_TTL = 60_000;
let aclCache: { at: number; rows: Record<string, unknown>[] } | null = null;

async function accessRows(): Promise<Record<string, unknown>[]> {
  if (aclCache && Date.now() - aclCache.at < ACL_TTL) return aclCache.rows;
  const ds = getDataset('access_control');
  if (!ds) throw new HttpError(500, 'access_control dataset is not configured.');
  const { rows } = await readDataset(ds);
  aclCache = { at: Date.now(), rows: rows as Record<string, unknown>[] };
  return aclCache.rows;
}

export async function authenticate(req: VercelRequest): Promise<Principal> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sign in to continue.');

  const clientId = required('GOOGLE_CLIENT_ID');
  verifier ??= new OAuth2Client(clientId);

  let email: string;
  let name: string;
  let picture: string | undefined;
  try {
    const ticket = await verifier.verifyIdToken({ idToken: token, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) throw new Error('unverified');

    const domain = optional('ALLOWED_HOSTED_DOMAIN').toLowerCase();
    const exceptions = list('ALLOWED_EXTERNAL_EMAILS');
    const addr = payload.email.toLowerCase();
    // Named exceptions bypass the domain rule only. They still need an active
    // row in access_control, so this widens WHO may present a token, never what
    // they may do once inside.
    if (domain && (payload.hd ?? '').toLowerCase() !== domain && !exceptions.includes(addr)) {
      throw new HttpError(403, `Sign in with your ${domain} account.`);
    }
    email = payload.email.toLowerCase();
    name = payload.name ?? email.split('@')[0];
    picture = payload.picture;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, 'Your session is not valid. Sign in again.');
  }

  const superAdmins = list('SUPER_ADMIN_EMAILS');
  const row = (await accessRows()).find(r => String(r.email ?? '').trim().toLowerCase() === email);

  if (!row) {
    // Bootstrap: the first super admin can sign in before the sheet has a row
    // for them, otherwise nobody could ever add the first user.
    if (superAdmins.includes(email)) {
      return { email, name, picture, role: 'super_admin', departments: [], grants: [] };
    }
    throw new HttpError(403, 'This account is not on the StowNest access list. Ask a super admin to add you.');
  }

  const principal = principalFromRow({ ...row, email }, superAdmins, await knownDepartmentIds());
  if (!principal) throw new HttpError(403, 'This account is suspended.');

  return { ...principal, name: principal.name || name, picture };
}
