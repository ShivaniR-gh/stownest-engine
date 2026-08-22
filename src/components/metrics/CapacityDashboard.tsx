import { useMemo } from 'react';
import { SectionHeader } from '@/components/metrics/MetricCard';
import {
  BandStrip, CapacityByGroup, CapacitySplit, GroupOverview, Insights,
  UtilisationRanking, UtilisationTrend,
} from '@/components/metrics/UtilisationPanels';
import { insights, utilisationBy, type DerivedSchema } from '@/lib/analytics/deriveSchema';
import type { DatasetDef, Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * Capacity dashboard.
 *
 * The whole analytics surface for any dataset that maps `capacity` and
 * `occupied`. Shared by the department page and Presentation so the two can
 * never drift apart. Every panel is driven by declared roles, so a different
 * sheet — or a different department — works without touching this file.
 * ------------------------------------------------------------------------- */
export function CapacityDashboard({ ds, rows, schema }: {
  ds: DatasetDef; rows: Row[]; schema: DerivedSchema;
}) {
  const { roles, primaryDimension, hasUtilisation } = schema;
  const nameDim = roles.name ?? primaryDimension;
  const locDim = roles.location && roles.location.key !== nameDim?.key ? roles.location : null;

  const units = useMemo(
    () => (nameDim ? utilisationBy(rows, nameDim, schema, 200) : []),
    [rows, nameDim, schema]);
  const observations = useMemo(() => insights(rows, schema), [rows, schema]);

  if (!hasUtilisation) return null;

  return (
    <>
      {units.length > 0 && (
        <section className="section">
          <SectionHeader title="Utilisation spread"
            note={`${units.length} ${(nameDim?.header ?? 'group').toLowerCase()}s in view`} />
          <BandStrip units={units} />
        </section>
      )}

      <section className="section">
        <SectionHeader title="Capacity over time" />
        <UtilisationTrend ds={ds} rows={rows} schema={schema} />
      </section>

      <section className="section">
        <SectionHeader title="Where capacity sits" />
        <div className="grid grid--split">
          {nameDim && (
            <UtilisationRanking ds={ds} rows={rows} schema={schema} dimension={nameDim}
              title={`Utilisation by ${nameDim.header}`} limit={10}
              question={`Which ${nameDim.header.toLowerCase()} values are closest to full?`} />
          )}
          <CapacitySplit ds={ds} rows={rows} schema={schema} />
        </div>
      </section>

      {locDim && (
        <section className="section">
          <SectionHeader title={`${locDim.header} performance`} />
          <div className="grid grid--split">
            <UtilisationRanking ds={ds} rows={rows} schema={schema} dimension={locDim}
              title={`Utilisation by ${locDim.header}`} limit={12}
              question={`Which ${locDim.header.toLowerCase()} is under the most pressure?`} />
            <CapacityByGroup ds={ds} rows={rows} schema={schema} dimension={locDim} />
          </div>
        </section>
      )}

      {observations.length > 0 && (
        <section className="section">
          <SectionHeader title="Insights" note="Derived from the rows in view" />
          <Insights items={observations} />
        </section>
      )}

      {locDim && (
        <section className="section">
          <SectionHeader title={`${locDim.header} overview`} note="Capacity rollup per group" />
          <GroupOverview rows={rows} schema={schema} dimension={locDim} />
        </section>
      )}
    </>
  );
}
