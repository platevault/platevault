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

/**
 * Render aggregate inbox stats as a compact horizontal summary strip.
 * Displayed just below the top action bar in InboxPage.
 */
export function InboxStatsSummary({ stats }: InboxStatsSummaryProps) {
  const { totals, perType } = stats;

  return (
    <div
      className="alm-inbox-stats"
      data-testid="inbox-stats-summary"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--alm-sp-3)',
        alignItems: 'center',
        padding: 'var(--alm-sp-1) var(--alm-sp-3)',
        borderBottom: '1px solid var(--alm-border)',
        fontSize: 'var(--alm-text-xs)',
        color: 'var(--alm-text-secondary)',
        background: 'var(--alm-surface-raised)',
      }}
    >
      {/* Aggregate totals */}
      <span className="alm-inbox-stats__totals" data-testid="inbox-stats-totals">
        <StatChip label="Folders" value={totals.folders} testId="inbox-stats-total-folders" />
        <StatChip label="Masters" value={totals.masters} testId="inbox-stats-total-masters" />
        <StatChip label="Images" value={totals.images} testId="inbox-stats-total-images" />
      </span>

      {/* Separator */}
      {perType.length > 0 && (
        <span
          aria-hidden
          style={{ borderLeft: '1px solid var(--alm-border)', alignSelf: 'stretch' }}
        />
      )}

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
    <span
      data-testid={testId}
      style={{ marginRight: 'var(--alm-sp-2)', whiteSpace: 'nowrap' }}
    >
      <span style={{ fontWeight: 600, color: 'var(--alm-text-primary)' }}>{value}</span>
      {' '}
      <span style={{ color: 'var(--alm-text-muted)' }}>{label}</span>
    </span>
  );
}

function PerTypeRow({ row }: { row: InboxStatsPerType }) {
  return (
    <span
      className="alm-inbox-stats__per-type"
      data-testid={`inbox-stats-type-${row.frameType}`}
      style={{ whiteSpace: 'nowrap' }}
    >
      <span
        style={{
          display: 'inline-block',
          fontWeight: 600,
          color: 'var(--alm-text-primary)',
          marginRight: 'var(--alm-sp-1)',
          textTransform: 'capitalize',
        }}
      >
        {row.frameType}
      </span>
      <span style={{ color: 'var(--alm-text-muted)' }}>
        {row.folderCount}
        {row.masterCount > 0 ? `+${row.masterCount}M` : ''} folders
        {' · '}
        {row.imageCount} files
      </span>
    </span>
  );
}
