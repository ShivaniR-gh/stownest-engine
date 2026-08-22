import type { ColumnDef, DatasetDef, MetricDef, Row, SemanticRole } from '@/config/types';
import type { ResolvedMetric } from './resolveMetric';
import { formatCompactNum, formatInt, formatMetric, toNum } from '@/lib/format';
import { pctChange } from './aggregate';

/** ---------------------------------------------------------------------------
 * Schema derivation.
 *
 * Turns a connected dataset's own mapping into the ingredients an analytics
 * screen needs: which columns are dimensions, which are measures, which one
 * carries status. Nothing here knows what a warehouse or an invoice is — it
 * reads the field mapping the admin configured and nothing else.
 *
 * Derived KPIs aggregate a named column and are LABELLED with that column's own
 * header. Summing "Total Space (sqft)" and calling it "Total Space (sqft)" is
 * honest; calling it "Utilisation" would require semantic roles we do not have
 * yet, so we do not claim it.
 * ------------------------------------------------------------------------- */

export interface DerivedSchema {
  dimensions: ColumnDef[];
  measures: ColumnDef[];
  dateColumn: ColumnDef | null;
  statusColumn: ColumnDef | null;
  primaryDimension: ColumnDef | null;
  /** Columns by declared semantic role. */
  roles: Partial<Record<SemanticRole, ColumnDef>>;
  /** True when capacity AND occupied are both mapped: utilisation is computable. */
  hasUtilisation: boolean;
}

const cardinality = (rows: Row[], key: string) =>
  new Set(rows.map(r => String(r[key] ?? '').trim()).filter(Boolean)).size;

export function deriveSchema(ds: DatasetDef, rows: Row[]): DerivedSchema {
  const mapped = ds.columns.filter(c => c.sheetColumn);

  const measures = mapped.filter(c => c.type === 'currency' || c.type === 'number' || c.type === 'percent');

  // A dimension is a low-cardinality categorical column: something you can
  // sensibly group by. A free-text column with 200 distinct values is not.
  const dimensions = mapped
    .filter(c => c.type === 'enum' || c.groupable || (c.type === 'text' && c.key !== ds.titleColumn))
    .filter(c => {
      if (!rows.length) return c.type === 'enum' || Boolean(c.groupable);
      const n = cardinality(rows, c.key);
      return n > 1 && n <= Math.max(12, Math.min(40, rows.length * 0.4));
    })
    .sort((a, b) => cardinality(rows, a.key) - cardinality(rows, b.key));

  const dateColumn = mapped.find(c => c.key === ds.dateColumn)
    ?? mapped.find(c => c.type === 'date' || c.type === 'datetime')
    ?? null;

  const statusColumn = mapped.find(c => c.key === ds.statusColumn && c.type === 'enum')
    ?? mapped.find(c => c.type === 'enum' && Boolean(c.tone))
    ?? mapped.find(c => c.type === 'enum')
    ?? null;

  // Prefer a dimension that is not the status column, so the two charts differ.
  const primaryDimension = dimensions.find(c => c.key !== statusColumn?.key) ?? dimensions[0] ?? null;

  const roles: Partial<Record<SemanticRole, ColumnDef>> = {};
  for (const c of mapped) if (c.role && !roles[c.role]) roles[c.role] = c;

  return {
    dimensions, measures, dateColumn, statusColumn, primaryDimension, roles,
    hasUtilisation: Boolean(roles.capacity && roles.occupied),
  };
}

/* ------------------------- role-driven analytics ------------------------- */

export const sumOf = (rows: Row[], col?: ColumnDef) =>
  col ? rows.reduce((a, r) => a + (toNum(r[col.key]) ?? 0), 0) : 0;

export interface UtilisationRow {
  key: string; capacity: number; occupied: number; available: number;
  pct: number; band: 'low' | 'healthy' | 'high' | 'full'; rows: Row[];
}

/** Thresholds are stated once here so the table, charts and insights agree. */
export function band(pct: number): UtilisationRow['band'] {
  if (pct >= 95) return 'full';
  if (pct >= 85) return 'high';
  if (pct >= 70) return 'healthy';
  return 'low';
}

export const BAND_LABEL: Record<UtilisationRow['band'], string> = {
  low: 'Low utilisation', healthy: 'Healthy', high: 'High utilisation', full: 'Near full',
};
export const BAND_TONE: Record<UtilisationRow['band'], 'pos' | 'accent' | 'signal' | 'neg'> = {
  low: 'accent', healthy: 'pos', high: 'signal', full: 'neg',
};

/** Utilisation grouped by any dimension — warehouse, location, anything mapped. */
export function utilisationBy(
  rows: Row[], dimension: ColumnDef, schema: DerivedSchema, limit = 40,
): UtilisationRow[] {
  if (!schema.hasUtilisation) return [];
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[dimension.key] ?? '').trim() || 'Unspecified';
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.entries()].map(([key, rs]) => {
    const capacity = sumOf(rs, schema.roles.capacity);
    const occupied = sumOf(rs, schema.roles.occupied);
    const pct = capacity > 0 ? (occupied / capacity) * 100 : 0;
    return { key, capacity, occupied, available: capacity - occupied, pct, band: band(pct), rows: rs };
  }).sort((a, b) => b.pct - a.pct).slice(0, limit);
}

/** Observations stated only when the data supports them. Never estimated. */
export function insights(rows: Row[], schema: DerivedSchema): string[] {
  if (!schema.hasUtilisation || !rows.length) return [];
  const out: string[] = [];
  const nameCol = schema.roles.name ?? schema.primaryDimension;
  const locCol = schema.roles.location;

  const capacity = sumOf(rows, schema.roles.capacity);
  const occupied = sumOf(rows, schema.roles.occupied);
  if (capacity <= 0) return out;

  const byName = nameCol ? utilisationBy(rows, nameCol, schema) : [];
  const critical = byName.filter(u => u.band === 'full');
  if (critical.length) {
    out.push(`${critical.length} ${nameCol!.header.toLowerCase()}${critical.length > 1 ? 's are' : ' is'} at or above 95% utilisation.`);
  }
  const atCap = byName.filter(u => u.pct >= 99.95);
  if (atCap.length) out.push(`${atCap.slice(0, 3).map(u => u.key).join(', ')} ${atCap.length > 1 ? 'have' : 'has'} no remaining capacity.`);

  if (locCol) {
    const byLoc = utilisationBy(rows, locCol, schema);
    const freest = [...byLoc].sort((a, b) => b.available - a.available)[0];
    if (freest && freest.available > 0) {
      out.push(`${freest.key} holds the largest available capacity at ${Math.round(freest.available).toLocaleString('en-IN')} ${schema.roles.capacity?.header.match(/\(([^)]+)\)/)?.[1] ?? 'units'}.`);
    }
    const tightest = byLoc[0];
    if (tightest && tightest.pct >= 95) out.push(`${tightest.key} is running at ${tightest.pct.toFixed(1)}% utilisation.`);
  }

  const spare = capacity - occupied;
  if (spare > 0) out.push(`${((spare / capacity) * 100).toFixed(1)}% of total capacity is unused.`);
  return out.slice(0, 4);
}

/* -------------------------- derived KPI cards ---------------------------- */

const synthetic = (
  id: string, label: string, ds: DatasetDef, formula: string, definition: string,
  requires: string[], format: MetricDef['format'], unit?: string,
): MetricDef => ({
  id, label, department: ds.department, dataset: ds.id,
  requires, format, unit, formula, definition,
  goodDirection: 'neutral',
  compute: () => null,   // evaluated eagerly below; never called
});

const resolved = (
  def: MetricDef, value: number | null, prev: number | null, display?: string,
): ResolvedMetric => {
  const delta = value !== null && prev !== null ? pctChange(value, prev) : null;
  return {
    def,
    status: value === null ? 'no_rows' : 'ok',
    value,
    display: value === null ? 'No records' : display ?? formatMetric(value, def.format),
    delta,
    deltaTone: 'flat',
    missing: [],
    sources: [def.dataset],
    reason: def.definition,
  };
};

/**
 * KPI cards computed from the dataset's own columns. Every card carries the
 * literal formula and the source column, so the provenance flip keeps working
 * exactly as it does for compiled metrics.
 */
export function deriveKpis(
  ds: DatasetDef, rows: Row[], prevRows: Row[], schema: DerivedSchema, limit = 6,
): ResolvedMetric[] {
  const out: ResolvedMetric[] = [];
  const cap = schema.roles.capacity, occ = schema.roles.occupied;

  // Roles mapped: state the business metrics properly, with real formulas.
  if (cap && occ) {
    const unit = cap.header.match(/\(([^)]+)\)/)?.[1];
    const mk = (id: string, label: string, formula: string, definition: string,
                fn: (rs: Row[]) => number, format: MetricDef['format'], dir: 'up' | 'down' | 'neutral') =>
      resolved(
        { ...synthetic(`${ds.id}.${id}`, label, ds, formula, definition, [cap.key, occ.key], format, unit),
          goodDirection: dir },
        rows.length ? fn(rows) : null, prevRows.length ? fn(prevRows) : null);

    out.push(mk('capacity', `Total ${cap.header.replace(/\s*\([^)]*\)/, '')}`,
      `SUM(${ds.sheetName}.${cap.sheetColumn})`,
      `Total capacity across every record in view, from the column mapped as capacity.`,
      rs => sumOf(rs, cap), 'int', 'neutral'));

    out.push(mk('occupied', `Occupied`,
      `SUM(${ds.sheetName}.${occ.sheetColumn})`,
      `Capacity currently in use, from the column mapped as occupied.`,
      rs => sumOf(rs, occ), 'int', 'neutral'));

    out.push(mk('available', `Available`,
      `SUM(${cap.sheetColumn}) − SUM(${occ.sheetColumn})`,
      `Capacity not currently in use. Derived, not read from a column.`,
      rs => sumOf(rs, cap) - sumOf(rs, occ), 'int', 'up'));

    out.push(mk('utilisation', `Utilisation`,
      `SUM(${occ.sheetColumn}) ÷ SUM(${cap.sheetColumn}) × 100`,
      `Share of capacity in use. High utilisation is efficient until it becomes a constraint.`,
      rs => { const c = sumOf(rs, cap); return c > 0 ? (sumOf(rs, occ) / c) * 100 : 0; }, 'pct', 'neutral'));
  }

  out.push(resolved(
    synthetic(`${ds.id}.count`, `${ds.label} records`, ds,
      `COUNT(${ds.sheetName})`,
      `Every row in the ${ds.sheetName} tab that falls inside the current period and filters.`,
      [], 'int'),
    rows.length, prevRows.length || null));

  // Sum each numeric column, labelled with the column's own header.
  for (const m of schema.measures) {
    const sum = (rs: Row[]) => rs.reduce((a, r) => a + (toNum(r[m.key]) ?? 0), 0);
    out.push(resolved(
      synthetic(`${ds.id}.sum.${m.key}`, `Total ${m.header}`, ds,
        `SUM(${ds.sheetName}.${m.sheetColumn})`,
        `Sum of the ${m.header} column. StowNest is aggregating a named column, not inferring a business meaning.`,
        [m.key], m.type === 'currency' ? 'inr_compact' : 'int'),
      rows.length ? sum(rows) : null, prevRows.length ? sum(prevRows) : null,
      rows.length && m.type !== 'currency' ? formatCompactNum(sum(rows)) : undefined));
  }

  // Distinct count for the primary dimension — "how many warehouses/vendors/cities".
  if (schema.primaryDimension) {
    const d = schema.primaryDimension;
    const distinct = (rs: Row[]) => new Set(rs.map(r => String(r[d.key] ?? '').trim()).filter(Boolean)).size;
    out.push(resolved(
      synthetic(`${ds.id}.distinct.${d.key}`, `Distinct ${d.header}`, ds,
        `COUNT(DISTINCT ${ds.sheetName}.${d.sheetColumn})`,
        `Number of different values in the ${d.header} column.`,
        [d.key], 'int'),
      rows.length ? distinct(rows) : null, prevRows.length ? distinct(prevRows) : null));
  }

  // Share held by the most common status value.
  if (schema.statusColumn && rows.length) {
    const s = schema.statusColumn;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = String(r[s.key] ?? '').trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      out.push(resolved(
        synthetic(`${ds.id}.top.${s.key}`, top[0], ds,
          `COUNT(${ds.sheetName}) WHERE ${s.sheetColumn} = '${top[0]}' ÷ COUNT(${ds.sheetName}) × 100`,
          `Share of records whose ${s.header} is “${top[0]}” — the most common value in this period.`,
          [s.key], 'pct'),
        (top[1] / rows.length) * 100, null,
        `${formatInt(top[1])} · ${((top[1] / rows.length) * 100).toFixed(1)}%`));
    }
  }

  return out.slice(0, limit);
}

/** Per-group summary: record count plus every numeric column, for cards like
 *  "Summary by Location" without knowing what a location is. */
export interface GroupSummary { key: string; count: number; measures: Record<string, number>; rows: Row[] }

export function summariseBy(rows: Row[], dimension: ColumnDef, measures: ColumnDef[], limit = 12): GroupSummary[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[dimension.key] ?? '').trim() || 'Unspecified';
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.entries()]
    .map(([key, rs]) => ({
      key, count: rs.length, rows: rs,
      measures: Object.fromEntries(measures.map(m => [m.key, rs.reduce((a, r) => a + (toNum(r[m.key]) ?? 0), 0)])),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
