/**
 * LifecycleStrip -- 5-phase linear progress indicator for project lifecycle.
 * Phases: Setup -> Ready -> Processing -> Completed -> Archived
 */

import { memo } from 'react';
import { clsx } from 'clsx';

const STAGES = ['setup', 'ready', 'processing', 'completed', 'archived'] as const;

export type LifecycleStage = (typeof STAGES)[number];

export interface LifecycleStripProps {
  currentIndex: number;
}

export const LifecycleStrip = memo(function LifecycleStrip({ currentIndex }: LifecycleStripProps) {
  return (
    <div className="alm-lifecycle" role="group" aria-label="Project lifecycle">
      {STAGES.map((stage, i) => (
        <span key={stage} className="alm-lifecycle__step">
          <span
            className={clsx(
              'alm-lifecycle__stage',
              i <= currentIndex && 'alm-lifecycle__stage--past',
              i === currentIndex && 'alm-lifecycle__stage--current',
            )}
            aria-current={i === currentIndex ? 'step' : undefined}
          >
            {stage}
          </span>
          {i < STAGES.length - 1 && (
            <span className="alm-lifecycle__arrow" aria-hidden="true">&rarr;</span>
          )}
        </span>
      ))}
    </div>
  );
});
