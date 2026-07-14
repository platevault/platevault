// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * BlockedBanner — spec 009 US4-2 + US4-3.
 *
 * Renders a structured banner when a project is in the `blocked` lifecycle state.
 * Shows the reason text per data-model.md §BlockedReason and a resolve action
 * that dispatches the correct recovery edge (US4-3).
 *
 * Reason kind → message:
 *   source_missing        → "Source missing: {inventoryId}"
 *   prepared_source_stale → "Prepared source out of date"
 *   tool_unconfigured     → "Tool path not configured: {tool}"
 *   calibration_unmatched → "Calibration set missing"
 *   user                  → "{note}"
 *
 * Resolve action → recovery edge (US4-3):
 *   source_missing        → blocked → setup_incomplete
 *   prepared_source_stale → blocked → ready
 *   tool_unconfigured     → blocked → setup_incomplete
 *   calibration_unmatched → blocked → ready  (deferred: spec 007)
 *   user                  → blocked → ready
 */

import { Banner, Btn } from '@/ui';
import { m } from '@/lib/i18n';

export interface BlockedReasonSourceMissing {
  kind: 'source_missing';
  inventoryId: string;
}

export interface BlockedReasonPreparedSourceStale {
  kind: 'prepared_source_stale';
  preparedId: string;
}

export interface BlockedReasonToolUnconfigured {
  kind: 'tool_unconfigured';
  tool: string;
}

export interface BlockedReasonCalibrationUnmatched {
  kind: 'calibration_unmatched';
  calibrationSetId: string;
}

export interface BlockedReasonUser {
  kind: 'user';
  note: string;
}

export type BlockedReason =
  | BlockedReasonSourceMissing
  | BlockedReasonPreparedSourceStale
  | BlockedReasonToolUnconfigured
  | BlockedReasonCalibrationUnmatched
  | BlockedReasonUser;

export type RecoveryEdge =
  | 'setup_incomplete'
  | 'ready'
  | 'prepared'
  | 'processing';

/** Map a BlockedReason to its human-readable message text. */
export function blockedReasonMessage(reason: BlockedReason): string {
  switch (reason.kind) {
    case 'source_missing':
      return m.projects_blocked_source_missing({ id: reason.inventoryId });
    case 'prepared_source_stale':
      return m.projects_blocked_source_stale();
    case 'tool_unconfigured':
      return m.projects_blocked_tool_unconfigured({ tool: reason.tool });
    case 'calibration_unmatched':
      return m.projects_blocked_calibration_missing();
    case 'user':
      return reason.note;
  }
}

/**
 * Derive the recovery edge for a given blocked reason (US4-3 resolve routing).
 *
 * The resolution routing follows:
 * - source_missing / tool_unconfigured → setup_incomplete (re-configure the project)
 * - prepared_source_stale / calibration_unmatched / user → ready (clear the block)
 */
export function resolveEdgeForReason(reason: BlockedReason): RecoveryEdge {
  switch (reason.kind) {
    case 'source_missing':
    case 'tool_unconfigured':
      return 'setup_incomplete';
    case 'prepared_source_stale':
    case 'calibration_unmatched':
    case 'user':
      return 'ready';
  }
}

export interface BlockedBannerProps {
  reason: BlockedReason;
  /** Called with the recovery edge when the user clicks "Resolve". */
  onResolve: (edge: RecoveryEdge) => void;
  disabled?: boolean;
}

/**
 * BlockedBanner renders when lifecycle === "blocked".
 *
 * Shows the structured reason text and a primary "Resolve" action that
 * dispatches the appropriate recovery edge.
 */
export function BlockedBanner({
  reason,
  onResolve,
  disabled,
}: BlockedBannerProps) {
  const message = blockedReasonMessage(reason);
  const edge = resolveEdgeForReason(reason);

  return (
    <Banner variant="danger" role="alert" aria-live="assertive">
      <div className="alm-blocked-banner__body">
        <span data-testid="blocked-reason-message">{message}</span>
        <div className="alm-blocked-banner__actions">
          <Btn
            size="sm"
            variant="danger"
            onClick={() => onResolve(edge)}
            disabled={disabled}
            data-testid="blocked-resolve-btn"
          >
            {m.projects_resolve_blocker()}
          </Btn>
        </div>
      </div>
    </Banner>
  );
}
