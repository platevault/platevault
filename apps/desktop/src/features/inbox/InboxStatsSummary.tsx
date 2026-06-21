/**
 * InboxStatsSummary — compact totals + per-frame-type breakdown strip.
 *
 * spec 041 US6 / T039: surfaces aggregate inbox queue stats (folders / masters /
 * images) with a per-frame-type breakdown. Fetched once on mount; caller
 * refreshes by unmount/remount or via the `refresh` prop.
 */

import type { InboxStatsResponse, InboxStatsPerType } from './store';

export interface InboxStatsSummaryProps {
  stats: InboxStatsResponse;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Render aggregate inbox stats as a compact horizontal summary strip.
 * Displayed just below the top action bar in InboxPage.
 */
export function InboxStatsSummary({ stats }: InboxStatsSummaryProps) {
  const { totals, perType } = stats;

  return (
    <div className="alm-inbox-stats" data-testid="inbox-stats-summary">
      {/* Aggregate totals */}
      <span className="alm-inbox-stats__totals" data-testid="inbox-stats-totals">
        <StatChip label="Folders" value={totals.folders} testId="inbox-stats-total-folders" />
        <StatChip label="Masters" value={totals.masters} testId="inbox-stats-total-masters" />
        <StatChip label="Images" value={totals.images} testId="inbox-stats-total-images" />
      </span>

      {/* Separator */}
      {perType.length > 0 && <span aria-hidden className="alm-inbox-stats__sep" />}

      {/* Per-frame-type breakdown */}
      {perType.map((row: InboxStatsPerType) => (
        <PerTypeRow key={row.frameType} row={row} />
      ))}
    </div>
  );
}

function StatChip({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <span data-testid={testId} className="alm-inbox-stats__chip">
      <span className="alm-inbox-stats__num">{value}</span>{' '}
      <span className="alm-inbox-stats__label">{label}</span>
    </span>
  );
}

function PerTypeRow({ row }: { row: InboxStatsPerType }) {
  return (
    <span
      className="alm-inbox-stats__per-type"
      data-testid={`inbox-stats-type-${row.frameType}`}
    >
      <span className="alm-inbox-stats__type">{row.frameType}</span>
      <span className="alm-inbox-stats__label">
        {/* Folders and masters counted separately (masters are individual files,
            not folders) — was the cryptic "N+MM folders". */}
        {plural(row.folderCount, 'folder')}
        {row.masterCount > 0 ? ` · ${plural(row.masterCount, 'master')}` : ''}
        {' · '}
        {row.imageCount} files
      </span>
    </span>
  );
}
