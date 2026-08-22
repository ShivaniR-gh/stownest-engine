import { Navigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { DatasetPanel } from '@/components/data/DatasetPanel';
import { Icon } from '@/components/primitives';
import { getDataset } from '@/config/datasets';
import { usePermission } from '@/lib/permissions/usePermission';

export default function AdminUsers() {
  const { can } = usePermission();
  const dataset = getDataset('access_control');
  if (!can('MANAGE_USERS')) return <Navigate to="/forbidden" replace />;
  if (!dataset) return <Navigate to="/404" replace />;

  return (
    <>
      <TopBar title="Users" crumb={[{ label: 'Administration', to: '/admin/users' }]} />
      <div className="page">
        <section className="section">
          <SectionHeader title="Access list" note={`Sheet tab: ${dataset.sheetName}`} />
          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s3)', fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.7 }}>
              <Icon name="info" size={16} />
              <span>
                Anyone signing in with a Google account is checked against this tab. No row means no access,
                whatever their email domain. <b>Departments</b> is a comma-separated list of department ids
                and is ignored for super admins. <b>Extra grants</b> adds actions on top of the role default —
                for example giving a specific employee <code className="num">EXPORT</code> without promoting them.
                Setting status to <b>Suspended</b> revokes access on their next request without deleting the row.
              </span>
            </div>
          </div>
          <DatasetPanel dataset={dataset} />
        </section>
      </div>
    </>
  );
}
