import type { DepartmentId } from '@/config/types';
import { allDatasets } from '@/config/datasets';
import { METRICS } from '@/config/metrics';
import { can, type Principal } from './policy';

/** ---------------------------------------------------------------------------
 * Request scoping.
 *
 * A page must ask only for datasets the principal may read. Requesting more and
 * letting the API refuse produces a 403 that looks like a broken page rather
 * than a correctly-enforced boundary — a Logistics employee should see their
 * Logistics figures, not "could not load business data".
 *
 * This narrows what is REQUESTED. It is not a security control: the API runs
 * the same `can()` against a Principal resolved from the access sheet.
 * ------------------------------------------------------------------------- */

export function visibleDatasetIds(p: Principal | null, wanted?: string[]): string[] {
  const pool = wanted ?? allDatasets().map(d => d.id);
  return pool.filter(id => {
    const ds = allDatasets().find(d => d.id === id);
    return ds ? can(p, 'VIEW', ds.department) : false;
  });
}

/** A metric is only requested when EVERY dataset it reads is visible. Otherwise
 *  it would resolve against partial data and quietly understate the number. */
export function visibleMetricIds(p: Principal | null, wanted: string[]): string[] {
  return wanted.filter(id => {
    const m = METRICS.find(x => x.id === id);
    if (!m) return false;
    const needs = [m.dataset, ...(m.requiresDatasets ?? []), ...Object.keys(m.requiresFrom ?? {})];
    return needs.every(dsId => {
      const ds = allDatasets().find(d => d.id === dsId);
      return ds ? can(p, 'VIEW', ds.department) : false;
    });
  });
}

export const visibleDepartmentIds = (p: Principal | null, all: DepartmentId[]): DepartmentId[] =>
  all.filter(d => can(p, 'VIEW', d));
