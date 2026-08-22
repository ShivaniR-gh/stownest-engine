import { useMemo, useState } from 'react';
import { Button, Icon, Popover, Tooltip } from '@/components/primitives';
import { useAnalytics } from '@/lib/analytics/AnalyticsContext';
import { PRESETS, periodLabel, periodToISO } from '@/lib/analytics/period';
import { GLOBAL_FILTER_KEYS, optionsFor } from '@/lib/analytics/filters';
import { getDataset } from '@/config/datasets';
import { getEntry, isStale, refreshAll } from '@/lib/data/store';
import { relativeTime } from '@/lib/format';
import type { Row } from '@/config/types';

/**
 * Global analytics controls. One bar, present on every analytical screen, and
 * every KPI and chart below it reads from the same state. There is no
 * per-widget date picker — divergent time windows on one screen is how two
 * people in the same review end up quoting different revenue figures.
 */
export function ControlBar({
  datasetIds, fetchedAt, busy, onRefresh, right,
}: {
  datasetIds: string[];
  fetchedAt: number | null;
  busy?: boolean;
  onRefresh?: () => void;
  right?: React.ReactNode;
}) {
  const a = useAnalytics();
  const stale = isStale(fetchedAt);

  return (
    <div className="ctlbar no-print">
      <DateRangeControl />
      <FilterControl datasetIds={datasetIds} />

      {a.activeCount > 0 && (
        <>
          <ActiveChips />
          <Button size="sm" variant="ghost" onClick={a.resetFilters}>Reset</Button>
        </>
      )}

      <span className="ctlbar__sep" />
      <Tooltip label="Show change against the previous equal-length period">
        <Button size="sm" icon="trending" aria-pressed={a.compare} onClick={() => a.setCompare(!a.compare)}>
          Compare
        </Button>
      </Tooltip>

      <div className="ctlbar__right">
        {right}
        <span className="ctlbar__sync" data-stale={stale}
          title={stale ? 'This data is more than five minutes old' : 'Data is current'}>
          <span className="ctlbar__dot" />
          {fetchedAt ? `Synced ${relativeTime(fetchedAt)}` : 'Not synced'}
        </span>
        <Tooltip label="Re-read every sheet">
          <Button size="sm" iconOnly icon="refresh" aria-label="Refresh data" disabled={busy}
            className={busy ? 'spin' : undefined}
            onClick={() => (onRefresh ? onRefresh() : void refreshAll())} />
        </Tooltip>
      </div>
    </div>
  );
}

function DateRangeControl() {
  const a = useAnalytics();
  const iso = periodToISO(a.period);
  const [from, setFrom] = useState(iso.from);
  const [to, setTo] = useState(iso.to);

  return (
    <Popover width={300} trigger={({ toggle, ref, open }) => (
      <Button size="sm" icon="calendar" ref={ref} onClick={toggle} aria-expanded={open}>
        {periodLabel(a.period)}
        <Icon name="chevronDown" size={12} />
      </Button>
    )}>
      {close => (
        <div className="rangepop">
          <div className="pop__hd eyebrow">Period</div>
          <div className="rangepop__grid">
            {PRESETS.map(p => (
              <button key={p.id} className="pop__item"
                onClick={() => { a.setPreset(p.id); close(); }}>
                {a.presetId === p.id ? <Icon name="check" size={12} /> : <span style={{ width: 12 }} />}
                {p.label}
              </button>
            ))}
          </div>
          <div className="rangepop__custom">
            <label className="formrow">
              <span className="formrow__lb">From</span>
              <input type="date" className="field" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="formrow">
              <span className="formrow__lb">To</span>
              <input type="date" className="field" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
          <div style={{ padding: 'var(--s2)' }}>
            <Button size="sm" variant="primary" style={{ width: '100%', justifyContent: 'center' }}
              disabled={!from || !to || from > to}
              onClick={() => { a.setCustom(from, to); close(); }}>
              Apply custom range
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function FilterControl({ datasetIds }: { datasetIds: string[] }) {
  const a = useAnalytics();
  const [openKey, setOpenKey] = useState<string | null>(null);

  /** Only offer dimensions that actually exist in the datasets on this screen —
   *  a Vendor filter on the Finance page would silently do nothing. */
  const dims = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    for (const k of GLOBAL_FILTER_KEYS) {
      for (const id of datasetIds) {
        const col = getDataset(id)?.columns.find(c => c.key === k && c.sheetColumn && c.filterable);
        if (col) { out.push({ key: k, label: col.header }); break; }
      }
    }
    return out;
  }, [datasetIds]);

  const optionsCache = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const d of dims) {
      // Reads whatever is already cached rather than triggering a fetch — opening
      // a filter menu must never cause another Sheets read.
      const rows: Row[] = datasetIds.flatMap(id => getEntry(id).rows);
      m[d.key] = optionsFor(rows, d.key);
    }
    return m;
  }, [dims, datasetIds]);

  if (!dims.length) return null;

  return (
    <Popover width={230} trigger={({ toggle, ref, open }) => (
      <Button size="sm" icon="filter" ref={ref} onClick={toggle} aria-expanded={open}
        aria-pressed={a.activeCount > 0}>
        Filters{a.activeCount > 0 && <span className="num"> · {a.activeCount}</span>}
        <Icon name="chevronDown" size={12} />
      </Button>
    )}>
      {() => (
        <>
          <div className="pop__hd eyebrow">Filter by</div>
          <div className="pop__scroll">
            {dims.map(d => (
              <div key={d.key}>
                <button className="pop__item" onClick={() => setOpenKey(k => (k === d.key ? null : d.key))}>
                  <Icon name={openKey === d.key ? 'chevronDown' : 'chevronRight'} size={12} />
                  {d.label}
                  {a.filters[d.key]?.length ? <span className="num" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>{a.filters[d.key].length}</span> : null}
                </button>
                {openKey === d.key && (
                  <div style={{ paddingLeft: 'var(--s5)', maxHeight: 190, overflowY: 'auto' }}>
                    <FilterOptions dimension={d.key} options={optionsCache[d.key] ?? []} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pop__sep" />
          <button className="pop__item" onClick={a.resetFilters}>
            <Icon name="close" size={12} /> Clear all filters
          </button>
        </>
      )}
    </Popover>
  );
}

function FilterOptions({ dimension, options }: { dimension: string; options: string[] }) {
  const a = useAnalytics();
  const sel = a.filters[dimension] ?? [];
  if (!options.length) return <div className="formrow__hint" style={{ padding: '4px 8px' }}>No values loaded yet</div>;
  return (
    <>
      {options.map(o => (
        <label key={o} className="pop__item check" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={sel.includes(o)}
            onChange={() => a.setFilter(dimension, sel.includes(o) ? sel.filter(x => x !== o) : [...sel, o])} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o}</span>
        </label>
      ))}
    </>
  );
}

function ActiveChips() {
  const a = useAnalytics();
  return (
    <span className="chips">
      {Object.entries(a.filters).filter(([, v]) => v.length).map(([k, v]) => (
        <span key={k} className="chip">
          {k.replace(/_/g, ' ')} <b>{v.length === 1 ? v[0] : `${v.length} selected`}</b>
          <button className="chip__x" onClick={() => a.clearFilter(k)} aria-label={`Clear ${k} filter`}>
            <Icon name="close" size={10} strokeWidth={2.4} />
          </button>
        </span>
      ))}
    </span>
  );
}
