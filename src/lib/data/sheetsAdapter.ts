import type { Row } from '@/config/types';
import { DataError, type DataAdapter, type DataOpts, type FetchResult } from './adapter';
import { getIdToken } from '@/lib/auth/googleIdentity';

/** Talks only to our own /api routes. The service-account key, the spreadsheet
 *  id and the Sheets scopes exist solely on the server. Nothing sensitive is
 *  reachable from the bundle. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail: string | undefined;
    try { detail = (await res.json())?.error; } catch { /* non-JSON error body */ }
    // The server explains WHY a write was refused — "Warehouse blr:1 is not in
    // the warehouse list", "Occupied space cannot exceed 11,247 sqft". Throwing
    // a generic message instead leaves the person with nothing to act on, so
    // the server's text wins whenever it sent one.
    throw new DataError(
      detail
        || (res.status === 401 ? 'Your session expired. Sign in again to continue.'
          : res.status === 403 ? 'You do not have permission for this.'
          : res.status === 429 ? 'Google is rate-limiting us. Try again in a moment.'
          : 'Could not reach the data service.'),
      res.status,
      detail,
    );
  }
  return res.json() as Promise<T>;
}

/** Builds the query string, omitting `tab` for static datasets. */
function qs(parts: Record<string, string | undefined>): string {
  const q = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return q ? `?${q}` : '';
}

export class SheetsAdapter implements DataAdapter {
  readonly kind = 'sheets' as const;

  async list(datasetId: string, opts: DataOpts = {}): Promise<FetchResult> {
    return call<FetchResult>(
      `/data/${encodeURIComponent(datasetId)}${qs({ tab: opts.tab })}`,
      { method: 'GET', signal: opts.signal },
    );
  }
  async create(datasetId: string, values: Row, opts: DataOpts = {}): Promise<Row> {
    const r = await call<{ row: Row }>(
      `/data/${encodeURIComponent(datasetId)}${qs({ tab: opts.tab })}`,
      { method: 'POST', body: JSON.stringify({ values }) },
    );
    return r.row;
  }
  async update(datasetId: string, id: string, values: Row, opts: DataOpts = {}): Promise<Row> {
    const r = await call<{ row: Row }>(
      `/data/${encodeURIComponent(datasetId)}${qs({ id, tab: opts.tab })}`,
      { method: 'PATCH', body: JSON.stringify({ values }) },
    );
    return r.row;
  }
  async remove(datasetId: string, id: string, opts: DataOpts = {}): Promise<void> {
    await call<{ ok: true }>(
      `/data/${encodeURIComponent(datasetId)}${qs({ id, tab: opts.tab })}`,
      { method: 'DELETE' },
    );
  }
}
