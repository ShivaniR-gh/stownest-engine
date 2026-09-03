import { Button, Tooltip } from '@/components/primitives';
import { isStale, refreshAll } from '@/lib/data/store';
import { relativeTime } from '@/lib/format';

/**
 * Sync state and refresh, present on every analytical screen.
 *
 * This used to carry the period picker, dimension filters and the compare
 * toggle. They were removed: the screens that matter scope their own data —
 * collections and marketing each have a month picker inside their dashboard —
 * so a global period was a lever attached to nothing on exactly the pages
 * people used most. Worse, it defaulted to the last 30 days, which on a
 * September morning emptied a table of February-to-July months and read as a
 * data outage rather than a filter.
 *
 * The period still exists in AnalyticsContext, pinned to all-time. If a date
 * picker is ever wanted back, it belongs per-screen and next to the data it
 * scopes, not in a global bar above unrelated pages.
 *
 * `left` exists because removing those controls left the bar as an empty strip
 * with two small items floated right. A page can put its own primary control
 * there — Department passes the Dashboard/Records toggle — rather than
 * stacking it in yet another row below.
 *
 * `datasetIds` is kept in the signature because five call sites pass it and it
 * is what a future per-screen filter would need to enumerate its dimensions.
 */
export function ControlBar({
  fetchedAt, busy, onRefresh, left, right,
}: {
  datasetIds: string[];
  fetchedAt: number | null;
  busy?: boolean;
  onRefresh?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const stale = isStale(fetchedAt);

  return (
    <div className="ctlbar no-print">
      {left}

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
