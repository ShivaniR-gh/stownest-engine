import type { Row } from '@/config/types';
import { formatInt, formatPct } from '@/lib/format';
import { seriesColor } from './util';

export interface Stage { key: string; label: string; value: number; rows: Row[] }

/**
 * Operational pipeline / conversion funnel.
 *
 * Each bar is scaled against the FIRST stage, so the visual width is the real
 * survival rate — not a cosmetic taper. Drop-off between consecutive stages is
 * called out in amber because that is the number worth acting on.
 */
export function Pipeline({
  stages, onStageClick, valueFormat = formatInt, showDrop = true,
}: {
  stages: Stage[];
  onStageClick?: (s: Stage) => void;
  valueFormat?: (n: number) => string;
  showDrop?: boolean;
}) {
  const base = stages[0]?.value || 1;
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        const pct = (s.value / base) * 100;
        const prev = i > 0 ? stages[i - 1].value : null;
        const drop = prev && prev > 0 ? ((prev - s.value) / prev) * 100 : null;
        return (
          <div key={s.key} className="funnel__step" onClick={() => onStageClick?.(s)}
            role={onStageClick ? 'button' : undefined} tabIndex={onStageClick ? 0 : undefined}
            onKeyDown={e => { if (e.key === 'Enter') onStageClick?.(s); }}>
            <span className="funnel__nm">{s.label}</span>
            <span className="funnel__track">
              <span className="funnel__fill" style={{ width: `${Math.max(0.6, pct)}%`, background: seriesColor(i) }} />
            </span>
            <span className="funnel__v">{valueFormat(s.value)}</span>
            <span>
              <div className="funnel__pc">{formatPct(pct, 1)}</div>
              {showDrop && drop !== null && drop > 0 && (
                <div className="funnel__drop">−{drop.toFixed(0)}%</div>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
