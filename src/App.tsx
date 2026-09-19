import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { AnalyticsProvider } from '@/lib/analytics/AnalyticsContext';
import { Skeleton } from '@/components/primitives';
import SignIn from '@/pages/SignIn';
import { Forbidden, NotFound } from '@/pages/Status';
import { usePermission } from '@/lib/permissions/usePermission';
import { activeDepartments } from '@/config/departments';

function SuperOnly({ children }: { children: ReactNode }) {
  const { principal, hasDepartment } = usePermission();
  if (principal?.role === 'super_admin') return <>{children}</>;
  const first = activeDepartments().find(d => d.inWorkspace && hasDepartment(d.id));
  return <Navigate to={first ? `/d/${first.id}` : '/forbidden'} replace />;
}


/* Route-level code splitting. The Overview is what most people open, so the
   heavier analytics and admin screens are not in its critical path. */
const Overview = lazy(() => import('@/pages/Overview'));
const Department = lazy(() => import('@/pages/Department'));
const RecordDetail = lazy(() => import('@/pages/RecordDetail'));
const Presentation = lazy(() => import('@/pages/Presentation'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Reports = lazy(() => import('@/pages/Reports'));
const AdminUsers = lazy(() => import('@/pages/AdminUsers'));
const AdminPermissions = lazy(() => import('@/pages/AdminPermissions'));
const AdminSettings = lazy(() => import('@/pages/AdminSettings'));
const DataSources = lazy(() => import('@/pages/DataSources'));
const AdminDepartments = lazy(() => import('@/pages/AdminDepartments'));

function PageFallback() {
  return (
    <div className="page">
      <Skeleton h={30} w={220} style={{ marginBottom: 24 }} />
      <div className="grid grid--kpi" style={{ marginBottom: 24 }}>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} h={104} />)}
      </div>
      <div className="grid grid--split">
        <Skeleton h={300} /><Skeleton h={300} />
      </div>
    </div>
  );
}

function Gatekeeper() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Skeleton h={12} w={160} />
      </div>
    );
  }
  if (status !== 'signed_in') return <SignIn />;

  return (
    <AnalyticsProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<SuperOnly><Overview /></SuperOnly>} />
            <Route path="/presentation" element={<SuperOnly><Presentation /></SuperOnly>} />
            <Route path="/d/:deptId" element={<Department />} />
            <Route path="/d/:deptId/:datasetId/:recordId" element={<RecordDetail />} />
            <Route path="/analytics" element={<SuperOnly><Analytics /></SuperOnly>} />
            <Route path="/reports" element={<SuperOnly><Reports /></SuperOnly>} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/permissions" element={<AdminPermissions />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/data-sources" element={<DataSources />} />
            <Route path="/admin/departments" element={<AdminDepartments />} />
            <Route path="/forbidden" element={<Forbidden />} />
            <Route path="/404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AnalyticsProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gatekeeper />
      </AuthProvider>
    </BrowserRouter>
  );
}
