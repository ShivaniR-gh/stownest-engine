import type { Row } from '@/config/types';
import { DataError, type DataAdapter } from './adapter';
import { SheetsAdapter } from './sheetsAdapter';

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

export const adapter: DataAdapter = new SheetsAdapter();

/** ---------------------------------------------------------------------------
 * Cache keys.
 *
 * A monthly dataset is not one collection but one per month: March's readings
 * and April's are different rows and must not share a cache slot. The key
 * carries the tab so they stay separate, while call sites for static datasets
 * keep passing a plain id and behave exactly as before.
 * ------------------------------------------------------------------------- */
export const scopedId = (id: string, tab?: string) => (tab ? `${id}::${tab}` : id);

/**
 * The newest month tab of a monthly dataset that actually holds rows.
 *
 * The tab list is generated from the calendar, so it always runs ahead of the
 * data: next month's tab exists and is empty, and the current month is usually
 * empty too until someone enters it. Opening on tabs[0] therefore showed an
 * all-zero dashboard. This walks the list newest-first and stops at the first
 * tab with rows — normally one or two reads, and the result is cached by the
 * adapter for the reads that follow.
 *
 * Returns '' when the dataset has no rows in any tab.
 */
const latestFilled = new Map<string, Promise<string>>();
export function latestFilledTab(datasetId: string): Promise<string> {
  const hit = latestFilled.get(datasetId);
  if (hit) return hit;
  const run = (async () => {
    const { tabs = [] } = await adapter.list(datasetId);
    for (const tab of tabs) {
      try {
        const r = await adapter.list(datasetId, { tab });
        if (r.rows.length > 0) return tab;
      } catch { /* a tab that does not exist yet is simply empty */ }
    }
    return '';
  })();
  latestFilled.set(datasetId, run);
  run.catch(() => latestFilled.delete(datasetId));
  return run;
}

export function unscope(key: string): { id: string; tab?: string } {
  const i = key.indexOf('::');
  return i < 0 ? { id: key } : { id: key.slice(0, i), tab: key.slice(i + 2) };
}

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

  const { id: dsId, tab } = unscope(id);

  const p = adapter.list(dsId, { tab })
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
  const { id: dsId, tab } = unscope(id);
  try {
    const row = await adapter.create(dsId, values, { tab });
    set(id, { rows: [row, ...before] });
    return row;
  } catch (e) { set(id, { rows: before }); throw e; }
}

export async function updateRow(id: string, rowId: string, values: Row): Promise<Row> {
  const before = getEntry(id).rows;
  const { id: dsId, tab } = unscope(id);
  set(id, { rows: before.map(r => (r.__id === rowId ? { ...r, ...values } : r)) });
  try {
    const row = await adapter.update(dsId, rowId, values, { tab });
    set(id, { rows: getEntry(id).rows.map(r => (r.__id === rowId ? row : r)) });
    return row;
  } catch (e) { set(id, { rows: before }); throw e; }
}

export async function deleteRow(id: string, rowId: string): Promise<void> {
  const before = getEntry(id).rows;
  const { id: dsId, tab } = unscope(id);
  set(id, { rows: before.filter(r => r.__id !== rowId) });
  try { await adapter.remove(dsId, rowId, { tab }); }
  catch (e) { set(id, { rows: before }); throw e; }
}
