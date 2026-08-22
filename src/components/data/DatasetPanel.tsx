import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DatasetDef, Row } from '@/config/types';
import { Button, ConfirmDialog, Icon, Popover } from '@/components/primitives';
import { DataTable } from './DataTable';
import { RecordForm } from './RecordForm';
import { createRow, deleteRow, updateRow } from '@/lib/data/store';
import { useScopedRows } from '@/lib/analytics/useMetrics';
import { applySearch } from '@/lib/analytics/filters';
import { exportRows } from '@/lib/export';
import { usePermission } from '@/lib/permissions/usePermission';
import { Gate } from '@/lib/permissions/Gate';

/**
 * A complete CRUD surface for one dataset: search, table, create, edit, delete,
 * bulk delete and export — all gated on the same policy the API enforces.
 *
 * Rows arrive already scoped to the global period and filters, so the table a
 * user exports is exactly the table they were looking at.
 */
export function DatasetPanel({ dataset, prefilter }: { dataset: DatasetDef; prefilter?: (r: Row) => boolean }) {
  const nav = useNavigate();
  const { can } = usePermission();
  const { rows, status, error } = useScopedRows(dataset.id);

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

  const runDelete = async () => {
    if (!deleting) return;
    const list = Array.isArray(deleting) ? deleting : [deleting];
    setBusy(true); setFailure(null);
    try {
      for (const r of list) await deleteRow(dataset.id, String(r.__id));
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
        onSelectionChange={setSelection}
        onRowClick={r => nav(`/d/${dept}/${dataset.id}/${encodeURIComponent(String(r.__id))}`)}
        toolbarLeft={
          <span className="search" style={{ width: 260 }}>
            <Icon name="search" size={14} />
            <input className="field" placeholder={`Search ${dataset.label.toLowerCase()}…`}
              value={q} onChange={e => setQ(e.target.value)} aria-label="Search records" />
          </span>
        }
        toolbarRight={
          <>
            {selection.length > 0 && can('DELETE', dept) && (
              <Button size="sm" variant="danger" icon="trash" onClick={() => setDeleting(selection)}>
                Delete {selection.length}
              </Button>
            )}
            <Gate action="EXPORT" department={dept}>
              <Button size="sm" icon="download" onClick={() => exportRows(dataset.id, view, cols)}>
                Export
              </Button>
            </Gate>
            <Gate action="CREATE" department={dept}>
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing(null)}>
                New {dataset.noun}
              </Button>
            </Gate>
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
                  <button className="pop__item" onClick={() => { close(); nav(`/d/${dept}/${dataset.id}/${encodeURIComponent(String(r.__id))}`); }}>
                    <Icon name="external" size={13} /> Open record
                  </button>
                  {can('UPDATE', dept) && (
                    <button className="pop__item" onClick={() => { close(); setEditing(r); }}>
                      <Icon name="edit" size={13} /> Edit
                    </button>
                  )}
                  {can('DELETE', dept) && (
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

      {editing !== undefined && (
        <RecordForm
          dataset={dataset}
          record={editing}
          onClose={() => setEditing(undefined)}
          onSubmit={async values => {
            if (editing) await updateRow(dataset.id, String(editing.__id), values);
            else await createRow(dataset.id, values);
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
