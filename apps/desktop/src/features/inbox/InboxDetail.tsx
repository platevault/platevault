/**
 * InboxDetail — bottom pane for the Inbox classify/confirm workflow.
 *
 * Uses the canonical DetailPanel with the `facts` prop so layout is
 * consistent with Sessions and Calibration:
 *
 *   HEADER  — item path (title) + classification pill (titleExtra), pinned.
 *   BODY    — two columns via DetailPanel facts/children contract:
 *     facts  (LEFT)  = alerts + breakdown table; non-scrolling, compact.
 *     content (RIGHT) = file-metadata table (scrolls internally) + inspector
 *                       (per-row extra fields: instrume, telescop, naxis1/2,
 *                        stackCount, imageTyp — NOT columned in the table).
 *
 * Owner-specified changes applied here:
 *   1. MetricLine ("N files · single_type classification") removed — noise.
 *   2. Breakdown is always-visible, never collapsible (Section wrapper removed).
 *   3. Samples column removed from breakdown table.
 *   4. Breakdown (left/facts) and file-metadata (right/content) at same level.
 *   5. Outer panel does NOT scroll; only the file-metadata column scrolls.
 *   6. Inspector: additive per-file fields not in the table — instrume,
 *      telescop, naxis1×naxis2, stackCount, imageTyp. Updates on row click.
 */

import { useState } from 'react';
import { DetailPanel } from '@/components';
import { Pill, Banner, Btn, Section, Table } from '@/ui';
import type { InboxItemSummary, InboxFileMetadata } from '@/api/commands';
import type { InboxClassifyResponse } from './store';
import type { PillVariant } from '@/ui';
import { useInboxReclassify } from './store';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';

// ── Helpers ───────────────────────────────────────────────────────────────────

function classificationVariant(type: string): PillVariant {
  switch (type) {
    case 'single_type':  return 'info';
    case 'mixed':        return 'warn';
    case 'unclassified': return 'neutral';
    default:             return 'neutral';
  }
}

const FRAME_TYPE_OPTIONS = ['light', 'dark', 'bias', 'flat', 'dark_flat'] as const;

/** Last path segment of a relative file path (forward- or back-slash separated). */
function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Format a nullable value as a muted dash. */
function fmtOrDash(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="alm-inbox-detail__dash">—</span>;
  }
  return String(value);
}

/** Format binning as "XxY" or dash. */
function fmtBinning(x: number | null | undefined, y: number | null | undefined): React.ReactNode {
  if (x == null && y == null) return <span className="alm-inbox-detail__dash">—</span>;
  return `${x != null ? x : '?'}x${y != null ? y : '?'}`;
}

/** Format exposure in seconds. */
function fmtExposure(s: number | null | undefined): React.ReactNode {
  if (s == null) return <span className="alm-inbox-detail__dash">—</span>;
  return `${s} s`;
}

/** Format temperature in °C. */
function fmtTemp(c: number | null | undefined): React.ReactNode {
  if (c == null) return <span className="alm-inbox-detail__dash">—</span>;
  return `${c} °C`;
}

/** Format pixel dimensions as "WxH" or dash. */
function fmtDimensions(w: number | null | undefined, h: number | null | undefined): React.ReactNode {
  if (w == null && h == null) return <span className="alm-inbox-detail__dash">—</span>;
  return `${w ?? '?'}×${h ?? '?'}`;
}

/**
 * Build a plain-language composition summary for a mixed classification.
 * Example: "12 light · 4 dark · 1 bias"
 */
function buildMixedSummary(breakdown: InboxClassifyResponse['breakdown']): string {
  if (!breakdown || breakdown.length === 0) return '';
  return breakdown.map((e) => `${e.count} ${e.kind}`).join(' · ');
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InboxDetailProps {
  item: InboxItemSummary;
  rootAbsolutePath: string;
  classification: InboxClassifyResponse | null;
  /**
   * Per-file metadata from `inbox.item.metadata` (FR-010).
   * Optional — rendered when provided and non-empty.
   */
  fileMetadata?: InboxFileMetadata[];
  /**
   * Inline action for the mixed-folder alert: generate a split plan for this item.
   * Optional — when absent the alert renders without the button.
   */
  onGenerateSplitPlan?: () => void;
  /** True while a confirm/split is in flight — disables the inline action. */
  splitPlanBusy?: boolean;
  /**
   * task 33: active frame-type filter (clicking a breakdown row filters the list).
   */
  activeBreakdownFilter?: string | null;
  /**
   * task 33: callback to set or clear the breakdown-row filter.
   */
  onBreakdownFilterChange?: (frameType: string | null) => void;
}

// ── Inspector ─────────────────────────────────────────────────────────────────

/**
 * Compact inspector for per-file fields NOT already shown in the metadata table:
 *   instrume, telescop, naxis1×naxis2, stackCount, imageTyp.
 *
 * Renders in the aux (right rail) slot. When no file is selected it renders
 * an empty-state without placeholder text (the visual shape conveys the purpose).
 * Clicking any row in the file-metadata table populates this inspector.
 */
function FileInspector({ file }: { file: InboxFileMetadata | null }) {
  if (!file) {
    return (
      <div className="alm-inbox-inspector alm-inbox-inspector--empty" data-testid="file-inspector" />
    );
  }

  const rows: Array<{ label: string; value: React.ReactNode; testid: string }> = [
    {
      label: m.inbox_field_instrument(),
      value: fmtOrDash(file.instrume),
      testid: 'inspector-instrume',
    },
    {
      label: m.inbox_field_telescope(),
      value: fmtOrDash(file.telescop),
      testid: 'inspector-telescop',
    },
    {
      label: m.inbox_field_dimensions(),
      value: fmtDimensions(file.naxis1, file.naxis2),
      testid: 'inspector-dims',
    },
    {
      label: m.inbox_field_stack_count(),
      value: fmtOrDash(file.stackCount),
      testid: 'inspector-stackcount',
    },
    {
      label: m.inbox_field_raw_imagetyp(),
      value: fmtOrDash(file.imageTyp),
      testid: 'inspector-imagetyp',
    },
  ];

  return (
    <div className="alm-inbox-inspector" data-testid="file-inspector">
      <div className="alm-inbox-inspector__name" title={file.relativeFilePath}>
        {basename(file.relativeFilePath)}
      </div>
      <dl className="alm-inbox-inspector__dl">
        {rows.map((r) => (
          <div key={r.label} className="alm-inbox-inspector__row" data-testid={r.testid}>
            <dt className="alm-inbox-inspector__label">{r.label}</dt>
            <dd className="alm-inbox-inspector__value">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InboxDetail({
  item,
  classification,
  fileMetadata,
  onGenerateSplitPlan,
  splitPlanBusy = false,
  activeBreakdownFilter = null,
  onBreakdownFilterChange,
}: InboxDetailProps) {
  const { reclassify, loading: reclassifyLoading } = useInboxReclassify(item.inboxItemId);

  // Per-file overrides pending submission (single-file flow).
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, string>>({});
  const [applyError, setApplyError] = useState<string | null>(null);

  // T027: multi-select + bulk override state.
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [bulkFrameType, setBulkFrameType] = useState('');
  const [bulkFilter, setBulkFilter] = useState('');
  const [bulkExposureS, setBulkExposureS] = useState('');
  const [bulkBinning, setBulkBinning] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Inspector: the currently-selected file row (index into fileMetadata).
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

  const handleOverrideChange = (filePath: string, frameType: string) => {
    setPendingOverrides((prev) => ({ ...prev, [filePath]: frameType }));
  };

  const handleApplyOverrides = async () => {
    const overrides = Object.entries(pendingOverrides).map(([filePath, frameType]) => ({
      filePath,
      frameType,
    }));
    if (overrides.length === 0) return;
    setApplyError(null);
    try {
      await reclassify(overrides);
      setPendingOverrides({});
    } catch (err) {
      setApplyError(errMessage(err));
    }
  };

  // T027 selection helpers.
  const unclassifiedFiles = classification?.unclassifiedFiles ?? [];

  const handleToggleFile = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === unclassifiedFiles.length) setSelectedFiles(new Set());
    else setSelectedFiles(new Set(unclassifiedFiles));
  };

  const handleBulkApply = async () => {
    if (selectedFiles.size === 0) return;
    const overrides = Array.from(selectedFiles).map((filePath) => {
      const override: {
        filePath: string;
        frameType?: string | null;
        filter?: string | null;
        exposureS?: number | null;
        binning?: string | null;
      } = { filePath };
      if (bulkFrameType !== '') override.frameType = bulkFrameType;
      if (bulkFilter !== '') override.filter = bulkFilter;
      if (bulkExposureS !== '') {
        const n = parseFloat(bulkExposureS);
        if (!Number.isNaN(n)) override.exposureS = n;
      }
      if (bulkBinning !== '') override.binning = bulkBinning;
      return override;
    });
    setBulkError(null);
    try {
      await reclassify(overrides);
      setSelectedFiles(new Set());
      setBulkFrameType('');
      setBulkFilter('');
      setBulkExposureS('');
      setBulkBinning('');
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    }
  };

  const title = item.relativePath || '(root)';
  const classType = classification?.type ?? 'pending';

  // ── Breakdown table ───────────────────────────────────────────────────────
  // No samples column; always visible (no Section/collapsible).
  // task 6: destination cell uses ellipsis class.
  const breakdownColumns = [
    { key: 'kind',        label: m.inbox_frame_type_label(),  style: { width: '28%' } },
    { key: 'count',       label: m.inbox_col_files(),         style: { width: '14%' } },
    { key: 'destination', label: m.inbox_col_destination(),   style: { width: '58%' } },
  ];

  // task 33: clicking a row sets/clears the active frame-type filter.
  const handleBreakdownRowClick = (frameType: string) => {
    if (!onBreakdownFilterChange) return;
    onBreakdownFilterChange(activeBreakdownFilter === frameType ? null : frameType);
  };

  const breakdownRows =
    classification?.breakdown?.map((entry) => {
      const isActive = activeBreakdownFilter === entry.kind;
      const hasFilter = onBreakdownFilterChange != null;
      return {
        kind: (
          <button
            type="button"
            className={[
              'alm-breakdown-filter-btn',
              isActive ? 'alm-breakdown-filter-btn--active' : '',
            ].filter(Boolean).join(' ')}
            onClick={hasFilter ? () => handleBreakdownRowClick(entry.kind) : undefined}
            aria-pressed={hasFilter ? isActive : undefined}
            aria-label={
              hasFilter
                ? isActive
                  ? `Clear filter: ${entry.kind}`
                  : `Filter list to ${entry.kind}`
                : undefined
            }
            data-testid={`breakdown-filter-${entry.kind}`}
            // eslint-disable-next-line no-restricted-syntax -- dynamic: cursor:default when no filter handler
            style={hasFilter ? undefined : { cursor: 'default' }}
          >
            { }
            <Pill variant={classificationVariant('single_type')}>{entry.kind}</Pill>
          </button>
        ),
        count: entry.count,
        destination: entry.destinationPreview ? (
          <span className="alm-inbox-detail__dest-cell" title={entry.destinationPreview}>
            {entry.destinationPreview}
          </span>
        ) : (
          <span className="alm-inbox-detail__dash">—</span>
        ),
        _rowClassName: isActive ? 'alm-breakdown-filter-row--active' : undefined,
      };
    }) ?? [];

  // ── Unclassified ("Needs review") table ───────────────────────────────────

  const allSelected =
    unclassifiedFiles.length > 0 && selectedFiles.size === unclassifiedFiles.length;
  const someSelected = selectedFiles.size > 0 && !allSelected;

  const unclassifiedColumns = [
    { key: 'select',   label: '',                              style: { width: 36 } },
    { key: 'file',     label: m.inbox_col_file(),             style: { width: 160 } },
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
      <span title={filePath} className="alm-inbox-detail__file-cell">
        {filePath}
      </span>
    ),
    override: (
      <select
        value={pendingOverrides[filePath] ?? ''}
        onChange={(e) => handleOverrideChange(filePath, e.target.value)}
        aria-label={m.inbox_override_frame_type_aria({ file: filePath })}
        data-testid={`override-select-${filePath}`}
        className="alm-select alm-select--sm"
      >
        <option value="">{m.inbox_pick_type_placeholder()}</option>
        {FRAME_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    ),
  }));

  // ── Per-file metadata table (FR-010) ──────────────────────────────────────

  const metadataColumns = [
    { key: 'file',     label: m.inbox_col_file(),     style: { minWidth: 160 } },
    { key: 'type',     label: m.inbox_col_type(),     style: { width: 80 } },
    { key: 'filter',   label: m.common_filter(),      style: { width: 70 } },
    { key: 'exposure', label: m.inbox_col_exposure(), style: { width: 80 } },
    { key: 'binning',  label: m.inbox_col_binning(),  style: { width: 70 } },
    { key: 'gain',     label: m.inbox_col_gain(),     style: { width: 60 } },
    { key: 'temp',     label: m.inbox_col_temp(),     style: { width: 70 } },
    { key: 'object',   label: m.inbox_col_object(),   style: { width: 100 } },
    { key: 'date',     label: m.archive_prop_date(),  style: { width: 110 } },
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
        <span title={f.relativeFilePath} className="alm-inbox-detail__file-cell">
          {f.relativeFilePath}
          {missingAttrs.length > 0 && (
            <span
              data-testid={`inbox-missing-attr-${fileName}`}
              title={m.inbox_missing_attrs_title({ attrs: missingAttrs.join(', ') })}
              className="alm-inbox-detail__missing-attr-badge"
            >
              {`needs ${missingAttrs.join(', ')}`}
            </span>
          )}
        </span>
      ),
      type:     fmtOrDash(f.frameTypeEffective),
      filter:   fmtOrDash(f.filter),
      exposure: fmtExposure(f.exposureS),
      binning:  fmtBinning(f.binningX, f.binningY),
      gain:     fmtOrDash(f.gain),
      temp:     fmtTemp(f.temperatureC),
      object:   fmtOrDash(f.object),
      date:     fmtOrDash(f.dateObs),
      _rowClassName: [
        needsAttention ? 'alm-inbox-meta-row--warn' : '',
        isInspected ? 'alm-inbox-meta-row--inspected' : '',
        'alm-inbox-meta-row',
      ].filter(Boolean).join(' '),
      _onClick: () => setInspectedIdx(isInspected ? null : rowIdx),
    };
  });

  // ── Mixed composition summary (FR-011) ────────────────────────────────────

  const mixedSummary =
    classType === 'mixed' && classification?.breakdown
      ? buildMixedSummary(classification.breakdown)
      : null;

  // ── Render ────────────────────────────────────────────────────────────────

  const hasMetadata = metadataRows.length > 0;

  // FACTS column (left): frame-type breakdown — always visible, no collapse,
  // no samples column. Also holds alerts and "Needs review" reclassify flow.
  const factsColumn = (
    <div className="alm-inbox-detail__facts-col">
      {/* Mixed: advisory alert + inline split action */}
      { }
      {classType === 'mixed' && (
        <Banner
          variant="warn"
          className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
          data-testid="inbox-mixed-alert"
        >
          <div className="alm-inbox-alert__msg">
            <span className="alm-inbox-alert__title">{m.inbox_mixed_folder_title()}</span>
            <span className="alm-inbox-alert__body">
              {m.inbox_mixed_folder_body()}
            </span>
          </div>
          {onGenerateSplitPlan && (
            <div className="alm-inbox-alert__action">
              <Btn
                size="sm"
                variant="accent"
                onClick={onGenerateSplitPlan}
                disabled={splitPlanBusy}
                aria-label={m.inbox_generate_split_plan()}
                data-testid="inbox-mixed-split-btn"
              >
                {splitPlanBusy ? m.common_working() : m.inbox_generate_split_plan()}
              </Btn>
            </div>
          )}
        </Banner>
      )}

      {/* Unclassified: blocking alert */}
      { }
      {classType === 'unclassified' && (
        <Banner
          variant="danger"
          className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
          data-testid="inbox-unclassified-alert"
        >
          <div className="alm-inbox-alert__msg">
            <span className="alm-inbox-alert__title">{m.inbox_frame_types_required_title()}</span>
            <span className="alm-inbox-alert__body">
              {m.inbox_frame_types_required_body()}
            </span>
          </div>
        </Banner>
      )}

      {/* FR-011: explicit per-type composition for mixed folders */}
      {mixedSummary && (
        <div
          aria-label={m.inbox_mixed_composition_summary_aria()}
          className="alm-inbox-detail__mixed-summary"
        >
          {mixedSummary}
        </div>
      )}

      {/* Breakdown always visible, no Section wrapper, no samples column */}
      {breakdownRows.length > 0 && (
        <div className="alm-inbox-detail__breakdown-block">
          <div className="alm-inbox-detail__breakdown-head">
            {m.inbox_frame_type_breakdown()}
            {/* task 33: active filter indicator + clear link */}
            {activeBreakdownFilter && onBreakdownFilterChange && (
              <span className="alm-breakdown-filter-label" data-testid="breakdown-filter-active">
                — {activeBreakdownFilter}
                <button
                  type="button"
                  className="alm-breakdown-filter-clear"
                  onClick={() => onBreakdownFilterChange(null)}
                  aria-label={m.inbox_clear_frame_type_filter_aria()}
                  data-testid="breakdown-filter-clear"
                >
                  {m.common_clear()}
                </button>
              </span>
            )}
          </div>
          <Table
            columns={breakdownColumns}
            rows={breakdownRows}
            className="alm-inbox-detail__table-fixed"
          />
        </div>
      )}

      {/* Needs review */}
      {unclassifiedRows.length > 0 && (
        <Section title={m.inbox_needs_review_title({ count: unclassifiedRows.length })}>
          <div className="alm-inbox-detail__select-all-row">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={handleSelectAll}
              aria-label={m.inbox_select_all_unclassified_aria()}
              data-testid="reclassify-select-all"
            />
            <span className="alm-inbox-detail__select-all-label">
              {selectedFiles.size === 0 ? m.common_select_all() : `${selectedFiles.size} selected`}
            </span>
          </div>
          <Table columns={unclassifiedColumns} rows={unclassifiedRows} />

          {selectedFiles.size > 0 && (
            <div className="alm-inbox-detail__bulk-controls" aria-label={m.inbox_bulk_override_controls_aria()}>
              <div className="alm-inbox-detail__bulk-field">
                <label htmlFor="bulk-frame-type" className="alm-inbox-detail__bulk-label">
                  {m.inbox_frame_type_label()}
                </label>
                <select
                  id="bulk-frame-type"
                  value={bulkFrameType}
                  onChange={(e) => setBulkFrameType(e.target.value)}
                  aria-label={m.inbox_bulk_frame_type_aria()}
                  data-testid="bulk-frame-type"
                  className="alm-select alm-select--sm"
                >
                  <option value="">{m.inbox_unchanged_placeholder()}</option>
                  {FRAME_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="alm-inbox-detail__bulk-field">
                <label htmlFor="bulk-filter" className="alm-inbox-detail__bulk-label">
                  {m.common_filter()}
                </label>
                <input
                  id="bulk-filter"
                  type="text"
                  value={bulkFilter}
                  onChange={(e) => setBulkFilter(e.target.value)}
                  placeholder={m.inbox_filter_placeholder()}
                  aria-label={m.inbox_bulk_filter_aria()}
                  data-testid="bulk-filter"
                  className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
                />
              </div>

              <div className="alm-inbox-detail__bulk-field">
                <label htmlFor="bulk-exposure" className="alm-inbox-detail__bulk-label">
                  {m.inbox_exposure_label()}
                </label>
                <input
                  id="bulk-exposure"
                  type="number"
                  value={bulkExposureS}
                  onChange={(e) => setBulkExposureS(e.target.value)}
                  placeholder={m.inbox_exposure_placeholder()}
                  aria-label={m.inbox_bulk_exposure_aria()}
                  data-testid="bulk-exposure-s"
                  className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
                  min={0}
                />
              </div>

              <div className="alm-inbox-detail__bulk-field">
                <label htmlFor="bulk-binning" className="alm-inbox-detail__bulk-label">
                  {m.settings_calmatch_binning()}
                </label>
                <input
                  id="bulk-binning"
                  type="text"
                  value={bulkBinning}
                  onChange={(e) => setBulkBinning(e.target.value)}
                  placeholder={m.inbox_binning_placeholder()}
                  aria-label={m.inbox_bulk_binning_aria()}
                  data-testid="bulk-binning"
                  className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
                />
              </div>

              <button
                className="alm-btn alm-btn--sm alm-btn--accent"
                onClick={handleBulkApply}
                disabled={reclassifyLoading}
                aria-label={m.inbox_bulk_override_apply_aria({ count: selectedFiles.size })}
                data-testid="bulk-apply-btn"
              >
                {reclassifyLoading
                  ? m.common_applying()
                  : `Apply to selected (${selectedFiles.size})`}
              </button>
            </div>
          )}

          {bulkError && (
            <Banner variant="danger" className="alm-inbox-detail__banner-mt2">{bulkError}</Banner>
          )}

          {Object.keys(pendingOverrides).length > 0 && (
            <div className="alm-inbox-detail__apply-row">
              <button
                className="alm-btn alm-btn--sm alm-btn--accent"
                onClick={handleApplyOverrides}
                disabled={Object.keys(pendingOverrides).length === 0 || reclassifyLoading}
                aria-label={m.inbox_apply_manual_overrides_aria()}
              >
                {reclassifyLoading
                  ? m.common_applying()
                  : /* eslint-disable-next-line alm/no-user-string -- 's' is a lone plural suffix, not user-facing prose */
                    `Apply ${Object.keys(pendingOverrides).length} override${Object.keys(pendingOverrides).length !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {applyError && (
            <Banner variant="danger" className="alm-inbox-detail__banner-mt2">{applyError}</Banner>
          )}
        </Section>
      )}

      {/* FR-032 (US9): blocking banner for missing path attributes */}
      {filesMissingAttrs.length > 0 && (
        <Banner
          variant="danger"
          className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
          data-testid="inbox-missing-attr-banner"
        >
          <div className="alm-inbox-alert__msg">
            <span className="alm-inbox-alert__title">{m.inbox_required_metadata_missing_title()}</span>
            <span className="alm-inbox-alert__body">
              {m.inbox_required_metadata_body({ count: filesMissingAttrs.length })}
            </span>
          </div>
        </Banner>
      )}

      {!classification && (
        <div className="alm-inbox-detail__empty">
          {m.inbox_select_item_prompt()}
        </div>
      )}
    </div>
  );

  // CONTENT column (center, scrolls): file-metadata table.
  // Row onClick → setInspectedIdx → FileInspector in the aux rail.
  const contentColumn = hasMetadata ? (
    <div className="alm-inbox-detail__meta-col" aria-label={m.inbox_file_metadata_aria()}>
      <div className="alm-inbox-detail__meta-head">
        {m.inbox_file_metadata_count({ count: metadataRows.length })}
      </div>
      <Table
        columns={metadataColumns}
        rows={metadataRows}
      />
    </div>
  ) : null;

  // AUX column (right): per-file FileInspector.
  // Always rendered when there is file metadata so the column appears even
  // before a row is clicked (inspector shows empty state).
  const auxColumn = hasMetadata ? (
    <FileInspector
      file={inspectedIdx != null ? (fileMetadata?.[inspectedIdx] ?? null) : null}
    />
  ) : null;

  return (
    <DetailPanel
      variant="inbox"
      title={title}
      titleExtra={
        <>
          <Pill variant={classificationVariant(classType)}>
            { }
            {classType === 'single_type'
              ? classification?.frameType ?? m.inbox_detail_single_fallback()
              : classType}
          </Pill>
          {/* eslint-disable-next-line alm/no-user-string -- "video" is a format-lane code, not a translatable word */}
          {item.lane === 'video' && <Pill variant="ghost">video</Pill>}
        </>
      }
      facts={factsColumn}
      aux={auxColumn}
    >
      {contentColumn}
    </DetailPanel>
  );
}
