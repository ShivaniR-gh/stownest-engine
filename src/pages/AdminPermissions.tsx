import { Navigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Badge, Icon } from '@/components/primitives';
import { DEPARTMENTS_ALL } from '@/config/departments';
import { allDatasets } from '@/config/datasets';
import { ACTION_LABEL, ALL_ACTIONS, ROLE_LABEL, roleDefaults, effectiveActions } from '@/lib/permissions/policy';
import { usePermission } from '@/lib/permissions/usePermission';
import type { RoleId } from '@/config/types';

const ROLES: RoleId[] = ['super_admin', 'department_admin', 'employee'];

/**
 * The permission model, stated rather than hidden.
 *
 * This screen is read-only on purpose: role definitions live in
 * `lib/permissions/policy.ts`, which is imported by both the UI and the API, so
 * they cannot drift apart. Per-user departments and extra grants are edited on
 * the Users screen, which writes to the access_control tab.
 */
export default function AdminPermissions() {
  const { can, principal } = usePermission();
  if (!can('MANAGE_PERMISSIONS')) return <Navigate to="/forbidden" replace />;

  const mine = effectiveActions(principal);

  return (
    <>
      <TopBar title="Permissions" crumb={[{ label: 'Administration', to: '/admin/users' }]} />
      <div className="page">
        <section className="section">
          <SectionHeader title="What each role can do by default" />
          <div className="card">
            <div className="tbl__scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 240 }}>Action</th>
                    {ROLES.map(r => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ALL_ACTIONS.map(a => (
                    <tr key={a}>
                      <td className="is-key">
                        {ACTION_LABEL[a]}
                        <span className="num" style={{ color: 'var(--ink-300)', marginLeft: 8, fontSize: 11 }}>{a}</span>
                      </td>
                      {ROLES.map(r => (
                        <td key={r} style={{ textAlign: 'center' }}>
                          {roleDefaults(r).includes(a)
                            ? <Icon name="check" size={14} className="" />
                            : <span style={{ color: 'var(--ink-300)' }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 'var(--s4)' }}>
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s3)', fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.7 }}>
              <Icon name="shield" size={16} />
              <span>
                Deleting and exporting are withheld from employees by default and must be granted per person.
                Every non-global action is additionally scoped to a department, so a Sales admin holding{' '}
                <code className="num">DELETE</code> can still only delete sales records. The same{' '}
                <code className="num">can()</code> function runs in the browser and again inside the serverless
                function before any write reaches the spreadsheet — the interface hides what you cannot do,
                the server is what actually stops it.
              </span>
            </div>
          </div>
        </section>

        <section className="section">
          <SectionHeader title="Department scope" />
          <div className="grid grid--3">
            {DEPARTMENTS_ALL().map(d => (
              <div key={d.id} className="card">
                <div className="card__bd">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 6 }}>
                    <Icon name={d.icon} size={15} />
                    <b style={{ fontSize: 'var(--fs-sm)' }}>{d.label}</b>
                    <span className="num" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-300)' }}>{d.id}</span>
                  </div>
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-600)', lineHeight: 1.6 }}>{d.purpose}</p>
                  <div style={{ marginTop: 8, fontSize: 'var(--fs-micro)', color: 'var(--ink-400)' }}>
                    Datasets: <span className="num">
                      {allDatasets().filter(x => x.department === d.id).map(x => x.id).join(', ') || 'none connected'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <SectionHeader title="Your effective permissions" note={principal?.email} />
          <div className="card">
            <div className="card__bd" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ALL_ACTIONS.map(a => (
                <Badge key={a} tone={mine.includes(a) ? 'pos' : 'idle'}>{a}</Badge>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
