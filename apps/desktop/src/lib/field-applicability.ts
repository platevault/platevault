// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The full per-frame-type field-applicability matrix (spec-030 Q16 / #620,
 * FR-135, data-model.md "Field-Applicability Matrix"). One authoritative
 * source for every surface that renders frame/master metadata (Inbox review,
 * Calibration masters) so applicability is never re-derived or guessed per
 * surface. Columns apply to both sub-frame sets and masters of each kind.
 */

import type { FieldApplicability } from '@/components';

export type FrameKind = 'light' | 'dark' | 'flat' | 'bias';

export type MatrixField =
  | 'target'
  | 'frameType'
  | 'filter'
  | 'date'
  | 'camera'
  | 'telescope'
  | 'focalLength'
  | 'exposure'
  | 'gain'
  | 'offset'
  | 'binning'
  | 'sensorMode'
  | 'setTemp'
  | 'observer'
  | 'timezone';

const ALL: ReadonlySet<FrameKind> = new Set(['light', 'dark', 'flat', 'bias']);

const MATRIX: Record<MatrixField, ReadonlySet<FrameKind>> = {
  target: new Set(['light']),
  frameType: ALL,
  filter: new Set(['light', 'flat']),
  date: ALL,
  camera: ALL,
  telescope: new Set(['light', 'flat']),
  focalLength: new Set(['light', 'flat']),
  exposure: new Set(['light', 'dark', 'flat']),
  gain: ALL,
  offset: ALL,
  binning: ALL,
  sensorMode: ALL,
  setTemp: new Set(['light', 'dark']),
  observer: new Set(['light']),
  timezone: new Set(['light']),
};

/**
 * Applicability of `field` for a given frame/entity kind (case-insensitive).
 * `kind` absent/unrecognized (mixed classification, unknown frame type) can't
 * assert not-applicable — defaults permissive (`'applicable'`) so a genuinely
 * missing value still surfaces as unresolved rather than being silently
 * treated as not-applicable.
 */
export function fieldApplicability(
  kind: string | null | undefined,
  field: MatrixField,
): FieldApplicability {
  if (!kind) return 'applicable';
  const k = kind.toLowerCase();
  if (!ALL.has(k as FrameKind)) return 'applicable';
  return MATRIX[field].has(k as FrameKind) ? 'applicable' : 'not_applicable';
}
