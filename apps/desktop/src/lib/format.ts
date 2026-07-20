// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Format utilities -- consolidates formatting functions that were duplicated
 * across StatusBar, CleanupPlan, ProjectsList, SessionDetail, InboxList,
 * SessionReview, TargetDetailPane, and SessionsList.
 */

/**
 * Format a byte count into a human-readable string (e.g. "1.2 GB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Blank marker for a missing/null value — matches RenderValue's convention. */
const EMPTY = '—';

/**
 * Format an integration duration in seconds (#631).
 *
 * The single formatter for this quantity. It replaces four divergent versions
 * that rendered the SAME total differently — Sessions' `1h 30m`, Projects'
 * `1.5h`, the wizard's `1h 30m 0s`, and a dead hours-based variant — so a
 * session and the project built from it no longer disagree on screen.
 *
 * `h`/`m` is exact where the old `1.5h` rounded a total away. Sub-minute
 * totals collapse to `<1m` rather than the misleading `0m` the previous
 * minute-rounding produced for any nonzero value under 30 seconds.
 *
 * e.g. 5400 => "1h 30m", 3000 => "50m", 7200 => "2h", 20 => "<1m".
 */
export function formatIntegration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return EMPTY;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return '<1m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Round to 1 decimal place, dropping a trailing ".0" (e.g. 30 => "30", 6.92447668013071 => "6.9"). */
function roundTrim1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Format a FITS exposure time in seconds (#811): consistent rounding (1
 * decimal place) and unit spacing. e.g. 6.92447668013071 => "6.9 s" (root
 * cause of #789's raw unrounded float), 30 => "30 s".
 */
export function formatExposureSeconds(
  seconds: number | null | undefined,
): string {
  if (seconds == null) return EMPTY;
  return `${roundTrim1(seconds)} s`;
}

/**
 * Format a FITS sensor temperature in Celsius (#811): consistent rounding (1
 * decimal place). e.g. -10.449 => "-10.4°C".
 */
export function formatTempC(tempC: number | null | undefined): string {
  if (tempC == null) return EMPTY;
  return `${roundTrim1(tempC)}°C`;
}

/**
 * Format a FITS gain value with a consistent null-guard (#811) — some call
 * sites previously ran `String(gain)` unguarded, rendering the literal string
 * "null" instead of the app's dash convention.
 */
export function formatGain(gain: number | null | undefined): string {
  if (gain == null) return EMPTY;
  return String(gain);
}

/**
 * Format a FITS binning value (#811), normalising the ASCII "x" separator to
 * the display "×" and null-guarding. e.g. "2x2" => "2×2".
 */
export function formatBinning(binning: string | null | undefined): string {
  if (binning == null || binning === '') return EMPTY;
  return binning.replace(/x/gi, '×');
}
