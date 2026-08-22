import type { Row } from '@/config/types';
import { DataError, type DataAdapter } from './adapter';
import { SheetsAdapter } from './sheetsAdapter';
import { DemoAdapter } from './demoAdapter';

/** ---------------------------------------------------------------------------
 * Dataset cache.
 *
 * One in-flight request per dataset, shared by every component that asks for
 * it. Ten metric cards and four charts on one screen produce ONE Sheets read.
 * Cached reads are served instantly and revalidated in the background; a read
 * older than STALE_MS is flagged in the control bar rather than silently used.
 * ------------------------------------------------------------------------- */

export const STALE_MS = 5 * 60 * 1000;
const TTL_MS = 60 * 1000;

export type Status = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';

export interface Entry {
  rows: Row[];
  status: Status;
  error: DataError | Error | null;
  fetchedAt: number | null;
}

const EMPTY: Entry = { rows: [], status: 'idle', error: null, fetchedAt: null };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const subs = new Map<string, Set<() => void>>();

export const dataSourceKind: 'sheets' | 'demo' =
  (import.meta.env.VITE_DATA_SOURCE as string) === 'demo' ? 'demo' : 'sheets';

export const adapter: DataAdapter = dataSourceKind === 'demo' ? new DemoAdapter() : new SheetsAdapter();

function emit(id: string) { subs.get(id)?.forEach(fn => fn()); }
function set(id: string, patch: Partial<Entry>) {
  cache.set(id, { ...(cache.get(id) ?? EMPTY), ...patch });
  emit(id);
}

export function getEntry(id: string): Entry { return cache.get(id) ?? EMPTY; }

export function subscribe(id: string, fn: () => void): () => void {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id)!.add(fn);
  return () => { subs.get(id)?.delete(fn); };
}

export function load(id: string, opts: { force?: boolean } = {}): Promise<void> {
  const cur = getEntry(id);
  const fresh = cur.fetchedAt !== null && Date.now() - cur.fetchedAt < TTL_MS;
  if (!opts.force && (fresh || cur.status === 'loading')) return inflight.get(id) ?? Promise.resolve();
  if (inflight.has(id)) return inflight.get(id)!;

  set(id, { status: cur.rows.length ? 'refreshing' : 'loading', error: null });

  const p = adapter.list(id)
    .then(res => { set(id, { rows: res.rows, status: 'ready', error: null, fetchedAt: res.fetchedAt || Date.now() }); })
    .catch(err => {
      // Keep whatever rows we already had; mark the entry errored so the UI can
      // say "showing data from 11:42, refresh failed" rather than blanking out.
      set(id, { status: 'error', error: err instanceof Error ? err : new Error(String(err)) });
    })
    .finally(() => { inflight.delete(id); });

  inflight.set(id, p);
  return p;
}

export const refreshAll = () => Promise.all([...cache.keys()].map(id => load(id, { force: true })));
export const loadedDatasets = () => [...cache.keys()];

export function lastSyncedAt(): number | null {
  const ts = [...cache.values()].map(e => e.fetchedAt).filter((n): n is number => n !== null);
  return ts.length ? Math.min(...ts) : null;
}

export const isStale = (at: number | null) => at !== null && Date.now() - at > STALE_MS;

/* ------------------------------ mutations ------------------------------ */
/** Optimistic write with rollback. The row is put back exactly as it was if
 *  the API rejects, so the table never shows a change that did not persist. */
export async function createRow(id: string, values: Row): Promise<Row> {
  const before = getEntry(id).rows;
  try {
    const row = await adapter.create(id, values);
    set(id, { rows: [row, ...before] });
    return row;
  } catch (e) { set(id, { rows: before }); throw e; }
}

export async function updateRow(id: string, rowId: string, values: Row): Promise<Row> {
  const before = getEntry(id).rows;
  set(id, { rows: before.map(r => (r.__id === rowId ? { ...r, ...values } : r)) });
  try {
    const row = await adapter.update(id, rowId, values);
    set(id, { rows: getEntry(id).rows.map(r => (r.__id === rowId ? row : r)) });
    return row;
  } catch (e) { set(id, { rows: before }); throw e; }
}

export async function deleteRow(id: string, rowId: string): Promise<void> {
  const before = getEntry(id).rows;
  set(id, { rows: before.filter(r => r.__id !== rowId) });
  try { await adapter.remove(id, rowId); }
  catch (e) { set(id, { rows: before }); throw e; }
}
