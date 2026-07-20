// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OutputsCleanupSections — spec 043 §4 Projects detail (task #44) +
 * spec 017 WP-E cleanup review flow.
 *
 * Two project-detail sections:
 *   1. Outputs — accepted processing outputs with verification pills.
 *      STUB DATA POLICY (constitution principle II — no fabricated data): the
 *      backend exposes no accepted-output model on ProjectDetailDto yet, so
 *      this section renders a teaching EMPTY state — never invented rows.
 *   2. Cleanup — LIVE two-step cleanup flow (D11): "Scan" calls the pure,
 *      read-only `cleanup.scan` preview on demand (no plan row, no mutation);
 *      candidates render grouped by classification with confidence, per-file
 *      protection, and reclaimable bytes. "Generate cleanup plan" materialises
 *      the reviewable plan (`cleanup.plan.generate`) and hands off to the
 *      shared {@link PlanReviewOverlay} (protection gate → approve → apply
 *      with live progress).
 */

import { useState } from 'react';
import {
  Section,
  Pill,
  Banner,
  Table,
  EmptyState,
  KV,
  Lock,
  RadioGroup,
  Btn,
} from '@/ui';
import type { PillVariant } from '@/ui';
import { m } from '@/lib/i18n';
import { formatBytes } from '@/lib/format';
import { addToast } from '@/shared/toast';
import { PlanReviewOverlay } from '@/features/plans/PlanReviewOverlay';
import { useCleanupScan, useGenerateCleanupPlan } from './cleanupStore';
import type { DestructiveDestinationChoice } from './cleanupStore';
import { groupCandidates, parseCandidateReason } from './cleanupCandidates';
import type { CleanupCandidate } from '@/bindings/index';

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
  /** Whether the collapsible section starts open. Default true. */
  defaultOpen?: boolean;
}

export function OutputsSection({
  outputs = [],
  defaultOpen = true,
}: OutputsSectionProps) {
  const columns = [
    { key: 'name', label: m.projects_col_output() },
    { key: 'format', label: m.projects_col_format() },
    { key: 'verified', label: m.projects_col_verification() },
  ];

  const rows = outputs.map((o) => ({
    name: <span className="pv-project-detail__output-name">{o.name}</span>,
    format: (
      <span className="pv-project-detail__output-format">{o.format}</span>
    ),
    verified: (
      <Pill variant={verifiedPillVariant(o.verified)}>
        {o.verified ? m.projects_verified() : m.projects_unverified()}
      </Pill>
    ),
  }));

  return (
    <Section
      title={m.projects_outputs_title()}
      count={outputs.length || undefined}
      defaultOpen={defaultOpen}
      data-testid="project-outputs"
    >
      {outputs.length === 0 ? (
        // STUB: no accepted-output backend model yet — teaching empty state.
        <EmptyState title={m.projects_outputs_empty_title()} />
      ) : (
        <div className="pv-project-detail__outputs">
          <Table columns={columns} rows={rows} />
        </div>
      )}
    </Section>
  );
}

// ── Cleanup (spec 017 WP-E) ──────────────────────────────────────────────────

/**
 * Protected categories shown LOCKED under the candidate list. These document
 * the protected-category intent (constitution II: protected categories must be
 * documented before any cleanup plan is generated); the live per-file
 * protection state additionally arrives on each scanned candidate.
 */
// Render-time factory so category labels re-read the active locale (spec 046 #8).
function protectedCategories(): readonly string[] {
  return [
    m.projects_cleanup_category_outputs(),
    m.projects_cleanup_category_calibration(),
    m.projects_cleanup_category_sources(),
  ];
}

/** Localised label for a candidate group's data-type classification. */
function dataTypeLabel(dataType: string): string {
  switch (dataType) {
    case 'intermediate':
      return m.projects_cleanup_type_intermediate();
    case 'master':
      return m.projects_cleanup_type_master();
    case 'final':
      return m.projects_cleanup_type_final();
    default:
      return dataType;
  }
}

// Render-time factory so column labels re-read the active locale (spec 046 #8).
function candidateColumns() {
  return [
    { key: 'file', label: m.projects_cleanup_col_file() },
    { key: 'size', label: m.projects_cleanup_col_size() },
    { key: 'confidence', label: m.projects_cleanup_col_confidence() },
    { key: 'protection', label: m.projects_cleanup_col_protection() },
  ];
}

/**
 * One candidate row. Protected candidates are clearly marked and carry NO
 * affordance for inclusion — they gate plan approval via the spec-016
 * acknowledgement flow instead (constitution II).
 */
function candidateRow(candidate: CleanupCandidate, index: number) {
  const parsed = parseCandidateReason(candidate.reason);
  const isProtected = parsed?.protection === 'protected';
  return {
    _testid: `cleanup-candidate-${index}`,
    _rowClassName: isProtected ? 'pv-cleanup-scan__row--protected' : undefined,
    file: (
      <span className="pv-mono" title={candidate.reason}>
        {candidate.filePath}
      </span>
    ),
    size: formatBytes(candidate.sizeBytes),
    // Tolerant of reason-format drift: show the raw reason when unparseable
    // rather than fabricating a confidence (constitution II).
    confidence: parsed
      ? m.projects_cleanup_confidence_pct({ pct: parsed.confidencePct })
      : candidate.reason,
    protection: isProtected ? (
      <span className="pv-cleanup-scan__protected-cell">
        {/* Decorative: the hint is one static sentence, identical on every
            protected row, and is stated once above the table. Giving each row
            its own tab stop would repeat that same announcement N times. */}
        <Lock decorative />
        <Pill variant="warn">{m.settings_cleanup_protection_protected()}</Pill>
      </span>
    ) : parsed ? (
      <Pill variant="ghost">{parsed.protection}</Pill>
    ) : null,
  };
}

export interface CleanupSectionProps {
  /** Project whose observed artifacts are scanned for cleanup candidates. */
  projectId: string;
  /** Whether the collapsible section starts open. Default true. */
  defaultOpen?: boolean;
}

export function CleanupSection({
  projectId,
  defaultOpen = true,
}: CleanupSectionProps) {
  const scan = useCleanupScan();
  const generate = useGenerateCleanupPlan();
  const [destination, setDestination] =
    useState<DestructiveDestinationChoice>('archive');
  const [reviewPlanId, setReviewPlanId] = useState<string | null>(null);

  const result = scan.data;
  const groups = result ? groupCandidates(result.candidates) : [];
  const hasCandidates = (result?.candidates.length ?? 0) > 0;
  // Whether any candidate is protected. The acknowledgement rule is stated once
  // here rather than N times behind identical per-row padlock tooltips, so it
  // is visible without hovering and costs one tab stop instead of one per row.
  const hasProtected = (result?.candidates ?? []).some(
    (c) => parseCandidateReason(c.reason)?.protection === 'protected',
  );

  const handleGenerate = () => {
    generate.mutate(
      { projectId, destructiveDestination: destination },
      {
        onSuccess: (res) => {
          addToast({
            message: m.projects_cleanup_plan_created_toast({
              count: res.itemCount,
            }),
            variant: 'info',
          });
          setReviewPlanId(res.planId);
        },
      },
    );
  };

  return (
    <Section
      title={m.projects_cleanup_title()}
      count={result ? result.candidates.length : undefined}
      defaultOpen={defaultOpen}
      data-testid="project-cleanup-preview"
    >
      {/* Themed alert: cleanup is reviewable + reversible, never silent. */}
      <Banner variant="warn" role="status" aria-live="polite">
        <div className="pv-project-detail__cleanup-preview">
          <span className="pv-project-detail__cleanup-note">
            {result
              ? m.projects_cleanup_candidate_count({
                  count: result.candidates.length,
                })
              : m.projects_cleanup_scan_prompt()}
          </span>
        </div>
      </Banner>

      {/* Scan is on-demand and read-only (D11 step 1). */}
      <div className="pv-cleanup-scan__controls">
        <Btn
          size="sm"
          onClick={() => scan.mutate(projectId)}
          disabled={scan.isPending}
          data-testid="cleanup-scan-btn"
        >
          {scan.isPending
            ? m.projects_cleanup_scanning()
            : m.projects_cleanup_scan_btn()}
        </Btn>
        {hasCandidates && (
          <span
            className="pv-cleanup-scan__reclaimable"
            data-testid="cleanup-reclaimable"
          >
            {m.projects_cleanup_reclaimable({
              size: formatBytes(result?.totalReclaimableBytes ?? 0),
            })}
          </span>
        )}
      </div>

      {scan.isError && (
        <Banner variant="danger">{m.projects_cleanup_scan_failed()}</Banner>
      )}

      {result && !hasCandidates && (
        <EmptyState
          title={m.projects_cleanup_no_candidates_title()}
          desc={m.projects_cleanup_no_candidates_desc()}
        />
      )}

      {/* The protection rule, stated once for every protected row below. */}
      {hasProtected && (
        <p className="pv-text-muted" data-testid="cleanup-protected-note">
          {m.projects_cleanup_row_protected_hint()}
        </p>
      )}

      {/* Candidates grouped by classification (intermediate → master → final). */}
      {groups.map((group) => (
        <div
          key={group.dataType}
          className="pv-cleanup-scan__group"
          data-testid={`cleanup-group-${group.dataType}`}
        >
          <div className="pv-cleanup-scan__group-head">
            <span className="pv-cleanup-scan__group-title">
              {dataTypeLabel(group.dataType)}
            </span>
            <span className="pv-cleanup-scan__group-meta">
              {m.projects_cleanup_group_meta({
                count: group.candidates.length,
                size: formatBytes(group.totalBytes),
              })}
            </span>
          </div>
          <Table
            columns={candidateColumns()}
            rows={group.candidates.map((candidate, index) =>
              candidateRow(candidate, index),
            )}
          />
        </div>
      ))}

      {/* Generate the reviewable plan (D11 step 2) — never applies anything. */}
      {hasCandidates && (
        <div className="pv-cleanup-scan__generate">
          <div className="pv-stack-1">
            <span className="pv-cleanup-scan__dest-label">
              {m.projects_cleanup_dest_label()}
            </span>
            <RadioGroup
              aria-label={m.projects_cleanup_dest_label()}
              options={[
                {
                  value: 'archive',
                  label: m.plans_dest_archive(),
                  desc: m.projects_cleanup_dest_archive_hint(),
                },
                {
                  value: 'trash',
                  label: m.plans_dest_trash(),
                  desc: m.projects_cleanup_dest_trash_hint(),
                },
              ]}
              value={destination}
              onChange={(v) =>
                setDestination(v as DestructiveDestinationChoice)
              }
            />
          </div>
          <Btn
            size="sm"
            variant="danger"
            onClick={handleGenerate}
            disabled={generate.isPending}
            data-testid="cleanup-generate-btn"
          >
            {generate.isPending
              ? m.projects_cleanup_generating()
              : m.projects_cleanup_generate_btn()}
          </Btn>
          {generate.isError && (
            <Banner variant="danger">
              {m.projects_cleanup_generate_failed()}
            </Banner>
          )}
        </div>
      )}

      {/* Protected categories — always shown LOCKED (never proposed for cleanup). */}
      <div
        className="pv-project-detail__cleanup-protected"
        data-testid="cleanup-protected"
      >
        <div className="pv-project-detail__cleanup-protected-head">
          {m.projects_cleanup_protected_label()}
        </div>
        <div className="pv-project-detail__cleanup-protected-list">
          {protectedCategories().map((cat) => (
            <KV
              key={cat}
              label={cat}
              value={
                <Lock
                  reason={m.projects_cleanup_category_protected_reason({
                    category: cat,
                  })}
                />
              }
            />
          ))}
        </div>
      </div>

      {/* Focused review overlay — shared plan kit (protection gate → approve →
          apply with live progress). Re-scan after apply so the section reflects
          the post-apply filesystem truth. */}
      <PlanReviewOverlay
        planId={reviewPlanId}
        open={reviewPlanId !== null}
        onClose={() => setReviewPlanId(null)}
        title={m.projects_cleanup_review_title()}
        onApplied={() => scan.mutate(projectId)}
        onRetryCreated={setReviewPlanId}
      />
    </Section>
  );
}
