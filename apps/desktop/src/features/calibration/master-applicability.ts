// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-kind field applicability for calibration masters (spec-030 Q16 / #620,
 * FR-135, data-model.md "Field-Applicability Matrix"). One place both
 * `MasterDetail` and `MastersTable` read from, so kind-conditional fields
 * (exposure, filter, set-temperature) are never re-derived ad hoc per
 * surface. Camera / gain / binning / sensor mode / size are applicable to
 * every master kind and need no lookup here.
 */

import type { FieldApplicability } from '@/components';

export type MasterApplicabilityField = 'exposure' | 'filter' | 'setTemp';

const APPLICABLE_KINDS: Record<MasterApplicabilityField, ReadonlySet<string>> = {
  // Exposure time: Light/Dark/Flat — not Bias.
  exposure: new Set(['dark', 'flat']),
  // Filter: Light/Flat — not Dark/Bias.
  filter: new Set(['flat']),
  // Set temperature: Light/Dark — not Flat/Bias.
  setTemp: new Set(['dark']),
};

/** `kind` is the master's `CalibrationKind` (case-insensitive). */
export function masterFieldApplicability(
  kind: string,
  field: MasterApplicabilityField,
): FieldApplicability {
  return APPLICABLE_KINDS[field].has(kind.toLowerCase())
    ? 'applicable'
    : 'not_applicable';
}
