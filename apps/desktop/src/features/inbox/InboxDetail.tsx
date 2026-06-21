/**
 * InboxDetail — centre pane for the Inbox classify/confirm workflow.
 *
 * Shows:
 * - Classification type pill + content signature.
 * - Breakdown table: one row per frame type with count, destination preview,
 *   and sample files.
 * - Mixed composition summary (FR-011): when type === 'mixed', a plain-text
 *   per-type count line (e.g. "12 light · 4 dark · 1 bias").
 * - "Needs review" section: files with unclassified = true, with an inline
 *   frame-type picker and "Apply override" button (calls inbox.reclassify).
 *   T027: multi-select checkboxes + bulk-override controls (frame type, filter,
 *   exposure, binning) applied to all selected files at once.
 * - Per-file metadata table (FR-010): rendered when the optional
 *   `fileMetadata` prop is provided and non-empty. No fetch here — the parent
 *   passes the data once `inbox.item.metadata` is wired (T019/T022).
 */

import { useState } from 'react';
import { DetailHeader, DetailPane, MetricLine } from '@/components';
import { Pill, Banner, Section, Table } from '@/ui';
import type { InboxItemSummary, InboxFileMetadata } from '@/api/commands';
import type { InboxClassifyResponse } from './store';
import type { PillVariant } from '@/ui';
import { useInboxReclassify } from './store';
import { errMessage } from '@/lib/errors';

// `InboxFileMetadata` is the generated Specta type (camelCase) re-exported from
// '@/api/commands' (spec 041 US2/FR-010 — T019 wired the real binding).

// ── Helpers ──────────────────────────────────────────────────────────────────

function classificationVariant(type: string): PillVariant {
  switch (type) {
    case 'single_type': return 'info';
    case 'mixed':       return 'warn';
    case 'unclassified': return 'neutral';
    default:            return 'neutral';
  }
}

const FRAME_TYPE_OPTIONS = ['light', 'dark', 'bias', 'flat', 'dark_flat'] as const;

/** Last path segment of a relative file path (forward- or back-slash separated). */
function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Format a nullable value as a muted dash for table cells. */
function fmtOrDash(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="alm-inbox-detail__dash">—</span>;
  }
  return String(value);
}

/** Format binning as "XxY" or dash. */
function fmtBinning(x: number | null | undefined, y: number | null | undefined): React.ReactNode {
  if (x == null && y == null) {
    return <span className="alm-inbox-detail__dash">—</span>;
  }
  const xStr = x != null ? String(x) : '?';
  const yStr = y != null ? String(y) : '?';
  return `${xStr}x${yStr}`;
}

/** Format exposure in seconds (e.g. "120 s"). */
function fmtExposure(s: number | null | undefined): React.ReactNode {
  if (s == null) return <span className="alm-inbox-detail__dash">—</span>;
  return `${s} s`;
}

/** Format temperature in °C. */
function fmtTemp(c: number | null | undefined): React.ReactNode {
  if (c == null) return <span className="alm-inbox-detail__dash">—</span>;
  return `${c} °C`;
}

/**
 * Build a plain-language composition summary for a mixed classification.
 * Example: "12 light · 4 dark · 1 bias"
 */
function buildMixedSummary(breakdown: InboxClassifyResponse['breakdown']): string {
  if (!breakdown || breakdown.length === 0) return '';
  return breakdown
    .map((entry) => `${entry.count} ${entry.kind}`)
    .join(' · ');
}

// ── EmptyClassification ───────────────────────────────────────────────────────

function EmptyClassification() {
  return (
    <div className="alm-inbox-detail__empty">
      Select an item and click <strong>Classify</strong> to see the breakdown.
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InboxDetailProps {
  item: InboxItemSummary;
  rootAbsolutePath: string;
  classification: InboxClassifyResponse | null;
  /**
   * Per-file metadata from `inbox.item.metadata` (FR-010).
   * Optional — rendered when provided and non-empty. The parent wires this
   * once the backend command exists (T017/T019/T022).
   */
  fileMetadata?: InboxFileMetadata[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InboxDetail({ item, classification, fileMetadata }: InboxDetailProps) {
  const { reclassify, loading: reclassifyLoading } = useInboxReclassify(item.inboxItemId);

  // Per-file overrides the user has selected but not yet submitted (single-file flow).
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, string>>({});
  const [applyError, setApplyError] = useState<string | null>(null);

  // ── T027: multi-select + bulk override state ──────────────────────────────
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [bulkFrameType, setBulkFrameType] = useState('');
  const [bulkFilter, setBulkFilter] = useState('');
  const [bulkExposureS, setBulkExposureS] = useState('');
  const [bulkBinning, setBulkBinning] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);

  const handleOverrideChange = (filePath: string, frameType: string) => {
    setPendingOverrides((prev) => ({ ...prev, [filePath]: frameType }));
  };

  // Single-file flow: apply per-file pendingOverrides (frame type only).
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

  // ── T027: selection helpers ───────────────────────────────────────────────

  const unclassifiedFiles = classification?.unclassifiedFiles ?? [];

  const handleToggleFile = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === unclassifiedFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(unclassifiedFiles));
    }
  };

  // Build overrides for the bulk apply: only include fields that are non-empty.
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
  const unclassifiedCount = classification?.unclassifiedFiles?.length ?? 0;

  // ── Breakdown table ────────────────────────────────────────────────────────

  // Fixed column widths (paired with table-layout: fixed on the <Table> below)
  // so the columns stay put when switching between items with different content
  // lengths instead of reflowing. Long paths wrap inside their cell.
  const wrapCell = { wordBreak: 'break-word' as const };
  const breakdownColumns = [
    { key: 'kind', label: 'Frame type', style: { width: '16%' } },
    { key: 'count', label: 'Files', style: { width: '10%' } },
    { key: 'destination', label: 'Destination preview', style: { width: '42%' }, cellStyle: wrapCell },
    { key: 'samples', label: 'Sample files', style: { width: '32%' }, cellStyle: wrapCell },
  ];

  const breakdownRows =
    classification?.breakdown?.map((entry) => ({
      kind: (
        <Pill variant={classificationVariant('single_type')}>{entry.kind}</Pill>
      ),
      count: entry.count,
      destination: entry.destinationPreview ?? (
        <span className="alm-inbox-detail__dash">—</span>
      ),
      samples: (
        <span className="alm-inbox-detail__samples">
          {entry.sampleFiles?.slice(0, 3).join(', ')}
          {(entry.sampleFiles?.length ?? 0) > 3 && (
            <span className="alm-inbox-detail__samples-more">
              {' '}+{(entry.sampleFiles?.length ?? 0) - 3} more
            </span>
          )}
        </span>
      ),
    })) ?? [];

  // ── Unclassified ("Needs review") table ────────────────────────────────────

  const allSelected = unclassifiedFiles.length > 0 && selectedFiles.size === unclassifiedFiles.length;
  const someSelected = selectedFiles.size > 0 && !allSelected;

  const unclassifiedColumns = [
    { key: 'select', label: '', style: { width: 36 } },
    { key: 'file', label: 'File', style: { width: 160 } },
    { key: 'override', label: 'Assign frame type' },
  ];

  const unclassifiedRows =
    unclassifiedFiles.map((filePath, idx) => ({
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
        <span
          title={filePath}
          className="alm-inbox-detail__file-cell"
        >
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

  // FR-032 (US9): files missing a path-load-bearing attribute block plan
  // generation. Surface a per-file "needs <attr>" indicator (consistent with
  // the missing-IMAGETYP needs-review affordance) and a summary banner.
  const filesMissingAttrs = (fileMetadata ?? []).filter(
    (f) => (f.missingPathAttributes?.length ?? 0) > 0,
  );

  const metadataRows =
    (fileMetadata ?? []).map((f) => {
      const missingAttrs = f.missingPathAttributes ?? [];
      const fileName = basename(f.relativeFilePath);
      return {
      file: (
        <span
          title={f.relativeFilePath}
          className="alm-inbox-detail__file-cell"
        >
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
      _rowStyle:
        f.overrideStale || missingAttrs.length > 0
          ? { background: 'var(--alm-warn-bg)' }
          : undefined,
      };
    });

  // ── Mixed composition summary (FR-011) ────────────────────────────────────

  const mixedSummary =
    classType === 'mixed' && classification?.breakdown
      ? buildMixedSummary(classification.breakdown)
      : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DetailPane>
      <DetailHeader
        title={title}
        titleExtra={
          <>
            <Pill variant={classificationVariant(classType)}>
              {classType === 'single_type'
                ? classification?.frameType ?? 'single'
                : classType}
            </Pill>
            {item.lane === 'video' && <Pill variant="ghost">video</Pill>}
          </>
        }
      />

      {classType === 'mixed' && (
        <Banner variant="warn" className="alm-inbox-detail__banner-mt3">
          Mixed folder — multiple frame types detected. Generate a split plan to
          move each type to its canonical location.
        </Banner>
      )}

      {classType === 'unclassified' && (
        <Banner variant="warn" className="alm-inbox-detail__banner-mt3">
          No IMAGETYP headers could be read. Assign frame types below before confirming.
        </Banner>
      )}

      {classification && (
        <MetricLine
          metrics={[
            { value: item.fileCount, label: 'files' },
            { value: classType, label: 'classification' },
            ...(unclassifiedCount > 0
              ? [{ value: unclassifiedCount, label: 'needs review' }]
              : []),
          ]}
        />
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

      {breakdownRows.length > 0 && (
        <Section title="Frame type breakdown">
          <Table
            columns={breakdownColumns}
            rows={breakdownRows}
            className="alm-inbox-detail__table-fixed"
          />
        </Section>
      )}

      {unclassifiedRows.length > 0 && (
        <Section title={`Needs review (${unclassifiedRows.length})`}>
          {/* Select-all affordance row above the table */}
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

          {/* T027: Bulk override controls — visible when >=1 file selected */}
          {selectedFiles.size > 0 && (
            <div
              className="alm-inbox-detail__bulk-controls"
              aria-label="Bulk override controls"
            >
              <div className="alm-inbox-detail__bulk-field">
                <label
                  htmlFor="bulk-frame-type"
                  className="alm-inbox-detail__bulk-label"
                >
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
                <label
                  htmlFor="bulk-filter"
                  className="alm-inbox-detail__bulk-label"
                >
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
                <label
                  htmlFor="bulk-exposure"
                  className="alm-inbox-detail__bulk-label"
                >
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
                <label
                  htmlFor="bulk-binning"
                  className="alm-inbox-detail__bulk-label"
                >
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

          {/* Single-file apply button: still available when user has per-row selects */}
          {Object.keys(pendingOverrides).length > 0 && (
            <div className="alm-inbox-detail__apply-row">
              <button
                className="alm-btn alm-btn--sm alm-btn--accent"
                onClick={handleApplyOverrides}
                disabled={Object.keys(pendingOverrides).length === 0 || reclassifyLoading}
                aria-label="Apply manual overrides"
              >
                {reclassifyLoading ? 'Applying…' : `Apply ${Object.keys(pendingOverrides).length} override${Object.keys(pendingOverrides).length !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
          {applyError && (
            <Banner variant="danger" className="alm-inbox-detail__banner-mt2">{applyError}</Banner>
          )}
        </Section>
      )}

      {/* FR-032 (US9): plan generation is blocked while any file lacks a
          path-load-bearing attribute. Direct the user to the override flow. */}
      {filesMissingAttrs.length > 0 && (
        <Banner
          variant="warn"
          className="alm-inbox-detail__banner-mt3"
          data-testid="inbox-missing-attr-banner"
        >
          {filesMissingAttrs.length} file{filesMissingAttrs.length !== 1 ? 's' : ''} missing
          required attribute(s) for their destination. Assign the missing value(s) in “Needs
          review” above before confirming.
        </Banner>
      )}

      {/* FR-010: per-file metadata table — shown only when parent provides data */}
      {metadataRows.length > 0 && (
        <Section title={`File metadata (${metadataRows.length})`}>
          <div className="alm-inbox-detail__metadata-scroll">
            <Table columns={metadataColumns} rows={metadataRows} />
          </div>
        </Section>
      )}

      {!classification && (
        <EmptyClassification />
      )}
    </DetailPane>
  );
}
