import type { ReactNode } from 'react';
import type { Action, DepartmentId } from '@/config/types';
import { usePermission } from './usePermission';

/** Renders children only when the principal holds `action` on `department`.
 *  Nothing here is a security control — it removes affordances the user cannot
 *  act on. The serverless function re-checks the same policy. */
export function Gate({
  action, department, children, fallback = null,
}: {
  action: Action;
  department?: DepartmentId;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePermission();
  return <>{can(action, department) ? children : fallback}</>;
}
