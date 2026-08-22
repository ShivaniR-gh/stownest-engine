import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { AnalyticsProvider } from '@/lib/analytics/AnalyticsContext';
import { Skeleton } from '@/components/primitives';
import SignIn from '@/pages/SignIn';
import { Forbidden, NotFound } from '@/pages/Status';

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
          {/* Presentation runs outside the shell — no sidebar on a projector. */}
          <Route path="/presentation" element={<Presentation />} />

          <Route element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="/d/:deptId" element={<Department />} />
            <Route path="/d/:deptId/:datasetId/:recordId" element={<RecordDetail />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/reports" element={<Reports />} />
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
