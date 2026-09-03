import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useCollapsed } from './useTheme';

export function AppShell() {
  const { collapsed, toggle } = useCollapsed();
  return (
    <div className="shell" data-collapsed={collapsed}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="main"><Outlet /></div>
    </div>
  );
}
