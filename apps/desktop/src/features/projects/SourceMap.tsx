/**
 * SourceMap -- column layout of project sources grouped by role.
 * Add/remove actions are lifecycle-gated (only in setup/ready phases).
 */

import { memo } from 'react';
import { clsx } from 'clsx';
import type { ProjectSource } from '@/bindings/types';
import { Pill, Btn } from '@/ui';

export interface SourceMapProps {
  sources: ProjectSource[];
  /** Whether the project is in a phase that allows editing (setup/ready). */
  editable: boolean;
}

const ROLE_ORDER: ProjectSource['role'][] = ['light', 'dark', 'flat', 'bias'];

const ROLE_LABELS: Record<ProjectSource['role'], string> = {
  light: 'Lights',
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
};

export const SourceMap = memo(function SourceMap({ sources, editable }: SourceMapProps) {
  const grouped = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    items: sources.filter((s) => s.role === role),
  }));

  return (
    <div className="alm-source-map" role="region" aria-label="Source map">
      <div className="alm-source-map__columns">
        {grouped.map((group) => (
          <div key={group.role} className="alm-source-map__column">
            <div className="alm-source-map__column-header">
              <span className="alm-source-map__column-title">{group.label}</span>
              <span className="alm-source-map__column-count">{group.items.length}</span>
            </div>
            <div className="alm-source-map__items">
              {group.items.map((src) => (
                <div
                  key={src.name}
                  className={clsx(
                    'alm-source-map__item',
                    src.selection === 'candidate' && 'alm-source-map__item--candidate',
                  )}
                >
                  <span className="alm-source-map__item-name alm-mono">{src.name}</span>
                  <span className="alm-source-map__item-meta">
                    {src.frames} frames
                    {src.hours !== '—' && ` · ${src.hours}`}
                  </span>
                  {src.warning && (
                    <span className="alm-source-map__item-warn">{src.warning}</span>
                  )}
                  <Pill
                    label={src.selection}
                    variant={src.selection === 'selected' ? 'ok' : 'warn'}
                    size="sm"
                  />
                </div>
              ))}
              {group.items.length === 0 && (
                <span className="alm-source-map__empty">None assigned</span>
              )}
            </div>
            {editable && (
              <Btn size="sm" variant="ghost">+ Add {group.label.toLowerCase()}</Btn>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
