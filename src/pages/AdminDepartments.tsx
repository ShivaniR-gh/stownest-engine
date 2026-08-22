import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Icon, Modal, Skeleton } from '@/components/primitives';
import { usePermission } from '@/lib/permissions/usePermission';
import { canManageDepartments } from '@/lib/permissions/policy';
import { hydrateDepartments } from '@/config/departments';
import {
  createDepartment, deleteDepartment, fetchDepartments, refreshDepartments,
  setDepartmentStatus, updateDepartment, type DepartmentRow,
} from '@/lib/data/config';

const ICONS = ['layers', 'trending', 'truck', 'box', 'checklist', 'radar', 'receipt', 'ledger', 'shield', 'users', 'chart', 'report'];

/**
 * Department management.
 *
 * A department is identity only — id, name, purpose, icon, status. It owns no
 * columns and no metrics: business data arrives through Data sources, and
 * access arrives through Users. Creating one here grants nobody anything.
 */
export default function AdminDepartments() {
  const { principal } = usePermission();
  const [rows, setRows] = useState<DepartmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DepartmentRow | null | undefined>(undefined);
  const [removing, setRemoving] = useState<DepartmentRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fresh = false) => {
    try {
      const r = fresh ? await refreshDepartments() : await fetchDepartments();
      setRows(r.departments);
      hydrateDepartments(r.departments);   // navigation updates without a reload
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load departments.');
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  };

  if (!canManageDepartments(principal)) return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar title="Departments" crumb={[{ label: 'Administration', to: '/admin/users' }]}
        actions={
          <>
            <Button size="sm" icon="refresh" disabled={busy} onClick={() => run(async () => {})}>Refresh</Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing(null)}>Add department</Button>
          </>
        } />

      <div className="page">
        {error && (
          <div style={{ marginBottom: 'var(--s4)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
            background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 'var(--fs-sm)' }}>{error}</div>
        )}

        <section className="section">
          <SectionHeader title="Departments"
            note="Identity only. Data comes from Data sources; access comes from Users." />

          {rows === null ? <Skeleton h={220} /> : !rows.length ? (
            <div className="card"><EmptyState icon="layers" title="No departments yet"
              body="Add one to make it available for data sources and access assignment." /></div>
          ) : (
            <div className="tbl__wrap">
              <div className="tbl__scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }} />
                      <th>Department</th>
                      <th style={{ width: 130 }}>ID</th>
                      <th>Purpose</th>
                      <th className="is-num" style={{ width: 110 }}>Datasets</th>
                      <th style={{ width: 110 }}>Status</th>
                      <th className="tbl__act" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(d => {
                      const active = (d.status ?? 'Active') === 'Active';
                      return (
                        <tr key={d.id} style={active ? undefined : { opacity: .55 }}>
                          <td><Icon name={d.icon} size={15} /></td>
                          <td className="is-key">{d.label}</td>
                          <td className="is-mono">{d.id}</td>
                          <td title={d.purpose}>{d.purpose}</td>
                          <td className="is-num">{d.datasetCount}</td>
                          <td><Badge tone={active ? 'pos' : 'idle'}>{active ? 'Active' : 'Inactive'}</Badge></td>
                          <td className="tbl__act">
                            <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <Button size="sm" iconOnly icon="edit" variant="ghost"
                                aria-label={`Edit ${d.label}`} onClick={() => setEditing(d)} />
                              <Button size="sm" variant="ghost" disabled={busy}
                                onClick={() => run(() => setDepartmentStatus(d.id, active ? 'Inactive' : 'Active'))}>
                                {active ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button size="sm" iconOnly icon="trash" variant="ghost"
                                aria-label={`Delete ${d.label}`} onClick={() => setRemoving(d)} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="section">
          <div className="card">
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s3)', fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.7 }}>
              <Icon name="shield" size={16} />
              <span>
                Creating a department grants no access to anything. Assign people to it on
                <b> Users</b>, and connect its Google Sheets on <b>Data sources</b>. Deactivating keeps existing
                datasets and access records intact — it only stops the department appearing for new configuration.
              </span>
            </div>
          </div>
        </section>
      </div>

      {editing !== undefined && (
        <DepartmentForm dept={editing} busy={busy}
          onClose={() => setEditing(undefined)}
          onSubmit={async values => {
            await run(() => editing ? updateDepartment({ ...values, id: editing.id }) : createDepartment(values));
            setEditing(undefined);
          }} />
      )}

      {removing && (
        <ConfirmDialog danger busy={busy}
          title={`Delete ${removing.label}?`}
          confirmLabel="Delete department"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => { await run(() => deleteDepartment(removing.id)); setRemoving(null); }}
          body={
            <>
              This removes the department from configuration. It is refused while any data source is still
              connected to it — {removing.datasetCount === 0
                ? 'none are connected right now.'
                : <>and <b>{removing.datasetCount}</b> {removing.datasetCount === 1 ? 'is' : 'are'}.</>}
              <br /><br />
              <b>Deactivating is usually the right choice.</b> It preserves datasets and access records for
              auditability while removing the department from everyday use.
            </>
          } />
      )}
    </>
  );
}

function DepartmentForm({ dept, busy, onClose, onSubmit }: {
  dept: DepartmentRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState(dept?.label ?? '');
  const [id, setId] = useState(dept?.id ?? '');
  const [purpose, setPurpose] = useState(dept?.purpose ?? '');
  const [icon, setIcon] = useState(dept?.icon ?? 'layers');
  const [touchedId, setTouchedId] = useState(Boolean(dept));

  const idValid = /^[a-z][a-z0-9_]{1,39}$/.test(id);

  return (
    <Modal title={dept ? `Edit ${dept.label}` : 'Add department'} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !label.trim() || !idValid}
            onClick={() => onSubmit({ label: label.trim(), id, purpose, icon })}>
            {busy ? 'Saving…' : dept ? 'Save changes' : 'Create department'}
          </Button>
        </>
      }>
      <div style={{ display: 'grid', gap: 'var(--s4)' }}>
        <Field label="Display name">
          <input className="field" value={label} autoFocus
            onChange={e => {
              setLabel(e.target.value);
              if (!touchedId) setId(e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
            }}
            placeholder="Facility" />
        </Field>

        <Field label="Department id"
          hint={dept ? 'The id cannot be changed once data sources reference it.'
            : 'Used in URLs and in the Departments column of the access sheet. Lowercase, no spaces.'}
          error={id && !idValid ? 'Start with a letter; lowercase letters, numbers and underscores only.' : undefined}>
          <input className="field num" value={id} disabled={Boolean(dept)}
            onChange={e => { setTouchedId(true); setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }}
            placeholder="facility" />
        </Field>

        <Field label="Purpose" hint="One line, shown under the department title.">
          <input className="field" value={purpose} onChange={e => setPurpose(e.target.value)}
            placeholder="Warehouse capacity and space management." />
        </Field>

        <Field label="Icon">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICONS.map(n => (
              <button key={n} className="btn btn--icon" aria-pressed={icon === n}
                aria-label={n} onClick={() => setIcon(n)}>
                <Icon name={n} size={15} />
              </button>
            ))}
          </div>
        </Field>
      </div>

      <p style={{ marginTop: 'var(--s5)', fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.7 }}>
        Saved to the <b>departments</b> tab of the control spreadsheet. The department appears immediately —
        no deployment. It grants no access on its own.
      </p>
    </Modal>
  );
}
