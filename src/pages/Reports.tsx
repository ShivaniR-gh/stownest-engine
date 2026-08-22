import { useMemo, useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { ControlBar } from '@/components/filters/ControlBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Badge, Button, EmptyState, Icon } from '@/components/primitives';
import { allDatasets, getDataset } from '@/config/datasets';
import { DEPT_BY_ID } from '@/config/departments';
import { useDatasets } from '@/lib/data/useDataset';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { applyFilters, applyPeriod } from '@/lib/analytics/filters';
import { usePermission } from '@/lib/permissions/usePermission';
import { exportRows, printReport, toCSV, download, stamp } from '@/lib/export';
import { formatInt, relativeTime } from '@/lib/format';
import { periodLabel } from '@/lib/analytics/period';

/**
 * Reports.
 *
 * Every export honours the same three constraints: the caller's permissions,
 * the active period, and the active filters. There is no "export everything"
 * path that quietly bypasses a department boundary.
 */
export default function Reports() {
  const { period, filters, activeCount } = useAnalytics();
  const { can, hasDepartment } = usePermission();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const available = useMemo(
    () => allDatasets().filter(d => hasDepartment(d.department) && can('EXPORT', d.department) && d.id !== 'access_control'),
    [hasDepartment, can]);

  const ids = available.map(d => d.id);
  const { byId, fetchedAt, status, refresh } = useDatasets(ids);

  const scoped = useMemo(() => Object.fromEntries(available.map(d => {
    const ds = getDataset(d.id)!;
    return [d.id, applyFilters(applyPeriod(byId[d.id] ?? [], ds, period), filters, ds)];
  })), [available, byId, period, filters]);

  const exportCombined = () => {
    const parts: string[] = [];
    for (const id of selected) {
      const ds = getDataset(id)!;
      const cols = ds.columns.filter(c => c.sheetColumn);
      parts.push(`# ${ds.label} — ${periodLabel(period)}`);
      parts.push(toCSV(scoped[id] ?? [], cols));
      parts.push('');
    }
    download(`stownest-report-${stamp()}.csv`, parts.join('\r\n'));
  };

  if (!available.length) {
    return (
      <>
        <TopBar title="Reports" />
        <div className="page">
          <div className="card">
            <EmptyState icon="shield" title="No export permission"
              body="Exporting is not enabled on your account. A super admin can grant the EXPORT action from Administration → Permissions." />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Reports" actions={
        <Button size="sm" icon="report" onClick={printReport}>Print / save as PDF</Button>
      } />
      <ControlBar datasetIds={ids} fetchedAt={fetchedAt}
        busy={status === 'loading' || status === 'refreshing'} onRefresh={refresh} />

      <div className="page">
        <section className="section">
          <SectionHeader title="Scope of this report"
            note={fetchedAt ? `Data read ${relativeTime(fetchedAt)}` : undefined} />
          <div className="card">
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', fontSize: 'var(--fs-sm)' }}>
              <span>
                <div className="eyebrow">Period</div>
                <b>{periodLabel(period)}</b>
              </span>
              <span>
                <div className="eyebrow">Filters</div>
                <b>{activeCount === 0 ? 'None applied' : `${activeCount} active`}</b>
              </span>
              <span>
                <div className="eyebrow">Datasets you may export</div>
                <b className="num">{available.length}</b>
              </span>
              <span style={{ marginLeft: 'auto', maxWidth: 380, color: 'var(--ink-400)', fontSize: 'var(--fs-xs)', lineHeight: 1.6 }}>
                Files contain exactly the rows shown under the current period and filters — not the whole sheet.
                Columns are formatted for Excel, including the ₹ symbol and Indian digit grouping.
              </span>
            </div>
          </div>
        </section>

        <section className="section">
          <SectionHeader
            title="Datasets"
            action={
              <span style={{ display: 'flex', gap: 'var(--s2)' }}>
                <Button size="sm" variant="ghost"
                  onClick={() => setSelected(s => (s.size === available.length ? new Set() : new Set(ids)))}>
                  {selected.size === available.length ? 'Clear all' : 'Select all'}
                </Button>
                <Button size="sm" variant="primary" icon="download" disabled={!selected.size}
                  onClick={exportCombined}>
                  Export {selected.size || ''} as one file
                </Button>
              </span>
            } />

          <div className="grid grid--3">
            {available.map(d => {
              const rows = scoped[d.id] ?? [];
              const on = selected.has(d.id);
              return (
                <div key={d.id} className="card" style={on ? { borderColor: 'var(--accent-line)' } : undefined}>
                  <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
                    <label className="check" style={{ alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={on} style={{ marginTop: 3 }}
                        onChange={() => setSelected(s => {
                          const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n;
                        })} />
                      <span>
                        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{d.label}</div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)' }}>
                          {DEPT_BY_ID[d.department].label} · tab <b className="num">{d.sheetName}</b>
                        </div>
                      </span>
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                      <Badge tone={rows.length ? 'accent' : 'idle'}>
                        {formatInt(rows.length)} rows
                      </Badge>
                      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-400)' }}>
                        {d.columns.filter(c => c.sheetColumn).length} columns
                      </span>
                      <Button size="sm" variant="ghost" icon="download" style={{ marginLeft: 'auto' }}
                        disabled={!rows.length}
                        onClick={() => exportRows(d.id, rows, d.columns.filter(c => c.sheetColumn))}>
                        CSV
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <SectionHeader title="Printing" />
          <div className="card">
            <div className="card__bd" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.7, display: 'flex', gap: 'var(--s3)' }}>
              <Icon name="info" size={16} />
              <span>
                Use <b>Print</b> on any screen and choose <i>Save as PDF</i>. Navigation, toolbars and row controls are
                removed from the printed page automatically, so what you get is the tables and charts as shown.
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
