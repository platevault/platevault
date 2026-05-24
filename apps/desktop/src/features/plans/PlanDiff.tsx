import { memo } from 'react';
import type { PlanItem } from '@/api/types';

export interface PlanDiffProps {
  items: PlanItem[];
}

interface DiffLine {
  path: string;
  type: 'removed' | 'added' | 'archived' | 'deleted' | 'protected';
}

export const PlanDiff = memo(function PlanDiff({ items }: PlanDiffProps) {
  const beforeLines: DiffLine[] = [];
  const afterLines: DiffLine[] = [];

  for (const item of items) {
    // Before column: show source paths that are being moved/removed
    if (item.source_path) {
      const type = item.status === 'protected' ? 'protected' : 'removed';
      beforeLines.push({ path: item.source_path, type });
    }

    // After column: show dest paths and action outcomes
    if (item.dest_path) {
      afterLines.push({ path: item.dest_path, type: 'added' });
    } else if (item.action === 'archive') {
      afterLines.push({ path: item.source_path, type: 'archived' });
    } else if (item.action === 'delete') {
      afterLines.push({ path: item.source_path, type: 'deleted' });
    } else if (item.action === 'trash') {
      afterLines.push({ path: item.source_path, type: 'archived' });
    }

    // Protected items in after column
    if (item.status === 'protected') {
      afterLines.push({ path: item.source_path, type: 'protected' });
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--alm-space-4)', overflow: 'auto', flex: 1 }}>
      {/* Before column */}
      <div>
        <h4 style={{ fontSize: 'var(--alm-text-xs)', fontWeight: 600, color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Before
        </h4>
        <div style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)', lineHeight: 1.8 }}>
          {beforeLines.map((line, i) => (
            <div key={`${line.path}-${i}`} style={{ display: 'flex', gap: 'var(--alm-space-2)' }}>
              <span style={{ color: line.type === 'protected' ? 'var(--alm-gray-400)' : 'var(--alm-danger)', flexShrink: 0 }}>
                {line.type === 'protected' ? '\u{1F512}' : '−'}
              </span>
              <span style={{ color: line.type === 'removed' ? 'var(--alm-danger)' : 'var(--alm-text-muted)', wordBreak: 'break-all' }}>
                {line.path}
              </span>
            </div>
          ))}
          {beforeLines.length === 0 && (
            <span style={{ color: 'var(--alm-text-muted)' }}>No source removals</span>
          )}
        </div>
      </div>

      {/* After column */}
      <div>
        <h4 style={{ fontSize: 'var(--alm-text-xs)', fontWeight: 600, color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          After
        </h4>
        <div style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)', lineHeight: 1.8 }}>
          {afterLines.map((line, i) => {
            let glyph: string;
            let color: string;
            switch (line.type) {
              case 'added':
                glyph = '+';
                color = 'var(--alm-ok)';
                break;
              case 'archived':
                glyph = '→';
                color = 'var(--alm-warn)';
                break;
              case 'deleted':
                glyph = '✕';
                color = 'var(--alm-danger)';
                break;
              case 'protected':
                glyph = '\u{1F512}';
                color = 'var(--alm-gray-400)';
                break;
              default:
                glyph = '+';
                color = 'var(--alm-ok)';
            }
            return (
              <div key={`${line.path}-${i}`} style={{ display: 'flex', gap: 'var(--alm-space-2)' }}>
                <span style={{ color, flexShrink: 0 }}>{glyph}</span>
                <span style={{ color, wordBreak: 'break-all' }}>{line.path}</span>
              </div>
            );
          })}
          {afterLines.length === 0 && (
            <span style={{ color: 'var(--alm-text-muted)' }}>No destinations</span>
          )}
        </div>
      </div>
    </div>
  );
});
