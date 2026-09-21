import type { Row } from '@/config/types';
import { DataError, type DataAdapter, type FetchResult } from './adapter';
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
export function latestFilledTab(datasetId: string, opts: { skipFuture?: boolean } = {}): Promise<string> {
  const cacheKey = `${datasetId}|${opts.skipFuture ? 'past' : 'any'}`;
  const hit = latestFilled.get(cacheKey);
  if (hit) return hit;
  const run = (async () => {
    const { tabs = [] } = await adapter.list(datasetId);
    const candidates = opts.skipFuture ? tabs.filter(t => !isFutureTab(t)) : tabs;
    /* Every candidate month is requested AT ONCE, not newest-first one at a
       time. Walking them sequentially cost one round trip per month and ran
       on every Facility and Warehouse Space open; requested together they go
       out as a single batch, and months with no tab are answered from the
       workbook's tab list without reading anything. */
    const results = await Promise.all(candidates.map(tab =>
      batchedList(datasetId, tab).then(r => r.rows.length > 0, () => false)));
    const i = results.findIndex(Boolean);     // tabs arrive newest first
    return i >= 0 ? candidates[i] : '';
  })();
  latestFilled.set(cacheKey, run);
  run.catch(() => latestFilled.delete(cacheKey));
  return run;
}

/** "Readings OCT 2026" → is that month after the current one? */
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function isFutureTab(tab: string): boolean {
  const m = /([A-Z]{3})\s+(\d{4})$/.exec(tab.trim().toUpperCase());
  if (!m) return false;
  const i = MON.indexOf(m[1]);
  if (i < 0) return false;
  const now = new Date();
  return new Date(Number(m[2]), i, 1) > new Date(now.getFullYear(), now.getMonth(), 1);
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

/* ------------------------------- batching -------------------------------
 * A page asks for its datasets one hook at a time, all within the same render.
 * Sending each as its own request is what exhausted Google's shared read quota
 * (about 60 a minute for the whole platform). Reads requested in the same tick
 * are collected here and sent as ONE /api/data/batch call; the server reads
 * every tab of a workbook in a single Google request. Each caller still gets
 * its own promise, and its own error if only its dataset failed. */
const BATCH_MAX = 40;
let queue: { datasetId: string; tab?: string; resolve: (r: FetchResult) => void; reject: (e: unknown) => void }[] = [];
let scheduled = false;

function batchedList(datasetId: string, tab?: string): Promise<FetchResult> {
  if (!adapter.listMany) return adapter.list(datasetId, { tab });
  return new Promise((resolve, reject) => {
    queue.push({ datasetId, tab, resolve, reject });
    if (!scheduled) {
      scheduled = true;
      // A macrotask, not a microtask: sibling components mount in separate
      // effect passes, and this lets all of them join the same batch.
      setTimeout(flush, 0);
    }
  });
}

async function flush() {
  scheduled = false;
  const pending = queue;
  queue = [];
  for (let i = 0; i < pending.length; i += BATCH_MAX) {
    const chunk = pending.slice(i, i + BATCH_MAX);
    try {
      const results = await adapter.listMany!(chunk.map(c => ({ datasetId: c.datasetId, tab: c.tab })));
      for (const c of chunk) {
        const r = results.get(c.tab ? `${c.datasetId}::${c.tab}` : c.datasetId);
        if (!r) c.reject(new Error('No result returned for this dataset.'));
        else if (r instanceof Error) c.reject(r);
        else c.resolve(r);
      }
    } catch (e) {
      // The whole batch failed (sign-in, network, server down): every caller
      // in it gets the same error, which is the truth.
      for (const c of chunk) c.reject(e);
    }
  }
}

export function load(id: string, opts: { force?: boolean } = {}): Promise<void> {
  const cur = getEntry(id);
  const fresh = cur.fetchedAt !== null && Date.now() - cur.fetchedAt < TTL_MS;
  if (!opts.force && (fresh || cur.status === 'loading')) return inflight.get(id) ?? Promise.resolve();
  if (inflight.has(id)) return inflight.get(id)!;

  set(id, { status: cur.rows.length ? 'refreshing' : 'loading', error: null });

  const { id: dsId, tab } = unscope(id);

  const p = batchedList(dsId, tab)
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
