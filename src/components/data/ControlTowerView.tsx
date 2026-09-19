import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SelectField } from '@/components/filters/SelectField';
import { WINDOW_PRESETS, keysInWindow, ytdOptions } from '@/lib/analytics/monthWindow';
import type { ColumnDef, Row } from '@/config/types';
import { getDataset } from '@/config/datasets';
import { Button, Icon, Popover } from '@/components/primitives';
import { formatINR, formatInt, formatPct, parseDate, toNum } from '@/lib/format';
import { isRowOpen } from '@/lib/data/editable';

const CITIES = [
  'Bangalore', 'Hyderabad', 'Chennai', 'Pune', 'Mumbai',
  'Delhi/Haryana', 'Delhi/Gurugram', 'Delhi', 'Kolkata',
];

const monthLabel = (v: unknown) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : String(v ?? '');
};

function formatCell(r: Row, key: string, type?: string) {
  if (key === 'month') return monthLabel(r.month);
  const raw = r[key];
  if (type === 'currency') return formatINR(toNum(raw) ?? 0);
  if (type === 'percent') return formatPct(toNum(raw) ?? 0);
  if (type === 'number') return formatInt(toNum(raw) ?? 0);
  if (raw == null || raw === '') return '—';
  return String(raw);
}

function groupOf(header: string): { group: string; leaf: string } {
  const city = CITIES.find(n => header.startsWith(n));
  if (city) return { group: city, leaf: header.slice(city.length).trim() || header };
  if (header.startsWith('Call ')) return { group: 'Calls', leaf: header.slice(5) };
  if (header.startsWith('Interakt ')) return { group: 'Interakt', leaf: header.slice(9) };
  if (header.startsWith('Total ')) return { group: 'Total', leaf: header.slice(6) };
  return { group: '', leaf: header };
}

export function ControlTowerView({ rows, datasetId, onEdit }: {
  rows: Row[];
  datasetId: string;
  onEdit?: (r: Row) => void;
}) {
  const nav = useNavigate();
  const ds = getDataset(datasetId);
  const allCols = (ds?.columns ?? []).filter(c =>
    c.key !== 'month' && !c.hiddenByDefault) as ColumnDef[];

  /* Filters: a period (all months, rolling windows, YTD, single month) and,
     for tabs whose columns are grouped, which group to show (a city on
     City income, Calls/Interakt on Calls, ...). Reset when the tab changes. */
  const [period, setPeriod] = useState('all');
  const [section, setSection] = useState('');
  useEffect(() => { setPeriod('all'); setSection(''); }, [datasetId]);

  const sections = useMemo(() => {
    const seen: string[] = [];
    for (const c of allCols) {
      const g = groupOf(c.header).group;
      if (g && !seen.includes(g)) seen.push(g);
    }
    return seen;
  }, [allCols]);
  const byCity = sections.some(g => CITIES.includes(g));
  const cols = section ? allCols.filter(c => groupOf(c.header).group === section) : allCols;

  const groups: { label: string; cols: ColumnDef[] }[] = [];
  for (const c of cols) {
    const { group } = groupOf(c.header);
    const last = groups[groups.length - 1];
    if (last && last.label === group) last.cols.push(c);
    else groups.push({ label: group, cols: [c] });
  }
  const grouped = groups.some(g => g.label && g.cols.length > 1);

  const months = (() => {
    const seen = new Map<string, Row>();
    const keyOf = (v: unknown) => {
      const d = parseDate(v);
      return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
    };
    const sorted = [...rows].sort((a, b) =>
      String(b.month ?? '').localeCompare(String(a.month ?? '')));
    for (const r of sorted) {
      const k = keyOf(r.month);
      if (!k || seen.has(k)) continue;
      seen.set(k, r);
    }
    return [...seen.values()];
  })();

  const monthKeys = months.map(r => {
    const d = parseDate(r.month);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
  });
  const visible = (() => {
    if (period === 'all') return months;
    const keep = new Set(keysInWindow(monthKeys, period));
    return months.filter((_, i) => keep.has(monthKeys[i] ?? ''));
  })();
  const periodOptions = [
    { value: 'all', label: 'All months' },
    ...WINDOW_PRESETS.map(p => ({ value: p.id, label: p.label })),
    ...ytdOptions(monthKeys).map(y => ({ value: y.id, label: y.label })),
    ...monthKeys.map(k => ({ value: k, label: monthLabel(`${k}-01`) })),
  ];

  return (
    <>
    {months.length > 0 && (
      <div className="filter-bar">
        <SelectField icon="calendar" label="Period" value={period} onChange={setPeriod}
          isOn={period !== 'all'} options={periodOptions} />
        {sections.length > 1 && (
          <SelectField icon="layers" label={byCity ? 'City' : 'Section'} value={section}
            onChange={setSection} isOn={!!section}
            options={[{ value: '', label: byCity ? 'All cities' : 'All sections' },
              ...sections.map(g => ({ value: g, label: g }))]} />
        )}
        {(period !== 'all' || !!section) && (
          <Button size="sm" variant="ghost" icon="close"
            onClick={() => { setPeriod('all'); setSection(''); }}>
            Reset
          </Button>
        )}
      </div>
    )}
    <div className="card">
      <div className="card__bd" style={{ padding: 0 }}>
        {months.length === 0 ? (
          <p className="cef__note" style={{ padding: 16 }}>No months yet. Use New record.</p>
        ) : visible.length === 0 ? (
          <p className="cef__note" style={{ padding: 16 }}>No months in this period.</p>
        ) : (
          <div className="tbl__scroll">
            <table className="xpose xpose--free">
              <thead>
                {grouped && (
                  <tr>
                    <th className="xpose__rowhd" rowSpan={2}>Month</th>
                    {groups.map((g, i) => (
                      <th key={g.label || i} colSpan={g.cols.length} className="is-num">
                        {g.label}
                      </th>
                    ))}
                    <th rowSpan={2} style={{ width: 44 }} />
                  </tr>
                )}
                <tr>
                  {!grouped && <th className="xpose__rowhd">Month</th>}
                  {groups.flatMap(g => g.cols.map(c => (
                    <th key={c.key} className="is-num">
                      {grouped ? (groupOf(c.header).leaf || c.header) : c.header}
                    </th>
                  )))}
                  {!grouped && <th style={{ width: 44 }} />}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const id = String(r.__id ?? '');
                  const open = isRowOpen(r, months);
                  return (
                    <tr key={id || String(r.month)}>
                      <th className="xpose__rowhd">{monthLabel(r.month)}</th>
                      {cols.map(c => (
                        <td key={c.key} className="is-num">{formatCell(r, c.key, c.type)}</td>
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
                                if (id) nav(`/d/control_tower/${datasetId}/${encodeURIComponent(id)}`);
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
