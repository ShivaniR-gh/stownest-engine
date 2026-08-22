import { useState } from 'react';
import { Icon, Tooltip } from '@/components/primitives';
import { Sparkline } from '@/components/charts/Sparkline';
import type { ResolvedMetric } from '@/lib/analytics/resolveMetric';

/**
 * The metric card.
 *
 * Three states, and only one of them shows a number:
 *   ok         — value, delta vs previous period, optional sparkline
 *   unmapped   — "Data unavailable", naming the exact column that is missing
 *   no data    — "No records" / "Insufficient data"
 *
 * The `ƒ` button flips the card to the provenance panel: the literal formula,
 * the sheet tabs read, and the plain-English definition. Anyone questioning a
 * number in a management review can check it in one click without leaving the
 * screen or asking an engineer.
 */
/** Icon chosen from what the metric IS, so it stays correct for any dataset. */
function iconFor(m: ResolvedMetric): string {
  if (m.status !== 'ok') return 'info';
  switch (m.def.format) {
    case 'inr': case 'inr_compact': return 'ledger';
    case 'pct': case 'pp': return 'chart';
    case 'days': return 'clock';
    default: return 'layers';
  }
}

/** Tone derives from the metric's own state — never picked for decoration. */
function toneFor(m: ResolvedMetric): 'pos' | 'neg' | 'signal' | 'void' | 'none' {
  if (m.status === 'unmapped') return 'signal';
  if (m.status !== 'ok') return 'void';
  if (m.deltaTone === 'pos') return 'pos';
  if (m.deltaTone === 'neg') return 'neg';
  return 'none';
}

export function MetricCard({
  m, spark, onDrill, compare = true, size = 'md', lead = false,
}: {
  m: ResolvedMetric;
  spark?: number[];
  onDrill?: () => void;
  compare?: boolean;
  size?: 'md' | 'lg';
  /** Emphasised treatment for the first metric in a row. */
  lead?: boolean;
}) {
  const [showProv, setShowProv] = useState(false);
  const clickable = Boolean(onDrill) && m.status === 'ok' && Boolean(m.def.drillTo);
  const tone = toneFor(m);

  // A percentage is the one case where a progress track means something.
  const pct = m.status === 'ok' && (m.def.format === 'pct') && m.value !== null
    ? Math.max(0, Math.min(100, m.value)) : null;

  return (
    <div className={`metric${clickable ? ' metric--clickable' : ''}${lead ? ' metric--lead' : ''}`}
      data-tone={tone === 'none' ? undefined : tone}
      onClick={clickable && !showProv ? onDrill : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={e => { if (e.key === 'Enter' && clickable) onDrill?.(); }}>

      <div className="metric__hd">
        <span className="metric__icon"><Icon name={iconFor(m)} size={14} /></span>
        <span className="metric__label" title={m.def.label}>{m.def.label}</span>
        {m.def.unit && <span className="eyebrow" style={{ fontSize: 9.5 }}>{m.def.unit}</span>}
        <button className="metric__fx" aria-expanded={showProv}
          aria-label={`How ${m.def.label} is calculated`}
          onClick={e => { e.stopPropagation(); setShowProv(v => !v); }}>ƒ</button>
      </div>

      {m.status === 'ok' ? (
        <>
          <div className="metric__value" style={size === 'lg' ? { fontSize: 'var(--fs-3xl)' } : undefined}>
            {m.display}
          </div>
          {spark && spark.length > 1 && (
            <Sparkline values={spark}
              tone={m.deltaTone === 'neg' ? 'var(--neg)' : m.deltaTone === 'pos' ? 'var(--pos)' : 'var(--ink-400)'} />
          )}
          {pct !== null && (
            <span className="metric__track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
          )}
          <div className="metric__ft">
            {compare && m.delta !== null ? (
              <>
                <span className={`delta delta--${m.deltaTone}`}>
                  <Icon name={m.delta >= 0 ? 'arrowUp' : 'arrowDown'} size={11} strokeWidth={2.2} />
                  {Math.abs(m.delta).toFixed(1)}%
                </span>
                <span className="metric__cmp">vs previous period</span>
              </>
            ) : (
              <span className="metric__cmp">
                {compare ? 'No comparable prior period' : m.def.format === 'pct' ? 'Current period' : ''}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="metric__void">
          <div className="metric__value metric__value--void">{m.display}</div>
          <div className="metric__voidnote">
            {m.status === 'no_access' ? m.reason
              : m.status === 'unmapped' ? (
              <>Needs {m.missing.map((c, i) => (
                <span key={c}>{i > 0 && ', '}<code>{c}</code></span>
              ))} — map {m.missing.length === 1 ? 'it' : 'them'} in Settings.</>
            ) : m.reason}
          </div>
        </div>
      )}

      {showProv && (
        <div className="prov" onClick={e => e.stopPropagation()}>
          <div className="prov__hd">
            <span className="eyebrow">How this is calculated</span>
            <button className="metric__fx" style={{ opacity: 1, marginLeft: 'auto' }}
              onClick={() => setShowProv(false)} aria-label="Close">
              <Icon name="close" size={12} />
            </button>
          </div>
          <div className="prov__formula">{m.def.formula}</div>
          <div className="prov__row">
            <span className="prov__k">Source</span>
            <span className="prov__v">{m.sources.join(' · ')}</span>
          </div>
          <div className="prov__row">
            <span className="prov__k">Columns</span>
            <span className="prov__v">{m.def.requires.join(', ')}</span>
          </div>
          <div className="prov__row">
            <span className="prov__k">Means</span>
            <span className="prov__v" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-micro)' }}>
              {m.def.definition}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** KPI row. Any metric that cannot compute still occupies its slot — hiding it
 *  would quietly change what management thinks they are looking at. */
export function MetricGrid({ metrics, sparks, onDrill, compare, size, emphasiseFirst = true }: {
  metrics: ResolvedMetric[];
  sparks?: Record<string, number[]>;
  onDrill?: (m: ResolvedMetric) => void;
  compare?: boolean;
  size?: 'md' | 'lg';
  /** The first computable metric leads the row. Purely visual weighting. */
  emphasiseFirst?: boolean;
}) {
  const leadId = emphasiseFirst ? metrics.find(m => m.status === 'ok')?.def.id : undefined;
  return (
    <div className="grid grid--kpi">
      {metrics.map(m => (
        <MetricCard key={m.def.id} m={m} spark={sparks?.[m.def.id]} compare={compare} size={size}
          lead={m.def.id === leadId}
          onDrill={onDrill ? () => onDrill(m) : undefined} />
      ))}
    </div>
  );
}

export function SectionHeader({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <header className="section__hd">
      <h2 className="section__title">{title}</h2>
      {note && <span className="section__note">{note}</span>}
      {action && <span style={{ marginLeft: note ? 'var(--s3)' : 'auto' }}>{action}</span>}
    </header>
  );
}

export { Tooltip };
