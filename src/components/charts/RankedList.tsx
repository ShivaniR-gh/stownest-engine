import type { Row } from '@/config/types';
import { formatCompactNum } from '@/lib/format';

export interface RankItem { key: string; value: number; count: number; rows: Row[]; meta?: string }

/** Leaderboard. A bar chart with 20 entries is unreadable; a ranked list with
 *  an inline magnitude bar stays scannable and carries the same information. */
export function RankedList({
  items, valueFormat = formatCompactNum, onClick, limit = 8, metaLabel = 'records',
}: {
  items: RankItem[];
  valueFormat?: (n: number) => string;
  onClick?: (i: RankItem) => void;
  limit?: number;
  metaLabel?: string;
}) {
  const rows = items.slice(0, limit);
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="rank">
      {rows.map((it, i) => (
        <div key={it.key} className="rank__row" onClick={() => onClick?.(it)}
          role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
          onKeyDown={e => { if (e.key === 'Enter') onClick?.(it); }}>
          <span className="rank__i">{i + 1}</span>
          <span style={{ minWidth: 0 }}>
            <div className="rank__nm">{it.key}</div>
            <div className="rank__meta">{it.meta ?? `${it.count} ${metaLabel}`}</div>
            <div className="rank__bar"><span style={{ width: `${(it.value / max) * 100}%` }} /></div>
          </span>
          <span className="rank__v">{valueFormat(it.value)}</span>
        </div>
      ))}
    </div>
  );
}
