import { memo } from 'react';

const STAGES = ['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'] as const;

export interface LifecycleStripProps {
  currentIndex: number;
}

export const LifecycleStrip = memo(function LifecycleStrip({ currentIndex }: LifecycleStripProps) {
  return (
    <div className="alm-lifecycle">
      {STAGES.map((stage, i) => (
        <span key={stage}>
          <span
            className={`alm-lifecycle__stage${i <= currentIndex ? ' alm-lifecycle__stage--past' : ''}${i === currentIndex ? ' alm-lifecycle__stage--current' : ''}`}
          >
            {stage}
          </span>
          {i < STAGES.length - 1 && (
            <span className="alm-lifecycle__arrow">&rarr;</span>
          )}
        </span>
      ))}
    </div>
  );
});
