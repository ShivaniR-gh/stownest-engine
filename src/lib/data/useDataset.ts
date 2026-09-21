import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getEntry, load, subscribe, type Entry } from './store';

/** Subscribes to one dataset. Multiple callers share a single fetch. */
export function useDataset(id: string | null): Entry & { refresh: () => Promise<void> } {
  const sub = useCallback((fn: () => void) => (id ? subscribe(id, fn) : () => {}), [id]);
  const snap = useCallback(
    () => (id ? getEntry(id) : { rows: [], status: 'ready' as const, error: null, fetchedAt: null }),
    [id],
  );
  const entry = useSyncExternalStore(sub, snap, snap);

  useEffect(() => { if (id) void load(id); }, [id]);

  const refresh = useCallback(async () => { if (id) await load(id, { force: true }); }, [id]);
  return { ...entry, refresh };
}

/** Subscribes to several datasets at once and reports a combined status. */
export function useDatasets(ids: string[]) {
  const key = ids.join('|');
  const sub = useCallback(
    (fn: () => void) => { const us = ids.map(i => subscribe(i, fn)); return () => us.forEach(u => u()); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  /**
   * The snapshot has to change whenever anything the caller renders changes.
   * It used to be `fetchedAt` alone, which never moves on a FAILED load — the
   * entry goes loading → error with fetchedAt still null, so no re-render was
   * scheduled and the page kept its first paint: empty rows and a status of
   * 'idle'. The dashboard then drew its own "no data" empty state instead of
   * the error state, which is why a failed or slow read looked like an empty
   * sheet. Status and row count are part of the snapshot for that reason.
   */
  const snap = useCallback(
    () => ids.map(i => {
      const e = getEntry(i);
      return `${e.status}:${e.fetchedAt ?? ''}:${e.rows.length}`;
    }).join('|'),
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useSyncExternalStore(sub, snap, snap);

  useEffect(() => { ids.forEach(i => void load(i)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = ids.map(i => getEntry(i));
  const byId = Object.fromEntries(ids.map((i, n) => [i, entries[n].rows]));

  return {
    byId,
    entries,
    status: entries.some(e => e.status === 'loading') ? 'loading'
      : entries.some(e => e.status === 'error') ? 'error'
      : entries.some(e => e.status === 'refreshing') ? 'refreshing'
      : entries.every(e => e.status === 'ready') ? 'ready' : 'idle',
    error: entries.find(e => e.error)?.error ?? null,
    fetchedAt: entries.map(e => e.fetchedAt).filter((n): n is number => n !== null).sort()[0] ?? null,
    refresh: async () => { await Promise.all(ids.map(i => load(i, { force: true }))); },
  };
}
