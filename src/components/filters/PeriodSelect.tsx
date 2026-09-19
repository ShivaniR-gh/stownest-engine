import { Icon } from '@/components/primitives';
import { WINDOW_PRESETS, ytdOptions, monthLabel } from '@/lib/analytics/monthWindow';

/** Period dropdown used on every department dashboard — now the same
 *  icon-led .filter-bar__field style as the Records filter bar, so the two
 *  filter rows in the app read as one system rather than two. Period has no
 *  "All" state to fall back off of, so unlike City/Client type/Service it's
 *  never rendered as .is-on — it's always a real selection, not an optional
 *  narrowing of the data. */
export function PeriodSelect({
  value, onChange, monthKeys, id, label = 'Period',
}: {
  value: string;
  onChange: (next: string) => void;
  /** yyyy-mm keys, newest first. */
  monthKeys: string[];
  id?: string;
  label?: string;
}) {
  return (
    <label className="filter-bar__field filter-bar__field--month" htmlFor={id}>
      <Icon name="calendar" size={14} />
      <select id={id} value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
        {WINDOW_PRESETS.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
        {ytdOptions(monthKeys).map(y => (
          <option key={y.id} value={y.id}>{y.label}</option>
        ))}
        {monthKeys.map(k => (
          <option key={k} value={k}>{monthLabel(`${k}-01`)}</option>
        ))}
      </select>
    </label>
  );
}

