import { useState } from 'react';
import { Box } from '@/ui/Box';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { useDirectoryPicker } from '@/shared/native/picker';
import type { SourceEntry, ScanDepth } from '../sources-store';

export interface StepProjectProps {
  entries: SourceEntry[];
  onAdd: (path: string) => void;
  onRemove: (index: number) => void;
  onScanDepthChange: (index: number, depth: ScanDepth) => void;
  errors: Record<number, string>;
}

const EXAMPLE_PATHS = [
  '/astro/projects',
  'D:\\Astrophotography\\Projects',
  '/Volumes/AstroData/Processing',
];

/**
 * Step — Project sources (required).
 * Where processing projects and output files will live.
 */
export function StepProject({ entries, onAdd, onRemove, onScanDepthChange, errors }: StepProjectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      <Box>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--alm-space-4)',
            marginBottom: 'var(--alm-space-3)',
          }}
        >
          <span style={{ fontSize: 'var(--alm-text-base)', fontWeight: 600 }}>
            Project sources
          </span>
          <Pill label="REQUIRED" variant="warn" size="sm" />
        </div>

        <p
          style={{
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text-muted)',
            lineHeight: 1.6,
            marginBottom: 'var(--alm-space-4)',
            maxWidth: 540,
          }}
        >
          Where processing projects and output files will live. Required — project creation
          happens later in the guided workflow.
        </p>

        {/* Folder list or empty state */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
          {entries.length === 0 && (
            <div
              style={{
                padding: 'var(--alm-space-5)',
                border: '1px dashed var(--alm-border)',
                borderRadius: 'var(--alm-radius-sm)',
                color: 'var(--alm-text-muted)',
                fontSize: 'var(--alm-text-sm)',
                textAlign: 'center',
              }}
            >
              No folders added
            </div>
          )}

          {entries.map((entry, idx) => (
            <SourceRow
              key={idx}
              entry={entry}
              error={errors[idx]}
              onRemove={() => onRemove(idx)}
              onScanDepthChange={(depth) => onScanDepthChange(idx, depth)}
            />
          ))}
        </div>

        {/* Add folder button */}
        <div style={{ marginTop: 'var(--alm-space-3)' }}>
          <AddFolderButton onAdd={onAdd} />
        </div>

        {/* Example paths */}
        <div
          style={{
            marginTop: 'var(--alm-space-4)',
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            lineHeight: 1.6,
          }}
        >
          Examples: {EXAMPLE_PATHS.map((p, i) => (
            <span key={p}>
              <code style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' }}>{p}</code>
              {i < EXAMPLE_PATHS.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      </Box>
    </div>
  );
}

function SourceRow({
  entry,
  error,
  onRemove,
  onScanDepthChange,
}: {
  entry: SourceEntry;
  error?: string;
  onRemove: () => void;
  onScanDepthChange: (depth: ScanDepth) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-space-3)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              padding: 'var(--alm-space-2) var(--alm-space-3)',
              background: 'var(--alm-surface)',
              border: '1px solid var(--alm-border)',
              borderRadius: 'var(--alm-radius-sm)',
              fontFamily: 'var(--alm-font-mono)',
              fontSize: 'var(--alm-text-xs)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.path}
          </div>
        </div>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
        >
          Advanced
        </Btn>
        <Btn size="sm" onClick={onRemove}>
          remove
        </Btn>
      </div>

      {error && (
        <div
          style={{
            marginTop: 'var(--alm-space-1)',
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-danger, #dc2626)',
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      {showAdvanced && (
        <div
          style={{
            marginTop: 'var(--alm-space-2)',
            padding: 'var(--alm-space-2) var(--alm-space-3)',
            background: 'var(--alm-bg)',
            borderRadius: 'var(--alm-radius-sm)',
            border: '1px solid var(--alm-border)',
            fontSize: 'var(--alm-text-xs)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-space-3)',
          }}
        >
          <span style={{ color: 'var(--alm-text-muted)' }}>Scan depth:</span>
          <select
            value={entry.scanDepth}
            onChange={(e) => onScanDepthChange(e.target.value as ScanDepth)}
            style={{
              padding: '2px var(--alm-space-2)',
              fontSize: 'var(--alm-text-xs)',
              border: '1px solid var(--alm-border)',
              borderRadius: 'var(--alm-radius-sm)',
              background: 'var(--alm-surface)',
              color: 'var(--alm-text)',
            }}
          >
            <option value="recursive">Recursive (all subfolders)</option>
            <option value="single">Single level (top folder only)</option>
          </select>
        </div>
      )}
    </div>
  );
}

function AddFolderButton({ onAdd }: { onAdd: (path: string) => void }) {
  const { pick, loading, error } = useDirectoryPicker();

  const handleChoose = async () => {
    const result = await pick(undefined, 'library_root');
    if (result.path) {
      onAdd(result.path);
    }
  };

  return (
    <div>
      <Btn size="sm" onClick={handleChoose} disabled={loading}>
        {loading ? 'Choosing...' : '+ Add folder…'}
      </Btn>
      {error && (
        <div
          style={{
            marginTop: 'var(--alm-space-1)',
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-danger, #dc2626)',
            lineHeight: 1.4,
          }}
        >
          {error.message}
        </div>
      )}
    </div>
  );
}
