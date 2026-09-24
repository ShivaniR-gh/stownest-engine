import { useEffect, useMemo, useState, type ComponentType } from 'react';
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
import { scopedId, latestFilledTab } from '@/lib/data/store';
import {
  isWindowId, windowCount, windowTabNames, tabMonthDate,
  WINDOW_PRESETS, keysInWindow, ytdOptions, monthLabel,
} from '@/lib/analytics/monthWindow';
import { SelectField } from '@/components/filters/SelectField';
import { parseDate } from '@/lib/format';
import { usePermission } from '@/lib/permissions/usePermission';
import { B2CReportView } from '@/components/data/B2CReportView';
import { SalesEntryForm } from '@/components/metrics/SalesEntryForm';
import { OperationsEntryForm } from '@/components/metrics/OperationsEntryForm';
import { ControlTowerEntryForm } from '@/components/metrics/ControlTowerEntryForm';
import { FinanceEntryForm } from '@/components/metrics/FinanceEntryForm';
import { B2BEntryForm } from '@/components/metrics/B2BEntryForm';
import { ControlTowerView } from '@/components/data/ControlTowerView';
import { FinanceDashboard } from '@/components/metrics/FinanceDashboard';
import { MarketingRecordsView } from '@/components/data/MarketingRecordsView';
import { SalesCityView } from '@/components/data/SalesCityView';
import { B2BMonthlyView } from '@/components/data/B2BMonthlyView';
import { ChartKindProvider, ChartKindSwitch } from '@/components/charts/chartKind';

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
  datasetId?: string;
  existing?: Row | null;
  onDone: () => void;
  onCancel: () => void;
}>> = {
  collections: CollectionsEntryForm,
  b2c_report: B2CReportEntryForm,
  marketing: MarketingEntryForm,
  sales: SalesEntryForm,
  operations: OperationsEntryForm,
  control_tower: ControlTowerEntryForm,
  finance: FinanceEntryForm,
  b2b: B2BEntryForm,
};

/** One segmented pill group. Three of these sit in the control bar. */
function Segmented({ label, items, active, onPick, allowSingle }: {
  label: string;
  items: { id: string; label: string; icon?: string; title?: string }[];
  active: string;
  onPick: (id: string) => void;
  allowSingle?: boolean;
}) {
  if (items.length === 0 || (!allowSingle && items.length < 2)) return null;
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
/** Month key (yyyy-mm) of a row's Month column. */
const rowMonthKey = (r: Row) => {
  const d = parseDate(r.month);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};

/**
 * Row test for the Records month filter on single-sheet datasets (B2B).
 * DatasetFilters cannot serve those — its month list comes from sheet tabs.
 *
 * Built from the FULL row list: a rolling window ("last 3 months") is relative
 * to the months that exist, so a per-row test would call every row its own
 * newest month and match them all.
 */
function monthTest(allRows: Row[], period: string): (r: Row) => boolean {
  if (period === 'all') return () => true;
  const keys = [...new Set(allRows.map(rowMonthKey).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const keep = new Set(keysInWindow(keys, period));
  return r => keep.has(rowMonthKey(r));
}

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
  /** Records month filter for single-sheet datasets (B2B), which
   *  DatasetFilters cannot serve — its month list comes from sheet tabs. */
  const [recPeriod, setRecPeriod] = useState('all');
  /** Which sub-tab of the records table is open, for datasets that declare one. */
  const [subTab, setSubTab] = useState<string>('');
  /** Departments with a combined entry form open it from the view header,
   *  so one button serves both Dashboard and Records. */
  const [entering, setEntering] = useState(false);
  /** Row open in the entry form for editing, if any. */
  const [editingRow, setEditingRow] = useState<Row | null>(null);

  const allIds = useMemo(() => {
    if (!dept) return [];
    return allDatasets()
      .filter(d => d.department === dept.id || (d.alsoIn ?? []).includes(dept.id))
      .map(d => d.id);
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

  /** Newest month tab that actually holds rows. Windows are anchored on it,
   *  not on today: "Last 3 Months" should mean the last three months with
   *  readings, not three calendar months that may all be empty. */
  const [filledTab, setFilledTab] = useState('');
  useEffect(() => {
    if (!activeDataset || !monthly) { setFilledTab(''); return; }
    let cancelled = false;
    latestFilledTab(activeDataset.id)
      .then(t => { if (!cancelled) setFilledTab(t); })
      .catch(() => { /* falls back to the calendar anchor */ });
    return () => { cancelled = true; };
  }, [activeDataset, monthly]);
  const anchor = tabMonthDate(filledTab) ?? undefined;

  /** Capacity datasets measure a level, not a flow, so their filter offers
   *  plain months only (see DatasetFilters). Their charts still need history,
   *  so a fixed year ending at the chosen month is loaded behind the scenes. */
  const snapshotDataset = !!activeDataset
    && activeDataset.columns.some(c => c.key === 'occupied_space')
    && activeDataset.columns.some(c => c.key === 'total_space');
  const SNAPSHOT_HISTORY = 12;

  const dashWindow = monthly && isWindowId(dashFilters.month);
  const dashTabs = useMemo(() => {
    if (!activeDataset || !monthly || !dashFilters.month) return [];
    if (isWindowId(dashFilters.month)) {
      return windowTabNames(
        activeDataset.tabPrefix ?? activeDataset.sheetName,
        windowCount(dashFilters.month),
        anchor,
      );
    }
    if (snapshotDataset) {
      return windowTabNames(
        activeDataset.tabPrefix ?? activeDataset.sheetName,
        SNAPSHOT_HISTORY,
        tabMonthDate(dashFilters.month) ?? anchor,
      );
    }
    return [dashFilters.month];
  }, [activeDataset, monthly, dashFilters.month, anchor, snapshotDataset]);

  // Each view reads its own month, so both are fetched and cached separately.
  const dashIds = useMemo(() => {
    if (!activeDataset) return [] as string[];
    if (!monthly) return [activeDataset.id];
    return dashTabs.map(t => scopedId(activeDataset.id, t));
  }, [activeDataset, monthly, dashTabs]);
  // Falls back to the dashboard's month for the first render, before the
  // records bar has fetched its month list — otherwise the panel briefly
  // loads the unscoped dataset id.
  const recMonth = (recFilters.month && !isWindowId(recFilters.month))
    ? recFilters.month
    : (dashWindow ? dashTabs[0] ?? '' : dashFilters.month);
  const recId = activeDataset
    ? (monthly && recMonth ? scopedId(activeDataset.id, recMonth) : activeDataset.id)
    : '';

  const loadIds = useMemo(
    () => [...new Set([...datasetIds, ...dashIds, recId].filter(Boolean))],
    [datasetIds, dashIds, recId]);
  const { byId } = useDatasets(loadIds);

  const scoped = useMemo(() => {
    const out: Record<string, ReturnType<typeof applyFilters>> = {};
    for (const id of loadIds) {
      const ds = getDataset(id);
      if (!ds) { out[id] = []; continue; }
      /* A monthly tab IS the period. applyPeriod uses Recorded On against the
         global analytics range (last 30 days etc) and drops July rows from the
         July tab when they are dated July, leaving only August-dated leftovers. */
      const raw = byId[id] ?? [];
      const dated = (monthly || snapshotDataset) ? raw : applyPeriod(raw, ds, period);
      out[id] = applyFilters(dated, filters, ds);
    }
    return out;
  }, [byId, loadIds, period, filters]);

  /* Built once over the whole row list: a rolling window has to know which
     months exist before it can decide which of them are the last three. */
  const monthOk = useMemo(
    () => monthTest(scoped[recId] ?? [], recPeriod),
    [scoped, recId, recPeriod]);
  /** Months present in the records rows, newest first — the Period options. */
  const recMonthKeys = useMemo(
    () => [...new Set((scoped[recId] ?? []).map(rowMonthKey).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a)),
    [scoped, recId]);

  // Unfiltered rows feed the filter dropdowns; filtered rows feed the view.
  const dashAll = useMemo(() => {
    if (!activeDataset) return [];
    if (!monthly) return scoped[activeDataset.id] ?? [];
    return dashIds.flatMap(id => (scoped[id] ?? []).map(r => ({ ...r, _tab: id.split('::')[1] })));
  }, [activeDataset, monthly, dashIds, scoped]);
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

      {dept.id === 'b2b' ? (
        <>
          <Segmented label="Accounts" active={datasetIds[activeTab] ?? ''}
            onPick={id => setTab(datasetIds.indexOf(id))}
            items={datasetIds.filter(id => id !== 'b2b_sales').map(id => ({
              id, label: getDataset(id)?.label ?? id, icon: getDataset(id)?.icon,
            }))} />
          <Segmented label="B2B Sales" allowSingle active={datasetIds[activeTab] ?? ''}
            onPick={id => setTab(datasetIds.indexOf(id))}
            items={datasetIds.filter(id => id === 'b2b_sales').map(id => ({
              id, label: getDataset(id)?.label ?? id, icon: getDataset(id)?.icon,
            }))} />
        </>
      ) : (
        <Segmented label="Dataset" active={datasetIds[activeTab] ?? ''}
          onPick={id => setTab(datasetIds.indexOf(id))}
          items={datasetIds.map(id => ({
            id, label: getDataset(id)?.label ?? id, icon: getDataset(id)?.icon,
          }))} />
      )}
    </div>
  );

  return (
    <>
      <TopBar title={dept.label} crumb={[{ label: 'Workspace', to: '/' }]} />
      <ControlBar datasetIds={datasetIds} fetchedAt={fetchedAt} busy={busy}
        onRefresh={refresh} left={barLeft} />

      <div className="page">
        {(entering || editingRow) && EntryForm && (
          <EntryForm datasetId={activeDataset?.id} existing={editingRow}
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
          /* One chart-type choice per department page. Every chart below
             follows it; the switch sits in the charts section's heading. */
          <ChartKindProvider scope={dept.id}>
            {/* Filters are hidden when a department's own dashboard is
                driving the page — it owns its period/city controls. But a
                capacity dataset is rendered by CapacityDashboard, not by the
                custom dashboard, even inside a department that has one
                (Operations' Warehouse Space is the case). That view needs the
                standard filters, so the test follows what is actually
                rendering below rather than what the department owns. */}
            {activeDataset && (!dept.customDashboard || schema?.hasUtilisation) && (
              <DatasetFilters dataset={activeDataset} rows={dashAll}
                value={dashFilters} onChange={setDashFilters} />
            )}

            {/* CapacityDashboard renders its own KPI row, so the separate
                "Key figures" section is only shown for datasets it cannot
                handle — otherwise the same five cards appeared twice. */}
            {activeDataset && schema?.hasUtilisation ? (
              <CapacityDashboard ds={activeDataset} rows={dashRows} schema={schema}
                focusMonth={dashFilters.month}
                snapshotRows={
                  monthly && dashFilters.month && !isWindowId(dashFilters.month)
                    ? (scoped[scopedId(activeDataset.id, dashFilters.month)] ?? [])
                    : undefined
                } />
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
                {/* A custom dashboard brings its own section headers ("Key
                    figures", "Analysis", ...), so this outer one would stack a
                    second heading directly on top of the first with nothing
                    between them. Only the generic path needs it. */}
                <section className="section">
                  {!dept.customDashboard && <SectionHeader title="Analysis" action={<ChartKindSwitch />} />}
                  <DepartmentCharts department={dept.id}
                    ctx={{ rows: scoped, period, activeDatasetId: activeDataset?.id ?? '',
                          drill: (t, d, r) => drill.openRows(t, d, r) }} />
                </section>
              </>
            )}
          </ChartKindProvider>
        ) : (
          activeDataset && (
            <section className="section">
              {/* Actions sit in the header's action slot rather than a
                  .view-head row of their own — that row cost a full band of
                  vertical space above the heading for one button. Still gated
                  on the entry form resolving: a combinedEntry dataset with no
                  form has no write surface at all. */}
              <SectionHeader title="Records" action={EntryForm ? (
                <span style={{ display: 'flex', gap: 8 }}>
                  {activeDataset?.id !== 'b2b_summary' && (
                    <Button size="sm" variant="primary" icon="plus"
                      onClick={() => { setEditingRow(null); setEntering(true); }}>New record</Button>
                  )}
                </span>
              ) : undefined} />

              {subTabs.length > 1 && (
                <div className="subtabs" role="tablist" aria-label={subTabCol?.header ?? 'View'}>
                  {subTabs.map(v => (
                    <button key={v} role="tab" aria-selected={v === activeSubTab}
                      className={`subtabs__btn${v === activeSubTab ? ' is-active' : ''}`}
                      onClick={() => setSubTab(v)}>{v}</button>
                  ))}
                </div>
              )}

              {monthly && activeDataset.department !== 'control_tower' && (
                <DatasetFilters dataset={activeDataset} rows={scoped[recId] ?? []}
                  value={recFilters} onChange={setRecFilters} />
              )}
              {/* Single-sheet datasets with a Month column (B2B, Operations)
                  get the Period filter here: DatasetFilters cannot serve them,
                  since its month list comes from sheet tabs. b2b_summary and
                  the custom views render their own. */}
              {!monthly && activeDataset.id !== 'b2b_summary'
                && !['sales', 'finance', 'control_tower', 'marketing', 'collections'].includes(activeDataset.department)
                && activeDataset.entryForm !== 'b2c_report'
                && !activeDataset.transposable
                && activeDataset.columns.some(c => c.key === 'month') && (
                <div className="filter-bar">
                  <SelectField icon="calendar" label="Period" value={recPeriod}
                    onChange={setRecPeriod} isOn={recPeriod !== 'all'}
                    options={[
                      { value: 'all', label: 'All months' },
                      ...WINDOW_PRESETS.map(p => ({ value: p.id, label: p.label })),
                      ...ytdOptions(recMonthKeys).map(y => ({ value: y.id, label: y.label })),
                      ...recMonthKeys.map(k => ({ value: k, label: monthLabel(`${k}-01`) })),
                    ]} />
                </div>
              )}
                            {/* Sales and the B2C report each render their own table; the
                  generic panel would show fifty columns scrolling sideways. */}
              {activeDataset.id === 'b2b_summary' ? (
                <B2BMonthlyView rows={scoped} />
              ) : activeDataset.department === 'sales' ? (
                <SalesCityView rows={scoped[recId] ?? []} datasetId={activeDataset.id}
                  label={activeDataset.label} onEdit={setEditingRow} />
              ) : activeDataset.entryForm === 'b2c_report' ? (
                <B2CReportView rows={scoped[recId] ?? []} onEdit={setEditingRow} />
              ) : activeDataset.department === 'control_tower' ? (
                <ControlTowerView rows={scoped[recId] ?? []}
                  datasetId={activeDataset.id} onEdit={setEditingRow} />
              ) : activeDataset.department === 'finance' ? (
                <FinanceDashboard rows={scoped} mode="records" onEdit={setEditingRow} />
              ) : activeDataset.department === 'marketing' ? (
                <MarketingRecordsView rows={scoped[recId] ?? []}
                  datasetId={activeDataset.id} onEdit={setEditingRow} />
              ) : activeDataset.transposable ? (
                /* No card wrapper here: CollectionsMatrix renders its own,
                   around the table only, so its period filter can sit above
                   the card instead of inside a body that is padding:0. */
                <CollectionsMatrix
                  monthlyDs={activeDataset}
                  monthly={scoped[recId] ?? []}
                  onEdit={setEditingRow} />
              ) : (
              <DatasetPanel
                key={`${activeDataset.id}:${recMonth}:${activeSubTab}`}
                dataset={activeDataset}
                allowCreate={!activeDataset.combinedEntry}
                month={monthly ? String(recMonth) : undefined}
                prefilter={r =>
                  applyViewFilters([r], recFilters).length > 0
                  && monthOk(r)
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
