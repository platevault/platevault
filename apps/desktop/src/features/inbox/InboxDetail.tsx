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

/** Format a nullable value as a muted dash for table cells. */
function fmtOrDash(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
  }
  return String(value);
}

/** Format binning as "XxY" or dash. */
function fmtBinning(x: number | null | undefined, y: number | null | undefined): React.ReactNode {
  if (x == null && y == null) {
    return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
  }
  const xStr = x != null ? String(x) : '?';
  const yStr = y != null ? String(y) : '?';
  return `${xStr}x${yStr}`;
}

/** Format exposure in seconds (e.g. "120 s"). */
function fmtExposure(s: number | null | undefined): React.ReactNode {
  if (s == null) return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
  return `${s} s`;
}

/** Format temperature in °C. */
function fmtTemp(c: number | null | undefined): React.ReactNode {
  if (c == null) return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
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
    <div
      style={{
        padding: 'var(--alm-sp-4)',
        color: 'var(--alm-text-muted)',
        fontSize: 'var(--alm-text-sm)',
      }}
    >
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
        <span style={{ color: 'var(--alm-text-muted)' }}>—</span>
      ),
      samples: (
        <span style={{ fontSize: 'var(--alm-text-xs)' }}>
          {entry.sampleFiles?.slice(0, 3).join(', ')}
          {(entry.sampleFiles?.length ?? 0) > 3 && (
            <span style={{ color: 'var(--alm-text-muted)' }}>
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
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--alm-text-xs)',
          }}
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

  const metadataRows =
    (fileMetadata ?? []).map((f) => ({
      file: (
        <span
          title={f.relativeFilePath}
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--alm-text-xs)',
          }}
        >
          {f.relativeFilePath}
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
      _rowStyle: f.overrideStale
        ? { background: 'var(--alm-color-warn-subtle, rgba(255,200,0,0.08))' }
        : undefined,
    }));

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
        <Banner variant="warn" style={{ marginTop: 'var(--alm-sp-3)' }}>
          Mixed folder — multiple frame types detected. Generate a split plan to
          move each type to its canonical location.
        </Banner>
      )}

      {classType === 'unclassified' && (
        <Banner variant="warn" style={{ marginTop: 'var(--alm-sp-3)' }}>
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
          style={{
            marginTop: 'var(--alm-sp-2)',
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text-secondary, var(--alm-text-muted))',
          }}
        >
          {mixedSummary}
        </div>
      )}

      {breakdownRows.length > 0 && (
        <Section title="Frame type breakdown">
          <Table
            columns={breakdownColumns}
            rows={breakdownRows}
            style={{ tableLayout: 'fixed', width: '100%' }}
          />
        </Section>
      )}

      {unclassifiedRows.length > 0 && (
        <Section title={`Needs review (${unclassifiedRows.length})`}>
          {/* Select-all affordance row above the table */}
          <div style={{ marginBottom: 'var(--alm-sp-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={handleSelectAll}
              aria-label="Select all unclassified files"
              data-testid="reclassify-select-all"
            />
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              {selectedFiles.size === 0 ? 'Select all' : `${selectedFiles.size} selected`}
            </span>
          </div>
          <Table columns={unclassifiedColumns} rows={unclassifiedRows} />

          {/* T027: Bulk override controls — visible when >=1 file selected */}
          {selectedFiles.size > 0 && (
            <div
              style={{
                marginTop: 'var(--alm-sp-3)',
                padding: 'var(--alm-sp-3)',
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'flex-end',
              }}
              aria-label="Bulk override controls"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  htmlFor="bulk-frame-type"
                  style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  htmlFor="bulk-filter"
                  style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
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
                  className="alm-input alm-input--sm"
                  style={{ width: 80 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  htmlFor="bulk-exposure"
                  style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
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
                  className="alm-input alm-input--sm"
                  style={{ width: 80 }}
                  min={0}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  htmlFor="bulk-binning"
                  style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
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
                  className="alm-input alm-input--sm"
                  style={{ width: 80 }}
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
            <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-2)' }}>{bulkError}</Banner>
          )}

          {/* Single-file apply button: still available when user has per-row selects */}
          {Object.keys(pendingOverrides).length > 0 && (
            <div style={{ marginTop: 'var(--alm-sp-2)', display: 'flex', gap: 8 }}>
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
            <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-2)' }}>{applyError}</Banner>
          )}
        </Section>
      )}

      {/* FR-010: per-file metadata table — shown only when parent provides data */}
      {metadataRows.length > 0 && (
        <Section title={`File metadata (${metadataRows.length})`}>
          <div style={{ overflowX: 'auto' }}>
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
