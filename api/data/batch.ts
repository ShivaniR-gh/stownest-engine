import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../_lib/auth.js';
import { fail, ok } from '../_lib/respond.js';
import { HttpError } from '../_lib/env.js';
import { readDatasetsBatch } from '../_lib/sheets.js';
import { getDatasetDef } from '../_lib/registry.js';
import { allowedTabs, resolveDestinationTab } from '../_lib/tabs.js';
import { can } from '../../src/lib/permissions/policy.js';
import type { DatasetDef } from '../../src/config/types.js';

/** ---------------------------------------------------------------------------
 * Batched read.
 *
 * POST { items: [{ dataset, tab? }] } → { results: { "<dataset>::<tab>": … } }
 *
 * Exists because Google allows the service account roughly 60 reads a minute,
 * shared by everyone. One request per dataset meant a single Overview load —
 * fifteen datasets, each with its own sign-in check, registry read, metadata
 * call and values call — could spend most of that minute on its own.
 *
 * Here the sign-in is checked once, the registry is read once, and every tab
 * in the same workbook comes back from a single values:batchGet.
 *
 * Permissions are checked PER ITEM with the same can() the single-dataset
 * route uses. An item the caller may not view comes back as a 403 entry rather
 * than failing the whole batch, so one restricted dataset cannot blank a page.
 * ------------------------------------------------------------------------- */

const MAX_ITEMS = 40;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const principal = await authenticate(req);

    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!raw.length) throw new HttpError(400, 'No datasets requested.');
    if (raw.length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} datasets per request.`);

    const results: Record<string, unknown> = {};
    const reads: { key: string; ds: DatasetDef; tab: string }[] = [];

    for (const it of raw) {
      const dataset = String(it?.dataset ?? '');
      const requested = it?.tab ? String(it.tab) : undefined;
      const key = requested ? `${dataset}::${requested}` : dataset;
      try {
        const ds = await getDatasetDef(dataset);
        if (!can(principal, 'VIEW', ds.department)) {
          throw new HttpError(403, `You do not have permission to view ${ds.label.toLowerCase()}.`);
        }
        // The tab is untrusted input: it must be one the server itself allows.
        const tab = resolveDestinationTab(ds, requested, true);
        reads.push({ key, ds, tab });
      } catch (e) {
        results[key] = {
          error: e instanceof Error ? e.message : 'Invalid request.',
          status: e instanceof HttpError ? e.status : 400,
        };
      }
    }

    const read = await readDatasetsBatch(reads);
    for (const r of reads) {
      const got = read.get(r.key);
      results[r.key] = got && 'rows' in got
        ? { ...got, tab: r.tab, tabs: allowedTabs(r.ds) }
        : got ?? { error: 'Read failed.', status: 500 };
    }

    return ok(res, { results });
  } catch (e) {
    return fail(res, e);
  }
}
