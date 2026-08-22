import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Principal } from '@/lib/permissions/policy';
import { dataSourceKind } from '@/lib/data/store';
import { getIdToken, initGoogle, signOutGoogle, hasClientId, storeIdToken } from './googleIdentity';
import { hydrateDatasets } from '@/config/datasets';
import { hydrateDepartments } from '@/config/departments';
import { fetchRegistry, fetchDepartments } from '@/lib/data/config';

interface AuthState {
  principal: Principal | null;
  status: 'loading' | 'signed_in' | 'signed_out' | 'denied' | 'error';
  error: string | null;
  signOut: () => void;
  /** Demo mode only — lets a reviewer inspect the UI as each role. */
  assumeDemoRole: (email: string) => void;
}

const Ctx = createContext<AuthState | null>(null);

const DEMO_PRINCIPALS: Record<string, Principal> = {
  'demo.super@stownest.com': { email: 'demo.super@stownest.com', name: 'Demo Super Admin', role: 'super_admin', departments: [], grants: [] },
  'demo.sales@stownest.com': { email: 'demo.sales@stownest.com', name: 'Demo Sales Admin', role: 'department_admin', departments: ['sales'], grants: [] },
  'demo.fin@stownest.com': { email: 'demo.fin@stownest.com', name: 'Demo Finance Admin', role: 'department_admin', departments: ['finance', 'collections'], grants: [] },
  'demo.ops@stownest.com': { email: 'demo.ops@stownest.com', name: 'Demo Ops Employee', role: 'employee', departments: ['operations', 'logistics', 'control_tower'], grants: ['EXPORT'] },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  /** Exchanges the Google ID token for a Principal resolved from the
   *  access_control sheet. The role is decided by the server, never the client. */
  const resolveSession = useCallback(async () => {
    const token = await getIdToken();
    if (!token) { setStatus('signed_out'); return; }
    try {
      const res = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? 'This account is not on the StowNest access list. Ask a super admin to add you.');
        setStatus('denied');
        return;
      }
      if (!res.ok) throw new Error('Session check failed');
      const body = await res.json();
      setPrincipal(body.principal as Principal);

      // Pull the live schema before rendering, so tables and forms are built
      // from connected sheets rather than the compiled seed defaults.
      try {
        // Departments first: navigation and permission scoping both read them.
        const [depts, reg] = await Promise.all([fetchDepartments(), fetchRegistry()]);
        hydrateDepartments(depts.departments);
        hydrateDatasets(reg.datasets);
      } catch {
        // Registry unavailable: fall back to seed defs rather than blocking sign-in.
      }
      setStatus('signed_in');
    } catch {
      setError('Could not verify your sign-in. Check your connection and try again.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (dataSourceKind === 'demo') {
      setPrincipal(DEMO_PRINCIPALS['demo.super@stownest.com']);
      setStatus('signed_in');
      return;
    }
    if (!hasClientId()) {
      setError('VITE_GOOGLE_CLIENT_ID is not configured for this deployment.');
      setStatus('error');
      return;
    }
    initGoogle(jwt => { storeIdToken(jwt); void resolveSession(); })
      .then(() => resolveSession())
      .catch(e => { setError(e.message); setStatus('error'); });
  }, [resolveSession]);

  const value = useMemo<AuthState>(() => ({
    principal, status, error,
    signOut: () => { signOutGoogle(); setPrincipal(null); setStatus('signed_out'); },
    assumeDemoRole: (email: string) => {
      if (dataSourceKind !== 'demo') return;
      setPrincipal(DEMO_PRINCIPALS[email] ?? null);
    },
  }), [principal, status, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

export { DEMO_PRINCIPALS };
