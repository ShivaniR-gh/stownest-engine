import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DatasetDef, Row } from '@/config/types';
import { Button, ConfirmDialog, Icon, Popover } from '@/components/primitives';
import { DataTable } from './DataTable';
import { RecordForm } from './RecordForm';
import { ReadingForm } from './ReadingForm';
import { adapter, createRow, deleteRow, latestFilledTab, scopedId, updateRow } from '@/lib/data/store';
import { useScopedRows } from '@/lib/analytics/useMetrics';
import { applySearch, describePeriod } from '@/lib/analytics/filters';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { exportRows } from '@/lib/export';
import { usePermission } from '@/lib/permissions/usePermission';
import { Gate } from '@/lib/permissions/Gate';
import { isRowOpen } from '@/lib/data/editable';

/**
 * A complete CRUD surface for one dataset: search, table, create, edit, delete,
 * bulk delete and export — all gated on the same policy the API enforces.
 *
 * Rows arrive already scoped to the global period and filters, so the table a
 * user exports is exactly the table they were looking at.
 */
export function DatasetPanel({ dataset, prefilter, month: monthProp, allowCreate = true }: {
  dataset: DatasetDef;
  prefilter?: (r: Row) => boolean;
  /** False when the page provides its own combined entry form — two New
   *  buttons writing the same tab in different shapes is a trap. */
  allowCreate?: boolean;
  /** Supplied when the page has its own month control; omit for a standalone
   *  panel. Explicitly allows undefined because the project runs with
   *  exactOptionalPropertyTypes. */
  month?: string | undefined;
}) {
  const nav = useNavigate();
  const { can } = usePermission();

  /**
   * Monthly datasets keep one tab per month, so the table has to be told WHICH
   * month to read. Without this the panel read whichever month the server
   * defaulted to while the form wrote to the month the user picked — the rows
   * went in correctly and the table looked empty.
   */
  const monthly = dataset.tabStrategy === 'monthly';
  const [ownMonth, setOwnMonth] = useState('');
  const [months, setMonths] = useState<string[]>([]);

  // A page-level filter bar wins; the built-in picker is the fallback so the
  // panel still works on its own.
  const month = monthProp ?? ownMonth;
  const setMonth = monthProp === undefined ? setOwnMonth : () => {};

  useEffect(() => {
    if (!monthly || monthProp !== undefined) { setMonths([]); return; }
    let cancelled = false;
    adapter.list(dataset.id)
      .then(r => {
        if (cancelled) return;
        setMonths(r.tabs ?? []);
        setOwnMonth(m => m || r.tab || r.tabs?.[0] || '');
      })
      .catch(() => { /* the table's own error state covers this */ });
    return () => { cancelled = true; };
  }, [dataset.id, monthly, monthProp]);

  /**
   * Monthly datasets keep one tab per month, so a row has no `month` field and
   * isRowOpen() would never match. The open month here is the newest tab that
   * actually holds rows and is not in the future: walk the allowed tabs
   * newest-first and stop at the first non-empty one. Usually one or two
   * reads. Only that month can be edited or deleted; older months are closed.
   *
   * Future tabs are skipped rather than counted. A dataset may allow entering
   * a month ahead, and one row typed into next month would otherwise close
   * the month everyone is actually correcting.
   */
  const [openTab, setOpenTab] = useState<string>('');
  useEffect(() => {
    if (!monthly) { setOpenTab(''); return; }
    let cancelled = false;
    /* Shared with the filter bar and the dashboard: one batched lookup per
       dataset, cached, instead of this panel walking the months itself. */
    latestFilledTab(dataset.id, { skipFuture: true })
      .then(t => { if (!cancelled) setOpenTab(t); })
      .catch(() => { if (!cancelled) setOpenTab(''); });
    return () => { cancelled = true; };
  }, [dataset.id, monthly]);

  // One cache entry per month, so switching months does not discard the other.
  const readId = monthly && month ? scopedId(dataset.id, month) : dataset.id;

  const { rows, all, status, error } = useScopedRows(readId);
  const { period } = useAnalytics();

  // Explains an empty table rather than blaming the date range: a mis-mapped
  // date column is otherwise indistinguishable from an empty sheet.
  const diag = useMemo(() => describePeriod(all, dataset, period), [all, dataset, period]);

  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Row | Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Row[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const cols = useMemo(() => dataset.columns.filter(c => c.sheetColumn), [dataset]);
  const view = useMemo(() => {
    const base = prefilter ? rows.filter(prefilter) : rows;
    return applySearch(base, q, dataset);
  }, [rows, q, dataset, prefilter]);

  const dept = dataset.department;
  /** The record page needs the month tab as well as the id: for a monthly
   *  dataset the row lives in that tab, not in the bare dataset. */
  const recordHref = (r: Row) =>
    `/d/${dept}/${dataset.id}/${encodeURIComponent(String(r.__id))}`
    + (monthly && month ? `?tab=${encodeURIComponent(month)}` : '');

  const rowOpen = (r: Row) => (monthly ? !!month && month === openTab : isRowOpen(r, all));

  const runDelete = async () => {
    if (!deleting) return;
    const list = Array.isArray(deleting) ? deleting : [deleting];
    setBusy(true); setFailure(null);
    try {
      for (const r of list) await deleteRow(readId, String(r.__id));
      setDeleting(null); setSelection([]);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Delete failed. Nothing was changed.');
    } finally { setBusy(false); }
  };

  return (
    <>
      {failure && (
        <div style={{
          marginBottom: 'var(--s3)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
          background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 'var(--fs-sm)',
        }}>{failure}</div>
      )}

      <DataTable
        dataset={dataset}
        rows={view}
        status={status}
        error={error}
        emptyBody={diag.emptyReason ?? undefined}
        onSelectionChange={setSelection}
        onRowClick={r => nav(recordHref(r))}
        toolbarLeft={
          <>
            {/* Which month's tab the table below is showing. */}
            {monthly && monthProp === undefined && (
              <select
                className="field"
                style={{ width: 150 }}
                value={month}
                onChange={e => setMonth(e.target.value)}
                aria-label="Month"
              >
                {!months.length && <option value="">Loading…</option>}
                {months.map(m => (
                  <option key={m} value={m}>{m.replace(/^\S+\s/, '')}</option>
                ))}
              </select>
            )}
            <span className="search" style={{ width: 260 }}>
              <Icon name="search" size={14} />
              <input className="field" placeholder={`Search ${dataset.label.toLowerCase()}…`}
                value={q} onChange={e => setQ(e.target.value)} aria-label="Search records" />
            </span>
          </>
        }
        toolbarRight={
          <>
            {/* Closed months are not deletable, so a mixed selection offers
                no bulk delete rather than silently skipping rows. */}
            {selection.length > 0 && can('DELETE', dept)
              && selection.every(r => rowOpen(r)) && (
              <Button size="sm" variant="danger" icon="trash" onClick={() => setDeleting(selection)}>
                Delete {selection.length}
              </Button>
            )}
            <Gate action="EXPORT" department={dept}>
              <Button size="sm" icon="download" onClick={() => exportRows(dataset.id, view, cols)}>
                Export
              </Button>
            </Gate>
            {allowCreate && (
              <Gate action="CREATE" department={dept}>
                <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing(null)}>
                  New {dataset.noun}
                </Button>
              </Gate>
            )}
          </>
        }
        rowActions={r => (
          (can('UPDATE', dept) || can('DELETE', dept)) ? (
            <Popover width={170} align="end" trigger={({ toggle, ref }) => (
              <Button size="sm" iconOnly variant="ghost" icon="more" ref={ref}
                aria-label="Row actions" onClick={toggle} />
            )}>
              {close => (
                <>
                  <button className="pop__item" onClick={() => { close(); nav(recordHref(r)); }}>
                    <Icon name="external" size={13} /> View record
                  </button>
                  {can('UPDATE', dept) && rowOpen(r) && (
                    <button className="pop__item" onClick={() => { close(); setEditing(r); }}>
                      <Icon name="edit" size={13} /> Edit
                    </button>
                  )}
                  {can('DELETE', dept) && rowOpen(r) && (
                    <>
                      <div className="pop__sep" />
                      <button className="pop__item pop__item--danger" onClick={() => { close(); setDeleting(r); }}>
                        <Icon name="trash" size={13} /> Delete
                      </button>
                    </>
                  )}
                </>
              )}
            </Popover>
          ) : null
        )}
      />

      {/* Monthly datasets get a purpose-built form: the warehouse comes from a
          dropdown and the space figures are computed as you type. Everything
          else uses the generic schema-driven form. */}
      {editing !== undefined && dataset.tabStrategy === 'monthly' && !editing && (
        <ReadingForm
          dataset={dataset}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values, tab) => { await createRow(scopedId(dataset.id, tab), values); setMonth(tab); }}
        />
      )}

      {editing !== undefined && (dataset.tabStrategy !== 'monthly' || editing) && (
        <RecordForm
          dataset={dataset}
          record={editing}
          onClose={() => setEditing(undefined)}
          onSubmit={async values => {
            if (editing) await updateRow(readId, String(editing.__id), values);
            else await createRow(readId, values);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          danger
          busy={busy}
          title={Array.isArray(deleting) ? `Delete ${deleting.length} records?` : `Delete this ${dataset.noun}?`}
          confirmLabel={Array.isArray(deleting) ? `Delete ${deleting.length}` : 'Delete'}
          onCancel={() => setDeleting(null)}
          onConfirm={runDelete}
          body={
            <>
              {Array.isArray(deleting)
                ? <>These {deleting.length} rows will be removed from the <b>{dataset.sheetName}</b> tab.</>
                : <>Row <b>{String((deleting as Row)[dataset.titleColumn] ?? deleting.__id)}</b> will be removed
                   from the <b>{dataset.sheetName}</b> tab.</>}
              <br /><br />
              This edits the spreadsheet directly and cannot be undone from here. The deletion is written
              to the audit tab with your name and the time.
            </>
          }
        />
      )}
    </>
  );
}
