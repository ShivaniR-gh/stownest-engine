import type { ReactNode } from 'react';
import { Icon } from '@/components/primitives';
import { Sparkline } from '@/components/charts/Sparkline';
import { iconForLabel } from '@/lib/ui/metricIcon';

/**
 * One KPI tile for the hand-built department dashboards (Collections,
 * Control Tower, Operations, Marketing, Finance, Sales).
 *
 * Every one of those files had its own near-identical copy of this markup,
 * which is how they ended up with six slightly different ideas of what a KPI
 * card looks like. One component instead, matching the treatment MetricCard
 * gives the config-driven grids: icon chip beside the label, value, footnote,
 * optional sparkline pinned to the bottom.
 *
 * The icon is derived from the label by default so a dashboard doesn't have
 * to name one per tile, but can be overridden where the label is ambiguous.
 */
export function KpiTile({ label, value, note, lead, tone, icon, spark }: {
  label: string;
  value: string;
  note?: ReactNode;
  /** The row's headline figure — accent border in dark, filled in light. */
  lead?: boolean;
  /** `neg` marks a metric where this number rising is bad. */
  tone?: 'neg' | 'pos';
  /** Overrides the label-derived icon. */
  icon?: string;
  /** Per-period values, oldest first. Needs at least two points to draw. */
  spark?: number[];
}) {
  const sparkTone = lead ? 'var(--kpi2-spark-lead)'
    : tone === 'neg' ? 'var(--neg)' : 'var(--accent)';
  return (
    <div className={`metric coll__kpi kpi2${lead ? ' metric--lead' : ''}`}>
      <div className="kpi2__hd">
        <span className={`kpi2__chip${tone === 'neg' ? ' kpi2__chip--neg' : ''}`}>
          <Icon name={icon ?? iconForLabel(label)} size={15} />
        </span>
        <span className="metric__label">{label}</span>
      </div>
      <div className="metric__value num">{value}</div>
      {note && <div className="metric__cmp">{note}</div>}
      {spark && spark.length > 1 && (
        <div className="kpi2__spark"><Sparkline values={spark} tone={sparkTone} height={30} /></div>
      )}
    </div>
  );
}
