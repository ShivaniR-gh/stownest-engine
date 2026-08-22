import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Icon, Modal, Skeleton } from '@/components/primitives';
import { usePermission } from '@/lib/permissions/usePermission';
import { canManageDataSource } from '@/lib/permissions/policy';
import { activeDepartments } from '@/config/departments';
import { hydrateDatasets } from '@/config/datasets';
import { relativeTime } from '@/lib/format';
import {
  disconnectSource, listSources, previewTab, refreshRegistry, saveSource, validateSheet,
  type PreviewColumn, type SourceRow,
} from '@/lib/data/config';
import type { DepartmentId } from '@/config/types';

const TYPES = ['text', 'longtext', 'id', 'number', 'currency', 'percent', 'date', 'enum', 'boolean', 'email', 'phone'];

/** Meaning, not format. Roles are what let the dashboard compute utilisation,
 *  margin or capacity generically instead of per department. */
const ROLES = ['', 'identifier', 'name', 'location', 'category', 'status', 'date',
  'quantity', 'capacity', 'occupied', 'amount', 'cost', 'revenue'];

/**
 * Data source management.
 *
 * A department admin pastes their sheet URL, StowNest confirms the service
 * account can read it, detects the headers, and the admin maps them. Nothing
 * about the connected sheet is compiled into the app — the mapping is written
 * to the control workbook and read back at runtime.
 */
export default function DataSources() {
  const { principal } = usePermission();
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [serviceAccount, setServiceAccount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ department: DepartmentId; existing?: SourceRow } | null>(null);
  const [removing, setRemoving] = useState<SourceRow | null>(null);
  const [busy, setBusy] = useState(false);

  const manageable = useMemo(
    () => activeDepartments().filter(d => canManageDataSource(principal, d.id)),
    [principal]);

  const load = useCallback(async () => {
    try {
      const r = await listSources();
      setSources(r.sources);
      setServiceAccount(r.serviceAccountEmail);
      setError(null);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load data sources.'); setSources([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setBusy(true);
    try { hydrateDatasets((await refreshRegistry()).datasets); await load(); }
    finally { setBusy(false); }
  };

  if (!manageable.length) return <Navigate to="/forbidden" replace />;

  const byDept = (id: string) => sources?.filter(s => s.department === id) ?? [];

  return (
    <>
      <TopBar title="Data sources" crumb={[{ label: 'Administration', to: '/admin/users' }]}
        actions={<Button size="sm" icon="refresh" disabled={busy} onClick={refresh}>Refresh</Button>} />

      <div className="page">
        {error && (
          <div style={{ marginBottom: 'var(--s4)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
            background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 'var(--fs-sm)' }}>{error}</div>
        )}

        <section className="section">
          <SectionHeader title="Connected spreadsheets"
            note="Google Sheets remains the source of truth. StowNest reads and writes the same file." />

          {sources === null ? (
            <div className="grid grid--2">{[0, 1].map(i => <Skeleton key={i} h={150} />)}</div>
          ) : (
            <div className="grid grid--2">
              {manageable.map(dept => {
                const rows = byDept(dept.id);
                return (
                  <div key={dept.id} className="card">
                    <header className="card__hd">
                      <span className="rail__icon"><Icon name={dept.icon} size={15} /></span>
                      <div>
                        <div className="card__title">{dept.label}</div>
                        <div className="card__sub">{rows.length
                          ? `${rows.length} dataset${rows.length > 1 ? 's' : ''} connected`
                          : 'No data source connected'}</div>
                      </div>
                      <div className="card__tools">
                        <Button size="sm" icon="plus" onClick={() => setWizard({ department: dept.id })}>
                          Connect sheet
                        </Button>
                      </div>
                    </header>

                    <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
                      {!rows.length ? (
                        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.7 }}>
                          Connect this department's Google Sheet to give the team a proper interface for it.
                          A department can hold several datasets — one per tab.
                        </p>
                      ) : rows.map(r => (
                        <div key={r.dataset_id} style={{
                          border: '1px solid var(--line-faint)', borderRadius: 'var(--r-md)', padding: 'var(--s3)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                            <b style={{ fontSize: 'var(--fs-sm)' }}>{r.label}</b>
                            <Badge tone={r.status === 'Connected' ? 'pos' : 'idle'}>{r.status}</Badge>
                            <span className="num" style={{ marginLeft: 'auto', fontSize: 'var(--fs-micro)', color: 'var(--ink-400)' }}>
                              {r.dataset_id}
                            </span>
                          </div>
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-600)', marginTop: 4, lineHeight: 1.7 }}>
                            Tab <b className="num">{r.tab_name}</b>
                            <br />Connected by {r.connected_by}
                            {r.connected_at && <> · {relativeTime(r.connected_at)}</>}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 'var(--s3)' }}>
                            <a className="btn btn--sm" target="_blank" rel="noreferrer"
                              href={`https://docs.google.com/spreadsheets/d/${r.spreadsheet_id}/edit`}>
                              <Icon name="external" size={13} /> Open sheet
                            </a>
                            <Button size="sm" icon="gear" onClick={() => setWizard({ department: dept.id, existing: r })}>
                              Reconnect
                            </Button>
                            <Button size="sm" variant="danger" iconOnly icon="trash"
                              aria-label="Disconnect" onClick={() => setRemoving(r)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="section">
          <div className="card">
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s3)', fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.7 }}>
              <Icon name="shield" size={16} />
              <span>
                StowNest reads your sheet through a server-side service account. Your browser never receives
                Google credentials and StowNest never asks for access to your Drive. Sharing the file with the
                service account is what grants access — revoke that share and the connection stops working.
              </span>
            </div>
          </div>
        </section>
      </div>

      {wizard && (
        <ConnectWizard department={wizard.department} existing={wizard.existing} serviceAccount={serviceAccount}
          onClose={() => setWizard(null)}
          onSaved={async () => { setWizard(null); await refresh(); }} />
      )}

      {removing && (
        <ConfirmDialog danger busy={busy}
          title="Disconnect this data source?"
          confirmLabel="Disconnect"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy(true);
            try { await disconnectSource(removing.dataset_id); setRemoving(null); await refresh(); }
            catch (e) { setError(e instanceof Error ? e.message : 'Could not disconnect.'); }
            finally { setBusy(false); }
          }}
          body={<>StowNest will stop showing <b>{removing.label}</b>. The Google Sheet itself is not touched —
            only the connection and its field mapping are removed.</>}
        />
      )}
    </>
  );
}

/* --------------------------- connection wizard ---------------------------- */
type Step = 'url' | 'tab' | 'map';

function ConnectWizard({ department, existing, serviceAccount, onClose, onSaved }: {
  department: DepartmentId; existing?: SourceRow; serviceAccount: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState(existing ? `https://docs.google.com/spreadsheets/d/${existing.spreadsheet_id}/edit` : '');
  const [sheet, setSheet] = useState<{ spreadsheetId: string; title: string; tabs: string[] } | null>(null);
  const [tab, setTab] = useState(existing?.tab_name ?? '');
  const [preview, setPreview] = useState<{ rows: string[][]; columns: PreviewColumn[]; rowsScanned: number } | null>(null);
  const [cols, setCols] = useState<PreviewColumn[]>([]);
  const [datasetId, setDatasetId] = useState(existing?.dataset_id ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [idColumn, setIdColumn] = useState(existing?.id_column ?? '');
  const [dateColumn, setDateColumn] = useState('');
  const [statusColumn, setStatusColumn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const doValidate = () => run(async () => {
    const r = await validateSheet(url);
    setSheet(r);
    if (!label) setLabel(r.title);
    setStep('tab');
  });

  const doPreview = (t: string) => run(async () => {
    const p = await previewTab(sheet!.spreadsheetId, t);
    setTab(t);
    setPreview(p);
    setCols(p.columns.map((c, i) => ({ ...c, editable: true, required: i === 0, filterable: c.type === 'enum', groupable: c.type === 'enum' })));
    setIdColumn(prev => p.columns.some(c => c.key === prev) ? prev : p.columns[0].key);
    if (!datasetId) setDatasetId(`${department}_${t}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const d = p.columns.find(c => c.type === 'date'); if (d) setDateColumn(d.key);
    const st = p.columns.find(c => c.type === 'enum'); if (st) setStatusColumn(st.key);
    setStep('map');
  });

  const doSave = () => run(async () => {
    await saveSource({
      datasetId, department, label: label || datasetId, noun: 'record',
      spreadsheetId: sheet!.spreadsheetId, tab,
      idColumn, dateColumn, statusColumn, titleColumn: idColumn,
      columns: cols,
    });
    onSaved();
  });

  const setCol = (i: number, patch: Partial<PreviewColumn>) =>
    setCols(cs => cs.map((c, n) => (n === i ? { ...c, ...patch } : c)));

  return (
    <Modal size="wide" title={existing ? 'Reconnect data source' : 'Connect Google Sheet'} onClose={onClose}
      footer={
        <>
          {step !== 'url' && <Button onClick={() => setStep(step === 'map' ? 'tab' : 'url')} disabled={busy}>Back</Button>}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          {step === 'url' && <Button variant="primary" onClick={doValidate} disabled={busy || !url.trim()}>
            {busy ? 'Checking…' : 'Validate'}
          </Button>}
          {step === 'map' && <Button variant="primary" onClick={doSave} disabled={busy || !datasetId || !idColumn}>
            {busy ? 'Saving…' : 'Save connection'}
          </Button>}
        </>
      }>

      <div className="chips" style={{ marginBottom: 'var(--s5)' }}>
        {(['url', 'tab', 'map'] as Step[]).map((s, i) => (
          <span key={s} className="chip" style={step === s ? undefined : { opacity: .45 }}>
            <b>{i + 1}</b> {s === 'url' ? 'Spreadsheet' : s === 'tab' ? 'Tab' : 'Fields'}
          </span>
        ))}
      </div>

      {err && (
        <div style={{ marginBottom: 'var(--s4)', padding: 'var(--s3)', borderRadius: 'var(--r-md)',
          background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>{err}</div>
      )}

      {step === 'url' && (
        <>
          <div style={{
            border: '1px solid var(--accent-line)', background: 'var(--accent-soft)',
            borderRadius: 'var(--r-md)', padding: 'var(--s4)', marginBottom: 'var(--s5)',
          }}>
            <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 6 }}>Step 1 — give StowNest access</div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-700)', lineHeight: 1.7, marginBottom: 'var(--s3)' }}>
              Open your sheet in Google, click <b>Share</b>, paste the address below, set it to <b>Editor</b>,
              and untick “Notify people”. This is what lets StowNest read and write your sheet — it cannot
              see anything you have not shared.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              <code className="num" style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
                padding: '7px 9px', fontSize: 'var(--fs-xs)',
              }}>{serviceAccount || 'loading…'}</code>
              <Button size="sm" icon={copied ? 'check' : 'columns'} disabled={!serviceAccount}
                onClick={() => {
                  void navigator.clipboard.writeText(serviceAccount);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="eyebrow" style={{ marginBottom: 6 }}>Step 2 — paste the link</div>
          <Field label="Google Sheet URL" hint="The link from your browser's address bar.">
            <input className="field" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…" />
          </Field>
        </>
      )}

      {step === 'tab' && sheet && (
        <>
          <p style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
            Connected to <b>{sheet.title}</b>. Choose the tab holding this dataset.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sheet.tabs.map(t => (
              <button key={t} className="pop__item" style={{ border: '1px solid var(--line)' }}
                disabled={busy} onClick={() => doPreview(t)}>
                <Icon name="layers" size={13} /> {t}
                <Icon name="chevronRight" size={13} style={{ marginLeft: 'auto' }} />
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'map' && preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
            <Field label="Dataset id" hint="Used in URLs. Lowercase, no spaces.">
              <input className="field" value={datasetId}
                onChange={e => setDatasetId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
            </Field>
            <Field label="Display name">
              <input className="field" value={label} onChange={e => setLabel(e.target.value)} />
            </Field>
            <Field label="Unique identifier column" hint="Used to find the right row on edit and delete.">
              <select className="field" value={idColumn} onChange={e => setIdColumn(e.target.value)}>
                {cols.map(c => <option key={c.key} value={c.key}>{c.header}</option>)}
              </select>
            </Field>
            <Field label="Date column" hint="Drives date filtering. Optional.">
              <select className="field" value={dateColumn} onChange={e => setDateColumn(e.target.value)}>
                <option value="">None</option>
                {cols.filter(c => c.type === 'date').map(c => <option key={c.key} value={c.key}>{c.header}</option>)}
              </select>
            </Field>
          </div>

          <SectionHeader title="Field mapping"
            note={`${preview.columns.length} columns detected · ${preview.rowsScanned} rows in tab`} />

          <div className="tbl__scroll" style={{ maxHeight: '38vh' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Sheet column</th><th>Shows as</th><th style={{ width: 108 }}>Type</th>
                  <th style={{ width: 128 }}>Means</th>
                  <th style={{ width: 70, textAlign: 'center' }}>Edit</th>
                  <th style={{ width: 70, textAlign: 'center' }}>Filter</th>
                  <th style={{ width: 70, textAlign: 'center' }}>Group</th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c, i) => (
                  <tr key={c.sheetColumn}>
                    <td className="is-mono">{c.sheetColumn}</td>
                    <td>
                      <input className="field" style={{ height: 26 }} value={c.header}
                        onChange={e => setCol(i, { header: e.target.value })} />
                    </td>
                    <td>
                      <select className="field" style={{ height: 26 }} value={c.type}
                        onChange={e => setCol(i, { type: e.target.value })}>
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="field" style={{ height: 26 }} value={c.role ?? ''}
                        onChange={e => setCol(i, { role: e.target.value })}>
                        {ROLES.map(r => <option key={r} value={r}>{r || '—'}</option>)}
                      </select>
                    </td>
                    {(['editable', 'filterable', 'groupable'] as const).map(f => (
                      <td key={f} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={Boolean(c[f])} style={{ accentColor: 'var(--accent)' }}
                          onChange={e => setCol(i, { [f]: e.target.checked })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 'var(--s3)', fontSize: 'var(--fs-xs)', color: 'var(--ink-400)', lineHeight: 1.7 }}>
            <b>Means</b> is what unlocks real analytics. Mark your capacity column as <code>capacity</code> and
            your filled column as <code>occupied</code>, and utilisation, available space and near-full
            warnings are computed automatically — for any department, from any sheet. Leave it blank and the
            column still appears in tables and forms, it just carries no business meaning.
          </p>

          <SectionHeader title="Preview" note="First rows as StowNest reads them" />
          <div className="tbl__scroll" style={{ maxHeight: 200 }}>
            <table className="tbl">
              <thead><tr>{cols.map(c => <th key={c.key}>{c.header}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>{r.map((v, n) => <td key={n}>{v}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

export { EmptyState };
