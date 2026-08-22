import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useCollapsed } from './useTheme';
import { dataSourceKind } from '@/lib/data/store';
import { Icon } from '@/components/primitives';

export function AppShell() {
  const { collapsed, toggle } = useCollapsed();
  return (
    <div className="shell" data-collapsed={collapsed}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="main">
        {dataSourceKind === 'demo' && (
          <div className="banner no-print" role="status">
            <Icon name="alert" size={13} />
            Demo data. These figures are generated samples, not StowNest records. Set
            <code style={{ margin: '0 4px' }}>VITE_DATA_SOURCE=sheets</code> to connect the live spreadsheet.
          </div>
        )}
        <Outlet />
      </div>
    </div>
  );
}
