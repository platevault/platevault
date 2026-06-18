import { useState } from 'react';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { useDirectoryPicker } from '@/shared/native';
import type { LastPathKind } from '@/shared/native';
import type { SourceEntry, SourceKind, ScanDepth } from '../sources-store';
import {
  ALL_SOURCE_KINDS,
  SOURCE_KIND_LABELS,
  REQUIRED_KINDS,
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
 * One persistent card per source kind. Each card has its own "Add folder"
 * button (type-first by construction) that opens the OS picker and registers
 * the folder under that card's kind. Required kinds highlight their card to
 * convey met / unmet status; the surrounding wizard still gates "Continue" on
 * getMissingRequiredKinds().
 */
export function StepSourceFolders({
  entries,
  onAdd,
  onRemove,
  onScanDepthChange,
  errors,
}: StepSourceFoldersProps) {
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
        touching your raw files. Add at least one folder to each required type below.
      </p>

      <div
        className="alm-step-sources__groups"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-4)' }}
      >
        {ALL_SOURCE_KINDS.map((kind) => {
          const rows = indexed.filter(({ entry }) => entry.kind === kind);
          return (
            <SourceGroup
              key={kind}
              kind={kind}
              rows={rows}
              errors={errors}
              onAdd={onAdd}
              onRemove={onRemove}
              onScanDepthChange={onScanDepthChange}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A persistent type group card: heading + requirement highlight + folder rows + add button. */
function SourceGroup({
  kind,
  rows,
  errors,
  onAdd,
  onRemove,
  onScanDepthChange,
}: {
  kind: SourceKind;
  rows: { entry: SourceEntry; index: number }[];
  errors: Record<number, string>;
  onAdd: (path: string, kind: SourceKind) => void;
  onRemove: (index: number) => void;
  onScanDepthChange: (index: number, depth: ScanDepth) => void;
}) {
  const isRequired = REQUIRED_KINDS.includes(kind);
  const isMet = rows.length > 0;

  // Requirement highlight: met required → ok accent; unmet required → warn
  // accent; optional kinds render with the neutral box treatment.
  let cardBorder = '1px solid var(--alm-border)';
  let cardBackground = 'var(--alm-bg)';
  let headerBorder = '1px solid var(--alm-border-subtle)';
  if (isRequired && isMet) {
    cardBorder = '1px solid var(--alm-ok-border)';
    cardBackground = 'var(--alm-ok-bg)';
    headerBorder = '1px solid var(--alm-ok-border)';
  } else if (isRequired && !isMet) {
    cardBorder = '1px solid var(--alm-warn-border)';
    cardBackground = 'var(--alm-warn-bg)';
    headerBorder = '1px solid var(--alm-warn-border)';
  }

  return (
    <div
      className="alm-step-sources__group"
      data-testid={`source-group-${kind}`}
      data-required={isRequired ? 'true' : 'false'}
      data-requirement-met={isRequired ? (isMet ? 'true' : 'false') : undefined}
      style={{
        border: cardBorder,
        borderRadius: 'var(--alm-radius-md)',
        background: cardBackground,
        overflow: 'hidden',
      }}
    >
      {/* Group header: type name + count + requirement status + add button */}
      <div
        className="alm-step-sources__group-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-sp-2)',
          padding: 'var(--alm-sp-2) var(--alm-sp-3)',
          borderBottom: headerBorder,
        }}
      >
        <span
          style={{
            fontSize: 'var(--alm-text-xs)',
            fontWeight: 'var(--alm-weight-semibold)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--alm-text-secondary)',
          }}
        >
          {SOURCE_KIND_LABELS[kind]}
        </span>
        {isMet && (
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            ({rows.length})
          </span>
        )}
        {isRequired && (
          <Pill
            variant={isMet ? 'ok' : 'warn'}
            data-testid={`requirement-status-${kind}`}
          >
            {isMet ? 'required ✓' : 'required — add one'}
          </Pill>
        )}
        <span style={{ flex: 1 }} />
        <AddFolderButton kind={kind} onAdd={onAdd} />
      </div>

      {/* Folder rows for this kind, or a slim empty hint */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--alm-sp-2)',
          padding: 'var(--alm-sp-3)',
        }}
      >
        {rows.length === 0 ? (
          <div
            className="alm-step-sources__group-empty"
            style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-faint)' }}
          >
            No {SOURCE_KIND_LABELS[kind].toLowerCase()} folders added yet.
          </div>
        ) : (
          rows.map(({ entry, index }) => (
            <SourceRow
              key={`${entry.path}-${index}`}
              entry={entry}
              error={errors[index]}
              onRemove={() => onRemove(index)}
              onScanDepthChange={(depth) => onScanDepthChange(index, depth)}
            />
          ))
        )}
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
        background: 'var(--alm-surface-raised)',
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
 * Per-group button that opens the native directory picker and adds the chosen
 * folder under this group's kind (type-first by construction).
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--alm-sp-1)' }}>
      <Btn
        size="sm"
        variant="primary"
        onClick={handleChoose}
        disabled={loading}
        aria-label={`Add ${SOURCE_KIND_LABELS[kind]} folder`}
      >
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
