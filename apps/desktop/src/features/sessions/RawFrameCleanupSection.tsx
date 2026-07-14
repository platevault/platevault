// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Raw sub-frame cleanup review (spec 048 US3 T031 frontend) — the
 * session-scoped counterpart to the project-level `CleanupSection`
 * (`features/projects/OutputsCleanupSections.tsx`). Uses the distinct raw
 * sub-frame `cleanup.candidates.scan` / `cleanup.plan.generate` extension
 * (`cleanupRawFramesScan`/`cleanupRawFramesGenerate` — a separate namespace
 * from the project-scoped `cleanup.scan`, see `contracts_core::cleanup`) so
 * users can review and select individual light/dark/flat/bias frames and
 * reclaim disk space — previously impossible (constitution II: reviewable,
 * never silent). Reuses the existing `alm-cleanup-scan__*` classes from the
 * project cleanup flow rather than introducing new CSS.
 */

import { useState } from 'react';
import {
  Section,
  Banner,
  Btn,
  EmptyState,
  RadioGroup,
  Table,
  Pill,
} from '@/ui';
import type { TableColumn } from '@/ui';
import { m } from '@/lib/i18n';
import { formatBytes } from '@/lib/format';
import { errMessage } from '@/lib/errors';
import { addToast } from '@/shared/toast';
import { PlanReviewOverlay } from '@/features/plans/PlanReviewOverlay';
import {
  useRawFrameCleanupScan,
  useGenerateRawFrameCleanupPlan,
} from '@/features/inventory/store';
import type { RawFrameCleanupCandidate } from '@/bindings/index';

export interface RawFrameCleanupSectionProps {
  sessionId: string;
  defaultOpen?: boolean;
}

function candidateColumns(): TableColumn[] {
  return [
    { key: 'select', label: '' },
    { key: 'file', label: m.projects_cleanup_col_file() },
    { key: 'type', label: m.sessions_frame_inventory_col_type() },
    { key: 'size', label: m.projects_cleanup_col_size() },
    { key: 'protection', label: m.projects_cleanup_col_protection() },
  ];
}

export function RawFrameCleanupSection({
  sessionId,
  defaultOpen = true,
}: RawFrameCleanupSectionProps) {
  const scan = useRawFrameCleanupScan();
  const generate = useGenerateRawFrameCleanupPlan();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<'archive' | 'trash'>(
    'archive',
  );
  const [reviewPlanId, setReviewPlanId] = useState<string | null>(null);

  const result = scan.data;
  const candidates = result?.candidates ?? [];
  const hasCandidates = candidates.length > 0;

  const runScan = () => {
    scan.mutate(
      { scope: { sessionId } },
      {
        onSuccess: (res) =>
          setSelected(
            new Set(
              res.candidates
                .filter((c) => c.protection !== 'protected')
                .map((c) => c.frameId),
            ),
          ),
      },
    );
  };

  // Session-scoped candidate lists are small; a plain reduce on every render
  // is cheap enough that memoizing it would only add an unstable-deps trap
  // (`candidates` is a fresh `[] ` when `result` is undefined).
  const selectedBytes = candidates
    .filter((c) => selected.has(c.frameId))
    .reduce((acc, c) => acc + c.sizeBytes, 0);

  const toggle = (frameId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      return next;
    });
  };

  const handleGenerate = () => {
    if (selected.size === 0) return;
    generate.mutate(
      { selectedFrameIds: [...selected], destructiveDestination: destination },
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

  const rows = candidates.map((c: RawFrameCleanupCandidate) => {
    const isProtected = c.protection === 'protected';
    return {
      _testid: `raw-cleanup-candidate-${c.frameId}`,
      select: isProtected ? null : (
        <input
          type="checkbox"
          checked={selected.has(c.frameId)}
          onChange={() => toggle(c.frameId)}
          aria-label={m.sessions_rawcleanup_select_aria({
            path: c.relativePath,
          })}
          data-testid={`raw-cleanup-select-${c.frameId}`}
        />
      ),
      file: (
        <span className="alm-mono" title={c.relativePath}>
          {c.relativePath}
        </span>
      ),
      type: c.frameType,
      size: formatBytes(c.sizeBytes),
      protection: isProtected ? (
        <Pill variant="warn">{m.settings_cleanup_protection_protected()}</Pill>
      ) : (
        <Pill variant="ghost">{c.protection}</Pill>
      ),
    };
  });

  return (
    <Section
      title={m.sessions_rawcleanup_title()}
      count={hasCandidates ? candidates.length : undefined}
      defaultOpen={defaultOpen}
      data-testid="session-raw-cleanup"
    >
      <div className="alm-cleanup-scan__controls">
        <Btn
          size="sm"
          onClick={runScan}
          disabled={scan.isPending}
          data-testid="raw-cleanup-scan-btn"
        >
          {scan.isPending
            ? m.sessions_rawcleanup_scanning()
            : m.sessions_rawcleanup_scan_btn()}
        </Btn>
        {hasCandidates && (
          <span
            className="alm-cleanup-scan__reclaimable"
            data-testid="raw-cleanup-reclaimable"
          >
            {m.projects_cleanup_reclaimable({
              size: formatBytes(selectedBytes),
            })}
          </span>
        )}
      </div>

      {scan.isError && (
        <Banner variant="danger">{errMessage(scan.error)}</Banner>
      )}

      {result && !hasCandidates && (
        <EmptyState title={m.sessions_rawcleanup_empty_title()} />
      )}

      {hasCandidates && (
        <>
          <Table columns={candidateColumns()} rows={rows} />
          <div className="alm-cleanup-scan__generate">
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
              onChange={(v) => setDestination(v as 'archive' | 'trash')}
            />
            <Btn
              size="sm"
              variant="danger"
              onClick={handleGenerate}
              disabled={generate.isPending || selected.size === 0}
              data-testid="raw-cleanup-generate-btn"
            >
              {generate.isPending
                ? m.sessions_rawcleanup_generating()
                : m.sessions_rawcleanup_generate_btn()}
            </Btn>
            {generate.isError && (
              <Banner variant="danger">{errMessage(generate.error)}</Banner>
            )}
          </div>
        </>
      )}

      <PlanReviewOverlay
        planId={reviewPlanId}
        open={reviewPlanId !== null}
        onClose={() => setReviewPlanId(null)}
        title={m.sessions_rawcleanup_review_title()}
        onApplied={runScan}
      />
    </Section>
  );
}
