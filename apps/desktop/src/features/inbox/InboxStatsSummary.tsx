/**
 * InboxStatsSummary — ONE compact per-frame-type breakdown chip row.
 *
 * spec 043 #83 inbox redesign: the old version was a full stats STRIP that
 * triplicated the folder/master/image totals already shown in the top-bar
 * summary and the global status bar. Those totals are removed here — the global
 * library totals are the status bar's job (#87). What remains is the ONE useful
 * thing this surface adds: a compact per-frame-type breakdown (bias · dark ·
 * flat · light) that the totals alone don't convey. It renders inline as a
 * single element (in the top-bar summary slot), not as a separate pinned strip.
 *
 * Each chip shows the frame type and its folder count (+ master count when the
 * type has masters), e.g. `light 3` / `dark 2 · 1 master`. Counts are derived
 * by {@link deriveInboxStats} from the SAME item list the header counts from, so
 * everything reconciles.
 */

import type { InboxStatsResponse, InboxStatsPerType } from './store';
import { m } from '@/lib/i18n';

export interface InboxStatsSummaryProps {
  stats: InboxStatsResponse;
}

/**
 * Render the per-frame-type breakdown as a compact inline chip row. Returns
 * `null` when there is nothing to break down (no per-type rows).
 */
export function InboxStatsSummary({ stats }: InboxStatsSummaryProps) {
  const { perType } = stats;

  if (perType.length === 0) return null;

  return (
    <span className="alm-inbox-stats" data-testid="inbox-stats-summary">
      {perType.map((row: InboxStatsPerType) => (
        <PerTypeChip key={row.frameType} row={row} />
      ))}
    </span>
  );
}

function PerTypeChip({ row }: { row: InboxStatsPerType }) {
  // Folders are the primary count; masters are individual files, surfaced only
  // when present so a calibration-master type still reads correctly.
  const count = row.folderCount > 0 ? row.folderCount : row.masterCount;
  return (
    <span
      className="alm-inbox-stats__per-type"
      data-testid={`inbox-stats-type-${row.frameType}`}
      title={m.inbox_stats_per_type_title({ folderCount: row.folderCount, masterCount: row.masterCount, imageCount: row.imageCount })}
    >
      <span className="alm-inbox-stats__type">{row.frameType}</span>
      <span className="alm-inbox-stats__num">{count}</span>
      {row.masterCount > 0 && row.folderCount > 0 && (
        // eslint-disable-next-line alm/no-user-string -- "m" is a unit abbreviation for "masters", not a translatable word
        <span className="alm-inbox-stats__label">+{row.masterCount}m</span>
      )}
    </span>
  );
}
