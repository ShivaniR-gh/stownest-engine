import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Row } from '@/config/types';
import { formatCompactNum } from '@/lib/format';

interface Cell { rowKey: string; colKey: string; value: number; rows: Row[] }

/** Two-dimensional density. Uses a single-hue ramp — a red-to-green ramp would
 *  imply good/bad on data where high is not automatically good. */
export function Heatmap({
  rowKeys, colKeys, cells, valueFormat = formatCompactNum, onCellClick, rowLabel, colLabel,
}: {
  rowKeys: string[];
  colKeys: string[];
  cells: Cell[][];
  valueFormat?: (n: number) => string;
  onCellClick?: (c: Cell) => void;
  rowLabel?: string;
  colLabel?: string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; c: Cell } | null>(null);
  const flat = cells.flat();
  const max = Math.max(1, ...flat.map(c => c.value));

  const shade = (v: number) => {
    if (v === 0) return { bg: 'var(--surface-sunk)', fg: 'var(--ink-300)' };
    const t = Math.sqrt(v / max); // sqrt so mid-range values stay distinguishable
    return { bg: `color-mix(in srgb, var(--c1) ${Math.round(t * 88)}%, var(--surface))`,
      fg: t > 0.55 ? '#fff' : 'var(--ink-700)' };
  };

  return (
    <div className="heat">
      <table className="heat__t">
        <thead>
          <tr>
            <th className="is-row">{rowLabel ?? ''}</th>
            {colKeys.map(c => <th key={c}>{c.length > 9 ? `${c.slice(0, 8)}…` : c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((rk, ri) => (
            <tr key={rk}>
              <th className="is-row">{rk.length > 18 ? `${rk.slice(0, 17)}…` : rk}</th>
              {cells[ri].map(c => {
                const s = shade(c.value);
                return (
                  <td key={c.colKey}>
                    <div className="heat__c" style={{ background: s.bg, color: s.fg, lineHeight: '26px' }}
                      onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, c })}
                      onMouseLeave={() => setTip(null)}
                      onClick={() => onCellClick?.(c)}>
                      {c.value ? valueFormat(c.value) : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heat__scale">
        <span>Low</span>
        <span className="heat__ramp">
          {[0.12, 0.3, 0.48, 0.66, 0.84, 1].map(t => (
            <i key={t} style={{ background: `color-mix(in srgb, var(--c1) ${Math.round(t * 88)}%, var(--surface))` }} />
          ))}
        </span>
        <span>{valueFormat(max)}</span>
        {colLabel && <span style={{ marginLeft: 'auto' }}>{colLabel}</span>}
      </div>
      {tip && createPortal(
        <div className="tip ctip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 200), top: tip.y + 12 }}>
          <div className="ctip__hd">{tip.c.rowKey} · {tip.c.colKey}</div>
          <div className="ctip__row">Value<span className="ctip__v">{valueFormat(tip.c.value)}</span></div>
          <div className="ctip__row">Records<span className="ctip__v">{tip.c.rows.length}</span></div>
        </div>, document.body)}
    </div>
  );
}
