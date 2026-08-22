import { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { TopBar } from '@/components/shell/TopBar';
import { SectionHeader } from '@/components/metrics/MetricCard';
import { Badge, Button, Icon } from '@/components/primitives';
import { allDatasets } from '@/config/datasets';
import { METRICS } from '@/config/metrics';
import { DEPT_BY_ID } from '@/config/departments';
import { usePermission } from '@/lib/permissions/usePermission';
import { dataSourceKind, getEntry, refreshAll, STALE_MS } from '@/lib/data/store';
import { formatInt, relativeTime } from '@/lib/format';

/**
 * Sheet mapping health.
 *
 * The one screen that answers "why does that KPI say Data unavailable?" without
 * anyone reading source. Every unmapped column is listed with the metrics it
 * blocks, so the fix is a named edit to `config/datasets.ts`, not an
 * investigation.
 */
export default function AdminSettings() {
  const { can } = usePermission();

  const audit = useMemo(() => allDatasets().map(ds => {
    const mapped = ds.columns.filter(c => c.sheetColumn);
    const unmapped = ds.columns.filter(c => !c.sheetColumn);
    const blocked = METRICS.filter(m =>
      (m.dataset === ds.id || m.requiresDatasets?.includes(ds.id)) &&
      m.requires.some(r => unmapped.some(u => u.key === r)));
    return { ds, mapped, unmapped, blocked, entry: getEntry(ds.id) };
  }), []);

  const totalUnmapped = audit.reduce((a, x) => a + x.unmapped.length, 0);

  /** Uses the metric's own declared requirements — including columns it needs
   *  from other datasets — so this list can never drift from what the cards
   *  actually render. */
  const blockedMetrics = useMemo(() => METRICS.map(m => {
    const missing = [
      ...m.requires
        .filter(r => !allDatasets().find(d => d.id === m.dataset)?.columns.find(c => c.key === r)?.sheetColumn)
        .map(r => `${m.dataset}.${r}`),
      ...Object.entries(m.requiresFrom ?? {}).flatMap(([dsId, cols]) =>
        cols.filter(c => !allDatasets().find(d => d.id === dsId)?.columns.find(x => x.key === c)?.sheetColumn)
          .map(c => `${dsId}.${c}`)),
    ];
    return { m, missing };
  }).filter(x => x.missing.length), []);

  if (!can('MANAGE_PERMISSIONS') && !can('MANAGE_USERS')) return <Navigate to="/forbidden" replace />;

  return (
    <>
      <TopBar title="Settings" crumb={[{ label: 'Administration', to: '/admin/users' }]}
        actions={<Button size="sm" icon="refresh" onClick={() => void refreshAll()}>Re-read all sheets</Button>} />

      <div className="page">
        <section className="section">
          <SectionHeader title="Connection" />
          <div className="card">
            <div className="card__bd" style={{ display: 'flex', gap: 'var(--s7)', flexWrap: 'wrap', fontSize: 'var(--fs-sm)' }}>
              <span>
                <div className="eyebrow">Data source</div>
                {dataSourceKind === 'demo'
                  ? <Badge tone="signal">Demo data</Badge>
                  : <Badge tone="pos">Google Sheets</Badge>}
              </span>
              <span>
                <div className="eyebrow">Datasets configured</div>
                <b className="num">{allDatasets().length}</b>
              </span>
              <span>
                <div className="eyebrow">Metrics defined</div>
                <b className="num">{METRICS.length}</b>
              </span>
              <span>
                <div className="eyebrow">Unmapped columns</div>
                {totalUnmapped
                  ? <Badge tone="signal">{formatInt(totalUnmapped)}</Badge>
                  : <Badge tone="pos">All mapped</Badge>}
              </span>
              <span>
                <div className="eyebrow">Considered stale after</div>
                <b className="num">{Math.round(STALE_MS / 60000)} min</b>
              </span>
            </div>
          </div>
        </section>

        {blockedMetrics.length > 0 && (
          <section className="section">
            <SectionHeader title="Metrics that cannot compute"
              note={`${blockedMetrics.length} of ${METRICS.length}`} />
            <div className="card">
              <div className="card__bd">
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', marginBottom: 'var(--s4)', lineHeight: 1.7 }}>
                  These render as <b>Data unavailable</b> rather than as a zero. Map the column named beside each one
                  in <code className="num">src/config/datasets.ts</code> and the metric starts working with no other change.
                </p>
                {blockedMetrics.map(({ m, missing }) => (
                  <div key={m.id} style={{
                    display: 'grid', gridTemplateColumns: '200px 1fr', gap: 'var(--s3)',
                    padding: '9px 0', borderBottom: '1px solid var(--line-faint)', fontSize: 'var(--fs-sm)',
                  }}>
                    <span>
                      <b>{m.label}</b>
                      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-400)' }}>
                        {m.department === 'business' ? 'Company' : DEPT_BY_ID[m.department]?.label}
                      </div>
                    </span>
                    <span style={{ fontSize: 'var(--fs-micro)', lineHeight: 1.7 }}>
                      <span className="num" style={{ color: 'var(--ink-600)' }}>{m.formula}</span>
                      <div className="num" style={{ color: 'var(--signal)', marginTop: 3 }}>
                        missing {missing.join(', ')}
                      </div>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="section">
          <SectionHeader title="Sheet mapping" note="One row per dataset tab" />
          <div className="grid grid--2">
            {audit.map(({ ds, mapped, unmapped, blocked, entry }) => (
              <div key={ds.id} className="card">
                <header className="card__hd">
                  <div>
                    <div className="card__title">{ds.label}</div>
                    <div className="card__sub">
                      {DEPT_BY_ID[ds.department].label} · tab <b className="num">{ds.sheetName}</b>
                    </div>
                  </div>
                  <div className="card__tools">
                    {unmapped.length
                      ? <Badge tone="signal">{unmapped.length} unmapped</Badge>
                      : <Badge tone="pos">Complete</Badge>}
                  </div>
                </header>
                <div className="card__bd" style={{ fontSize: 'var(--fs-xs)' }}>
                  <div style={{ display: 'flex', gap: 'var(--s5)', marginBottom: 'var(--s3)', color: 'var(--ink-600)' }}>
                    <span>Columns <b className="num">{mapped.length}</b>/{ds.columns.length}</span>
                    <span>Rows cached <b className="num">{formatInt(entry.rows.length)}</b></span>
                    <span>
                      {entry.fetchedAt ? `Read ${relativeTime(entry.fetchedAt)}` : 'Not read yet'}
                    </span>
                  </div>

                  {unmapped.length > 0 && (
                    <div style={{
                      padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-md)',
                      background: 'var(--signal-soft)', color: 'var(--signal)', lineHeight: 1.7,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Icon name="alert" size={12} />
                        <b>Needs a sheetColumn</b>
                      </div>
                      {unmapped.map(c => (
                        <div key={c.key} className="num" style={{ fontSize: 11 }}>
                          {ds.id}.{c.key} — expects header “{c.header}”
                        </div>
                      ))}
                      {blocked.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 11, opacity: .9 }}>
                          Blocks: {blocked.map(b => b.label).join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <SectionHeader title="How to change a mapping" />
          <div className="card">
            <div className="card__bd" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)', lineHeight: 1.8 }}>
              Column mapping lives in one file, <code className="num">src/config/datasets.ts</code>. Each column carries a
              <code className="num"> sheetColumn</code> holding the exact header text in the tab. If someone renames a
              header in Sheets, change that one string — nothing else in the platform refers to sheet headers.
              A column with no <code className="num">sheetColumn</code> is treated as absent: it is hidden from tables and
              forms, and any metric requiring it reports itself unavailable rather than defaulting to zero.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
