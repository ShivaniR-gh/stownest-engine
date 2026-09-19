import { useState, type ReactNode } from 'react';
import { Button, Icon, Modal, Tooltip, EmptyState } from '@/components/primitives';
import { Gate } from '@/lib/permissions/Gate';
import type { DepartmentId } from '@/config/types';

export interface ChartType { id: string; label: string; icon: string }

/** Shared chrome for every visualisation: title, the question it answers,
 *  optional chart-type switch, full-screen and export. */
export function ChartFrame({
  title, question, department, children, types, activeType, onType,
  onExport, isEmpty, emptyBody, footer, height = 240, actions,
}: {
  title: string;
  /** The business question this chart exists to answer. Shown under the title —
   *  if a chart can't be given one, it shouldn't be on the page. */
  question: string;
  department?: DepartmentId;
  children: (h: number) => ReactNode;
  types?: ChartType[];
  activeType?: string;
  onType?: (id: string) => void;
  onExport?: () => void;
  isEmpty?: boolean;
  emptyBody?: string;
  footer?: ReactNode;
  height?: number;
  actions?: ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(1);

  const body = (h: number) =>
    isEmpty
      ? <EmptyState icon="chart" title="Nothing to plot"
          body={emptyBody ?? 'No records match the current period and filters.'} />
      : children(h);

  return (
    <>
      <section className="card">
        <header className="card__hd">
          <div style={{ minWidth: 0 }}>
            <div className="card__title">{title}</div>
            <div className="card__sub">{question}</div>
          </div>
          <div className="card__tools no-print">
            {actions}
            {types && types.length > 1 && types.map(t => (
              <Tooltip key={t.id} label={t.label}>
                <Button size="sm" iconOnly icon={t.icon} variant="ghost"
                  aria-pressed={activeType === t.id} aria-label={t.label}
                  onClick={() => onType?.(t.id)} />
              </Tooltip>
            ))}
            {onExport && (
              <Gate action="EXPORT" department={department}>
                <Tooltip label="Download this chart's data as CSV">
                  <Button size="sm" iconOnly icon="download" variant="ghost" aria-label="Export chart data" onClick={onExport} />
                </Tooltip>
              </Gate>
            )}
            <Tooltip label="Full screen">
              <Button size="sm" iconOnly icon="expand" variant="ghost" aria-label="Full screen" onClick={() => setFull(true)} />
            </Tooltip>
          </div>
        </header>
        <div className="card__bd">
          {body(height)}
          {footer}
        </div>
      </section>

      {full && (
        <Modal title={title} size="full" onClose={() => { setFull(false); setZoom(1); }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 'var(--s4)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-600)' }}>{question}</div>
            <div className="card__tools">
              <button className="btn" type="button" onClick={() => setZoom(z => Math.max(0.7, +(z - 0.15).toFixed(2)))}>− Zoom</button>
              <span className="pageno">{Math.round(zoom * 100)}%</span>
              <button className="btn" type="button" onClick={() => setZoom(z => Math.min(1.6, +(z + 0.15).toFixed(2)))}>+ Zoom</button>
            </div>
          </div>
          {body(Math.round(320 * zoom))}
          {footer}
        </Modal>
      )}
    </>
  );
}

export function ChartLegend({ series, hidden, onToggle }: {
  series: { id: string; label: string; color: string; total?: string }[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map(s => (
        <button key={s.id} className="legend__item" data-off={hidden.has(s.id)}
          onClick={() => onToggle(s.id)}
          aria-pressed={!hidden.has(s.id)}
          title={hidden.has(s.id) ? `Show ${s.label}` : `Hide ${s.label}`}>
          <span className="legend__swatch" style={{ background: s.color }} />
          {s.label}
          {s.total && <span className="legend__val">{s.total}</span>}
        </button>
      ))}
    </div>
  );
}

export { Icon };
