import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DatasetDef, Row } from '@/config/types';
import { Button, EmptyState, Icon, Popover } from '@/components/primitives';
import { formatCell, parseDate, toNum } from '@/lib/format';
import { isRowOpen } from '@/lib/data/editable';
import { keysInWindow } from '@/lib/analytics/monthWindow';
import { PeriodSelect } from '@/components/filters/PeriodSelect';

/** ---------------------------------------------------------------------------
 * Collections matrix.
 *
 * One grid, months across, every figure down the left — the layout the finance
 * team already reads. Two datasets are merged here rather than shown as two
 * tables, because the segment figures only mean anything against the month
 * totals sitting above them.
 *
 * Months run newest to oldest, so the current month sits beside the labels.
 * Reading rightwards is reading backwards in time.
 *
 * Read-only: editing stays on the entry form, which owns validation and the
 * derived figures. Two write surfaces against one tab drift apart.
 * ------------------------------------------------------------------------- */

/** Segment column groups, keyed by the prefix their columns share. */
const SEGMENTS = [
  { name: 'Transportation (Pickup)', p: 'pk_' },
  { name: 'Transportation (Delivery)', p: 'dl_' },
  { name: 'Storage Rental', p: 'st_' },
];

const monthTime = (v: unknown) => parseDate(v)?.getTime() ?? 0;
const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : String(v ?? '—');
};

export function CollectionsMatrix({ monthlyDs, monthly, onEdit }: {
  monthlyDs: DatasetDef;
  monthly: Row[];
  /** Omit to render read-only. */
  onEdit?: (row: Row) => void;
}) {
  const nav = useNavigate();
  /** Every month present in either dataset, so a month with segment rows but
   *  no summary row still gets a column instead of vanishing. */
  const allMonths = useMemo(() => {
    const seen = new Map<number, unknown>();
    for (const r of monthly) {
      const t = monthTime(r.month);
      if (t && !seen.has(t)) seen.set(t, r.month);
    }
    // Newest first: the month someone opens this for is almost always the one
    // just entered, and it should be the column beside the labels rather than
    // at the far end of a sideways scroll.
    return [...seen.entries()].sort((a, b) => b[0] - a[0]);
  }, [monthly]);

  /** yyyy-mm keys for the columns, newest first, for the period filter. */
  const monthKeys = useMemo(
    () => allMonths.map(([t]) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }),
    [allMonths]);

  /** Defaults to the last 12 months rather than the single current one: this
   *  is the records view, where the point is comparing months side by side,
   *  and a one-column matrix is not a matrix. */
  const [pick, setPick] = useState<string>('12m');
  const months = useMemo(() => {
    const keep = new Set(keysInWindow(monthKeys, pick));
    return allMonths.filter(([t]) => {
      const d = new Date(t);
      return keep.has(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
  }, [allMonths, monthKeys, pick]);

  const byMonth = useMemo(() => {
    const m = new Map<number, Row>();
    for (const r of monthly) m.set(monthTime(r.month), r);
    return m;
  }, [monthly]);

  const col = (k: string) => monthlyDs.columns.find(c => c.key === k);
  /** Month totals: every mapped column that is not part of a segment group. */
  const monthlyFields = useMemo(
    () => monthlyDs.columns.filter(c => c.sheetColumn && c.key !== 'month'
      && !SEGMENTS.some(sg => c.key.startsWith(sg.p))),
    [monthlyDs]);

  /* Nothing recorded at all is a different situation from nothing inside the
     selected period — the second must keep the filter on screen, or there is
     no way back to a window that has data. */
  if (!allMonths.length) {
    return <EmptyState icon="search" title="No collections rows"
      body="Add a record and its month appears here as a column." />;
  }

  /* Above the card, not inside it — a card holding an .xpose table is given
     `padding: 0` so the table can bleed to its edges, which leaves anything
     else in that body jammed against the border. */
  const filter = (
    <div className="filter-bar">
      <PeriodSelect value={pick} onChange={setPick} monthKeys={monthKeys} />
    </div>
  );

  if (!months.length) {
    return (
      <>
        {filter}
        <EmptyState icon="search" title="No months in this period"
          body="Widen the period to bring earlier months back into view." />
      </>
    );
  }

  return (
    <>
    {filter}
    <div className="card"><div className="card__bd">
    <div className="xpose__scroll">
      <table className="xpose">
        <thead>
          <tr>
            <th className="xpose__corner">Month</th>
            {months.map(([t, raw]) => <th key={t} className="is-num">{monthLabel(raw)}</th>)}
          </tr>
          <tr>
            <th className="xpose__rowhd" />
            {months.map(([t]) => {
              const row = byMonth.get(t);
              if (!row) return <td key={t} />;
              const open = isRowOpen(row, monthly);
              return (
                <td key={t} className="is-num">
                  <Popover width={170} align="end" trigger={({ toggle, ref }) => (
                    <Button size="sm" iconOnly variant="ghost" icon="more" ref={ref}
                      aria-label="Row actions" onClick={toggle} />
                  )}>
                    {close => (
                      <>
                        {row.__id && (
                          <button className="pop__item" onClick={() => {
                            close();
                            nav(`/d/${monthlyDs.department}/${monthlyDs.id}/${encodeURIComponent(String(row.__id))}`);
                          }}>
                            <Icon name="external" size={13} /> Open record
                          </button>
                        )}
                        {open && onEdit && (
                          <button className="pop__item" onClick={() => { close(); onEdit(row); }}>
                            <Icon name="edit" size={13} /> Edit
                          </button>
                        )}
                      </>
                    )}
                  </Popover>
                </td>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {monthlyFields.map(c => (
            <tr key={c.key}>
              <th scope="row" className="xpose__rowhd" title={c.help}>{c.header}</th>
              {months.map(([t]) => (
                <td key={t} className="is-num">{formatCell(byMonth.get(t)?.[c.key], c.type)}</td>
              ))}
            </tr>
          ))}

          {/* Comparison is the movement between two adjacent months, so it is
              computed from the columns either side rather than read from a
              stored field that would go stale the moment a month is inserted. */}
          <tr>
            <th scope="row" className="xpose__rowhd">Comparison</th>
            {months.map(([t], i) => {
              const now = toNum(byMonth.get(t)?.collection_amount) ?? 0;
              // Newest first, so the earlier month is the column to the RIGHT.
              const prevEntry = months[i + 1];
              const prev = prevEntry ? toNum(byMonth.get(prevEntry[0])?.collection_amount) ?? 0 : 0;
              return (
                <td key={t} className="is-num">
                  {prev > 0 && now > 0 ? ((now - prev) / prev).toFixed(2) : '—'}
                </td>
              );
            })}
          </tr>

          <tr className="xpose__band">
            <th scope="row" className="xpose__rowhd">Source of Revenue</th>
            {months.map(([t]) => <td key={t} />)}
          </tr>

          {SEGMENTS.map(sg => (
            <>
              <tr key={`${sg.name}:hd`} className="xpose__sub">
                <th scope="row" className="xpose__rowhd">{sg.name}</th>
                {months.map(([t]) => <td key={t} />)}
              </tr>
              {['raised', 'collected', 'gap', 'gap_pct', 'share'].map(f => {
                const c = col(`${sg.p}${f}`);
                if (!c?.sheetColumn) return null;
                // Strip the segment name from the label: it is already the
                // subheading directly above, and repeating it in every row
                // makes five near-identical lines to scan.
                const label = c.header.replace(/^(Pickup|Delivery|Storage)\s+/, '');
                return (
                  <tr key={c.key}>
                    <th scope="row" className="xpose__rowhd xpose__rowhd--in">{label}</th>
                    {months.map(([t]) => (
                      <td key={t} className="is-num">
                        {formatCell(byMonth.get(t)?.[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </>
          ))}
        </tbody>

        {/* Edit sits at the foot rather than in the header: always visible, and
            directly under the column of figures it changes. */}
      </table>
    </div>
    </div></div>
    </>
  );
}
