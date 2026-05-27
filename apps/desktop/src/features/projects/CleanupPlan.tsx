/**
 * CleanupPlan -- reviewable cleanup opportunities with per-item details.
 * Uses mock data matching the project detail fixture artifacts.
 */

import { memo } from 'react';
import { clsx } from 'clsx';
import type { ProjectArtifactGroup } from '@/bindings/types';
import { Pill, Btn } from '@/ui';
import { formatBytes } from '@/lib/format';

export interface CleanupPlanProps {
  artifacts: ProjectArtifactGroup[];
  cleanupLabel: string;
}


function eligibilityVariant(eligibility: ProjectArtifactGroup['cleanup_eligibility']) {
  switch (eligibility) {
    case 'eligible': return 'warn' as const;
    case 'archive': return 'info' as const;
    case 'keep': return 'ok' as const;
    case 'none': return 'ghost' as const;
  }
}

export const CleanupPlan = memo(function CleanupPlan({
  artifacts,
  cleanupLabel,
}: CleanupPlanProps) {
  const eligibleItems = artifacts.filter((a) => a.cleanup_eligibility === 'eligible');
  const totalReclaimable = eligibleItems.reduce((acc, a) => acc + a.total_size_bytes, 0);

  return (
    <div className="alm-cleanup-plan" role="region" aria-label="Cleanup plan">
      <div className="alm-cleanup-plan__summary">
        <span className="alm-cleanup-plan__summary-label">
          Reclaimable: <strong className="alm-mono">{cleanupLabel}</strong>
        </span>
        <span className="alm-cleanup-plan__summary-count">
          {eligibleItems.length} artifact group{eligibleItems.length !== 1 ? 's' : ''} eligible
        </span>
        <Btn size="sm">Generate cleanup plan</Btn>
      </div>

      <div className="alm-cleanup-plan__table" role="table" aria-label="Artifact groups">
        <div className="alm-cleanup-plan__row alm-cleanup-plan__row--header" role="row">
          <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--type" role="columnheader">Type</span>
          <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--count" role="columnheader">Count</span>
          <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--size" role="columnheader">Size</span>
          <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--eligibility" role="columnheader">Eligibility</span>
          <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--tool" role="columnheader">Tool</span>
        </div>
        {artifacts.map((artifact) => (
          <div
            key={artifact.type}
            className={clsx(
              'alm-cleanup-plan__row',
              artifact.protected && 'alm-cleanup-plan__row--protected',
            )}
            role="row"
          >
            <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--type" role="cell">
              {artifact.protected && (
                <span className="alm-cleanup-plan__lock" aria-label="Protected" title="Protected">&#x1F512;</span>
              )}
              {artifact.type}
              {artifact.warning && (
                <span className="alm-cleanup-plan__warn">{artifact.warning}</span>
              )}
            </span>
            <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--count alm-mono" role="cell">
              {artifact.count}
            </span>
            <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--size alm-mono" role="cell">
              {formatBytes(artifact.total_size_bytes)}
            </span>
            <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--eligibility" role="cell">
              <Pill
                label={artifact.cleanup_eligibility}
                variant={eligibilityVariant(artifact.cleanup_eligibility)}
                size="sm"
              />
            </span>
            <span className="alm-cleanup-plan__cell alm-cleanup-plan__cell--tool alm-mono" role="cell">
              {artifact.tool}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
