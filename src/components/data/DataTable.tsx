import { useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef, DatasetDef, Row } from '@/config/types';
import { Badge, Button, EmptyState, ErrorState, Icon, Popover, Skeleton } from '@/components/primitives';
import { formatCell, formatINR, formatInt, isMonoType, isNumericType, toNum } from '@/lib/format';
import { groupBy } from '@/lib/analytics/aggregate';

type SortSpec = { key: string; dir: 'asc' | 'desc' };

export interface DataTableProps {
  dataset: DatasetDef;
  rows: Row[];
  status: string;
  error: Error | null;
  onRowClick?: (r: Row) => void;
  rowActions?: (r: Row) => ReactNode;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  onSelectionChange?: (rows: Row[]) => void;
  pageSize?: number;
  emptyTitle?: string;
  emptyBody?: string;
  /** Column keys forced visible regardless of hiddenByDefault. */
  initialColumns?: string[];
}

export function DataTable({
  dataset, rows, status, error, onRowClick, rowActions,
  toolbarLeft, toolbarRight, onSelectionChange, pageSize = 25,
  emptyTitle, emptyBody, initialColumns,
}: DataTableProps) {
  const mapped = useMemo(() => dataset.columns.filter(c => c.sheetColumn), [dataset]);

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(initialColumns ?? mapped.filter(c => !c.hiddenByDefault).map(c => c.key)),
  );
  const [sort, setSort] = useState<SortSpec[]>(
    () => (dataset.defaultSort ? [dataset.defaultSort] : []),
  );
  const [group, setGroup] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const cols = useMemo(() => mapped.filter(c => visible.has(c.key)), [mapped, visible]);

  /* ------------------------------- sorting ------------------------------- */
  const sorted = useMemo(() => {
    if (!sort.length) return rows;
    const col = (k: string) => dataset.columns.find(c => c.key === k);
    return [...rows].sort((a, b) => {
      for (const s of sort) {
        const c = col(s.key);
        const av = a[s.key], bv = b[s.key];
        let d = 0;
        if (c && isNumericType(c.type)) d = (toNum(av) ?? -Infinity) - (toNum(bv) ?? -Infinity);
        else if (c && (c.type === 'date' || c.type === 'datetime')) {
          d = (Date.parse(String(av)) || 0) - (Date.parse(String(bv)) || 0);
        } else d = String(av ?? '').localeCompare(String(bv ?? ''), 'en-IN');
        if (d !== 0) return s.dir === 'asc' ? d : -d;
      }
      return 0;
    });
  }, [rows, sort, dataset]);

  /* ------------------------------ grouping ------------------------------- */
  const groups = useMemo(() => {
    if (!group) return null;
    return groupBy(sorted, group, { agg: 'count' })
      .map(g => ({ key: g.key, rows: g.rows }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [sorted, group]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = group ? sorted : sorted.slice(page * pageSize, page * pageSize + pageSize);

  const toggleSort = (key: string, additive: boolean) => {
    setSort(cur => {
      const at = cur.findIndex(s => s.key === key);
      if (!additive) {
        if (at === 0 && cur.length === 1) return cur[0].dir === 'asc' ? [{ key, dir: 'desc' }] : [];
        return [{ key, dir: 'asc' }];
      }
      if (at < 0) return [...cur, { key, dir: 'asc' }];
      const next = [...cur];
      if (next[at].dir === 'asc') next[at] = { key, dir: 'desc' };
      else next.splice(at, 1);
      return next;
    });
    setPage(0);
  };

  const toggleRow = (id: string) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      onSelectionChange?.(sorted.filter(r => n.has(String(r.__id))));
      return n;
    });
  };
  const allOnPageSelected = pageRows.length > 0 && pageRows.every(r => selected.has(String(r.__id)));
  const toggleAll = () => {
    setSelected(s => {
      const n = new Set(s);
      pageRows.forEach(r => (allOnPageSelected ? n.delete(String(r.__id)) : n.add(String(r.__id))));
      onSelectionChange?.(sorted.filter(x => n.has(String(x.__id))));
      return n;
    });
  };

  const totals = useMemo(() => {
    const agg = cols.filter(c => c.aggregate);
    if (!agg.length) return null;
    return Object.fromEntries(agg.map(c => [
      c.key,
      c.aggregate === 'count' ? sorted.length
        : sorted.reduce((a, r) => a + (toNum(r[c.key]) ?? 0), 0) / (c.aggregate === 'avg' ? Math.max(1, sorted.length) : 1),
    ]));
  }, [cols, sorted]);

  /* -------------------------------- states -------------------------------- */
  if (status === 'loading') {
    return (
      <div className="tbl__wrap">
        <div className="tbl__bar"><Skeleton h={30} w={200} /><div className="tbl__bar-right"><Skeleton h={30} w={120} /></div></div>
        <div style={{ padding: 'var(--s3)' }}>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={30} style={{ marginBottom: 6 }} />)}
        </div>
      </div>
    );
  }
  if (status === 'error' && !rows.length) {
    return (
      <div className="tbl__wrap">
        <ErrorState title="Could not load this table"
          body={error?.message ?? 'The data service did not respond.'} />
      </div>
    );
  }

  return (
    <div className="tbl__wrap">
      <div className="tbl__bar no-print">
        {toolbarLeft}
        <div className="tbl__bar-right">
          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-600)' }}>
                <b className="num">{selected.size}</b> selected
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); onSelectionChange?.([]); }}>
                Clear
              </Button>
              <span className="ctlbar__sep" />
            </>
          )}

          <Popover width={200} align="end" trigger={({ toggle, ref, open }) => (
            <Button size="sm" icon="layers" aria-pressed={Boolean(group)}
              ref={ref} onClick={toggle} aria-expanded={open}>
              {group ? `Grouped: ${dataset.columns.find(c => c.key === group)?.header}` : 'Group'}
            </Button>
          )}>
            {close => (
              <>
                <div className="pop__hd eyebrow">Group rows by</div>
                <button className="pop__item" onClick={() => { setGroup(null); close(); }}>
                  <Icon name={group === null ? 'check' : 'close'} size={13} style={{ opacity: group === null ? 1 : 0 }} />
                  No grouping
                </button>
                <div className="pop__scroll">
                  {mapped.filter(c => c.groupable).map(c => (
                    <button key={c.key} className="pop__item" onClick={() => { setGroup(c.key); setPage(0); close(); }}>
                      {group === c.key ? <Icon name="check" size={13} /> : <span style={{ width: 13 }} />}
                      {c.header}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Popover>

          <Popover width={230} align="end" trigger={({ toggle, ref, open }) => (
            <Button size="sm" icon="columns" ref={ref} onClick={toggle} aria-expanded={open}>
              Columns
            </Button>
          )}>
            {() => (
              <>
                <div className="pop__hd eyebrow">Show columns</div>
                <div className="pop__scroll">
                  {mapped.map(c => (
                    <label key={c.key} className="pop__item check" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={visible.has(c.key)}
                        onChange={() => setVisible(v => {
                          const n = new Set(v);
                          n.has(c.key) ? n.delete(c.key) : n.add(c.key);
                          return n.size ? n : v; // never allow zero columns
                        })} />
                      {c.header}
                    </label>
                  ))}
                </div>
              </>
            )}
          </Popover>

          {toolbarRight}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon="search"
          title={emptyTitle ?? `No ${dataset.label.toLowerCase()} match this view`}
          body={emptyBody ?? 'Widen the date range or clear a filter to see more.'} />
      ) : (
        <>
          <div className="tbl__scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="tbl__sel">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll}
                      aria-label="Select all rows on this page" style={{ accentColor: 'var(--accent)' }} />
                  </th>
                  {cols.map(c => {
                    const si = sort.findIndex(s => s.key === c.key);
                    return (
                      <th key={c.key} className={isNumericType(c.type) ? 'is-num' : ''}
                        style={{ width: c.width }}
                        aria-sort={si < 0 ? 'none' : sort[si].dir === 'asc' ? 'ascending' : 'descending'}>
                        {c.sortable === false ? c.header : (
                          <button className="tbl__sort" data-active={si >= 0}
                            onClick={e => toggleSort(c.key, e.shiftKey)}
                            title="Click to sort · shift-click to add a second sort">
                            {c.header}
                            {si >= 0 && <Icon name={sort[si].dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={11} strokeWidth={2.4} />}
                            {si >= 0 && sort.length > 1 && <span className="tbl__sortidx">{si + 1}</span>}
                          </button>
                        )}
                      </th>
                    );
                  })}
                  {rowActions && <th className="tbl__act" />}
                </tr>
              </thead>

              <tbody>
                {groups
                  ? groups.map(g => (
                    <GroupBlock key={g.key} label={g.key} rows={g.rows} cols={cols} dataset={dataset}
                      selected={selected} onToggle={toggleRow} onRowClick={onRowClick} rowActions={rowActions} />
                  ))
                  : pageRows.map(r => (
                    <BodyRow key={String(r.__id)} r={r} cols={cols} dataset={dataset}
                      selected={selected.has(String(r.__id))} onToggle={toggleRow}
                      onRowClick={onRowClick} rowActions={rowActions} />
                  ))}
              </tbody>

              {totals && (
                <tfoot>
                  <tr>
                    <td className="tbl__sel is-lbl" />
                    {cols.map((c, i) => (
                      <td key={c.key} className={isNumericType(c.type) ? 'is-num' : 'is-lbl'}>
                        {i === 0 ? `${formatInt(sorted.length)} rows` :
                          totals[c.key] !== undefined
                            ? (c.type === 'currency' ? formatINR(totals[c.key]) : formatInt(totals[c.key]))
                            : ''}
                      </td>
                    ))}
                    {rowActions && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="tbl__foot no-print">
            <span>
              {group
                ? <>Showing all <b className="num">{formatInt(sorted.length)}</b> rows in <b className="num">{groups?.length}</b> groups</>
                : <>
                  <b className="num">{formatInt(page * pageSize + 1)}</b>–
                  <b className="num">{formatInt(Math.min((page + 1) * pageSize, sorted.length))}</b> of{' '}
                  <b className="num">{formatInt(sorted.length)}</b>
                </>}
            </span>
            {!group && pageCount > 1 && (
              <div className="tbl__foot-right">
                <Button size="sm" iconOnly icon="chevronLeft" variant="ghost" aria-label="Previous page"
                  disabled={page === 0} onClick={() => setPage(p => p - 1)} />
                <span className="pageno">{page + 1} / {pageCount}</span>
                <Button size="sm" iconOnly icon="chevronRight" variant="ghost" aria-label="Next page"
                  disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------- row parts -------------------------------- */
function BodyRow({ r, cols, dataset, selected, onToggle, onRowClick, rowActions }: {
  r: Row; cols: ColumnDef[]; dataset: DatasetDef; selected: boolean;
  onToggle: (id: string) => void; onRowClick?: (r: Row) => void; rowActions?: (r: Row) => ReactNode;
}) {
  return (
    <tr data-selected={selected} data-clickable={Boolean(onRowClick)}
      onClick={e => {
        if ((e.target as HTMLElement).closest('input,button,a')) return;
        onRowClick?.(r);
      }}>
      <td className="tbl__sel">
        <input type="checkbox" checked={selected} onChange={() => onToggle(String(r.__id))}
          aria-label="Select row" style={{ accentColor: 'var(--accent)' }} />
      </td>
      {cols.map(c => <Cell key={c.key} col={c} row={r} dataset={dataset} />)}
      {rowActions && <td className="tbl__act">{rowActions(r)}</td>}
    </tr>
  );
}

function Cell({ col, row, dataset }: { col: ColumnDef; row: Row; dataset: DatasetDef }) {
  const v = row[col.key];
  const cls = [
    isNumericType(col.type) && 'is-num',
    isMonoType(col.type) && 'is-mono',
    col.key === dataset.titleColumn && 'is-key',
  ].filter(Boolean).join(' ');

  if (col.type === 'enum' && col.tone) {
    const tone = col.tone[String(v)] ?? 'idle';
    return <td className={cls}>{v ? <Badge tone={tone}>{String(v)}</Badge> : ''}</td>;
  }
  const text = formatCell(v, col.type);
  return <td className={cls} title={text.length > 24 ? text : undefined}>{text}</td>;
}

function GroupBlock({ label, rows, cols, dataset, selected, onToggle, onRowClick, rowActions }: {
  label: string; rows: Row[]; cols: ColumnDef[]; dataset: DatasetDef;
  selected: Set<string>; onToggle: (id: string) => void;
  onRowClick?: (r: Row) => void; rowActions?: (r: Row) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className="tbl__group">
        <td colSpan={cols.length + 1 + (rowActions ? 1 : 0)}>
          <button onClick={() => setOpen(o => !o)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2.4} />
            {label}
            <span className="num" style={{ marginLeft: 6 }}>{rows.length}</span>
          </button>
        </td>
      </tr>
      {open && rows.map(r => (
        <BodyRow key={String(r.__id)} r={r} cols={cols} dataset={dataset}
          selected={selected.has(String(r.__id))} onToggle={onToggle}
          onRowClick={onRowClick} rowActions={rowActions} />
      ))}
    </>
  );
}
