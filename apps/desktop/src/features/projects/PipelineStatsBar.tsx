/**
 * PipelineStatsBar -- compact single-row summary of project pipeline stats.
 * Shows: Sources: N | Views: N | On disk: X | Outputs: N
 */

import { memo } from 'react';

export interface PipelineStatsBarProps {
  sourceCount: number;
  viewCount: number;
  onDiskLabel: string;
  outputCount: number;
}

export const PipelineStatsBar = memo(function PipelineStatsBar({
  sourceCount,
  viewCount,
  onDiskLabel,
  outputCount,
}: PipelineStatsBarProps) {
  return (
    <div className="alm-pipeline-stats" role="status" aria-label="Pipeline statistics">
      <span className="alm-pipeline-stats__item">
        <span className="alm-pipeline-stats__label">Sources:</span>
        <span className="alm-pipeline-stats__value alm-mono">{sourceCount}</span>
      </span>
      <span className="alm-pipeline-stats__sep" aria-hidden="true">|</span>
      <span className="alm-pipeline-stats__item">
        <span className="alm-pipeline-stats__label">Views:</span>
        <span className="alm-pipeline-stats__value alm-mono">{viewCount}</span>
      </span>
      <span className="alm-pipeline-stats__sep" aria-hidden="true">|</span>
      <span className="alm-pipeline-stats__item">
        <span className="alm-pipeline-stats__label">On disk:</span>
        <span className="alm-pipeline-stats__value alm-mono">{onDiskLabel}</span>
      </span>
      <span className="alm-pipeline-stats__sep" aria-hidden="true">|</span>
      <span className="alm-pipeline-stats__item">
        <span className="alm-pipeline-stats__label">Outputs:</span>
        <span className="alm-pipeline-stats__value alm-mono">{outputCount}</span>
      </span>
    </div>
  );
});
