// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * RotationWarning — spec 041 T080 · FR-040 (flat↔light rotation applicability).
 *
 * A clear, NON-BLOCKING warning surfaced when a flat group's mechanical rotator
 * angle (`ROTATANG`) does not exactly agree with the matched light group's, or
 * when `ROTATANG` was unavailable and the flat was matched without a rotation
 * check. The verdict is produced by the pure Rust matcher
 * `calibration_core::flat_light_rotation_match` (R-18, real-FITS-verified);
 * this component renders its optional warning.
 *
 * It mirrors the Rust `RotationWarning` enum (`crates/calibration/core/src/
 * rotation.rs`): a `deviation` variant carrying the degree delta, and a
 * `rotation_unavailable` variant. When the matcher returns no warning (exact
 * rotation agreement) this component renders nothing.
 *
 * Non-blocking by design (Banner variant="warn"): a deviation warns but never
 * excludes the flat — only `flat_rotation_required` (absent ROTATANG) excludes,
 * which is handled on the matcher side, not here.
 */

import { AlertTriangle } from 'lucide-react';
import { Banner } from '@/ui';
import { m } from '@/lib/i18n';

/**
 * Mirror of the Rust `calibration_core::rotation::RotationWarning` enum
 * (serde `tag = "kind"`, snake_case). Declared locally because the matcher is a
 * pure domain function not yet wired through the IPC contract; once a
 * binding-backed DTO exists this type should be replaced by the generated one.
 */
export type RotationWarning =
  | { kind: 'deviation'; deg: number }
  | { kind: 'rotation_unavailable' };

export interface RotationWarningNoticeProps {
  /** The matcher's optional warning. `null`/`undefined` → renders nothing. */
  warning: RotationWarning | null | undefined;
}

/** Format a degree delta compactly (max 2 decimals, trailing zeros trimmed). */
function formatDeg(deg: number): string {
  return Number(deg.toFixed(2)).toString();
}

export function RotationWarningNotice({ warning }: RotationWarningNoticeProps) {
  if (!warning) return null;

  const message =
    warning.kind === 'deviation'
      ? m.calibration_rotation_deviation({ deg: formatDeg(warning.deg) })
      : m.calibration_rotation_unavailable();

  return (
    <Banner
      variant="warn"
      className="alm-rotation-warning"
      data-testid={`rotation-warning-${warning.kind}`}
    >
      <AlertTriangle
        size={14}
        role="img"
        aria-label={m.calibration_rotation_warning_aria()}
        className="alm-rotation-warning__icon"
      />{' '}
      {message}
    </Banner>
  );
}
