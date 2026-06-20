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
 * - Per-file metadata table (FR-010): rendered when the optional
 *   `fileMetadata` prop is provided and non-empty. No fetch here — the parent
 *   passes the data once `inbox.item.metadata` is wired (T019/T022).
 */

import { useState } from 'react';
import { DetailHeader, DetailPane, MetricLine } from '@/components';
import { Pill, Banner, Section, Table } from '@/ui';
import type { InboxItemSummary } from '@/api/commands';
import type { InboxClassifyResponse } from './store';
import type { PillVariant } from '@/ui';
import { useInboxReclassify } from './store';

// ── InboxFileMetadata (local until T019 regenerates bindings) ─────────────────
//
// Field names mirror the snake_case contract shape from
// specs/041-inbox-plan-surface/contracts/operations.md (inbox.item.metadata).
// When the generated bindings export `InboxFileMetadata` (Specta camelCase),
// swap this interface for an import from '@/bindings' and update field access.

/** @todo replace with import from '@/bindings' once T019 regenerates bindings */
export interface InboxFileMetadata {
  relative_file_path: string;
  frame_type_effective: string | null;
  image_typ: string | null;
  filter: string | null;
  exposure_s: number | null;
  gain: number | null;
  binning_x: number | null;
  binning_y: number | null;
  temperature_c: number | null;
  object: string | null;
  date_obs: string | null;
  instrume: string | null;
  telescop: string | null;
  naxis1: number | null;
  naxis2: number | null;
  stack_count: number | null;
  is_master: boolean;
  override_stale: boolean;
}

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
function fmtBinning(x: number | null, y: number | null): React.ReactNode {
  if (x === null && y === null) {
    return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
  }
  const xStr = x !== null ? String(x) : '?';
  const yStr = y !== null ? String(y) : '?';
  return `${xStr}x${yStr}`;
}

/** Format exposure in seconds (e.g. "120 s"). */
function fmtExposure(s: number | null): React.ReactNode {
  if (s === null) return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
  return `${s} s`;
}

/** Format temperature in °C. */
function fmtTemp(c: number | null): React.ReactNode {
  if (c === null) return <span style={{ color: 'var(--alm-text-muted)' }}>—</span>;
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

// ── Props ────────────────────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

export function InboxDetail({ item, classification, fileMetadata }: InboxDetailProps) {
  const { reclassify, loading: reclassifyLoading } = useInboxReclassify(item.inboxItemId);

  // Per-file overrides the user has selected but not yet submitted.
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, string>>({});
  const [applyError, setApplyError] = useState<string | null>(null);

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
      setApplyError(err instanceof Error ? err.message : String(err));
    }
  };

  const title = item.relativePath || '(root)';
  const classType = classification?.type ?? 'pending';
  const unclassifiedCount = classification?.unclassifiedFiles?.length ?? 0;

  // ── Breakdown table ───────────────────────────────────────────────────────

  const breakdownColumns = [
    { key: 'kind', label: 'Frame type', style: { width: 100 } },
    { key: 'count', label: 'Files' },
    { key: 'destination', label: 'Destination preview' },
    { key: 'samples', label: 'Sample files' },
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

  // ── Unclassified ("Needs review") table ──────────────────────────────────

  const unclassifiedColumns = [
    { key: 'file', label: 'File', style: { width: 160 } },
    { key: 'override', label: 'Assign frame type' },
  ];

  const unclassifiedRows =
    classification?.unclassifiedFiles?.map((filePath) => ({
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
    })) ?? [];

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
          title={f.relative_file_path}
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--alm-text-xs)',
          }}
        >
          {f.relative_file_path}
        </span>
      ),
      type:     fmtOrDash(f.frame_type_effective),
      filter:   fmtOrDash(f.filter),
      exposure: fmtExposure(f.exposure_s),
      binning:  fmtBinning(f.binning_x, f.binning_y),
      gain:     fmtOrDash(f.gain),
      temp:     fmtTemp(f.temperature_c),
      object:   fmtOrDash(f.object),
      date:     fmtOrDash(f.date_obs),
      _rowStyle: f.override_stale
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
          <Table columns={breakdownColumns} rows={breakdownRows} />
        </Section>
      )}

      {unclassifiedRows.length > 0 && (
        <Section title={`Needs review (${unclassifiedRows.length})`}>
          <Table columns={unclassifiedColumns} rows={unclassifiedRows} />
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
