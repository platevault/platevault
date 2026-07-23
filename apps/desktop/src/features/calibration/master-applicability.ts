// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-kind field applicability for calibration masters (spec-030 Q16 / #620,
 * FR-135). Thin, calibration-scoped wrapper over the shared
 * `@/lib/field-applicability` matrix (also used by Inbox review) — `Master*`
 * kinds are always dark/flat/bias, never light, so the shared matrix's Light
 * column is simply never queried here.
 */

import type { FieldApplicability } from '@/components';
import { fieldApplicability } from '@/lib/field-applicability';

export type MasterApplicabilityField = 'exposure' | 'filter' | 'setTemp';

/** `kind` is the master's `CalibrationKind` (case-insensitive). */
export function masterFieldApplicability(
  kind: string,
  field: MasterApplicabilityField,
): FieldApplicability {
  return fieldApplicability(kind, field);
}
