/**
 * InboxDetail — bottom pane for the Inbox classify/confirm workflow.
 *
 * Follows the SessionDetail shape (spec 043 §4 redesign):
 *
 *   HEADER — item path (title, bold) + titleExtra: classification pill +
 *             inline action buttons (left-packed, alm-session-detail2__actions).
 *             "Generate split plan" for mixed folders lives HERE, not in the body.
 *   BODY   — left-packed .alm-session-detail2 flex row:
 *     col A (PropertyTable, left)    — classification + file-count + FITS metadata
 *     breakdown block (after cols)   — frame-type breakdown table; retains full
 *                                      interactivity (filter rows, type-override
 *                                      selects, bulk-apply).
 *     file-metadata block (after BD) — per-file metadata table (FR-010).
 *     file-inspector block           — per-file FileInspector (updated on row click).
 *   The mixed-folder Banner sits above the .alm-session-detail2 row as an
 *   informational summary; the primary ACTION ("Generate split plan") is in
 *   the header titleExtra.
 *
 * No facts/aux props passed to DetailPanel — body is fully self-contained.
 */

import { useState } from 'react';
import { DetailPanel, PropertyTable } from '@/components';
import type { PropertyDef } from '@/components';
import { Pill, Banner, Btn, Section, Table } from '@/ui';
import type { InboxItemSummary, InboxFileMetadata } from '@/api/commands';
import type { InboxClassifyResponse } from './store';
import type { PillVariant } from '@/ui';
import { useInboxReclassify } from './store';
import { errMessage } from '@/lib/errors';

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
      label: 'Instrument',
      value: fmtOrDash(file.instrume),
      testid: 'inspector-instrume',
    },
    {
      label: 'Telescope',
      value: fmtOrDash(file.telescop),
      testid: 'inspector-telescop',
    },
    {
      label: 'Dimensions',
      value: fmtDimensions(file.naxis1, file.naxis2),
      testid: 'inspector-dims',
    },
    {
      label: 'Stack count',
      value: fmtOrDash(file.stackCount),
      testid: 'inspector-stackcount',
    },
    {
      label: 'Raw IMAGETYP',
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
    { key: 'kind',        label: 'Frame type',  style: { width: '28%' } },
    { key: 'count',       label: 'Files',        style: { width: '14%' } },
    { key: 'destination', label: 'Destination',  style: { width: '58%' } },
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
    { key: 'select',   label: '',                 style: { width: 36 } },
    { key: 'file',     label: 'File',             style: { width: 160 } },
    { key: 'override', label: 'Assign frame type' },
  ];

  const unclassifiedRows = unclassifiedFiles.map((filePath, idx) => ({
    select: (
      <input
        type="checkbox"
        checked={selectedFiles.has(filePath)}
        onChange={() => handleToggleFile(filePath)}
        aria-label={`Select ${filePath}`}
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
        aria-label={`Override frame type for ${filePath}`}
        data-testid={`override-select-${filePath}`}
        className="alm-select alm-select--sm"
      >
        <option value="">— pick type —</option>
        {FRAME_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    ),
  }));

  // ── Per-file metadata table (FR-010) ──────────────────────────────────────

  const metadataColumns = [
    { key: 'file',     label: 'File',     style: { minWidth: 160 } },
    { key: 'type',     label: 'Type',     style: { width: 80 } },
    { key: 'filter',   label: 'Filter',   style: { width: 70 } },
    { key: 'exposure', label: 'Exposure', style: { width: 80 } },
    { key: 'binning',  label: 'Binning',  style: { width: 70 } },
    { key: 'gain',     label: 'Gain',     style: { width: 60 } },
    { key: 'temp',     label: 'Temp',     style: { width: 70 } },
    { key: 'object',   label: 'Object',   style: { width: 100 } },
    { key: 'date',     label: 'Date',     style: { width: 110 } },
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
              title={`Missing required attribute(s): ${missingAttrs.join(', ')}`}
              className="alm-inbox-detail__missing-attr-badge"
            >
              needs {missingAttrs.join(', ')}
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

  // ── Detection property table (left col A) ────────────────────────────────
  // Classification type, file count, and the first file's FITS metadata fields
  // as a flat PropertyTable — mirrors SessionDetail's factProps pattern.
  // The "first file" is a best-effort representative sample for the detection.

  const repFile = fileMetadata?.[0] ?? null;

  const detectionProps: PropertyDef[] = [
    {
      key: 'classification',
      label: 'Classification',
      value:
        classType === 'single_type'
          ? (classification?.frameType ?? 'single_type')
          : classType,
    },
    { key: 'files', label: 'Files', value: classification ? String(classification.breakdown?.reduce((s, e) => s + e.count, 0) || item.fileCount) : String(item.fileCount) },
    ...(repFile?.object != null
      ? [{ key: 'target', label: 'Target', value: repFile.object, source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.filter != null
      ? [{ key: 'filter', label: 'Filter', value: repFile.filter, source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.exposureS != null
      ? [{ key: 'exposure', label: 'Exposure', value: fmtExposure(repFile.exposureS), source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.binningX != null || repFile?.binningY != null
      ? [{ key: 'binning', label: 'Binning', value: fmtBinning(repFile?.binningX, repFile?.binningY), source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.gain != null
      ? [{ key: 'gain', label: 'Gain', value: repFile.gain, source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.temperatureC != null
      ? [{ key: 'temp', label: 'Sensor temp', value: fmtTemp(repFile.temperatureC), source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.instrume != null
      ? [{ key: 'instrume', label: 'Instrument', value: repFile.instrume, source: 'fits' } as PropertyDef]
      : []),
    ...(repFile != null && (repFile.naxis1 != null || repFile.naxis2 != null)
      ? [{ key: 'dims', label: 'Dimensions', value: fmtDimensions(repFile.naxis1, repFile.naxis2), source: 'fits' } as PropertyDef]
      : []),
    ...(repFile?.dateObs != null
      ? [{ key: 'date', label: 'Night', value: repFile.dateObs, source: 'fits' } as PropertyDef]
      : []),
  ];

  // ── Inline header actions ─────────────────────────────────────────────────
  // Classification pill + lane pill + "Generate split plan" for mixed.
  // Left-packed via alm-session-detail2__actions so growing the panel adds
  // trailing whitespace rather than spreading title and buttons apart.
  const titleActions = (
    <span className="alm-session-detail2__actions">
      <Pill variant={classificationVariant(classType)}>
        {classType === 'single_type'
          ? classification?.frameType ?? 'single'
          : classType}
      </Pill>
      {item.lane === 'video' && <Pill variant="ghost">video</Pill>}
      {classType === 'mixed' && onGenerateSplitPlan && (
        <Btn
          size="sm"
          variant="accent"
          onClick={onGenerateSplitPlan}
          disabled={splitPlanBusy}
          aria-label="Generate split plan"
          data-testid="inbox-mixed-split-btn"
        >
          {splitPlanBusy ? 'Working…' : 'Generate split plan'}
        </Btn>
      )}
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
      {/* Mixed: advisory banner above the content row */}
      {classType === 'mixed' && (
        <Banner
          variant="warn"
          className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
          data-testid="inbox-mixed-alert"
        >
          <div className="alm-inbox-alert__msg">
            <span className="alm-inbox-alert__title">Mixed folder</span>
            <span className="alm-inbox-alert__body">
              Multiple frame types detected. Confirm to produce a reviewable split plan.
            </span>
          </div>
        </Banner>
      )}

      {/* Unclassified: blocking banner */}
      {classType === 'unclassified' && (
        <Banner
          variant="danger"
          className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
          data-testid="inbox-unclassified-alert"
        >
          <div className="alm-inbox-alert__msg">
            <span className="alm-inbox-alert__title">Frame types required</span>
            <span className="alm-inbox-alert__body">
              No IMAGETYP headers could be read. Assign frame types below, then confirm.
            </span>
          </div>
        </Banner>
      )}

      {/* FR-011: explicit per-type composition for mixed folders */}
      {mixedSummary && (
        <div
          aria-label="Mixed composition summary"
          className="alm-inbox-detail__mixed-summary"
        >
          {mixedSummary}
        </div>
      )}

      {!classification && (
        <div className="alm-inbox-detail__empty">
          Select an item to see the classification breakdown.
        </div>
      )}

      {/* Left-packed .alm-session-detail2 row: [property col] [breakdown] [metadata] [inspector] */}
      <div className="alm-session-detail2">
        {/* Col A: detection properties (classification, files, FITS attrs) */}
        <div className="alm-session-detail2__col">
          <div className="alm-session-detail2__head">Detection</div>
          <PropertyTable mode="view" showSource properties={detectionProps} />
        </div>

        {/* Breakdown table: always visible when there are breakdown entries */}
        {breakdownRows.length > 0 && (
          <div className="alm-session-detail2__col">
            <div className="alm-session-detail2__head">
              Frame type breakdown
              {activeBreakdownFilter && onBreakdownFilterChange && (
                <span className="alm-breakdown-filter-label" data-testid="breakdown-filter-active">
                  {' '}— {activeBreakdownFilter}
                  <button
                    type="button"
                    className="alm-breakdown-filter-clear"
                    onClick={() => onBreakdownFilterChange(null)}
                    aria-label="Clear frame type filter"
                    data-testid="breakdown-filter-clear"
                  >
                    clear
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

        {/* Needs review — always rendered when unclassified files exist */}
        {unclassifiedRows.length > 0 && (
          <div className="alm-session-detail2__col">
            <Section title={`Needs review (${unclassifiedRows.length})`}>
              <div className="alm-inbox-detail__select-all-row">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={handleSelectAll}
                  aria-label="Select all unclassified files"
                  data-testid="reclassify-select-all"
                />
                <span className="alm-inbox-detail__select-all-label">
                  {selectedFiles.size === 0 ? 'Select all' : `${selectedFiles.size} selected`}
                </span>
              </div>
              <Table columns={unclassifiedColumns} rows={unclassifiedRows} />

              {selectedFiles.size > 0 && (
                <div className="alm-inbox-detail__bulk-controls" aria-label="Bulk override controls">
                  <div className="alm-inbox-detail__bulk-field">
                    <label htmlFor="bulk-frame-type" className="alm-inbox-detail__bulk-label">
                      Frame type
                    </label>
                    <select
                      id="bulk-frame-type"
                      value={bulkFrameType}
                      onChange={(e) => setBulkFrameType(e.target.value)}
                      aria-label="Bulk frame type"
                      data-testid="bulk-frame-type"
                      className="alm-select alm-select--sm"
                    >
                      <option value="">— unchanged —</option>
                      {FRAME_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="alm-inbox-detail__bulk-field">
                    <label htmlFor="bulk-filter" className="alm-inbox-detail__bulk-label">
                      Filter
                    </label>
                    <input
                      id="bulk-filter"
                      type="text"
                      value={bulkFilter}
                      onChange={(e) => setBulkFilter(e.target.value)}
                      placeholder="e.g. Ha"
                      aria-label="Bulk filter"
                      data-testid="bulk-filter"
                      className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
                    />
                  </div>

                  <div className="alm-inbox-detail__bulk-field">
                    <label htmlFor="bulk-exposure" className="alm-inbox-detail__bulk-label">
                      Exposure (s)
                    </label>
                    <input
                      id="bulk-exposure"
                      type="number"
                      value={bulkExposureS}
                      onChange={(e) => setBulkExposureS(e.target.value)}
                      placeholder="e.g. 300"
                      aria-label="Bulk exposure seconds"
                      data-testid="bulk-exposure-s"
                      className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
                      min={0}
                    />
                  </div>

                  <div className="alm-inbox-detail__bulk-field">
                    <label htmlFor="bulk-binning" className="alm-inbox-detail__bulk-label">
                      Binning
                    </label>
                    <input
                      id="bulk-binning"
                      type="text"
                      value={bulkBinning}
                      onChange={(e) => setBulkBinning(e.target.value)}
                      placeholder="e.g. 2x2"
                      aria-label="Bulk binning"
                      data-testid="bulk-binning"
                      className="alm-input alm-input--sm alm-inbox-detail__bulk-input-w80"
                    />
                  </div>

                  <button
                    className="alm-btn alm-btn--sm alm-btn--accent"
                    onClick={handleBulkApply}
                    disabled={reclassifyLoading}
                    aria-label={`Apply bulk override to ${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''}`}
                    data-testid="bulk-apply-btn"
                  >
                    {reclassifyLoading
                      ? 'Applying…'
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
                    aria-label="Apply manual overrides"
                  >
                    {reclassifyLoading
                      ? 'Applying…'
                      : `Apply ${Object.keys(pendingOverrides).length} override${Object.keys(pendingOverrides).length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              )}

              {applyError && (
                <Banner variant="danger" className="alm-inbox-detail__banner-mt2">{applyError}</Banner>
              )}
            </Section>
          </div>
        )}

        {/* FR-032 (US9): blocking banner for missing path attributes — outside
            the "Needs review" block so it renders even when unclassifiedFiles
            is empty (classified files with missing path-load-bearing attrs). */}
        {filesMissingAttrs.length > 0 && (
          <div className="alm-session-detail2__col">
            <Banner
              variant="danger"
              className="alm-inbox-detail__banner-mt3 alm-inbox-alert"
              data-testid="inbox-missing-attr-banner"
            >
              <div className="alm-inbox-alert__msg">
                <span className="alm-inbox-alert__title">Required metadata missing</span>
                <span className="alm-inbox-alert__body">
                  {filesMissingAttrs.length} file{filesMissingAttrs.length !== 1 ? 's' : ''} missing
                  required attribute(s) for their destination — confirm disabled. Assign the
                  missing value(s) in "Needs review" above, then confirm.
                </span>
              </div>
            </Banner>
          </div>
        )}

        {/* Per-file metadata table (FR-010) */}
        {hasMetadata && (
          <div className="alm-session-detail2__col alm-inbox-detail__meta-col" aria-label="File metadata">
            <div className="alm-session-detail2__head">
              File metadata ({metadataRows.length})
            </div>
            <Table
              columns={metadataColumns}
              rows={metadataRows}
            />
          </div>
        )}

        {/* Per-file inspector — shown when metadata is present */}
        {hasMetadata && (
          <FileInspector
            file={inspectedIdx != null ? (fileMetadata?.[inspectedIdx] ?? null) : null}
          />
        )}
      </div>
    </DetailPanel>
  );
}
