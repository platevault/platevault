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

/**
 * Format integration time in seconds to a human-readable string.
 * e.g. 3661 => "1h 1m 1s", 120 => "2m 0s"
 */
export function formatIntegration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format integration time in hours to a compact display string.
 * e.g. 2.5 => "2.5h", 0 => "0h"
 */
export function formatIntegrationHours(hours: number): string {
  if (hours === 0) return '0h';
  if (hours < 0.1) return '<0.1h';
  return `${hours.toFixed(1)}h`;
}

/** Blank marker for a missing/null value — matches RenderValue's convention. */
const EMPTY = '—';

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
