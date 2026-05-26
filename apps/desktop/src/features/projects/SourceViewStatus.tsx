/**
 * SourceViewStatus -- shows generated/not status, file counts, path, reveal button.
 */

import { memo } from 'react';
import type { ProjectSourceView } from '@/bindings/types';
import { Pill, Btn } from '@/ui';

export interface SourceViewStatusProps {
  views: ProjectSourceView[];
}

export const SourceViewStatus = memo(function SourceViewStatus({ views }: SourceViewStatusProps) {
  if (views.length === 0) {
    return (
      <div className="alm-source-views" role="region" aria-label="Source views">
        <div className="alm-source-views__empty">
          <span className="alm-source-views__empty-text">No source views generated yet.</span>
          <Btn size="sm">Generate source view</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="alm-source-views" role="region" aria-label="Source views">
      {views.map((view) => (
        <div key={view.name} className="alm-source-views__item">
          <div className="alm-source-views__item-header">
            <span className="alm-source-views__item-name alm-mono">{view.name}</span>
            <Pill label="generated" variant="ok" size="sm" />
          </div>
          <div className="alm-source-views__item-meta">
            <span>Strategy: {view.strategy}</span>
            <span className="alm-source-views__item-sep" aria-hidden="true">&middot;</span>
            <span>{view.link_count} files</span>
            <span className="alm-source-views__item-sep" aria-hidden="true">&middot;</span>
            <span>{view.plan_ref}</span>
          </div>
          <div className="alm-source-views__item-actions">
            <Btn size="sm" variant="ghost">Reveal in Explorer</Btn>
          </div>
        </div>
      ))}
    </div>
  );
});
