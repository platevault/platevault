import { useState } from 'react';
import { Box } from '@/ui/Box';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { useDirectoryPicker } from '@/shared/native/picker';
import { clsx } from 'clsx';
import type { SourceEntry, SourceKind, ScanDepth } from '../sources-store';
import {
  ALL_SOURCE_KINDS,
  SOURCE_KIND_LABELS,
  REQUIRED_KINDS,
  getMissingRequiredKinds,
} from '../sources-store';

export interface StepSourceFoldersProps {
  entries: SourceEntry[];
  onAdd: (path: string, kind: SourceKind) => void;
  onRemove: (index: number) => void;
  onKindChange: (index: number, kind: SourceKind) => void;
  onScanDepthChange: (index: number, depth: ScanDepth) => void;
  errors: Record<number, string>;
}

/**
 * Step 1 -- Source Folders.
 * Combines all source folder types into a single screen with an intro paragraph,
 * folder list with type selectors, and a validation summary.
 */
export function StepSourceFolders({
  entries,
  onAdd,
  onRemove,
  onKindChange,
  onScanDepthChange,
  errors,
}: StepSourceFoldersProps) {
  const missingKinds = getMissingRequiredKinds(entries);

  return (
    <div className="alm-step-sources">
      <p className="alm-step-sources__intro">
        Organize your astrophotography library, map sessions to targets and projects,
        prepare inputs for PixInsight, and safely plan filesystem changes — all without
        touching your raw files. Add the folders where your data lives to get started.
      </p>

      <Box>
        {/* Folder list or empty state */}
        <div className="alm-step-sources__list">
          {entries.length === 0 && (
            <div className="alm-step-sources__empty">
              No folders added yet. Click the button below to add your first source folder.
            </div>
          )}

          {entries.map((entry, idx) => (
            <SourceRow
              key={`${entry.path}-${idx}`}
              entry={entry}
              error={errors[idx]}
              onRemove={() => onRemove(idx)}
              onKindChange={(kind) => onKindChange(idx, kind)}
              onScanDepthChange={(depth) => onScanDepthChange(idx, depth)}
            />
          ))}
        </div>

        {/* Add folder button */}
        <div className="alm-step-sources__actions">
          <AddFolderButton onAdd={onAdd} />
        </div>
      </Box>

      {/* Validation summary */}
      {missingKinds.length > 0 && (
        <div className="alm-step-sources__validation">
          <span className="alm-step-sources__validation-label">Required:</span>
          {REQUIRED_KINDS.map((kind) => {
            const isMissing = missingKinds.includes(kind);
            return (
              <Pill key={kind} variant={isMissing ? 'warn' : 'ok'}>
                {`${SOURCE_KIND_LABELS[kind]}${isMissing ? ' (missing)' : ''}`}
              </Pill>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A single source row with path, type selector, and remove button. */
function SourceRow({
  entry,
  error,
  onRemove,
  onKindChange,
  onScanDepthChange,
}: {
  entry: SourceEntry;
  error?: string;
  onRemove: () => void;
  onKindChange: (kind: SourceKind) => void;
  onScanDepthChange: (depth: ScanDepth) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="alm-step-sources__row">
      <div className="alm-step-sources__row-main">
        <div className="alm-step-sources__row-path">
          {entry.path}
        </div>
        <select
          className="alm-step-sources__kind-select"
          value={entry.kind}
          onChange={(e) => onKindChange(e.target.value as SourceKind)}
          aria-label="Source type"
        >
          {ALL_SOURCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SOURCE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <Pill variant={REQUIRED_KINDS.includes(entry.kind) ? 'warn' : 'ghost'}>
          {REQUIRED_KINDS.includes(entry.kind) ? 'REQUIRED' : 'OPTIONAL'}
        </Pill>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="alm-step-sources__advanced-btn"
        >
          Advanced
        </Btn>
        <Btn size="sm" onClick={onRemove}>
          Remove
        </Btn>
      </div>

      {error && (
        <div className="alm-step-sources__row-error">
          {error}
        </div>
      )}

      {showAdvanced && (
        <div className="alm-step-sources__row-advanced">
          <span className="alm-step-sources__row-advanced-label">Scan depth:</span>
          <select
            className="alm-step-sources__depth-select"
            value={entry.scanDepth}
            onChange={(e) => onScanDepthChange(e.target.value as ScanDepth)}
            aria-label="Scan depth"
          >
            <option value="recursive">Recursive (all subfolders)</option>
            <option value="single">Single level (top folder only)</option>
          </select>
        </div>
      )}
    </div>
  );
}

/** Button that opens native directory picker and calls onAdd with the selected path and default kind. */
function AddFolderButton({ onAdd }: { onAdd: (path: string, kind: SourceKind) => void }) {
  const { pick, loading, error } = useDirectoryPicker();

  const handleChoose = async () => {
    const result = await pick(undefined, 'raw');
    if (result.path) {
      onAdd(result.path, 'light_frames');
    }
  };

  return (
    <div>
      <Btn size="sm" onClick={handleChoose} disabled={loading}>
        {loading ? 'Choosing...' : '+ Add folder...'}
      </Btn>
      {error && (
        <div className="alm-step-sources__picker-error">
          {error.message}
        </div>
      )}
    </div>
  );
}
