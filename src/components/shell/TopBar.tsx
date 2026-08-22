import { Link } from 'react-router-dom';
import { Button, Icon, Popover } from '@/components/primitives';
import { useAuth, DEMO_PRINCIPALS } from '@/lib/auth/AuthContext';
import { ROLE_LABEL } from '@/lib/permissions/policy';
import { dataSourceKind } from '@/lib/data/store';
import { useTheme } from './useTheme';

export function TopBar({ title, crumb, actions }: {
  title: string; crumb?: { label: string; to: string }[]; actions?: React.ReactNode;
}) {
  const { principal, signOut, assumeDemoRole } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className="topbar no-print">
      {crumb?.map(c => (
        <span key={c.to} className="topbar__crumb">
          <Link to={c.to}>{c.label}</Link>
          <span style={{ margin: '0 6px', color: 'var(--ink-300)' }}>/</span>
        </span>
      ))}
      <h1 className="topbar__title">{title}</h1>

      <div className="topbar__right">
        {actions}
        <Button size="sm" iconOnly variant="ghost" icon={theme === 'dark' ? 'overview' : 'layers'}
          aria-label="Toggle theme" onClick={toggle} />

        <Popover width={230} align="end" trigger={({ toggle: t, ref, open }) => (
          <Button size="sm" ref={ref} onClick={t} aria-expanded={open}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-soft)',
              color: 'var(--accent)', display: 'grid', placeItems: 'center',
              fontSize: 10, fontWeight: 700,
            }}>
              {(principal?.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <Icon name="chevronDown" size={12} />
          </Button>
        )}>
          {close => (
            <>
              <div className="pop__hd">
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{principal?.name}</div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-400)' }}>{principal?.email}</div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-micro)', color: 'var(--accent)', fontWeight: 600 }}>
                  {principal ? ROLE_LABEL[principal.role] : ''}
                </div>
              </div>

              {dataSourceKind === 'demo' && (
                <>
                  <div className="pop__hd eyebrow" style={{ borderBottom: 0 }}>View as role</div>
                  {Object.values(DEMO_PRINCIPALS).map(p => (
                    <button key={p.email} className="pop__item"
                      onClick={() => { assumeDemoRole(p.email); close(); }}>
                      {principal?.email === p.email ? <Icon name="check" size={12} /> : <span style={{ width: 12 }} />}
                      {p.name}
                    </button>
                  ))}
                  <div className="pop__sep" />
                </>
              )}

              <button className="pop__item pop__item--danger" onClick={signOut}>
                <Icon name="logout" size={13} /> Sign out
              </button>
            </>
          )}
        </Popover>
      </div>
    </header>
  );
}
