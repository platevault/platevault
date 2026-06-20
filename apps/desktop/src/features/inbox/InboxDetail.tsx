/**
 * InboxDetail — centre pane for the Inbox classify/confirm workflow.
 *
 * Shows:
 * - Classification type pill + content signature.
 * - Breakdown table: one row per frame type with count, destination preview,
 *   and sample files.
 * - "Needs review" section: files with unclassified = true, with an inline
 *   frame-type picker and "Apply override" button (calls inbox.reclassify).
 */

import { useState } from 'react';
import { DetailHeader, DetailPane, MetricLine } from '@/components';
import { Pill, Banner, Section, Table } from '@/ui';
import type { InboxItemSummary } from '@/api/commands';
import type { InboxClassifyResponse } from './store';
import type { PillVariant } from '@/ui';
import { useInboxReclassify } from './store';
import { errMessage } from '@/lib/errors';

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

// ── Props ────────────────────────────────────────────────────────────────────

export interface InboxDetailProps {
  item: InboxItemSummary;
  rootAbsolutePath: string;
  classification: InboxClassifyResponse | null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function InboxDetail({ item, classification }: InboxDetailProps) {
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
      setApplyError(errMessage(err));
    }
  };

  const title = item.relativePath || '(root)';
  const classType = classification?.type ?? 'pending';
  const unclassifiedCount = classification?.unclassifiedFiles?.length ?? 0;

  const breakdownColumns = [
    { key: 'kind', label: 'Frame type', style: { width: 100 } },
    { key: 'count', label: 'Files' },
    { key: 'destination', label: 'Destination preview' },
    { key: 'samples', label: 'Sample files' },
  ];

  const breakdownRows =
    classification?.breakdown?.map((entry) => ({
      kind: <Pill variant={classificationVariant('single_type')}>{entry.kind}</Pill>,
      count: entry.count,
      destination: entry.destinationPreview ? (
        <code style={{ fontSize: 'var(--alm-text-xs)' }}>{entry.destinationPreview}</code>
      ) : (
        <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>computed on confirm</span>
      ),
      samples: (
        <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
          {entry.sampleFiles?.slice(0, 3).join(', ')}
          {(entry.sampleFiles?.length ?? 0) > 3 ? ' …' : ''}
        </span>
      ),
    })) ?? [];

  const unclassifiedRows =
    classification?.unclassifiedFiles?.map((filePath) => ({
      file: (
        <code style={{ fontSize: 'var(--alm-text-xs)', wordBreak: 'break-all' }}>{filePath}</code>
      ),
      override: (
        <select
          className="alm-select alm-select--sm"
          value={pendingOverrides[filePath] ?? ''}
          onChange={(e) => handleOverrideChange(filePath, e.target.value)}
          aria-label={`Frame type for ${filePath}`}
          data-testid={`override-select-${filePath}`}
        >
          <option value="">— select type —</option>
          {FRAME_TYPE_OPTIONS.map((ft) => (
            <option key={ft} value={ft}>
              {ft}
            </option>
          ))}
        </select>
      ),
    })) ?? [];

  const unclassifiedColumns = [
    { key: 'file', label: 'File' },
    { key: 'override', label: 'Assign type', style: { width: 160 } },
  ];

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

      {!classification && (
        <EmptyClassification />
      )}
    </DetailPane>
  );
}

function EmptyClassification() {
  return (
    <div style={{ padding: 'var(--alm-sp-4)', color: 'var(--alm-text-muted)' }}>
      Loading classification…
    </div>
  );
}
