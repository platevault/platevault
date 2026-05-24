import { memo } from 'react';
import type { SourceMap } from '@/api/types';
import { Box } from '@/ui';

export interface CommandCenterProps {
  sourceMap: SourceMap;
  compact?: boolean;
}

interface KitColumn {
  label: string;
  items: string[];
  color: string;
}

export const CommandCenter = memo(function CommandCenter({ sourceMap, compact }: CommandCenterProps) {
  const columns: KitColumn[] = [
    { label: 'Lights', items: sourceMap.lights, color: 'var(--alm-ok)' },
    { label: 'Darks', items: sourceMap.darks, color: 'var(--alm-gray-500)' },
    { label: 'Flats', items: sourceMap.flats, color: 'var(--alm-info)' },
    { label: 'Bias', items: sourceMap.bias, color: 'var(--alm-warn)' },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--alm-space-4)',
        padding: compact ? 'var(--alm-space-3)' : 'var(--alm-space-5)',
      }}
    >
      {columns.map((col) => (
        <Box key={col.label} heading={col.label}>
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {col.items.length === 0 ? (
              <span>None assigned</span>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-1)' }}>
                {col.items.map((id) => (
                  <li
                    key={id}
                    style={{
                      padding: 'var(--alm-space-1) var(--alm-space-2)',
                      background: 'var(--alm-surface)',
                      borderRadius: 4,
                      borderLeft: `3px solid ${col.color}`,
                      fontFamily: 'var(--alm-font-mono)',
                      fontSize: compact ? '10px' : 'var(--alm-text-xs)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {id.slice(0, 12)}...
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Box>
      ))}
    </div>
  );
});
