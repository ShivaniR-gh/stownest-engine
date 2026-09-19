import { useNavigate } from 'react-router-dom';
import type { ColumnDef, Row } from '@/config/types';
import { getDataset } from '@/config/datasets';
import { Button, Icon, Popover } from '@/components/primitives';
import { formatINR, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import { isRowOpen } from '@/lib/data/editable';

/* Records tab for Marketing: a plain month-by-month table, one row per month,
   columns grouped by category. The dashboard (KPIs, category cards, charts)
   stays on the Dashboard tab only. */

const GROUPS: { label: string; prefixes: string[] }[] = [
  { label: 'B2C', prefixes: ['B2C '] },
  { label: 'B2B', prefixes: ['B2B '] },
  { label: 'Packing & Moving', prefixes: ['P&M '] },
  { label: 'Overall', prefixes: ['Total ', 'Blended ', ''] },
];

const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : String(v ?? '');
};

const monthKey = (v: unknown) => {
  const d = parseDate(v);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};

function formatCell(r: Row, c: ColumnDef) {
  const raw = r[c.key];
  if (raw == null || raw === '') return '—';
  if (c.type === 'currency') return formatINR(toNum(raw) ?? 0);
  if (c.type === 'percent') return formatPct(toNum(raw) ?? 0);
  if (c.type === 'number') return formatInt(toNum(raw) ?? 0);
  return String(raw);
}

function split(header: string): { group: string; leaf: string } {
  for (const g of GROUPS) {
    for (const p of g.prefixes) {
      if (p && header.startsWith(p)) {
        return { group: g.label, leaf: g.label === 'Overall' ? header : header.slice(p.length) };
      }
    }
  }
  return { group: 'Overall', leaf: header };
}

export function MarketingRecordsView({ rows, datasetId, onEdit }: {
  rows: Row[];
  datasetId: string;
  /** Offered only on the newest recorded month; older months are closed. */
  onEdit?: (r: Row) => void;
}) {
  const nav = useNavigate();
  const ds = getDataset(datasetId);
  const cols = (ds?.columns ?? []).filter(c => c.key !== 'month' && !c.hiddenByDefault) as ColumnDef[];

  // Columns are interleaved in the schema (all spends, then all customers…),
  // so regroup by category to keep each header band contiguous.
  const allGroups = GROUPS
    .map(g => ({ label: g.label, cols: cols.filter(c => split(c.header).group === g.label) }))
    .filter(g => g.cols.length > 0);
  const groups = allGroups;
  const ordered = groups.flatMap(g => g.cols);

  const months = (() => {
    const seen = new Map<string, Row>();
    const sorted = [...rows].sort((a, b) => monthKey(b.month).localeCompare(monthKey(a.month)));
    for (const r of sorted) {
      const k = monthKey(r.month);
      if (k && !seen.has(k)) seen.set(k, r);
    }
    return [...seen.values()];
  })();

  return (
    <>
    <div className="card">
      <div className="card__bd" style={{ padding: 0 }}>
        {months.length === 0 ? (
          <p className="cef__note" style={{ padding: 16 }}>No months yet. Use New record.</p>
        ) : (
          <div className="tbl__scroll">
            <table className="xpose xpose--free">
              <thead>
                <tr>
                  <th className="xpose__rowhd" rowSpan={2}>Month</th>
                  {groups.map(g => (
                    <th key={g.label} colSpan={g.cols.length} className="is-num">{g.label}</th>
                  ))}
                  <th rowSpan={2} style={{ width: 44 }} />
                </tr>
                <tr>
                  {ordered.map(c => (
                    <th key={c.key} className="is-num">{split(c.header).leaf}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map(r => {
                  const id = String(r.__id ?? r.month ?? '');
                  const open = isRowOpen(r, months);
                  return (
                    <tr key={id}>
                      <th className="xpose__rowhd">{monthLabel(r.month)}</th>
                      {ordered.map(c => (
                        <td key={c.key} className="is-num">{formatCell(r, c)}</td>
                      ))}
                      <td className="is-num">
                        <Popover width={170} align="end" trigger={({ toggle, ref }) => (
                          <Button size="sm" iconOnly variant="ghost" icon="more" ref={ref}
                            aria-label="Row actions" onClick={toggle} />
                        )}>
                          {close => (
                            <>
                              <button className="pop__item" onClick={() => {
                                close();
                                if (id) nav(`/d/marketing/${datasetId}/${encodeURIComponent(id)}`);
                              }}>
                                <Icon name="external" size={13} /> Open record
                              </button>
                              {onEdit && open && (
                                <button className="pop__item" onClick={() => { close(); onEdit(r); }}>
                                  <Icon name="edit" size={13} /> Edit
                                </button>
                              )}
                            </>
                          )}
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
