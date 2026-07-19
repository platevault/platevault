// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Fragment, useState } from 'react';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { InfoTip } from '@/ui/InfoTip';
import { m } from '@/lib/i18n';
import { useDirectoryPicker } from '@/shared/native';
import type { LastPathKind } from '@/shared/native';
import type {
  SourceEntry,
  SourceKind,
  OrganizationState,
} from '../sources-store';
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
  onOrganizationStateChange: (index: number, state: OrganizationState) => void;
  errors: Record<number, string>;
}

/** Map a source kind to the picker's last-path affordance bucket. */
const KIND_TO_LAST_PATH: Record<SourceKind, LastPathKind> = {
  light_frames: 'raw',
  calibration: 'calibration',
  project: 'project',
  inbox: 'inbox',
};

// Per-category explanatory copy for the (?) affordance next to each group
// label (issue #497, #714) — what the category means and how PlateVault
// uses it, including the note that Projects are created later in a guided
// workflow (this folder just registers where to look).
const SOURCE_KIND_HELP: Record<SourceKind, () => string> = {
  light_frames: () => m.setup_kind_light_frames_help(),
  calibration: () => m.setup_kind_calibration_help(),
  project: () => m.setup_kind_project_help(),
  inbox: () => m.setup_kind_inbox_help(),
};

// Required-first display order (issue #496): both required kinds precede
// both optional kinds, otherwise preserving ALL_SOURCE_KINDS' relative order.
// Array.prototype.sort is stable per spec, so this always yields
// [light_frames, project, calibration, inbox].
const ORDERED_SOURCE_KINDS: SourceKind[] = [...ALL_SOURCE_KINDS].sort(
  (a, b) =>
    Number(!REQUIRED_KINDS.includes(a)) - Number(!REQUIRED_KINDS.includes(b)),
);

/** Normalize a path for cross-platform prefix/equality comparison. */
function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Add-time validation across ALL pending sources, independent of kind —
 * folders cannot be nested inside each other (no-overlap rule, #501), and a
 * duplicate must surface a message rather than silently no-op (#502).
 *
 * Existence / is-a-directory checks are not performed here: in production
 * the only entry point is the native OS directory picker, which already
 * guarantees a real, existing directory. The E2E-only manual path input
 * (tree-shaken from production builds) is a test fixture path and goes
 * through this same check for overlap/duplicate coverage.
 */
function findAddTimeConflict(
  entries: SourceEntry[],
  kind: SourceKind,
  path: string,
): string | null {
  const normalized = normalizePathForCompare(path);
  for (const entry of entries) {
    const entryNormalized = normalizePathForCompare(entry.path);
    if (entryNormalized === normalized) {
      return entry.kind === kind
        ? m.setup_sources_error_already_added()
        : m.setup_sources_error_registered_under({
            kind: SOURCE_KIND_LABELS[entry.kind](),
          });
    }
    if (
      normalized.startsWith(`${entryNormalized}/`) ||
      entryNormalized.startsWith(`${normalized}/`)
    ) {
      return m.setup_sources_error_overlaps_existing({ path: entry.path });
    }
  }
  return null;
}

/**
 * Step 1 -- Source Folders.
 *
 * One persistent, compact card per source kind. Each card has its own "Add
 * folder" button (type-first by construction) that opens the OS picker and
 * registers the folder under that card's kind. Empty groups collapse to a
 * single header row; required kinds highlight their card to convey met / unmet
 * status. The surrounding wizard still gates "Continue" on
 * getMissingRequiredKinds().
 *
 * Groups render required-first under "Required"/"Optional" section headings
 * (#496); ALL_SOURCE_KINDS still governs which kinds exist and their default
 * order elsewhere (e.g. Confirm step).
 */
export function StepSourceFolders({
  entries,
  onAdd,
  onRemove,
  onOrganizationStateChange,
  errors,
}: StepSourceFoldersProps) {
  // Stable index lookup so per-row remove/advanced map back to the flat array.
  const indexed = entries.map((entry, index) => ({ entry, index }));

  return (
    <div className="alm-step-sources">
      <p className="alm-step-sources__intro">{m.setup_sources_intro()}</p>

      <div className="alm-step-sources__groups">
        {ORDERED_SOURCE_KINDS.map((kind, i) => {
          const rows = indexed.filter(({ entry }) => entry.kind === kind);
          const isRequired = REQUIRED_KINDS.includes(kind);
          const prevKind = ORDERED_SOURCE_KINDS[i - 1];
          const isSectionStart =
            i === 0 || isRequired !== REQUIRED_KINDS.includes(prevKind);
          return (
            <Fragment key={kind}>
              {isSectionStart && (
                <div className="alm-step-sources__section-heading">
                  {isRequired
                    ? m.setup_sources_section_required()
                    : m.setup_sources_section_optional()}
                </div>
              )}
              <SourceGroup
                kind={kind}
                rows={rows}
                allEntries={entries}
                errors={errors}
                onAdd={onAdd}
                onRemove={onRemove}
                onOrganizationStateChange={onOrganizationStateChange}
              />
            </Fragment>
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
  allEntries,
  errors,
  onAdd,
  onRemove,
  onOrganizationStateChange,
}: {
  kind: SourceKind;
  rows: { entry: SourceEntry; index: number }[];
  allEntries: SourceEntry[];
  errors: Record<number, string>;
  onAdd: (path: string, kind: SourceKind) => void;
  onRemove: (index: number) => void;
  onOrganizationStateChange: (index: number, state: OrganizationState) => void;
}) {
  const isRequired = REQUIRED_KINDS.includes(kind);
  const isMet = rows.length > 0;
  const hasRows = rows.length > 0;
  const [addError, setAddError] = useState<string | null>(null);

  // Add-time validation (#502): reject duplicates/overlaps here, before the
  // path ever reaches the wizard's registered-sources buffer, so the user
  // gets immediate, accessible feedback instead of a silent no-op.
  const handleAdd = (path: string, addKind: SourceKind) => {
    const conflict = findAddTimeConflict(allEntries, addKind, path);
    if (conflict) {
      setAddError(conflict);
      return;
    }
    setAddError(null);
    onAdd(path, addKind);
  };

  // Requirement highlight is driven entirely by CSS data-attribute selectors
  // (data-required, data-requirement-met) — no inline style needed.
  return (
    <div
      className="alm-step-sources__group"
      data-testid={`source-group-${kind}`}
      data-required={isRequired ? 'true' : 'false'}
      data-requirement-met={isRequired ? (isMet ? 'true' : 'false') : undefined}
    >
      {/* Single compact header row: label + count + status + add button.
          When empty this is the entire card height. */}
      <div className="alm-step-sources__group-header">
        <span className="alm-step-sources__group-header-label">
          {SOURCE_KIND_LABELS[kind]()}
        </span>
        <InfoTip tip={SOURCE_KIND_HELP[kind]()} />
        {hasRows && (
          <span className="alm-step-sources__group-header-count">
            {rows.length}
          </span>
        )}
        {isRequired ? (
          <Pill
            variant={isMet ? 'ok' : 'warn'}
            data-testid={`requirement-status-${kind}`}
          >
            {isMet
              ? `${m.setup_sources_required()} ✓`
              : m.setup_sources_required()}
          </Pill>
        ) : (
          <span className="alm-step-sources__group-header-optional">
            {m.setup_sources_optional()}
          </span>
        )}
        <span className="alm-step-sources__group-header-spacer" />
        <AddFolderButton
          kind={kind}
          onAdd={handleAdd}
          validationError={addError}
        />
      </div>

      {/* Folder rows only render when present — no empty-state block. */}
      {hasRows && (
        <div>
          {rows.map(({ entry, index }, i) => (
            <SourceRow
              key={`${entry.path}-${index}`}
              entry={entry}
              error={errors[index]}
              isLast={i === rows.length - 1}
              onRemove={() => onRemove(index)}
              onOrganizationStateChange={(state) =>
                onOrganizationStateChange(index, state)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single, single-line source row: path + org-state toggle + remove. */
function SourceRow({
  entry,
  error,
  isLast: _isLast,
  onRemove,
  onOrganizationStateChange,
}: {
  entry: SourceEntry;
  error?: string;
  isLast: boolean;
  onRemove: () => void;
  onOrganizationStateChange: (state: OrganizationState) => void;
}) {
  const isInbox = entry.kind === 'inbox';
  return (
    <div className="alm-step-sources__row">
      <div className="alm-step-sources__row-main">
        <span
          className="alm-step-sources__row-path alm-mono"
          title={entry.path}
        >
          {entry.path}
        </span>
        {!isInbox && (
          <>
            <select
              className="alm-step-sources__org-select"
              value={entry.organizationState}
              onChange={(e) =>
                onOrganizationStateChange(e.target.value as OrganizationState)
              }
              aria-label={m.setup_sources_org_state_aria()}
            >
              <option value="organized">
                {m.setup_sources_org_organized()}
              </option>
              <option value="unorganized">
                {m.setup_sources_org_unorganized()}
              </option>
            </select>
            <InfoTip tip={m.setup_sources_org_state_title()} />
          </>
        )}
        <Btn size="sm" variant="ghost" onClick={onRemove}>
          {m.common_remove()}
        </Btn>
      </div>

      {error && <div className="alm-step-sources__row-error">{error}</div>}
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
  validationError,
}: {
  kind: SourceKind;
  onAdd: (path: string, kind: SourceKind) => void;
  validationError: string | null;
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
        aria-label={m.setup_sources_add_folder_aria({
          kind: SOURCE_KIND_LABELS[kind](),
        })}
      >
        {loading ? m.setup_choosing() : m.setup_add_folder()}
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
            aria-label={m.setup_sources_e2e_path_aria({
              kind: SOURCE_KIND_LABELS[kind](),
            })}
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
            {m.setup_sources_add_e2e()}
          </button>
        </span>
      ) : null}
      {error && (
        <span className="alm-step-sources__picker-error">{error.message}</span>
      )}
      {/* role="alert" announces without requiring focus (#502 a11y ask). */}
      {validationError && (
        <span role="alert" className="alm-step-sources__picker-error">
          {validationError}
        </span>
      )}
    </>
  );
}
