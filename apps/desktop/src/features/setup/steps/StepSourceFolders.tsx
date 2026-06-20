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
  calibration: 'calibration',
  project: 'project',
  inbox: 'inbox',
};

/**
 * Step 1 -- Source Folders.
 *
 * One persistent, compact card per source kind. Each card has its own "Add
 * folder" button (type-first by construction) that opens the OS picker and
 * registers the folder under that card's kind. Empty groups collapse to a
 * single header row; required kinds highlight their card to convey met / unmet
 * status. The surrounding wizard still gates "Continue" on
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
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}
    >
      <p
        className="alm-step-sources__intro"
        style={{
          margin: 0,
          fontSize: 'var(--alm-text-sm)',
          lineHeight: 'var(--alm-leading-normal)',
          color: 'var(--alm-text-secondary)',
        }}
      >
        Add the folders where your data lives. At least one folder is required for each
        required type below; raw files are never moved or copied.
      </p>

      <div
        className="alm-step-sources__groups"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}
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

/** A compact type group card: one header row, plus folder rows only when present. */
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
  const hasRows = rows.length > 0;

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
        borderRadius: 'var(--alm-radius-sm)',
        background: cardBackground,
        overflow: 'hidden',
      }}
    >
      {/* Single compact header row: label + count + status + add button.
          When empty this is the entire card height. */}
      <div
        className="alm-step-sources__group-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-sp-2)',
          padding: 'var(--alm-sp-1) var(--alm-sp-2)',
          minHeight: 'var(--alm-row-height)',
          borderBottom: hasRows ? headerBorder : 'none',
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
        {hasRows && (
          <span style={{ fontSize: 'var(--alm-text-2xs)', color: 'var(--alm-text-muted)' }}>
            {rows.length}
          </span>
        )}
        {isRequired ? (
          <Pill
            variant={isMet ? 'ok' : 'warn'}
            data-testid={`requirement-status-${kind}`}
          >
            {isMet ? 'required ✓' : 'required'}
          </Pill>
        ) : (
          <span style={{ fontSize: 'var(--alm-text-2xs)', color: 'var(--alm-text-faint)' }}>
            optional
          </span>
        )}
        <span style={{ flex: 1 }} />
        <AddFolderButton kind={kind} onAdd={onAdd} />
      </div>

      {/* Folder rows only render when present — no empty-state block. */}
      {hasRows && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {rows.map(({ entry, index }, i) => (
            <SourceRow
              key={`${entry.path}-${index}`}
              entry={entry}
              error={errors[index]}
              isLast={i === rows.length - 1}
              onRemove={() => onRemove(index)}
              onScanDepthChange={(depth) => onScanDepthChange(index, depth)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single, single-line source row: path + scan-depth selector + remove. */
function SourceRow({
  entry,
  error,
  isLast,
  onRemove,
  onScanDepthChange,
}: {
  entry: SourceEntry;
  error?: string;
  isLast: boolean;
  onRemove: () => void;
  onScanDepthChange: (depth: ScanDepth) => void;
}) {
  return (
    <div
      className="alm-step-sources__row"
      style={{
        padding: 'var(--alm-sp-1) var(--alm-sp-2)',
        background: 'var(--alm-surface-raised)',
        borderBottom: isLast ? 'none' : '1px solid var(--alm-border-subtle)',
      }}
    >
      <div
        className="alm-step-sources__row-main"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', minHeight: 'var(--alm-row-height)' }}
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
        <select
          className="alm-step-sources__depth-select"
          value={entry.scanDepth}
          onChange={(e) => onScanDepthChange(e.target.value as ScanDepth)}
          aria-label="Scan depth"
          style={{ fontSize: 'var(--alm-text-2xs)' }}
        >
          <option value="recursive">Recursive</option>
          <option value="single">Single level</option>
        </select>
        <Btn size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Btn>
      </div>

      {error && (
        <div
          className="alm-step-sources__row-error"
          style={{
            marginTop: 'var(--alm-sp-0)',
            fontSize: 'var(--alm-text-2xs)',
            color: 'var(--alm-danger)',
          }}
        >
          {error}
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
  const [e2ePath, setE2ePath] = useState('');

  const handleChoose = async () => {
    const result = await pick(undefined, KIND_TO_LAST_PATH[kind]);
    if (result.path) {
      onAdd(result.path, kind);
    }
  };

  return (
    <>
      <Btn
        size="sm"
        variant="primary"
        onClick={handleChoose}
        disabled={loading}
        aria-label={`Add ${SOURCE_KIND_LABELS[kind]} folder`}
      >
        {loading ? 'Choosing…' : '+ Add folder…'}
      </Btn>
      {/*
        CI-only path entry: WebDriver cannot drive the native folder picker, so
        real-UI E2E journeys add a source by typing its path. Gated on the
        build-time VITE_E2E flag, so it is tree-shaken out of production builds
        and reuses the exact same `onAdd` registration path as the picker.
      */}
      {import.meta.env.VITE_E2E ? (
        <span data-testid={`e2e-add-by-path-${kind}`}>
          <input
            data-testid={`e2e-path-input-${kind}`}
            aria-label={`E2E ${SOURCE_KIND_LABELS[kind]} path`}
            value={e2ePath}
            onChange={(ev) => setE2ePath(ev.target.value)}
          />
          <button
            type="button"
            data-testid={`e2e-add-path-btn-${kind}`}
            onClick={() => {
              const p = e2ePath.trim();
              if (p) {
                onAdd(p, kind);
                setE2ePath('');
              }
            }}
          >
            Add by path (E2E)
          </button>
        </span>
      ) : null}
      {error && (
        <span
          className="alm-step-sources__picker-error"
          style={{ fontSize: 'var(--alm-text-2xs)', color: 'var(--alm-danger)' }}
        >
          {error.message}
        </span>
      )}
    </>
  );
}
