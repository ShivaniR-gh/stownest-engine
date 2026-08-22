import type { ColumnDef, DatasetDef, MetricDef, Row } from '@/config/types';
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

  return { dimensions, measures, dateColumn, statusColumn, primaryDimension };
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
