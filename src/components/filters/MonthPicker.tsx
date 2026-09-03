import { useEffect, useState } from 'react';
import type { DatasetDef } from '@/config/types';
import { adapter } from '@/lib/data/store';

/** ---------------------------------------------------------------------------
 * Month selector for datasets that keep one tab per month.
 *
 * The list comes from the server rather than being generated here. The API
 * accepts only months it computed itself, so a client-generated list could
 * offer options the server would then refuse — the two must come from one
 * place, and that place has to be the side doing the enforcing.
 * ------------------------------------------------------------------------- */

export function MonthPicker({
  dataset, value, onChange,
}: {
  dataset: DatasetDef;
  value: string;
  onChange: (tab: string) => void;
}) {
  const [months, setMonths] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (dataset.tabStrategy !== 'monthly') return;
    let cancelled = false;

    adapter.list(dataset.id, { tab: value || undefined })
      .then(res => {
        if (cancelled) return;
        setMonths(res.tabs ?? []);
        // Default to the newest month the server offers.
        if (!value && res.tabs?.length) onChange(res.tabs[0]);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
    // Deliberately not re-running on `value`: this fetches the option list,
    // not the rows. The dataset panel reloads rows when the month changes.
  }, [dataset.id, dataset.tabStrategy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dataset.tabStrategy !== 'monthly') return null;

  if (failed) {
    return <span className="muted small">Months unavailable — refresh to try again.</span>;
  }

  return (
    <label className="field-inline">
      <span className="field-label">Month</span>
      <select
        className="select"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={!months.length}
      >
        {!months.length && <option value="">Loading…</option>}
        {months.map(m => (
          <option key={m} value={m}>{m.replace(/^\S+\s/, '')}</option>
        ))}
      </select>
    </label>
  );
}
