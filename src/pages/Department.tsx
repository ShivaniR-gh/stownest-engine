import { useMemo, useState, type ComponentType } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { DepartmentId, Row } from '@/config/types';
import { DEPT_BY_ID } from '@/config/departments';
import { allDatasets, getDataset } from '@/config/datasets';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import {
  DatasetFilters, EMPTY_FILTERS, applyViewFilters, type ViewFilters,
} from '@/components/filters/DatasetFilters';
import { MetricGrid, SectionHeader } from '@/components/metrics/MetricCard';
import { DatasetPanel } from '@/components/data/DatasetPanel';
import { CollectionsMatrix } from '@/components/data/CollectionsMatrix';
import { DrillDown } from '@/components/data/DrillDown';
import { DepartmentCharts } from './DepartmentCharts';
import { CapacityDashboard } from '@/components/metrics/CapacityDashboard';
import { CollectionsEntryForm } from '@/components/metrics/CollectionsEntryForm';
import { B2CReportEntryForm } from '@/components/metrics/B2CReportEntryForm';
import { MarketingEntryForm } from '@/components/metrics/MarketingEntryForm';
import { deriveKpis, deriveSchema } from '@/lib/analytics/deriveSchema';
import { Button, ErrorState, Icon } from '@/components/primitives';
import { useMetrics } from '@/lib/analytics/useMetrics';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { useDrill } from '@/lib/analytics/useDrill';
import { applyFilters, applyPeriod } from '@/lib/analytics/filters';
import { scopedId } from '@/lib/data/store';
import { usePermission } from '@/lib/permissions/usePermission';
import { B2CReportView } from '@/components/data/B2CReportView';

type View = 'dashboard' | 'records';

/**
 * Combined entry forms, looked up by the `entryForm` the dataset declares.
 *
 * Previously CollectionsEntryForm was rendered for any dataset with
 * combinedEntry set, which was only correct while collections was the sole
 * department with one. A dataset naming its own form keeps that decision in
 * the schema, where the rest of this page already reads it.
 */
const ENTRY_FORMS: Record<string, ComponentType<{
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}>> = {
  collections: CollectionsEntryForm,
  b2c_report: B2CReportEntryForm,
  marketing: MarketingEntryForm,
};

/** One segmented pill group. Three of these sit in the control bar. */
function Segmented({ label, items, active, onPick }: {
  label: string;
  items: { id: string; label: string; icon?: string; title?: string }[];
  active: string;
  onPick: (id: string) => void;
}) {
  if (items.length < 2) return null;
  return (
    <div className="view-toggle" role="tablist" aria-label={label}>
      {items.map(it => (
        <button key={it.id} role="tab" aria-selected={it.id === active} title={it.title}
          className={`view-toggle__btn${it.id === active ? ' is-active' : ''}`}
          onClick={() => onPick(it.id)}>
          {it.icon && <Icon name={it.icon} size={14} />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One page serves every department.
 *
 * Dashboard and Records are separate views over the same datasets, each with
 * its own filter state — including its own month. Filtering the charts to one
 * city does not silently change what the records table shows, which matters
 * because the two get used for different jobs: a monthly review versus finding
 * one warehouse.
 */
export default function Department() {
  const { deptId } = useParams<{ deptId: string }>();
  const dept = DEPT_BY_ID[deptId as DepartmentId];
  const { hasDepartment } = usePermission();
  const { period, compare, filters } = useAnalytics();
  const drill = useDrill();

  const [view, setView] = useState<View>('dashboard');

  /**
   * Which dataset is in view. Defaults to the first one that carries a
   * capacity/occupied pair, because that is the one with a dashboard worth
   * showing — landing on a flat master list gives an empty Analysis section
   * and no indication that another dataset exists.
   */
  const [tab, setTab] = useState<number | null>(null);
  /** Selected line of business, for departments that declare any. */
  const [line, setLine] = useState<string>('');
  const [dashFilters, setDashFilters] = useState<ViewFilters>(EMPTY_FILTERS);
  const [recFilters, setRecFilters] = useState<ViewFilters>(EMPTY_FILTERS);
  /** Which sub-tab of the records table is open, for datasets that declare one. */
  const [subTab, setSubTab] = useState<string>('');
  /** Departments with a combined entry form open it from the view header,
   *  so one button serves both Dashboard and Records. */
  const [entering, setEntering] = useState(false);
  /** Row open in the entry form for editing, if any. */
  const [editingRow, setEditingRow] = useState<Row | null>(null);

  const allIds = useMemo(() => {
    if (!dept) return [];
    return allDatasets().filter(d => d.department === dept.id).map(d => d.id);
  }, [dept]);

  const lines = dept?.businessLines ?? [];
  const activeLine = lines.find(l => l.id === line)?.id ?? lines[0]?.id ?? '';

  /**
   * Datasets for the selected line. A department that declares businessLines
   * shows only datasets that name one, so a dataset added without a line is
   * visibly missing rather than silently appearing under whichever tab
   * happens to be open.
   */
  const datasetIds = useMemo(() => (
    lines.length
      ? allIds.filter(id => getDataset(id)?.businessLine === activeLine)
      : allIds
  ), [allIds, lines.length, activeLine]);

  const { metrics, error, fetchedAt, status, refresh } = useMetrics(dept?.metrics ?? []);

  const defaultTab = useMemo(() => {
    const i = datasetIds.findIndex(id => {
      const d = getDataset(id);
      return d?.columns.some(c => c.role === 'capacity')
          && d?.columns.some(c => c.role === 'occupied');
    });
    return i >= 0 ? i : 0;
  }, [datasetIds]);

  const activeTab = tab ?? defaultTab;
  const activeDataset = getDataset(datasetIds[activeTab] ?? '');
  const monthly = activeDataset?.tabStrategy === 'monthly';

  // Each view reads its own month, so both are fetched and cached separately.
  const dashId = activeDataset
    ? (monthly && dashFilters.month ? scopedId(activeDataset.id, dashFilters.month) : activeDataset.id)
    : '';
  // Falls back to the dashboard's month for the first render, before the
  // records bar has fetched its month list — otherwise the panel briefly
  // loads the unscoped dataset id.
  const recMonth = recFilters.month || dashFilters.month;
  const recId = activeDataset
    ? (monthly && recMonth ? scopedId(activeDataset.id, recMonth) : activeDataset.id)
    : '';

  const loadIds = useMemo(
    () => [...new Set([...datasetIds, dashId, recId].filter(Boolean))],
    [datasetIds, dashId, recId]);
  const { byId } = useDatasets(loadIds);

  const scoped = useMemo(() => {
    const out: Record<string, ReturnType<typeof applyFilters>> = {};
    for (const id of loadIds) {
      const ds = getDataset(id);
      out[id] = ds ? applyFilters(applyPeriod(byId[id] ?? [], ds, period), filters, ds) : [];
    }
    return out;
  }, [byId, loadIds, period, filters]);

  // Unfiltered rows feed the filter dropdowns; filtered rows feed the view.
  const dashAll = activeDataset ? scoped[dashId] ?? [] : [];
  const dashRows = useMemo(() => applyViewFilters(dashAll, dashFilters), [dashAll, dashFilters]);


  // Every hook must run before these — bailing out above useMemo changes the
  // hook count between renders and React throws on the way to /forbidden.
  if (!dept) return <Navigate to="/404" replace />;
  if (!hasDepartment(dept.id)) return <Navigate to="/forbidden" replace />;

  const busy = status === 'loading' || status === 'refreshing';

  // Values come from the column's enum, not from the rows in view. A segment
  // with no readings yet still needs a tab, or it can never be added.
  const subTabCol = activeDataset?.subTabColumn
    ? activeDataset.columns.find(c => c.key === activeDataset.subTabColumn)
    : undefined;
  const subTabs = subTabCol?.enumValues ?? [];

  const activeSubTab = subTabs.includes(subTab) ? subTab : (subTabs[0] ?? '');

  // A dataset flagged combinedEntry but naming no form has no write surface at
  // all, so the button is gated on the form resolving rather than on the flag.
  const EntryForm = activeDataset?.combinedEntry && activeDataset.entryForm
    ? ENTRY_FORMS[activeDataset.entryForm]
    : undefined;

  const schema = activeDataset ? deriveSchema(activeDataset, dashRows) : null;
  const derivedKpis = activeDataset && schema
    ? deriveKpis(activeDataset, dashRows, [], schema, 6) : [];

  /**
   * All three switchers sit in the control bar. Removing the period picker
   * left that bar an empty strip, and stacking these below it cost a row per
   * level of nesting — view, line, dataset — for controls that are read
   * together.
   *
   * A line with no datasets is still selectable. Clicking it lands on an
   * empty state naming the line, which says "not connected yet"; greying the
   * tab out would say "not allowed", and hiding it would say "does not
   * exist". Only the first is true.
   */
  const barLeft = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
      <Segmented label="View" active={view} onPick={v => setView(v as View)}
        items={[
          { id: 'dashboard', label: 'Dashboard', icon: 'overview' },
          { id: 'records', label: 'Records', icon: 'report' },
        ]} />

      <Segmented label="Line of business" active={activeLine}
        onPick={id => { setLine(id); setTab(null); }}
        items={lines.map(l => ({
          id: l.id, label: l.id, icon: l.icon,
          title: allIds.some(id => getDataset(id)?.businessLine === l.id)
            ? undefined : `No ${l.id} data connected yet`,
        }))} />

      <Segmented label="Dataset" active={datasetIds[activeTab] ?? ''}
        onPick={id => setTab(datasetIds.indexOf(id))}
        items={datasetIds.map(id => ({
          id, label: getDataset(id)?.label ?? id, icon: getDataset(id)?.icon,
        }))} />
    </div>
  );

  return (
    <>
      <TopBar title={dept.label} crumb={[{ label: 'Workspace', to: '/' }]} />
      <ControlBar datasetIds={datasetIds} fetchedAt={fetchedAt} busy={busy}
        onRefresh={refresh} left={barLeft} />

      <div className="page">
        {/* Only for datasets that name an entry form. A dataset flagged
            combinedEntry with no form has no write surface at all, so gating
            on the form resolving is what keeps this honest. */}
        {EntryForm && (
          <div className="view-head">
            <div className="view-head__row">
              <Button size="sm" variant="primary" icon="plus"
                onClick={() => setEntering(true)}>New record</Button>
            </div>
          </div>
        )}

        {(entering || editingRow) && EntryForm && (
          <EntryForm existing={editingRow}
            onCancel={() => { setEntering(false); setEditingRow(null); }}
            onDone={() => { setEntering(false); setEditingRow(null); refresh(); }} />
        )}


        {status === 'error' && !Object.values(byId).some(r => r.length) ? (
          <ErrorState title={`Could not load ${dept.label} data`}
            body={error?.message ?? 'The data service did not respond.'} onRetry={refresh} />
        ) : !activeDataset && lines.length > 0 ? (
          <ErrorState title={`No ${activeLine} data yet`}
            body={`Nothing is connected for ${activeLine} in ${dept.label}. Add a dataset with businessLine: '${activeLine}' to fill this tab.`} />
        ) : view === 'dashboard' ? (
          <>
            {activeDataset && !dept.customDashboard && (
              <DatasetFilters dataset={activeDataset} rows={dashAll}
                value={dashFilters} onChange={setDashFilters} />
            )}

            {/* CapacityDashboard renders its own KPI row, so the separate
                "Key figures" section is only shown for datasets it cannot
                handle — otherwise the same five cards appeared twice. */}
            {activeDataset && schema?.hasUtilisation ? (
              <CapacityDashboard ds={activeDataset} rows={dashRows} schema={schema} />
            ) : (
              <>
                {/* A department with its own dashboard already shows its
                    figures; deriveKpis would guess a second set from the same
                    columns and print every number twice. */}
                {!dept.customDashboard && (metrics.length > 0 || derivedKpis.length > 0) && (
                  <section className="section">
                    <SectionHeader title="Key figures" note={period.label} />
                    <MetricGrid metrics={[...metrics, ...derivedKpis]} compare={compare}
                      onDrill={drill.openMetric} />
                  </section>
                )}
                <section className="section">
                  <SectionHeader title="Analysis" />
                  <DepartmentCharts department={dept.id}
                    ctx={{ rows: scoped, period, activeDatasetId: activeDataset?.id ?? '',
                          drill: (t, d, r) => drill.openRows(t, d, r) }} />
                </section>
              </>
            )}
          </>
        ) : (
          activeDataset && (
            <section className="section">
              <SectionHeader title="Records" />

              {subTabs.length > 1 && (
                <div className="subtabs" role="tablist" aria-label={subTabCol?.header ?? 'View'}>
                  {subTabs.map(v => (
                    <button key={v} role="tab" aria-selected={v === activeSubTab}
                      className={`subtabs__btn${v === activeSubTab ? ' is-active' : ''}`}
                      onClick={() => setSubTab(v)}>{v}</button>
                  ))}
                </div>
              )}

              {monthly && (
                <DatasetFilters dataset={activeDataset} rows={scoped[recId] ?? []}
                  value={recFilters} onChange={setRecFilters} />
              )}

              {/* One grid for both collections datasets: the segment figures
                  only read against the month totals above them, so showing
                  them as two tables loses the comparison. */}
                                {activeDataset.entryForm === 'b2c_report' ? (
                <B2CReportView rows={scoped[recId] ?? []} onEdit={setEditingRow} />
              ) : activeDataset.transposable ? (
                <div className="card"><div className="card__bd">
                  <CollectionsMatrix
                    monthlyDs={activeDataset}
                    monthly={scoped[recId] ?? []}
                    onEdit={setEditingRow} />
                </div></div>
              ) : (
              <DatasetPanel
                key={`${activeDataset.id}:${recMonth}:${activeSubTab}`}
                dataset={activeDataset}
                allowCreate={!activeDataset.combinedEntry}
                month={monthly ? String(recMonth) : undefined}
                prefilter={r =>
                  applyViewFilters([r], recFilters).length > 0
                  && (!activeSubTab || !subTabCol
                      || String(r[subTabCol.key] ?? '').trim() === activeSubTab)}
              />
              )}
            </section>
          )
        )}
      </div>

      {drill.target && getDataset(drill.target.datasetId) && (
        <DrillDown title={drill.target.title} subtitle={drill.target.subtitle}
          dataset={getDataset(drill.target.datasetId)!} rows={drill.target.rows} onClose={drill.close} />
      )}
    </>
  );
}
