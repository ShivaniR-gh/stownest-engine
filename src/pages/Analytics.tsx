import { useMemo, useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { TrendChart } from '@/components/charts/TrendChart';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { Heatmap } from '@/components/charts/Heatmap';
import { DrillDown } from '@/components/data/DrillDown';
import { Button, Icon, Popover } from '@/components/primitives';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { useDrill } from '@/lib/analytics/useDrill';
import { applyFilters, applyPeriod } from '@/lib/analytics/filters';
import { crosstab, groupBy, timeSeries } from '@/lib/analytics/aggregate';
import { getDataset, allDatasets } from '@/config/datasets';
import { formatCompactNum, formatINRCompact, formatInt } from '@/lib/format';
import { usePermission } from '@/lib/permissions/usePermission';
import { visibleDatasetIds, visibleMetricIds } from '@/lib/permissions/scope';

const BUSINESS = ['fin.revenue', 'fin.collections', 'fin.profit', 'fin.margin', 'cust.arpu', 'cust.retention'];
const ALL_DATA = ['invoices', 'expenses', 'leads', 'jobs', 'customers', 'space', 'tasks'];

/**
 * Free-form business review.
 *
 * Unlike the department pages, the analyst chooses the dataset, the dimension
 * and the measure. The chart is still generated from the dataset config, so a
 * dimension that is not mapped simply is not offered — there is no way to build
 * a chart of a column that does not exist.
 */
/** Declared at module scope: defining this inside Analytics would remount it on
 *  every state change, closing the popover the moment a selection was made. */
function Selector({ label, value, options, onChange }: {
  label: string; value: string; options: { key: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <Popover width={210} trigger={({ toggle, ref, open }) => (
      <Button size="sm" ref={ref} onClick={toggle} aria-expanded={open}>
        <span style={{ color: 'var(--ink-400)' }}>{label}</span>
        {options.find(o => o.key === value)?.label ?? '—'}
        <Icon name="chevronDown" size={12} />
      </Button>
    )}>
      {close => (
        <div className="pop__scroll">
          {options.map(o => (
            <button key={o.key} className="pop__item" onClick={() => { onChange(o.key); close(); }}>
              {value === o.key ? <Icon name="check" size={12} /> : <span style={{ width: 12 }} />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export default function Analytics() {
  const { period, compare, filters } = useAnalytics();
  const { principal } = usePermission();

  const DATA = useMemo(() => visibleDatasetIds(principal, ALL_DATA), [principal]);
  const business = useMemo(() => visibleMetricIds(principal, BUSINESS), [principal]);

  const { metrics, fetchedAt, status, refresh } = useMetrics(business);
  const { byId } = useDatasets(DATA);
  const drill = useDrill();

  const [datasetId, setDatasetId] = useState(() => DATA[0] ?? 'invoices');
  const [dimension, setDimension] = useState('city');
  const [measureKey, setMeasureKey] = useState('amount');
  const [agg, setAgg] = useState<'sum' | 'count' | 'avg'>('sum');
  const [split, setSplit] = useState<string>('revenue_line');

  const dataset = getDataset(datasetId)!;
  const rows = useMemo(() => {
    const ds = getDataset(datasetId);
    return ds ? applyFilters(applyPeriod(byId[datasetId] ?? [], ds, period), filters, ds) : [];
  }, [byId, datasetId, period, filters]);

  const dimensions = dataset.columns.filter(c => c.sheetColumn && c.groupable);
  const measures = dataset.columns.filter(c => c.sheetColumn && (c.type === 'currency' || c.type === 'number'));

  const measureLabel = measures.find(m => m.key === measureKey)?.header ?? 'Records';
  const isMoney = measures.find(m => m.key === measureKey)?.type === 'currency';
  const fmt = agg === 'count' ? formatInt : isMoney ? formatINRCompact : formatCompactNum;

  const grouped = useMemo(
    () => groupBy(rows, dimension, { agg, measure: measureKey }),
    [rows, dimension, agg, measureKey]);

  const trend = useMemo(() => dataset.dateColumn
    ? timeSeries(rows, dataset.dateColumn, period, [{ id: 'v', agg, measure: measureKey }])
    : [], [rows, dataset.dateColumn, period, agg, measureKey]);

  const heat = useMemo(
    () => crosstab(rows, dimension, split, { agg, measure: measureKey }),
    [rows, dimension, split, agg, measureKey]);

  return (
    <>
      <TopBar title="Business review" />
      <ControlBar datasetIds={DATA} fetchedAt={fetchedAt}
        busy={status === 'loading' || status === 'refreshing'} onRefresh={refresh} />

      <div className="page">
        {metrics.length > 0 && (
          <section className="section">
            <SectionHeader title="Company position" note={period.label} />
            <MetricGrid metrics={metrics} compare={compare} onDrill={drill.openMetric} />
          </section>
        )}

        <section className="section">
          <SectionHeader title="Build a view" note="Charts are generated from the mapped columns of the chosen dataset." />

          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center' }}>
              <Selector label="Dataset" value={datasetId}
                options={allDatasets().filter(d => DATA.includes(d.id)).map(d => ({ key: d.id, label: d.label }))}
                onChange={id => {
                  setDatasetId(id);
                  const ds = getDataset(id)!;
                  setDimension(ds.columns.find(c => c.sheetColumn && c.groupable)?.key ?? '');
                  const m = ds.columns.find(c => c.sheetColumn && (c.type === 'currency' || c.type === 'number'));
                  setMeasureKey(m?.key ?? '');
                  setAgg(m ? 'sum' : 'count');
                  setSplit(ds.columns.filter(c => c.sheetColumn && c.groupable)[1]?.key ?? '');
                }} />
              <Icon name="chevronRight" size={13} />
              <Selector label="Group by" value={dimension}
                options={dimensions.map(c => ({ key: c.key, label: c.header }))}
                onChange={setDimension} />
              <Selector label="Measure" value={agg === 'count' ? '__count' : measureKey}
                options={[{ key: '__count', label: 'Record count' },
                  ...measures.map(c => ({ key: c.key, label: c.header }))]}
                onChange={v => { if (v === '__count') setAgg('count'); else { setAgg('sum'); setMeasureKey(v); } }} />
              {agg !== 'count' && (
                <Selector label="As" value={agg}
                  options={[{ key: 'sum', label: 'Total' }, { key: 'avg', label: 'Average' }]}
                  onChange={v => setAgg(v as 'sum' | 'avg')} />
              )}
              <span className="ctlbar__sep" />
              <Selector label="Split by" value={split}
                options={dimensions.filter(d => d.key !== dimension).map(c => ({ key: c.key, label: c.header }))}
                onChange={setSplit} />
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--ink-400)' }}>
                <b className="num">{rows.length}</b> rows in scope
              </span>
            </div>
          </div>

          <div className="grid grid--split">
            <ChartFrame
              title={`${agg === 'count' ? 'Records' : `${agg === 'avg' ? 'Average ' : ''}${measureLabel}`} by ${dimensions.find(d => d.key === dimension)?.header ?? '—'}`}
              question="Which segment contributes most on the measure you chose?"
              department={dataset.department}
              isEmpty={!grouped.length}>
              {h => <CategoryChart height={h} data={grouped} valueFormat={fmt}
                onBarClick={d => drill.openRows(`${dataset.label} — ${d.key}`, datasetId, d.rows)} />}
            </ChartFrame>

            <ChartFrame
              title="Movement over time"
              question="Is the measure trending up or down inside the selected period?"
              department={dataset.department}
              isEmpty={!trend.length}
              emptyBody={dataset.dateColumn ? undefined : `${dataset.label} has no date column, so it cannot be plotted over time.`}>
              {h => <TrendChart height={h} data={trend} valueFormat={fmt}
                series={[{ id: 'v', label: agg === 'count' ? 'Records' : measureLabel, kind: 'area', colorIndex: 0 }]}
                onPointClick={p => drill.openRows(`${dataset.label} — ${p.label}`, datasetId, p.rows)} />}
            </ChartFrame>
          </div>

          {split && (
            <div style={{ marginTop: 'var(--s4)' }}>
              <ChartFrame title="Cross-tabulation"
                question="Where do the two dimensions concentrate together?"
                department={dataset.department} isEmpty={!heat.rowKeys.length} height={300}>
                {() => <Heatmap rowKeys={heat.rowKeys} colKeys={heat.colKeys} cells={heat.cells}
                  valueFormat={fmt} rowLabel={dimensions.find(d => d.key === dimension)?.header}
                  onCellClick={c => drill.openRows(`${c.rowKey} · ${c.colKey}`, datasetId, c.rows)} />}
              </ChartFrame>
            </div>
          )}
        </section>
      </div>

      {drill.target && getDataset(drill.target.datasetId) && (
        <DrillDown title={drill.target.title} subtitle={drill.target.subtitle}
          dataset={getDataset(drill.target.datasetId)!} rows={drill.target.rows} onClose={drill.close} />
      )}
    </>
  );
}
