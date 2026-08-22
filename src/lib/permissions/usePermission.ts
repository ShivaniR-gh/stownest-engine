import { useCallback } from 'react';
import type { Action, DepartmentId } from '@/config/types';
import { can, hasDepartment, visibleDepartments } from './policy';
import { useAuth } from '@/lib/auth/AuthContext';

export function usePermission() {
  const { principal } = useAuth();
  return {
    principal,
    can: useCallback((a: Action, d?: DepartmentId) => can(principal, a, d), [principal]),
    hasDepartment: useCallback((d: DepartmentId) => hasDepartment(principal, d), [principal]),
    visibleDepartments: useCallback((all: DepartmentId[]) => visibleDepartments(principal, all), [principal]),
  };
}
