import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getDataset } from '@/config/datasets';
import { TopBar } from '@/components/shell/TopBar';
import { Badge, Button, ConfirmDialog, EmptyState, Icon, Skeleton } from '@/components/primitives';
import { RecordForm } from '@/components/data/RecordForm';
import { useDataset } from '@/lib/data/useDataset';
import { deleteRow, updateRow } from '@/lib/data/store';
import { usePermission } from '@/lib/permissions/usePermission';
import { Gate } from '@/lib/permissions/Gate';
import { formatCell, isNumericType } from '@/lib/format';
import { exportRows } from '@/lib/export';

/**
 * A record is a page, not a row in an editable grid. Fields are grouped, the
 * status is a badge rather than raw text, and unmapped columns are shown as
 * unmapped rather than as blanks that look like missing data.
 */
export default function RecordDetail() {
  const { deptId, datasetId, recordId } = useParams<{ deptId: string; datasetId: string; recordId: string }>();
  const nav = useNavigate();
  const dataset = getDataset(datasetId ?? '');
  const { rows, status, error } = useDataset(dataset ? dataset.id : null);
  const { can } = usePermission();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const record = useMemo(
    () => rows.find(r => String(r.__id) === decodeURIComponent(recordId ?? '')),
    [rows, recordId]);

  if (!dataset) return <Navigate to="/404" replace />;

  const dept = dataset.department;
  const mapped = dataset.columns.filter(c => c.sheetColumn);
  const unmapped = dataset.columns.filter(c => !c.sheetColumn);

  const title = record ? String(record[dataset.titleColumn] ?? record.__id) : '';
  const statusCol = dataset.columns.find(c => c.key === dataset.statusColumn);
  const statusVal = record && dataset.statusColumn ? String(record[dataset.statusColumn] ?? '') : '';

  return (
    <>
      <TopBar
        title={title || dataset.noun}
        crumb={[
          { label: dataset.label, to: `/d/${deptId}` },
        ]}
        actions={
          record ? (
            <>
              <Gate action="EXPORT" department={dept}>
                <Button size="sm" icon="download" onClick={() => exportRows(`${dataset.id}-${record.__id}`, [record], mapped)}>
                  Export
                </Button>
              </Gate>
              <Gate action="UPDATE" department={dept}>
                <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>
              </Gate>
              {can('DELETE', dept) && (
                <Button size="sm" variant="danger" iconOnly icon="trash" aria-label="Delete record"
                  onClick={() => setConfirming(true)} />
              )}
            </>
          ) : undefined
        }
      />

      <div className="page">
        <Button size="sm" variant="ghost" icon="chevronLeft" onClick={() => nav(-1)}
          style={{ marginBottom: 'var(--s4)' }}>Back</Button>

        {status === 'loading' && !record ? (
          <div className="card"><div className="card__bd">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={22} style={{ marginBottom: 10 }} />)}
          </div></div>
        ) : !record ? (
          <div className="card"><EmptyState icon="alert" title="Record not found"
            body={error?.message ?? `No ${dataset.noun} with this id exists in the ${dataset.sheetName} tab. It may have been deleted.`}
            action={<Button size="sm" onClick={() => nav(`/d/${deptId}`)}>Back to {dataset.label}</Button>} /></div>
        ) : (
          <>
            <header style={{ marginBottom: 'var(--s6)', display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
              <div>
                <div className="eyebrow">{dataset.noun}</div>
                <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: '-.015em' }}>{title}</h2>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-400)', marginTop: 2 }} className="num">
                  {(dataset.subtitleColumns ?? []).map(k => record[k]).filter(Boolean).join(' · ')}
                </div>
              </div>
              {statusVal && statusCol && (
                <div style={{ marginLeft: 'auto' }}>
                  <Badge tone={statusCol.tone?.[statusVal] ?? 'idle'}>{statusVal}</Badge>
                </div>
              )}
            </header>

            <div className="grid grid--2">
              <section className="card">
                <header className="card__hd"><div className="card__title">Details</div></header>
                <div className="card__bd" style={{ display: 'grid', gap: 0 }}>
                  {mapped.map(c => (
                    <div key={c.key} style={{
                      display: 'grid', gridTemplateColumns: '150px 1fr', gap: 'var(--s3)',
                      padding: '9px 0', borderBottom: '1px solid var(--line-faint)',
                    }}>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)' }}>{c.header}</span>
                      <span className={isNumericType(c.type) || c.type === 'date' || c.type === 'id' ? 'num' : undefined}
                        style={{ fontSize: 'var(--fs-sm)', wordBreak: 'break-word' }}>
                        {c.type === 'enum' && c.tone && record[c.key]
                          ? <Badge tone={c.tone[String(record[c.key])] ?? 'idle'}>{String(record[c.key])}</Badge>
                          : formatCell(record[c.key], c.type) || <span style={{ color: 'var(--ink-300)' }}>—</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card" style={{ alignSelf: 'start' }}>
                <header className="card__hd"><div className="card__title">Source</div></header>
                <div className="card__bd" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.7 }}>
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <span style={{ color: 'var(--ink-400)', minWidth: 70 }}>Sheet tab</span>
                    <b className="num">{dataset.sheetName}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <span style={{ color: 'var(--ink-400)', minWidth: 70 }}>Row</span>
                    <b className="num">{String(record.__row ?? '—')}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <span style={{ color: 'var(--ink-400)', minWidth: 70 }}>Key</span>
                    <b className="num">{String(record.__id)}</b>
                  </div>

                  {unmapped.length > 0 && (
                    <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--line-faint)' }}>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>Not mapped</div>
                      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', marginBottom: 6 }}>
                        These fields are defined in the platform but have no matching column in the sheet, so they
                        hold no value and are excluded from every metric.
                      </p>
                      {unmapped.map(c => (
                        <div key={c.key} style={{ fontSize: 'var(--fs-micro)', fontFamily: 'var(--font-num)', color: 'var(--signal)' }}>
                          {dataset.id}.{c.key}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>

      {editing && record && (
        <RecordForm dataset={dataset} record={record} onClose={() => setEditing(false)}
          onSubmit={async values => { await updateRow(dataset.id, String(record.__id), values); }} />
      )}

      {confirming && record && (
        <ConfirmDialog danger busy={busy}
          title={`Delete this ${dataset.noun}?`} confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setBusy(true);
            try { await deleteRow(dataset.id, String(record.__id)); nav(`/d/${deptId}`); }
            finally { setBusy(false); }
          }}
          body={<>Row <b>{title}</b> will be removed from the <b>{dataset.sheetName}</b> tab. This edits the
            spreadsheet directly and cannot be undone from here.</>}
        />
      )}
    </>
  );
}

export { Icon };
