import type { DatasetDef } from '@/config/types';
import { getIdToken } from '@/lib/auth/googleIdentity';
import { DataError } from './adapter';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail: string | undefined;
    try { detail = (await res.json())?.error; } catch { /* non-JSON body */ }
    throw new DataError(detail ?? 'That request could not be completed.', res.status, detail);
  }
  return res.json() as Promise<T>;
}

export interface SourceRow {
  dataset_id: string; department: string; label: string; noun: string;
  spreadsheet_id: string; tab_name: string; id_column: string;
  status: string; connected_by: string; connected_at: string;
}

export interface PreviewColumn {
  sheetColumn: string; key: string; header: string; type: string;
  editable?: boolean; required?: boolean; filterable?: boolean; groupable?: boolean; hidden?: boolean;
}

export interface DepartmentRow {
  id: string; label: string; purpose: string; icon: string;
  status?: 'Active' | 'Inactive'; sortOrder?: number; datasetCount: number;
  metrics: string[]; inWorkspace: boolean;
}

export const fetchDepartments = () =>
  call<{ departments: DepartmentRow[]; canManage: boolean }>('/config/departments');
export const refreshDepartments = () =>
  call<{ departments: DepartmentRow[]; canManage: boolean }>('/config/departments?refresh=1');

const postDept = <T,>(payload: Record<string, unknown>) =>
  call<T>('/config/departments', { method: 'POST', body: JSON.stringify(payload) });

export const createDepartment = (d: Record<string, unknown>) => postDept<{ ok: true; id: string }>({ action: 'create', ...d });
export const updateDepartment = (d: Record<string, unknown>) => postDept<{ ok: true }>({ action: 'update', ...d });
export const setDepartmentStatus = (id: string, status: 'Active' | 'Inactive') =>
  postDept<{ ok: true }>({ action: 'setStatus', id, status });
export const deleteDepartment = (id: string) => postDept<{ ok: true }>({ action: 'delete', id });

export const fetchRegistry = () => call<{ datasets: DatasetDef[] }>('/config/datasets');
export const refreshRegistry = () => call<{ datasets: DatasetDef[] }>('/config/datasets?refresh=1');

export const listSources = () =>
  call<{
    sources: SourceRow[];
    serviceAccountEmail: string;
    manageableDepartments: { id: string; label: string }[];
  }>('/config/sources');

const post = <T,>(payload: Record<string, unknown>) =>
  call<T>('/config/sources', { method: 'POST', body: JSON.stringify(payload) });

export const validateSheet = (url: string) =>
  post<{ spreadsheetId: string; title: string; tabs: string[] }>({ action: 'validate', url });

export const previewTab = (spreadsheetId: string, tab: string) =>
  post<{ headers: string[]; rows: string[][]; columns: PreviewColumn[]; rowsScanned: number }>(
    { action: 'preview', spreadsheetId, tab });

export const saveSource = (payload: Record<string, unknown>) =>
  post<{ ok: true; datasetId: string }>({ action: 'save', ...payload });

export const disconnectSource = (datasetId: string) =>
  post<{ ok: true }>({ action: 'disconnect', datasetId });
