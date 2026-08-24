import { useMemo, useState } from 'react';
import '@/styles/capacity.css';
import { Badge, Button, EmptyState, Icon } from '@/components/primitives';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { DrillDown } from '@/components/data/DrillDown';
import {
  BAND_LABEL, BAND_TONE, bandDistribution, deriveKpis,
  insights, sumOf, utilisationBy, utilisationOverTime,
  type DerivedSchema, type UtilisationRow,
} from '@/lib/analytics/deriveSchema';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { formatCompactNum, formatInt, formatPct, parseDate } from '@/lib/format';
import type { ColumnDef, DatasetDef, Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Capacity dashboard.
 *
 * Rendered for ANY dataset whose mapping declares a `capacity` and an
 * `occupied` column. It contains no warehouse, location or month names — every
 * label, axis and grouping comes from the field mapping, so a different sheet
 * or a different department produces a correct dashboard with no code change.
 * ------------------------------------------------------------------------- */

export function CapacityDashboard({ ds, rows, schema }: {
  ds: DatasetDef;
  /** Already scoped to the active period and filters by the parent page. */
  rows: Row[];
  schema: DerivedSchema;
}) {
  const { period, compare } = useAnalytics();
  const [drill, setDrill] = useState<{ title: string; rows: Row[] } | null>(null);
  const { roles, hasUtilisation, primaryDimension } = schema;

  const nameDim: ColumnDef | undefined = roles.name ?? primaryDimension ?? undefined;
  const locDim: ColumnDef | undefined = roles.location;
  const dateCol: ColumnDef | undefined = roles.date ?? schema.dateColumn ?? undefined;
  const unit = roles.capacity?.header.match(/\(([^)]+)\)/)?.[1] ?? '';

  const kpis = useMemo(() => deriveKpis(ds, rows, [], schema, 6), [ds, rows, schema]);
  const observations = useMemo(() => insights(rows, schema), [rows, schema]);

  const byName = useMemo(
    () => (nameDim ? utilisationBy(rows, nameDim, schema, 200) : []),
    [rows, nameDim, schema]);
  const byLoc = useMemo(
    () => (locDim ? utilisationBy(rows, locDim, schema, 40) : []),
    [rows, locDim, schema]);

  const distribution = useMemo(() => bandDistribution(byName), [byName]);

  // Bucketing is supplied by the caller, so the helper makes no date assumptions.
  const trend = useMemo(() => (dateCol
    ? utilisationOverTime(rows, schema, r => {
        const d = parseDate(r[dateCol.key]);
        if (!d) return null;
        return {
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        };
      }).filter(p => p.capacity > 0)
    : []), [rows, schema, dateCol]);

  const capacity = sumOf(rows, roles.capacity);
  const occupied = sumOf(rows, roles.occupied);
  const overall = capacity > 0 ? (occupied / capacity) * 100 : 0;

  if (!hasUtilisation) {
    return (
      <div className="card">
        <EmptyState icon="layers" title="Capacity analytics not configured"
          body={`Map one column as “capacity” and one as “occupied” in this dataset's field mapping, and utilisation, available space and near-full warnings appear here automatically.`} />
      </div>
    );
  }

  const open = (u: UtilisationRow) => setDrill({ title: u.key, rows: u.rows });

  return (
    <>
      <section className="section">
        <SectionHeader title="Capacity" note={`${formatInt(rows.length)} records · ${period.label}`} />
        <MetricGrid metrics={kpis} compare={compare} />
      </section>

      {distribution.length > 0 && (
        <section className="section">
          <SectionHeader title="Where things stand"
            note={`${byName.length} ${nameDim?.header.toLowerCase() ?? 'groups'}`} />
          <div className="bands">
            {distribution.map(d => (
              <div key={d.band} className="bandcard" data-band={d.band}>
                <div className="bandcard__lb">{d.label}</div>
                <div className="bandcard__n">{formatInt(d.count)}</div>
                <div className="bandcard__meta">
                  {formatPct(d.share, 0)} of total · {formatCompactNum(d.capacity)} {unit}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {observations.length > 0 && (
        <section className="section">
          <SectionHeader title="Insights" note="Derived from the rows in view" />
          <div className="insights">
            {observations.map(t => (
              <div key={t} className="insight"
                data-tone={/no remaining|at or above/i.test(t) ? 'neg' : /headroom|unused|largest/i.test(t) ? 'pos' : 'signal'}>
                <Icon name={/no remaining|at or above/i.test(t) ? 'alert' : 'info'} size={15} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <SectionHeader title="Analysis" />

        {trend.length > 1 && (
          <div style={{ marginBottom: 'var(--s4)' }}>
            <ChartFrame title="Utilisation trend" department={ds.department} height={280}
              question={`How has utilisation moved across ${dateCol?.header.toLowerCase()}?`}>
              {h => (
                <TrendChart height={h}
                  data={trend.map(p => ({
                    key: p.key, label: p.label, rows: p.rows,
                    values: { pct: p.pct, occupied: p.occupied, available: p.available },
                  }))}
                  valueFormat={formatCompactNum}
                  series={[
                    { id: 'occupied', label: `Occupied ${unit}`, kind: 'bar', colorIndex: 1 },
                    { id: 'available', label: `Available ${unit}`, kind: 'bar', colorIndex: 2 },
                    { id: 'pct', label: 'Utilisation %', kind: 'line', colorIndex: 0,
                      axis: 'right', format: n => formatPct(n, 1) },
                  ]}
                  onPointClick={p => setDrill({ title: p.label, rows: p.rows })} />
              )}
            </ChartFrame>
          </div>
        )}

        <div className="grid grid--split">
          {nameDim && byName.length > 0 ? (
            <ChartFrame title={`Utilisation by ${nameDim.header}`} department={ds.department} height={300}
              question={`Which ${nameDim.header.toLowerCase()} values are closest to full?`}>
              {() => (
                <div className="util__rows" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {byName.slice(0, 14).map(u => (
                    <div key={u.key} className="util__row" onClick={() => open(u)} role="button" tabIndex={0}>
                      <span style={{ minWidth: 0 }}>
                        <div className="util__nm" title={u.key}>{u.key}</div>
                        <div className="util__sub">{formatInt(u.available)} {unit} free</div>
                      </span>
                      <span className="util__bar">
                        <span className="util__track" data-band={u.band}>
                          <span style={{ width: `${Math.min(100, u.pct)}%` }} />
                        </span>
                        <span className="util__pct">{formatPct(u.pct, 1)}</span>
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <Badge tone={BAND_TONE[u.band]}>{BAND_LABEL[u.band]}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartFrame>
          ) : <div />}

          <ChartFrame title="Occupied against available" department={ds.department} height={300}
            question="How much of total capacity is in use?" isEmpty={capacity <= 0}>
            {() => (
              <DonutChart height={210} total={capacity} valueFormat={formatCompactNum}
                centerLabel={`${formatPct(overall, 1)} used`}
                data={[
                  { key: `Occupied ${unit}`, value: occupied, count: rows.length, rows },
                  { key: `Available ${unit}`, value: Math.max(0, capacity - occupied), count: 0, rows: [] },
                ]} />
            )}
          </ChartFrame>
        </div>

        {locDim && byLoc.length > 1 && (
          <div className="grid grid--split" style={{ marginTop: 'var(--s4)' }}>
            <ChartFrame title={`Utilisation by ${locDim.header}`} department={ds.department} height={260}
              question={`Which ${locDim.header.toLowerCase()} is under the most pressure?`}>
              {() => (
                <div className="util__rows">
                  {byLoc.map(u => (
                    <div key={u.key} className="util__row" onClick={() => open(u)} role="button" tabIndex={0}>
                      <span style={{ minWidth: 0 }}>
                        <div className="util__nm">{u.key}</div>
                        <div className="util__sub">{u.rows.length} records</div>
                      </span>
                      <span className="util__bar">
                        <span className="util__track" data-band={u.band}>
                          <span style={{ width: `${Math.min(100, u.pct)}%` }} />
                        </span>
                        <span className="util__pct">{formatPct(u.pct, 1)}</span>
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <Badge tone={BAND_TONE[u.band]}>{BAND_LABEL[u.band]}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartFrame>

            <ChartFrame title={`Capacity by ${locDim.header}`} department={ds.department} height={260}
              question={`Where is the most ${roles.capacity?.header.toLowerCase()} concentrated?`}>
              {h => (
                <CategoryChart height={h} valueFormat={formatCompactNum}
                  data={[...byLoc].sort((a, b) => b.capacity - a.capacity)
                    .map(u => ({ key: u.key, value: u.capacity, count: u.rows.length, rows: u.rows }))}
                  onBarClick={d => setDrill({ title: d.key, rows: d.rows })} />
              )}
            </ChartFrame>
          </div>
        )}
      </section>

      {nameDim && byName.length > 0 && (
        <section className="section">
          <SectionHeader title={`${nameDim.header} detail`}
            note="Read-only view. Add, edit and delete in Records below."
            action={<Button size="sm" variant="ghost" icon="chevronDown"
              onClick={() => document.querySelector('.tbl__wrap')?.scrollIntoView({ behavior: 'smooth' })}>
              Go to records
            </Button>} />
          <div className="card card--flat">
            <div className="tbl__scroll" style={{ maxHeight: '60vh' }}>
              <table className="captbl">
                <thead>
                  <tr>
                    <th>{nameDim.header}</th>
                    {locDim && <th>{locDim.header}</th>}
                    <th className="is-num">{roles.capacity?.header}</th>
                    <th className="is-num">{roles.occupied?.header}</th>
                    <th className="is-num">Available</th>
                    <th style={{ width: 180 }}>Utilisation</th>
                    <th style={{ width: 150 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {byName.map(u => {
                    const loc = locDim ? String(u.rows[0]?.[locDim.key] ?? '') : '';
                    return (
                      <tr key={u.key} onClick={() => open(u)} style={{ cursor: 'pointer' }}>
                        <td className="is-key">{u.key}</td>
                        {locDim && <td>{loc}</td>}
                        <td className="is-num">{formatInt(u.capacity)}</td>
                        <td className="is-num">{formatInt(u.occupied)}</td>
                        <td className="is-num">{formatInt(u.available)}</td>
                        <td>
                          <span className="util__bar">
                            <span className="util__track" data-band={u.band}>
                              <span style={{ width: `${Math.min(100, u.pct)}%` }} />
                            </span>
                            <span className="util__pct">{formatPct(u.pct, 1)}</span>
                          </span>
                        </td>
                        <td><Badge tone={BAND_TONE[u.band]}>{BAND_LABEL[u.band]}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {drill && (
        <DrillDown title={drill.title} dataset={ds} rows={drill.rows}
          subtitle={`${drill.rows.length} records · ${period.label}`}
          onClose={() => setDrill(null)} />
      )}
    </>
  );
}


