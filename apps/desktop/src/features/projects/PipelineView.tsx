import { memo } from 'react';
import type { ProjectDetail } from '@/api/types';
import { Pill } from '@/ui';

export interface PipelineViewProps {
  project: ProjectDetail;
}

interface PipelineStage {
  label: string;
  count: number;
  state: 'ok' | 'info' | 'neutral' | 'warn';
}

export const PipelineView = memo(function PipelineView({ project }: PipelineViewProps) {
  const sourceCount =
    project.source_map.lights.length +
    project.source_map.darks.length +
    project.source_map.flats.length +
    project.source_map.bias.length;

  const stages: PipelineStage[] = [
    {
      label: 'Sources',
      count: sourceCount,
      state: sourceCount > 0 ? 'ok' : 'warn',
    },
    {
      label: 'Source views',
      count: project.source_view_ids.length,
      state: project.source_view_ids.length > 0 ? 'info' : 'neutral',
    },
    {
      label: 'Processing',
      count: project.artifacts.length,
      state: project.state === 'processing' ? 'info' : 'neutral',
    },
    {
      label: 'Outputs',
      count: project.outputs.length,
      state: project.outputs.length > 0 ? 'ok' : 'neutral',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: 'var(--alm-space-5)',
        overflow: 'auto',
      }}
    >
      {stages.map((stage, i) => (
        <div key={stage.label} style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--alm-space-2)',
              padding: 'var(--alm-space-4) var(--alm-space-5)',
              border: '1px solid var(--alm-border)',
              borderRadius: 8,
              minWidth: 120,
              background: 'var(--alm-surface)',
            }}
          >
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', fontWeight: 600 }}>
              {stage.label}
            </span>
            <span style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 700 }}>
              {stage.count}
            </span>
            <Pill label={stage.state === 'ok' ? 'ready' : stage.state === 'info' ? 'active' : 'pending'} variant={stage.state} size="sm" />
          </div>
          {i < stages.length - 1 && (
            <span
              style={{
                display: 'inline-block',
                width: 32,
                height: 2,
                background: 'var(--alm-border)',
                position: 'relative',
              }}
              aria-hidden="true"
            >
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  top: -4,
                  fontSize: 10,
                  color: 'var(--alm-text-muted)',
                }}
              >
                &#x2192;
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
});
