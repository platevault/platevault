// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cleanup-scan view helpers (spec 017 WP-E, D11 step 1).
 *
 * `cleanup.scan` returns flat `CleanupCandidate` rows whose `reason` string is
 * produced by the backend generator in a single documented format:
 *
 *   "<dataType> artifact (classified by <source>, <NN>% confidence);
 *    protection: <level>; policy: <action>"
 *
 * (see `crates/app/core/src/cleanup_generator.rs::scan_with_policy`). The
 * parser below lifts the classification source, confidence, protection level,
 * and policy action out of that string for structured rendering. Parsing is
 * TOLERANT: when the format ever drifts, we fall back to showing the raw
 * reason text and claim nothing we cannot prove (constitution II — no
 * fabricated confidence or protection states).
 */

import type { CleanupCandidate } from '@/bindings/index';

// ── Reason parsing ───────────────────────────────────────────────────────────

export interface ParsedCandidateReason {
  /** Classification source, e.g. "rule" or "override". */
  classifiedBy: string;
  /** Classification confidence in percent (0-100). */
  confidencePct: number;
  /** Resolved protection level, e.g. "protected" | "normal" | "unprotected". */
  protection: string;
  /** Policy action driving the candidacy: "archive" | "delete". */
  policy: string;
}

const REASON_RE =
  /\(classified by ([^,]+), (\d+)% confidence\); protection: ([a-z_]+); policy: ([a-z_]+)/;

/**
 * Parse the backend's structured candidate reason. Returns `null` when the
 * string does not match the documented format (render the raw reason then).
 */
export function parseCandidateReason(
  reason: string,
): ParsedCandidateReason | null {
  const match = REASON_RE.exec(reason);
  if (!match) return null;
  return {
    classifiedBy: match[1],
    confidencePct: Number(match[2]),
    protection: match[3],
    policy: match[4],
  };
}

/** Whether the candidate resolved to a protected protection level. */
export function isProtectedCandidate(candidate: CleanupCandidate): boolean {
  return parseCandidateReason(candidate.reason)?.protection === 'protected';
}

// ── Grouping by classification ───────────────────────────────────────────────

export interface CandidateGroup {
  /** Canonical data-type key: "intermediate" | "master" | "final". */
  dataType: string;
  candidates: CleanupCandidate[];
  /** Sum of `sizeBytes` across the group. */
  totalBytes: number;
}

/** Stable display order for the known data types; unknowns sort last. */
const DATA_TYPE_ORDER = ['intermediate', 'master', 'final'];

function dataTypeRank(dataType: string): number {
  const idx = DATA_TYPE_ORDER.indexOf(dataType);
  return idx === -1 ? DATA_TYPE_ORDER.length : idx;
}

/**
 * Group candidates by their `dataType` classification, in stable
 * intermediate → master → final order, with per-group byte subtotals.
 */
export function groupCandidates(
  candidates: CleanupCandidate[],
): CandidateGroup[] {
  const byType = new Map<string, CandidateGroup>();
  for (const candidate of candidates) {
    let group = byType.get(candidate.dataType);
    if (!group) {
      group = { dataType: candidate.dataType, candidates: [], totalBytes: 0 };
      byType.set(candidate.dataType, group);
    }
    group.candidates.push(candidate);
    group.totalBytes += candidate.sizeBytes;
  }
  return [...byType.values()].sort(
    (a, b) => dataTypeRank(a.dataType) - dataTypeRank(b.dataType),
  );
}
