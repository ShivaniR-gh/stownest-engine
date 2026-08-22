import type { Row } from '@/config/types';
import { DataError, type DataAdapter, type FetchResult } from './adapter';
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
    throw new DataError(
      res.status === 401 ? 'Your session expired. Sign in again to continue.'
        : res.status === 403 ? 'You do not have permission for this.'
        : res.status === 429 ? 'Google is rate-limiting us. Try again in a moment.'
        : 'Could not reach the data service.',
      res.status,
      detail,
    );
  }
  return res.json() as Promise<T>;
}

export class SheetsAdapter implements DataAdapter {
  readonly kind = 'sheets' as const;

  async list(datasetId: string, signal?: AbortSignal): Promise<FetchResult> {
    return call<FetchResult>(`/data/${encodeURIComponent(datasetId)}`, { method: 'GET', signal });
  }
  async create(datasetId: string, values: Row): Promise<Row> {
    const r = await call<{ row: Row }>(`/data/${encodeURIComponent(datasetId)}`, {
      method: 'POST', body: JSON.stringify({ values }),
    });
    return r.row;
  }
  async update(datasetId: string, id: string, values: Row): Promise<Row> {
    const r = await call<{ row: Row }>(`/data/${encodeURIComponent(datasetId)}?id=${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ values }),
    });
    return r.row;
  }
  async remove(datasetId: string, id: string): Promise<void> {
    await call<{ ok: true }>(`/data/${encodeURIComponent(datasetId)}?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
