// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * InboxDetail — bottom pane for the Inbox classify/confirm workflow.
 *
 * Follows the SessionDetail shape (spec 043 §4 redesign):
 *
 *   HEADER — item path (title, bold) + titleExtra: classification pill +
 *             inline action buttons (left-packed, pv-session-detail2__actions).
 *             Confirm lives HERE; disabled for "mixed" rows (spec 041 FR-050 —
 *             the backend "split" action is removed, T071/T072).
 *   BODY   — scrollable (#553) left-packed .pv-session-detail2 flex row:
 *     col A (PropertyTable) — classification + file-count + FITS metadata
 *     mixed-summary line   — compact "N light · M dark" muted text (mixed only)
 *     "Files (N) ▾" popover trigger — opens a portaled popup containing:
 *       • scrollable per-file metadata table
 *       • FileInspector detail for the clicked row
 *       • FR-032/#554 missing-required-attribute banner, inline right below
 *         the trigger it explains (not a separate full-width alert column)
 *     "Needs review" col  — unclassified-file type-override editing (if any)
 *
 * No facts/aux props on DetailPanel — body is fully self-contained.
 * No breakdown-filter interaction — the breakdown table is gone from the detail.
 */

import { Popover } from '@base-ui-components/react/popover';
import { Fragment, useCallback, useState } from 'react';
import type {
  InboxFileMetadata_Serialize as InboxFileMetadata,
  InboxItemSummary,
  InboxReclassifyV2Response_Serialize as InboxReclassifyV2Response,
} from '@/bindings/index';
import type { PropertyDef } from '@/components';
import {
  DetailPanel,
  PropertyTable,
  TwoColDetailLayout,
  renderValue,
} from '@/components';
import { fieldApplicability } from '@/lib/field-applicability';
import { m } from '@/lib/i18n';
import { revealLabel } from '@/lib/reveal-label';
import { copyToClipboard, revealInOs } from '@/shared/native/reveal';
import { addToast } from '@/shared/toast';
import { Banner, Btn, Pill, Section, Table } from '@/ui';
import type { InboxClassifyResponse } from './store';
import { ConeSearchSuggestions } from './ConeSearchSuggestions';
import { FileInspector } from './FileInspector';
import { useInboxReclassifyState } from './useInboxReclassifyState';
import {
  applicableRootCategory,
  basename,
  buildMixedSummary,
  buildRootLabels,
  classificationVariant,
  FRAME_TYPE_OPTIONS,
  formatExposureSeconds,
  humanizeKey,
  resolveInboxRevealPath,
} from './inboxDetailHelpers';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InboxDetailProps {
  // #768: `organizationState` isn't on the base `InboxItemSummary` (it's an
  // `InboxListItem` extension) — widened here so the picker-gate below can
  // read it without every other InboxDetail caller needing a full InboxListItem.
  item: InboxItemSummary & { organizationState?: string };
  rootAbsolutePath: string;
  classification: InboxClassifyResponse | null;
  /**
   * Per-file metadata from `inbox.item.metadata` (FR-010).
   * Optional — rendered when provided and non-empty.
   */
  fileMetadata?: InboxFileMetadata[];
  /**
   * Primary confirm action for this detection — runs the confirm/split flow.
   * For a mixed folder the page labels this "Generate split plan"; otherwise
   * "Confirm to inventory". Rendered inline-left in the detail header (the
   * canonical Sessions placement). Omit to hide the button.
   */
  onConfirm?: () => void;
  /** Header confirm label, e.g. "Confirm to inventory" / "Generate split plan". */
  confirmLabel?: string;
  /** Disable the confirm action (gated: unclassified / missing attrs / open plan). */
  confirmDisabled?: boolean;
  /** True while a confirm/split is in flight — shows "Working…" + disables. */
  confirmBusy?: boolean;
  /**
   * Candidate destination library roots (non-inbox). When more than one
   * exists, a "Source" picker is shown next to Confirm so the user chooses
   * WHERE files are placed instead of relying on auto-selection.
   */
  destinationRoots?: Array<{ id: string; path: string; category: string }>;
  /** Currently chosen destination root id; "" / null means auto-select. */
  selectedRootId?: string | null;
  /** Called when the user picks a destination root ("" = auto). */
  onSelectRoot?: (rootId: string) => void;
  /**
   * Called with the raw `inbox.reclassify_v2` response after EITHER the
   * per-file or bulk override flow succeeds. `reclassify_v2` operates at
   * source-group scope and re-splits the group into new single-type
   * sub-items (R-14, issue #755) — the CURRENTLY selected `item.inboxItemId`
   * may cease to exist. The caller (InboxPage) owns selection and is
   * responsible for moving it to the correct post-split item once the
   * refetched list contains it; this component does not track selection.
   */
  onReclassified?: (response: InboxReclassifyV2Response) => void;
  /**
   * Stable `inbox_source_groups` id for this item's folder, when known.
   * Preferred over `item.inboxItemId` for `inbox.reclassify_v2` because
   * sub-item ids are purged/recreated across re-splits (see
   * `useInboxReclassifyV2`); `null`/absent falls back to the item id.
   */
  sourceGroupId?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InboxDetail({
  item,
  rootAbsolutePath,
  classification,
  fileMetadata,
  onConfirm,
  confirmLabel = m.inbox_confirm_to_inventory(),
  confirmDisabled = false,
  confirmBusy = false,
  destinationRoots,
  selectedRootId,
  onSelectRoot,
  onReclassified,
  sourceGroupId,
}: InboxDetailProps) {
  const {
    reclassifyLoading,
    unclassifiedFiles,
    propertyRegistry,
    pendingOverrides,
    applyError,
    handleOverrideChange,
    handleApplyOverrides,
    selectedFiles,
    bulkFrameType,
    setBulkFrameType,
    bulkPropValues,
    bulkError,
    handleToggleFile,
    handleSelectAll,
    handleBulkPropChange,
    handleBulkApply,
    isHeterogeneousFrameTypeBulk,
    heterogeneousSignature,
    heterogeneousAcked,
    setHeterogeneousAckKey,
    lastFrameTypeUndo,
    undoLoading,
    undoError,
    handleUndoBulkFrameType,
  } = useInboxReclassifyState({
    inboxItemId: item.inboxItemId,
    rootAbsolutePath,
    sourceGroupId,
    classification,
    fileMetadata,
    onReclassified,
  });

  // Files popover: which row is "inspected" inside the popover.
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

  const title = item.relativePath || m.inbox_list_root_label();
  const classType = classification?.type ?? 'pending';

  // Reveal this item's location in the OS file browser (#715, spec 004
  // FR-005/SC-002). No connectivity gate like Sessions (#889): the Inbox
  // root is the currently-scanned root, always reachable while this pane is
  // shown. On failure, the toast carries a "Copy path" action (#717 FR-010:
  // `copyToClipboard` was exported with zero call sites anywhere in the app).
  const handleReveal = useCallback(async () => {
    const revealPath = resolveInboxRevealPath(
      rootAbsolutePath,
      item.relativePath,
    );
    try {
      await revealInOs(revealPath, {
        entityKind: 'inbox_item',
        entityId: item.inboxItemId,
      });
    } catch {
      addToast({
        message: m.inbox_toast_reveal_error(),
        variant: 'error',
        action: {
          label: m.common_copy_path(),
          onClick: () => {
            void copyToClipboard(revealPath).then((ok) => {
              if (ok) {
                addToast({ message: m.common_path_copied(), variant: 'info' });
              }
            });
          },
        },
      });
    }
  }, [rootAbsolutePath, item.relativePath, item.inboxItemId]);

  // Library picker (point 1): narrow the destination roots to the category that
  // can receive this item's frame type. Only meaningful for a single-type item
  // (or a master); mixed/unknown → show all roots. The picker is shown only when
  // MORE THAN ONE applicable root exists (otherwise there's nothing to choose).
  //
  // #768: an item sourced from an ORGANIZED root is always catalogued in
  // place — confirm ignores any chosen destination and reuses the source
  // root server-side — so there is never a real destination choice to make.
  // No applicable roots means no picker, regardless of how many other
  // library roots are registered.
  const itemFrameType =
    classType === 'single_type'
      ? (classification?.frameType ?? null)
      : item.isMaster
        ? (item.masterFrameType ?? null)
        : null;
  const applicableCategory = applicableRootCategory(itemFrameType);
  const applicableRoots =
    item.organizationState === 'organized'
      ? []
      : applicableCategory && destinationRoots
        ? destinationRoots.filter((r) => r.category === applicableCategory)
        : (destinationRoots ?? []);
  const rootLabels = buildRootLabels(applicableRoots);

  // Generic bulk-editable properties (FR-044/US11, issue #755): every
  // overridable registry entry other than frameType (which keeps its own
  // enum select above), narrowed to the ones applicable to this item's frame
  // type. Unknown/mixed frame type (itemFrameType == null) shows all of them.
  const genericBulkFields = (propertyRegistry ?? []).filter((e) => {
    if (e.key === 'frameType' || !e.overridable) return false;
    if (!itemFrameType) return true;
    return e.appliesTo.includes(itemFrameType);
  });

  // Reuse existing translated labels/placeholders for the well-known keys;
  // any other registry key falls back to `humanizeKey` in the render loop.
  const KNOWN_BULK_FIELD_LABELS: Record<
    string,
    { label: string; placeholder?: string; testid: string }
  > = {
    filter: {
      label: m.common_filter(),
      placeholder: m.inbox_filter_placeholder(),
      testid: 'bulk-filter',
    },
    exposureS: {
      label: m.inbox_exposure_label(),
      placeholder: m.inbox_exposure_placeholder(),
      testid: 'bulk-exposure-s',
    },
    binning: {
      label: m.settings_calmatch_binning(),
      placeholder: m.inbox_binning_placeholder(),
      testid: 'bulk-binning',
    },
    gain: { label: m.inbox_col_gain(), testid: 'bulk-gain' },
    temperatureC: {
      label: m.settings_calmatch_sensor_temp(),
      testid: 'bulk-temperature-c',
    },
  };

  // ── Unclassified ("Needs review") table ───────────────────────────────────

  const allSelected =
    unclassifiedFiles.length > 0 &&
    selectedFiles.size === unclassifiedFiles.length;
  const someSelected = selectedFiles.size > 0 && !allSelected;

  const unclassifiedColumns = [
    { key: 'select', label: '', style: { width: 36 } },
    { key: 'file', label: m.inbox_col_file(), style: { width: 160 } },
    { key: 'override', label: m.inbox_col_assign_frame_type() },
  ];

  const unclassifiedRows = unclassifiedFiles.map((filePath, idx) => ({
    select: (
      <input
        type="checkbox"
        checked={selectedFiles.has(filePath)}
        onChange={() => handleToggleFile(filePath)}
        aria-label={m.inbox_select_file_aria({ file: filePath })}
        data-testid={`reclassify-select-${idx}`}
      />
    ),
    file: (
      <span title={filePath} className="pv-inbox-detail__file-cell">
        {filePath}
      </span>
    ),
    override: (
      <select
        value={pendingOverrides[filePath] ?? ''}
        onChange={(e) => handleOverrideChange(filePath, e.target.value)}
        aria-label={m.inbox_override_frame_type_aria({ file: filePath })}
        data-testid={`override-select-${filePath}`}
        className="pv-select pv-select--sm"
      >
        <option value="">{m.inbox_pick_type_placeholder()}</option>
        {FRAME_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    ),
  }));

  // ── Per-file metadata table (FR-010) ──────────────────────────────────────

  const metadataColumns = [
    { key: 'file', label: m.inbox_col_file(), style: { minWidth: 160 } },
    { key: 'type', label: m.inbox_col_type(), style: { width: 80 } },
    { key: 'filter', label: m.common_filter(), style: { width: 70 } },
    { key: 'exposure', label: m.inbox_col_exposure(), style: { width: 80 } },
    { key: 'binning', label: m.inbox_col_binning(), style: { width: 70 } },
    { key: 'gain', label: m.inbox_col_gain(), style: { width: 60 } },
    { key: 'temp', label: m.inbox_col_temp(), style: { width: 70 } },
    { key: 'object', label: m.inbox_col_object(), style: { width: 100 } },
    { key: 'date', label: m.archive_prop_date(), style: { width: 110 } },
  ];

  // FR-032 (US9): files missing a path-load-bearing attribute.
  const filesMissingAttrs = (fileMetadata ?? []).filter(
    (f) => (f.missingPathAttributes?.length ?? 0) > 0,
  );

  const metadataRows = (fileMetadata ?? []).map((f, rowIdx) => {
    const missingAttrs = f.missingPathAttributes ?? [];
    const fileName = basename(f.relativeFilePath);
    const needsAttention = f.overrideStale || missingAttrs.length > 0;
    const isInspected = inspectedIdx === rowIdx;
    return {
      file: (
        <span title={f.relativeFilePath} className="pv-inbox-detail__file-cell">
          {f.relativeFilePath}
          {missingAttrs.length > 0 && (
            <span
              data-testid={`inbox-missing-attr-${fileName}`}
              title={m.inbox_missing_attrs_title({
                attrs: missingAttrs.join(', '),
              })}
              className="pv-inbox-detail__missing-attr-badge"
            >
              {m.inbox_needs_attrs({ attrs: missingAttrs.join(', ') })}
            </span>
          )}
        </span>
      ),
      // Per-row applicability (spec-030 Q16 / FR-135, FR-137): each file in a
      // mixed folder can have its own effective frame type, so a field that
      // doesn't apply to THIS row's type renders blank while a genuinely
      // missing-but-applicable value renders the unresolved chip — never the
      // same dash for both.
      type: renderValue(f.frameTypeEffective ?? null, {
        applicability: 'applicable',
      }),
      filter: renderValue(f.filter ?? null, {
        applicability: fieldApplicability(f.frameTypeEffective, 'filter'),
      }),
      exposure: renderValue(
        f.exposureS ?? null,
        { applicability: fieldApplicability(f.frameTypeEffective, 'exposure') },
        (v) => formatExposureSeconds(Number(v)),
      ),
      binning: renderValue(
        f.binningX != null || f.binningY != null
          ? `${f.binningX ?? '?'}x${f.binningY ?? '?'}`
          : null,
        { applicability: 'applicable' },
      ),
      gain: renderValue(f.gain ?? null, { applicability: 'applicable' }),
      temp: renderValue(
        f.temperatureC ?? null,
        { applicability: fieldApplicability(f.frameTypeEffective, 'setTemp') },
        (v) => `${v} °C`,
      ),
      object: renderValue(f.object ?? null, {
        applicability: fieldApplicability(f.frameTypeEffective, 'target'),
      }),
      date: renderValue(f.dateObs ?? null, { applicability: 'applicable' }),
      _rowClassName: [
        needsAttention ? 'pv-inbox-meta-row--warn' : '',
        isInspected ? 'pv-inbox-meta-row--inspected' : '',
        'pv-inbox-meta-row',
      ]
        .filter(Boolean)
        .join(' '),
      _onClick: () => setInspectedIdx(isInspected ? null : rowIdx),
    };
  });

  // ── Mixed composition summary (FR-011) ────────────────────────────────────

  const mixedSummary =
    classType === 'mixed' && classification?.breakdown
      ? buildMixedSummary(classification.breakdown)
      : null;

  // ── Detection property table (col A) ─────────────────────────────────────
  // Representative file for FITS metadata display (best-effort).

  const repFile = fileMetadata?.[0] ?? null;

  const detectionProps: PropertyDef[] = [
    {
      key: 'classification',
      label: m.inbox_prop_classification(),
      value:
        classType === 'single_type'
          ? (classification?.frameType ?? 'single_type')
          : classType,
    },
    {
      key: 'files',
      label: m.inbox_col_files(),
      // #653: the breakdown only tallies CLASSIFIED files — it excludes
      // `unclassifiedFiles`, so a needs-review item (the one a user is most
      // likely scrutinizing) undercounted here vs the list row's total
      // `fileCount`. Add the unclassified count back in before falling back.
      value: classification
        ? String(
            (classification.breakdown?.reduce((s, e) => s + e.count, 0) ?? 0) +
              (classification.unclassifiedFiles?.length ?? 0) || item.fileCount,
          )
        : String(item.fileCount),
    },
    // Rows below are always present (never conditionally omitted for a
    // missing value — that collapsed "missing" into "not-applicable", spec-030
    // Q16 / FR-135); applicability per frame type comes from the shared
    // `fieldApplicability` matrix (data-model.md), so an applicable-but-absent
    // field renders the unresolved chip instead of silently vanishing.
    {
      key: 'target',
      label: m.inbox_dim_target(),
      value: repFile?.object ?? null,
      source: 'fits',
      applicability: fieldApplicability(itemFrameType, 'target'),
    },
    {
      key: 'filter',
      label: m.common_filter(),
      value: repFile?.filter ?? null,
      source: 'fits',
      applicability: fieldApplicability(itemFrameType, 'filter'),
    },
    {
      key: 'exposure',
      label: m.inbox_col_exposure(),
      value:
        repFile?.exposureS != null
          ? formatExposureSeconds(repFile.exposureS)
          : null,
      source: 'fits',
      applicability: fieldApplicability(itemFrameType, 'exposure'),
    },
    {
      key: 'binning',
      label: m.settings_calmatch_binning(),
      value:
        repFile?.binningX != null || repFile?.binningY != null
          ? `${repFile?.binningX ?? '?'}x${repFile?.binningY ?? '?'}`
          : null,
      source: 'fits',
    },
    {
      key: 'gain',
      label: m.inbox_col_gain(),
      value: repFile?.gain ?? null,
      source: 'fits',
    },
    {
      key: 'temp',
      label: m.settings_calmatch_sensor_temp(),
      value:
        repFile?.temperatureC != null ? `${repFile.temperatureC} °C` : null,
      source: 'fits',
      applicability: fieldApplicability(itemFrameType, 'setTemp'),
    },
    {
      key: 'instrume',
      label: m.inbox_field_instrument(),
      value: repFile?.instrume ?? null,
      source: 'fits',
    },
    {
      key: 'dims',
      label: m.inbox_field_dimensions(),
      value:
        repFile != null && (repFile.naxis1 != null || repFile.naxis2 != null)
          ? `${repFile.naxis1 ?? '?'}×${repFile.naxis2 ?? '?'}`
          : null,
      source: 'fits',
    },
    {
      key: 'date',
      label: m.sessions_col_night(),
      value: repFile?.dateObs ?? null,
      source: 'fits',
      applicability: fieldApplicability(itemFrameType, 'date'),
    },
  ];

  // Spread the detection facts across two left-packed columns (the canonical
  // SessionDetail shape) so the bottom panel reads as multi-column, not one
  // cramped stack.
  const detMid = Math.ceil(detectionProps.length / 2);
  const detColA = detectionProps.slice(0, detMid);
  const detColB = detectionProps.slice(detMid);

  // ── Inline header actions ─────────────────────────────────────────────────

  const titleActions = (
    <span className="pv-session-detail2__actions">
      <Pill variant={classificationVariant(classType)}>
        {classType === 'single_type'
          ? (classification?.frameType ?? m.inbox_detail_single_fallback())
          : classType}
      </Pill>
      {item.lane === 'video' && (
        <Pill variant="ghost">{m.inbox_lane_video()}</Pill>
      )}
      {onConfirm && (
        <Btn
          size="sm"
          variant="primary"
          onClick={onConfirm}
          disabled={confirmDisabled || confirmBusy}
          aria-label={confirmLabel}
          data-testid="inbox-confirm-btn"
          data-guide-anchor="inbox.confirm-row"
        >
          {confirmBusy ? m.common_working() : confirmLabel}
        </Btn>
      )}
      {/* Destination library picker — to the RIGHT of Confirm. Lets the user
			    choose which library the files are placed in (Auto = backend pick). */}
      {onConfirm && applicableRoots.length > 1 && (
        <label className="pv-inbox-detail__dest-root">
          <span className="pv-inbox-detail__dest-root-label">
            {m.inbox_dest_root_label()}
          </span>
          <select
            className="pv-select pv-select--sm"
            value={selectedRootId ?? ''}
            onChange={(e) => onSelectRoot?.(e.target.value)}
            aria-label={m.inbox_dest_root_aria()}
            data-testid="inbox-dest-root-select"
          >
            <option value="">{m.projects_edit_channels_auto_tag()}</option>
            {applicableRoots.map((r) => (
              <option key={r.id} value={r.id}>
                {rootLabels.get(r.id) ?? `${basename(r.path)} · ${r.category}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* Reveal — platform-native label (shared revealLabel() helper, #715). */}
      <Btn
        size="sm"
        onClick={() => void handleReveal()}
        title={m.inbox_reveal_title()}
        data-testid="inbox-reveal-btn"
      >
        {revealLabel()}
      </Btn>
    </span>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const hasMetadata = metadataRows.length > 0;

  return (
    <DetailPanel
      variant="inbox"
      title={<strong>{title}</strong>}
      titleExtra={titleActions}
    >
      {/* #553: the body (this whole subtree) is the sole scroll region — the
          header above stays pinned via the `:has()` rule in detail-panes.css.
          DetailPanel's "content-only" mode (no facts/aux slots) renders
          children with no scroll wrapper of its own, so a tall FILES/Needs-
          review body previously overflowed the docked panel's max-height and
          was clipped by `.pv-listpage__detail-body`'s `overflow: hidden`
          (unreachable, not just unscrolled). */}
      <div className="pv-inbox-detail__scroll">
        {/* Mixed: advisory banner */}
        {classType === 'mixed' && (
          <Banner
            variant="warn"
            className="pv-inbox-detail__banner-mt3 pv-inbox-alert"
            data-testid="inbox-mixed-alert"
          >
            <div className="pv-inbox-alert__msg">
              <span className="pv-inbox-alert__title">
                {m.inbox_mixed_folder_title()}
              </span>
              <span className="pv-inbox-alert__body">
                {m.inbox_mixed_folder_body()}
              </span>
            </div>
          </Banner>
        )}

        {/* Unclassified: blocking banner */}
        {classType === 'unclassified' && (
          <Banner
            variant="danger"
            className="pv-inbox-detail__banner-mt3 pv-inbox-alert"
            data-testid="inbox-unclassified-alert"
          >
            <div className="pv-inbox-alert__msg">
              <span className="pv-inbox-alert__title">
                {m.inbox_frame_types_required_title()}
              </span>
              <span className="pv-inbox-alert__body">
                {m.inbox_frame_types_required_body()}
              </span>
            </div>
          </Banner>
        )}

        {!classification && (
          <div className="pv-inbox-detail__empty">
            {m.inbox_select_item_prompt()}
          </div>
        )}

        {/* Left-packed .pv-session-detail2 row, via the shared component
            (#813) instead of a hand-copied div structure. Files and Needs-
            review ride in `extraCols`, NOT `linked`: both are table-shaped
            and need `__col` sizing (flex 0 1 400px / min-width 340px) —
            `__linked` is flex 0 0 auto / min-width 160px and would squeeze
            them. */}
        <TwoColDetailLayout
          colA={<PropertyTable mode="view" showSource properties={detColA} />}
          colB={
            // Only when the fact list was long enough to spread across two.
            detColB.length > 0 ? (
              <PropertyTable mode="view" showSource properties={detColB} />
            ) : null
          }
          extraCols={[
            /* Files — mixed-composition summary + the metadata popover */
            <Fragment key="files">
              <div className="pv-session-detail2__head">
                {m.inbox_col_files()}
              </div>

              {/* FR-011: compact mixed-composition summary */}
              {mixedSummary && (
                <section
                  aria-label={m.inbox_mixed_composition_summary_aria()}
                  className="pv-inbox-detail__mixed-summary"
                >
                  {mixedSummary}
                </section>
              )}

              {/* Files popover — trigger + portaled popup with metadata table + inspector */}
              {hasMetadata ? (
                <Popover.Root
                  onOpenChange={() => {
                    // Reset inspector selection whenever the popover is closed.
                    setInspectedIdx(null);
                  }}
                >
                  <Popover.Trigger
                    className="pv-inbox-detail__files-trigger"
                    aria-label={m.inbox_file_metadata_count({
                      count: metadataRows.length,
                    })}
                    data-testid="inbox-files-popover-trigger"
                  >
                    {m.inbox_file_metadata_count({
                      count: metadataRows.length,
                    })}{' '}
                    ▾
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner
                      side="bottom"
                      align="start"
                      sideOffset={4}
                    >
                      <Popover.Popup
                        className="pv-inbox-detail__files-popup"
                        data-testid="inbox-files-popup"
                        aria-label={m.inbox_file_metadata_aria()}
                      >
                        {/* Scrollable metadata table */}
                        <div className="pv-inbox-detail__files-popup-table">
                          <Table
                            columns={metadataColumns}
                            rows={metadataRows}
                          />
                        </div>
                        {/* Inspector — updates on row click */}
                        {inspectedIdx != null && (
                          <div className="pv-inbox-detail__files-popup-inspector">
                            <FileInspector
                              file={fileMetadata?.[inspectedIdx] ?? null}
                            />
                          </div>
                        )}
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
              ) : (
                !mixedSummary && (
                  <span className="pv-session-detail2__muted">
                    {m.inbox_no_file_metadata()}
                    {/* #551: no per-file metadata means the required-destination-
                    attribute gate has no data to evaluate here — say so
                    explicitly instead of silently reading as "nothing to
                    worry about" (confirm can still be rejected server-side
                    for these files; see inbox.missing_path_attributes). */}
                    {' — '}
                    {m.inbox_no_file_metadata_caveat()}
                  </span>
                )
              )}

              {/* FR-032 (US9) / #554: missing-required-attribute warning lives
              INLINE in the Files column (the field it explains) rather than
              as its own full-width alert column competing with the property
              tables (#554 — "stands out horribly"). */}
              {filesMissingAttrs.length > 0 && (
                <Banner
                  variant="danger"
                  className="pv-inbox-detail__banner-mt2 pv-inbox-alert"
                  data-testid="inbox-missing-attr-banner"
                >
                  <div className="pv-inbox-alert__msg">
                    <span className="pv-inbox-alert__title">
                      {m.inbox_required_metadata_missing_title()}
                    </span>
                    <span className="pv-inbox-alert__body">
                      {m.inbox_required_metadata_body({
                        count: filesMissingAttrs.length,
                      })}
                    </span>
                  </div>
                </Banner>
              )}
            </Fragment>,
            /* Needs review — rendered when unclassified files exist */
            unclassifiedRows.length > 0 ? (
              <Section
                key="needs-review"
                title={m.inbox_needs_review_title({
                  count: unclassifiedRows.length,
                })}
              >
                <div className="pv-inbox-detail__select-all-row">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={handleSelectAll}
                    aria-label={m.inbox_select_all_unclassified_aria()}
                    data-testid="reclassify-select-all"
                  />
                  <span className="pv-inbox-detail__select-all-label">
                    {selectedFiles.size === 0
                      ? m.common_select_all()
                      : m.inbox_n_selected({ count: selectedFiles.size })}
                  </span>
                </div>
                <Table columns={unclassifiedColumns} rows={unclassifiedRows} />

                {selectedFiles.size > 0 && (
                  <fieldset className="pv-inbox-detail__bulk-controls">
                    <legend className="pv-visually-hidden">
                      {m.inbox_bulk_override_controls_aria()}
                    </legend>
                    <div className="pv-inbox-detail__bulk-field">
                      {}
                      <label
                        htmlFor="bulk-frame-type"
                        className="pv-inbox-detail__bulk-label"
                      >
                        {m.inbox_frame_type_label()}
                      </label>
                      <select
                        id="bulk-frame-type"
                        value={bulkFrameType}
                        onChange={(e) => setBulkFrameType(e.target.value)}
                        aria-label={m.inbox_bulk_frame_type_aria()}
                        data-testid="bulk-frame-type"
                        className="pv-select pv-select--sm"
                      >
                        <option value="">
                          {m.inbox_unchanged_placeholder()}
                        </option>
                        {FRAME_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Field-agnostic bulk properties (FR-044/US11, issue #755):
                        every OTHER overridable registry property applicable to
                        this item's frame type — filter/exposureS/binning/gain/
                        temperatureC/etc, whichever the registry returns. Known
                        keys reuse their existing translated label; unrecognised
                        future registry keys fall back to a humanized label so
                        new properties are reachable without a UI change. */}
                    {genericBulkFields.map((field) => {
                      const known = KNOWN_BULK_FIELD_LABELS[field.key];
                      const label =
                        known?.label ??
                        humanizeKey(field.key) +
                          (field.unit ? ` (${field.unit})` : '');
                      const testid = known?.testid ?? `bulk-prop-${field.key}`;
                      const inputType =
                        field.kind === 'number' || field.kind === 'integer'
                          ? 'number'
                          : 'text';
                      return (
                        <div
                          className="pv-inbox-detail__bulk-field"
                          key={field.key}
                        >
                          {}
                          <label
                            htmlFor={testid}
                            className="pv-inbox-detail__bulk-label"
                            title={field.validation ?? undefined}
                          >
                            {label}
                          </label>
                          <input
                            id={testid}
                            type={inputType}
                            value={bulkPropValues[field.key] ?? ''}
                            onChange={(e) =>
                              handleBulkPropChange(field.key, e.target.value)
                            }
                            placeholder={
                              known?.placeholder ??
                              m.inbox_unchanged_placeholder()
                            }
                            aria-label={label}
                            data-testid={testid}
                            className="pv-input pv-input--sm pv-inbox-detail__bulk-input-w80"
                          />
                        </div>
                      );
                    })}

                    {/* #611: the selection spans more than one currently-
                        detected frame type — warn before the override is
                        silently applied to files it may not actually belong
                        to (e.g. calibration files stranded under a light's
                        target/filter/date destination). Require an explicit
                        acknowledgement before Apply proceeds. */}
                    {isHeterogeneousFrameTypeBulk && (
                      <Banner
                        variant="warn"
                        className="pv-inbox-detail__banner-mt2"
                        data-testid="bulk-heterogeneous-warning"
                      >
                        <div className="pv-inbox-alert__msg">
                          <span className="pv-inbox-alert__title">
                            {m.inbox_bulk_heterogeneous_title()}
                          </span>
                          <span className="pv-inbox-alert__body">
                            {m.inbox_bulk_heterogeneous_body({
                              type: bulkFrameType,
                            })}
                          </span>
                        </div>
                        <label className="pv-inbox-detail__select-all-row">
                          <input
                            type="checkbox"
                            checked={heterogeneousAcked}
                            onChange={(e) =>
                              setHeterogeneousAckKey(
                                e.target.checked
                                  ? heterogeneousSignature
                                  : null,
                              )
                            }
                            aria-label={m.inbox_bulk_heterogeneous_ack_label({
                              type: bulkFrameType,
                            })}
                            data-testid="bulk-heterogeneous-ack"
                          />
                          {m.inbox_bulk_heterogeneous_ack_label({
                            type: bulkFrameType,
                          })}
                        </label>
                      </Banner>
                    )}

                    <button
                      type="button"
                      className="pv-btn pv-btn--sm pv-btn--primary"
                      onClick={handleBulkApply}
                      disabled={reclassifyLoading || !heterogeneousAcked}
                      aria-label={m.inbox_bulk_override_apply_aria({
                        count: selectedFiles.size,
                      })}
                      data-testid="bulk-apply-btn"
                    >
                      {reclassifyLoading
                        ? m.common_applying()
                        : isHeterogeneousFrameTypeBulk
                          ? m.inbox_bulk_apply_anyway({
                              count: selectedFiles.size,
                            })
                          : m.inbox_apply_to_selected({
                              count: selectedFiles.size,
                            })}
                    </button>
                  </fieldset>
                )}

                {bulkError && (
                  <Banner
                    variant="danger"
                    className="pv-inbox-detail__banner-mt2"
                  >
                    {bulkError}
                  </Banner>
                )}

                {/* #611: recoverable bulk frame-type override — restores each
                    file's pre-override detected type via a per-file
                    `overrides` call. */}
                {lastFrameTypeUndo && (
                  <Banner
                    variant="info"
                    className="pv-inbox-detail__banner-mt2"
                    data-testid="bulk-undo-banner"
                  >
                    <div className="pv-inbox-alert__msg">
                      <span className="pv-inbox-alert__body">
                        {m.inbox_bulk_undo_message({
                          count: lastFrameTypeUndo.count,
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="pv-btn pv-btn--sm"
                      onClick={() => void handleUndoBulkFrameType()}
                      disabled={undoLoading}
                      aria-label={m.inbox_bulk_undo_aria()}
                      data-testid="bulk-undo-btn"
                    >
                      {undoLoading
                        ? m.common_applying()
                        : m.inbox_bulk_undo_button()}
                    </button>
                  </Banner>
                )}

                {undoError && (
                  <Banner
                    variant="danger"
                    className="pv-inbox-detail__banner-mt2"
                  >
                    {undoError}
                  </Banner>
                )}

                {Object.keys(pendingOverrides).length > 0 && (
                  <div className="pv-inbox-detail__apply-row">
                    <button
                      type="button"
                      className="pv-btn pv-btn--sm pv-btn--primary"
                      onClick={handleApplyOverrides}
                      disabled={
                        Object.keys(pendingOverrides).length === 0 ||
                        reclassifyLoading
                      }
                      aria-label={m.inbox_apply_manual_overrides_aria()}
                    >
                      {reclassifyLoading
                        ? m.common_applying()
                        : m.inbox_apply_n_overrides({
                            count: Object.keys(pendingOverrides).length,
                          })}
                    </button>
                  </div>
                )}

                {applyError && (
                  <Banner
                    variant="danger"
                    className="pv-inbox-detail__banner-mt2"
                  >
                    {applyError}
                  </Banner>
                )}
              </Section>
            ) : null,
          ]}
        />

        {/* Cone-search target suggestion (spec 052 P3) — light framesets only. */}
        {itemFrameType === 'light' && (
          <ConeSearchSuggestions framesetId={item.inboxItemId} />
        )}
      </div>
    </DetailPanel>
  );
}
