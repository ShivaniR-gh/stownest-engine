import { Icon } from '@/components/primitives';

/** One filter control in the .filter-bar row — same icon + clean-field
 *  system DatasetFilters already uses for Records, applied to the
 *  dashboard-level Analysis filters (City, Client type, Service, ...).
 *  Turns accent-blue via `.is-on` the moment it's off its "All" default,
 *  same rule DatasetFilters uses: blue means "this is narrowing the data".
 *
 *  The field name is shown, not just announced to screen readers: the row
 *  is a set of otherwise-identical pills, and "All" beside "All" tells you
 *  nothing about which is which. Defaults read "All client types" rather
 *  than "All", and a chosen value is prefixed with the field name so
 *  "Service: Transaction" can't be misread as client type "Transactional". */
export function SelectField({ icon, label, value, onChange, options, isOn }: {
  icon: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  isOn?: boolean;
}) {
  return (
    <label className={`filter-bar__field${isOn ? ' is-on' : ''}`}>
      <Icon name={icon} size={14} />
      {isOn && <span className="filter-bar__name">{label}:</span>}
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
