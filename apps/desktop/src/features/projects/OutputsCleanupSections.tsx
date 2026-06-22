/**
 * OutputsCleanupSections — spec 043 §4 Projects detail (task #44).
 *
 * Two project-detail sections that the PlateVault mock calls for:
 *   1. Outputs           — accepted processing outputs with verification pills.
 *   2. Cleanup preview   — themed Banner alert summarising what a cleanup plan
 *                          WOULD do, with protected categories shown LOCKED.
 *
 * STUB DATA POLICY (constitution principle II — no fabricated data):
 * The current backend exposes neither an accepted-output model nor a
 * per-project cleanup-preview projection on ProjectDetailDto. `cleanup.scan`
 * exists as a separate, on-demand command (CleanupScanResult), but no preview
 * is carried on the detail read path. Until those land, BOTH sections render
 * teaching EMPTY states — never invented rows or byte counts.
 *
 * When the backend lands:
 *   - Outputs:  map project.outputs[] → output rows (name · format · verified
 *     pill). The `verified` boolean drives the pill variant; replace the
 *     EmptyState branch with a Table of real rows.
 *   - Cleanup:  call cleanup.scan (or read a detail-carried preview) and fill
 *     reclaimableBytes + candidate counts; the protected categories below are
 *     intentionally LOCKED (constitution: protected categories must be
 *     documented before any cleanup plan is generated).
 */

import { Section, Pill, Banner, Table, EmptyState, KV, Lock } from '@/ui';
import type { PillVariant } from '@/ui';

// ── Outputs ───────────────────────────────────────────────────────────────────

/**
 * Accepted processing output, as the future backend will expose it.
 * STUB: ProjectDetailDto carries no `outputs` field yet, so the live list is
 * always empty. Shape kept here so wiring is a one-line map() once it lands.
 */
export interface ProjectOutputView {
  /** Stable id (file record / output id). */
  id: string;
  /** Display name (filename or label). */
  name: string;
  /** Output format, e.g. "XISF", "TIFF", "PNG". */
  format: string;
  /** Whether the output passed final verification (drives the pill). */
  verified: boolean;
}

function verifiedPillVariant(verified: boolean): PillVariant {
  return verified ? 'ok' : 'warn';
}

export interface OutputsSectionProps {
  /** STUB: always [] until ProjectDetailDto exposes accepted outputs. */
  outputs?: ProjectOutputView[];
}

export function OutputsSection({ outputs = [] }: OutputsSectionProps) {
  const columns = [
    { key: 'name', label: 'OUTPUT' },
    { key: 'format', label: 'FORMAT' },
    { key: 'verified', label: 'VERIFICATION' },
  ];

  const rows = outputs.map((o) => ({
    name: <span className="alm-project-detail__output-name">{o.name}</span>,
    format: <span className="alm-project-detail__output-format">{o.format}</span>,
    verified: (
      <Pill variant={verifiedPillVariant(o.verified)}>
        {o.verified ? 'verified' : 'unverified'}
      </Pill>
    ),
  }));

  return (
    <Section title="Outputs" count={outputs.length || undefined} data-testid="project-outputs">
      {outputs.length === 0 ? (
        // STUB: no accepted-output backend model yet — teaching empty state.
        <EmptyState
          title="No accepted outputs yet"
          desc="Accepted processing outputs and their verification status will appear here once recorded. Record an accepted output from your processing tool to track it."
        />
      ) : (
        <div className="alm-project-detail__outputs">
          <Table columns={columns} rows={rows} />
        </div>
      )}
    </Section>
  );
}

// ── Cleanup preview ─────────────────────────────────────────────────────────────

/**
 * Protected categories shown LOCKED in the cleanup preview.
 * STUB: these mirror the documented protected-category intent (constitution
 * principle II / spec 042 cleanup). They are NOT live policy values; when the
 * cleanup policy read path is wired, derive these from CleanupPolicy entries.
 */
const PROTECTED_CATEGORIES: readonly string[] = [
  'Accepted outputs',
  'Master calibration frames',
  'Source acquisition frames',
];

/**
 * Cleanup preview summary, as the future backend will expose it
 * (derived from cleanup.scan / a detail-carried preview projection).
 * STUB: no preview is carried on ProjectDetailDto yet.
 */
export interface CleanupPreviewView {
  /** Number of files the cleanup plan would propose to archive/trash. */
  candidateCount: number;
  /** Bytes the cleanup plan would reclaim. */
  reclaimableBytes: number;
}

export interface CleanupPreviewSectionProps {
  /** STUB: undefined until cleanup-preview data lands on the read path. */
  preview?: CleanupPreviewView;
}

export function CleanupPreviewSection({ preview }: CleanupPreviewSectionProps) {
  return (
    <Section title="Cleanup preview" data-testid="project-cleanup-preview">
      {/* Themed alert: cleanup is reviewable + reversible, never silent. */}
      <Banner variant="warn" role="status" aria-live="polite">
        <div className="alm-project-detail__cleanup-preview">
          {preview ? (
            // STUB: this branch is currently unreachable (preview is always
            // undefined). Kept so wiring is trivial once the backend lands.
            <span className="alm-project-detail__cleanup-note">
              Cleanup would review {preview.candidateCount} candidate
              {preview.candidateCount === 1 ? '' : 's'} for archive or trash.
              Nothing is removed without explicit plan approval.
            </span>
          ) : (
            <span className="alm-project-detail__cleanup-note">
              No cleanup preview available yet. After the project is verified,
              this will show what a cleanup plan would archive or trash —
              reviewable before anything is removed.
            </span>
          )}
        </div>
      </Banner>

      {/* Protected categories — always shown LOCKED (never proposed for cleanup). */}
      <div className="alm-project-detail__cleanup-protected" data-testid="cleanup-protected">
        <div className="alm-project-detail__cleanup-protected-head">
          Protected — never proposed for cleanup
        </div>
        <div className="alm-project-detail__cleanup-protected-list">
          {PROTECTED_CATEGORIES.map((cat) => (
            <KV
              key={cat}
              label={cat}
              value={<Lock reason={`${cat} are protected and excluded from cleanup plans`} />}
            />
          ))}
        </div>
      </div>
    </Section>
  );
}
