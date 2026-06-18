import { useState } from 'react';
import { Box } from '@/ui/Box';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { EmptyState } from '@/ui/EmptyState';
import { useDirectoryPicker } from '@/shared/native';
import type { LastPathKind } from '@/shared/native';
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

/** Map a source kind to the picker's last-path affordance bucket. */
const KIND_TO_LAST_PATH: Record<SourceKind, LastPathKind> = {
  light_frames: 'raw',
  dark: 'calibration',
  flat: 'calibration',
  bias: 'calibration',
  project: 'project',
  inbox: 'inbox',
};

/**
 * Step 1 -- Source Folders.
 *
 * Type-first add flow: the user picks the frame/source type, then clicks
 * "Add folder" to open the OS picker; the chosen folder is added with that
 * pre-selected type. Added folders are listed grouped by type, and the
 * required source types render as met/unmet pills.
 */
export function StepSourceFolders({
  entries,
  onAdd,
  onRemove,
  onScanDepthChange,
  errors,
}: StepSourceFoldersProps) {
  const [selectedKind, setSelectedKind] = useState<SourceKind>('light_frames');
  const missingKinds = getMissingRequiredKinds(entries);

  // Stable index lookup so per-row remove/advanced map back to the flat array.
  const indexed = entries.map((entry, index) => ({ entry, index }));

  return (
    <div
      className="alm-step-sources"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-5)' }}
    >
      <p
        className="alm-step-sources__intro"
        style={{
          margin: 0,
          fontSize: 'var(--alm-text-base)',
          lineHeight: 'var(--alm-leading-relaxed)',
          color: 'var(--alm-text-secondary)',
        }}
      >
        Organize your astrophotography library, map sessions to targets and projects,
        prepare inputs for PixInsight, and safely plan filesystem changes — all without
        touching your raw files. Choose a folder type, then add the folder where that
        data lives.
      </p>

      {/* Required-source indicator: one pill per required type-group. */}
      <div
        className="alm-step-sources__requirements"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', flexWrap: 'wrap' }}
      >
        <span
          style={{
            fontSize: 'var(--alm-text-2xs)',
            fontWeight: 'var(--alm-weight-semibold)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--alm-text-muted)',
          }}
        >
          Required
        </span>
        {REQUIRED_KINDS.map((kind) => {
          const isMet = !missingKinds.includes(kind);
          return (
            <Pill
              key={kind}
              variant={isMet ? 'ok' : 'warn'}
              data-testid={`requirement-pill-${kind}`}
              data-met={isMet ? 'true' : 'false'}
            >
              {SOURCE_KIND_LABELS[kind]} {isMet ? '✓' : '✗'}
            </Pill>
          );
        })}
      </div>

      {/* Type-first add bar: select type, then open the OS picker. */}
      <Box title="Add a source folder">
        <div
          className="alm-step-sources__add"
          style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--alm-sp-3)', flexWrap: 'wrap' }}
        >
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)' }}
          >
            <span
              style={{
                fontSize: 'var(--alm-text-2xs)',
                fontWeight: 'var(--alm-weight-semibold)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--alm-text-muted)',
              }}
            >
              Folder type
            </span>
            <select
              className="alm-step-sources__kind-select"
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value as SourceKind)}
              aria-label="Folder type"
            >
              {ALL_SOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {SOURCE_KIND_LABELS[kind]}
                  {REQUIRED_KINDS.includes(kind) ? ' (required)' : ''}
                </option>
              ))}
            </select>
          </label>

          <AddFolderButton kind={selectedKind} onAdd={onAdd} />
        </div>
      </Box>

      {/* Grouped list of added folders, one section per type. */}
      {entries.length === 0 ? (
        <EmptyState
          title="No folders added yet"
          desc="Pick a folder type above and click “Add folder” to register your first source."
        />
      ) : (
        <div
          className="alm-step-sources__groups"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-4)' }}
        >
          {ALL_SOURCE_KINDS.map((kind) => {
            const rows = indexed.filter(({ entry }) => entry.kind === kind);
            if (rows.length === 0) return null;
            return (
              <SourceGroup
                key={kind}
                kind={kind}
                rows={rows}
                errors={errors}
                onRemove={onRemove}
                onScanDepthChange={onScanDepthChange}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A type group: heading + count + its folder rows. */
function SourceGroup({
  kind,
  rows,
  errors,
  onRemove,
  onScanDepthChange,
}: {
  kind: SourceKind;
  rows: { entry: SourceEntry; index: number }[];
  errors: Record<number, string>;
  onRemove: (index: number) => void;
  onScanDepthChange: (index: number, depth: ScanDepth) => void;
}) {
  const isRequired = REQUIRED_KINDS.includes(kind);
  return (
    <div className="alm-step-sources__group" data-testid={`source-group-${kind}`}>
      <div
        className="alm-step-sources__group-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-sp-2)',
          padding: 'var(--alm-sp-1) 0',
          borderBottom: '1px solid var(--alm-border)',
          marginBottom: 'var(--alm-sp-2)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--alm-text-xs)',
            fontWeight: 'var(--alm-weight-semibold)',
            color: 'var(--alm-text-secondary)',
          }}
        >
          {SOURCE_KIND_LABELS[kind]}
        </span>
        <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          ({rows.length})
        </span>
        {isRequired && <Pill variant="info">required</Pill>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
        {rows.map(({ entry, index }) => (
          <SourceRow
            key={`${entry.path}-${index}`}
            entry={entry}
            error={errors[index]}
            onRemove={() => onRemove(index)}
            onScanDepthChange={(depth) => onScanDepthChange(index, depth)}
          />
        ))}
      </div>
    </div>
  );
}

/** A single source row with path, advanced scan-depth toggle, and remove button. */
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
    <div
      className="alm-step-sources__row"
      style={{
        border: '1px solid var(--alm-border)',
        borderRadius: 'var(--alm-radius-sm)',
        padding: 'var(--alm-sp-2) var(--alm-sp-3)',
        background: 'var(--alm-bg)',
      }}
    >
      <div
        className="alm-step-sources__row-main"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}
      >
        <span
          className="alm-step-sources__row-path alm-mono"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 'var(--alm-text-sm)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={entry.path}
        >
          {entry.path}
        </span>
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
        <div
          className="alm-step-sources__row-error"
          style={{
            marginTop: 'var(--alm-sp-1)',
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-danger)',
          }}
        >
          {error}
        </div>
      )}

      {showAdvanced && (
        <div
          className="alm-step-sources__row-advanced"
          style={{
            marginTop: 'var(--alm-sp-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-sp-2)',
          }}
        >
          <span
            className="alm-step-sources__row-advanced-label"
            style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
          >
            Scan depth:
          </span>
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

/**
 * Button that opens the native directory picker and calls onAdd with the
 * selected path and the currently selected kind (type-first add).
 */
function AddFolderButton({
  kind,
  onAdd,
}: {
  kind: SourceKind;
  onAdd: (path: string, kind: SourceKind) => void;
}) {
  const { pick, loading, error } = useDirectoryPicker();

  const handleChoose = async () => {
    const result = await pick(undefined, KIND_TO_LAST_PATH[kind]);
    if (result.path) {
      onAdd(result.path, kind);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)' }}>
      <Btn variant="primary" size="sm" onClick={handleChoose} disabled={loading}>
        {loading ? 'Choosing…' : '+ Add folder…'}
      </Btn>
      {error && (
        <div
          className="alm-step-sources__picker-error"
          style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-danger)' }}
        >
          {error.message}
        </div>
      )}
    </div>
  );
}
