import { NavLink } from 'react-router-dom';
import { activeDepartments } from '@/config/departments';
import { usePermission } from '@/lib/permissions/usePermission';
import { canManageDataSource, canManageDepartments } from '@/lib/permissions/policy';
import { Icon, Tooltip } from '@/components/primitives';

/** Navigation is derived from the department config and filtered by the
 *  principal's grants. A Sales Admin never sees a Finance link to be refused
 *  at — the absence is the permission model made visible. */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { can, hasDepartment, principal } = usePermission();

  const workspace = activeDepartments().filter(d => d.inWorkspace && hasDepartment(d.id));
  const showAdmin = can('MANAGE_USERS') || can('MANAGE_PERMISSIONS');
  // Department admins reach Data sources without holding any global admin action.
  const showSources = activeDepartments().some(d => canManageDataSource(principal, d.id))
    || canManageDepartments(principal);

  const Item = ({ to, icon, label, end }: { to: string; icon: string; label: string; end?: boolean }) => {
    const link = (
      <NavLink to={to} end={end} className="rail__item">
        <span className="rail__icon"><Icon name={icon} size={15} /></span>
        <span className="rail__label">{label}</span>
      </NavLink>
    );
    return collapsed ? <Tooltip label={label}>{link}</Tooltip> : link;
  };

  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="rail__mark" aria-hidden="true">SN</span>
        <span className="rail__word">STOWNEST</span>
      </div>

      <nav className="rail__nav" aria-label="Primary">
        <div className="rail__group">
          <Item to="/" icon="overview" label="Overview" end />
          <Item to="/presentation" icon="present" label="Presentation" />
        </div>

        {workspace.length > 0 && (
          <div className="rail__group">
            <div className="rail__grouphd eyebrow">Workspace</div>
            {workspace.map(d => (
              <Item key={d.id} to={`/d/${d.id}`} icon={d.icon} label={d.label} />
            ))}
          </div>
        )}

        <div className="rail__group">
          <div className="rail__grouphd eyebrow">Analytics</div>
          <Item to="/analytics" icon="chart" label="Business review" />
          <Item to="/reports" icon="report" label="Reports" />
        </div>

        {(showAdmin || showSources) && (
          <div className="rail__group">
            <div className="rail__grouphd eyebrow">Administration</div>
            {canManageDepartments(principal) && <Item to="/admin/departments" icon="box" label="Departments" />}
            {showSources && <Item to="/admin/data-sources" icon="layers" label="Data sources" />}
            {showAdmin && <Item to="/admin/users" icon="users" label="Users" />}
            {showAdmin && <Item to="/admin/permissions" icon="shield" label="Permissions" />}
            {showAdmin && <Item to="/admin/settings" icon="gear" label="Settings" />}
          </div>
        )}
      </nav>

      <div className="rail__foot">
        <button className="rail__item" onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <span className="rail__icon"><Icon name="panelLeft" size={15} /></span>
          <span className="rail__label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}
