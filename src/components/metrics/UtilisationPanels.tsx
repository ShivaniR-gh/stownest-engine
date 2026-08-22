import { Badge, Icon } from '@/components/primitives';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { DonutChart } from '@/components/charts/DonutChart';
import {
  BAND_LABEL, BAND_TONE, sumOf, utilisationBy,
  type DerivedSchema, type UtilisationRow,
} from '@/lib/analytics/deriveSchema';
import { formatCompactNum, formatInt, formatPct } from '@/lib/format';
import type { ColumnDef, DatasetDef, Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Capacity analytics.
 *
 * Rendered only when a dataset declares BOTH a `capacity` and an `occupied`
 * column. Nothing here knows what a warehouse is: the same panels serve any
 * department that maps those two roles. Colour follows the utilisation band, so
 * the table, the bars and the insights always agree.
 * ------------------------------------------------------------------------- */

export function UtilisationBar({ u }: { u: UtilisationRow }) {
  return (
    <span className="util__bar">
      <span className="util__track" data-band={u.band}>
        <span style={{ width: `${Math.min(100, u.pct)}%` }} />
      </span>
      <span className="util__pct">{formatPct(u.pct, 1)}</span>
    </span>
  );
}

/** Occupied against available, with utilisation in the middle. */
export function CapacitySplit({ ds, rows, schema }: { ds: DatasetDef; rows: Row[]; schema: DerivedSchema }) {
  const capacity = sumOf(rows, schema.roles.capacity);
  const occupied = sumOf(rows, schema.roles.occupied);
  const available = Math.max(0, capacity - occupied);
  const pct = capacity > 0 ? (occupied / capacity) * 100 : 0;

  return (
    <ChartFrame title="Occupied against available" department={ds.department} height={240}
      question="How much of total capacity is currently in use?"
      isEmpty={capacity <= 0}
      emptyBody="No capacity recorded for the current period and filters.">
      {() => (
        <DonutChart height={200} centerLabel={`${formatPct(pct, 1)} used`}
          valueFormat={formatCompactNum}
          total={capacity}
          data={[
            { key: 'Occupied', value: occupied, count: rows.length, rows },
            { key: 'Available', value: available, count: rows.length, rows: [] },
          ]} />
      )}
    </ChartFrame>
  );
}

/** Utilisation per group, sorted worst-first so what needs attention is on top. */
export function UtilisationRanking({
  ds, rows, schema, dimension, title, question, limit = 10, onSelect,
}: {
  ds: DatasetDef; rows: Row[]; schema: DerivedSchema; dimension: ColumnDef;
  title: string; question: string; limit?: number;
  onSelect?: (u: UtilisationRow) => void;
}) {
  const data = utilisationBy(rows, dimension, schema, limit);
  const unit = schema.roles.capacity?.header.match(/\(([^)]+)\)/)?.[1] ?? '';

  return (
    <ChartFrame title={title} department={ds.department} height={240} question={question}
      isEmpty={!data.length}
      emptyBody={`No ${dimension.header.toLowerCase()} values with capacity in this view.`}>
      {() => (
        <div className="util__rows">
          {data.map(u => (
            <div key={u.key} className="util__row" onClick={() => onSelect?.(u)}
              role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}>
              <span style={{ minWidth: 0 }}>
                <div className="util__nm" title={u.key}>{u.key}</div>
                <div className="util__sub">
                  {formatInt(u.available)} {unit} free of {formatInt(u.capacity)}
                </div>
              </span>
              <UtilisationBar u={u} />
              <span style={{ textAlign: 'right' }}>
                <Badge tone={BAND_TONE[u.band]}>{BAND_LABEL[u.band]}</Badge>
              </span>
            </div>
          ))}
        </div>
      )}
    </ChartFrame>
  );
}

/** Observations, each traceable to the rows in view. */
export function Insights({ items }: { items: string[] }) {
  if (!items.length) return null;
  const toneOf = (t: string) =>
    /no remaining capacity|above 95|running at 9[5-9]|running at 100/i.test(t) ? 'neg'
      : /unused|largest available/i.test(t) ? 'pos' : 'signal';

  return (
    <div className="insights">
      {items.map(t => (
        <div key={t} className="insight" data-tone={toneOf(t)}>
          <Icon name={toneOf(t) === 'neg' ? 'alert' : 'info'} size={15} />
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}

/** Per-location rollup: count, capacity, occupied, available, utilisation. */
export function GroupOverview({
  rows, schema, dimension, onSelect,
}: {
  rows: Row[]; schema: DerivedSchema; dimension: ColumnDef;
  onSelect?: (u: UtilisationRow) => void;
}) {
  const groups = utilisationBy(rows, dimension, schema, 24);
  const unit = schema.roles.capacity?.header.match(/\(([^)]+)\)/)?.[1] ?? '';
  if (!groups.length) return null;

  return (
    <div className="sumgrid">
      {groups.map(g => (
        <div key={g.key} className="sumcard" onClick={() => onSelect?.(g)}
          style={onSelect ? { cursor: 'pointer' } : undefined}>
          <div className="sumcard__hd">
            <span className="sumcard__nm" title={g.key}>{g.key}</span>
            <span className="sumcard__n num">{formatInt(g.rows.length)} records</span>
          </div>
          <div className="sumcard__row"><span>Total</span><b>{formatInt(g.capacity)} {unit}</b></div>
          <div className="sumcard__row"><span>Occupied</span><b>{formatInt(g.occupied)} {unit}</b></div>
          <div className="sumcard__row"><span>Available</span><b>{formatInt(g.available)} {unit}</b></div>
          <div style={{ marginTop: 'var(--s3)' }}><UtilisationBar u={g} /></div>
        </div>
      ))}
    </div>
  );
}
