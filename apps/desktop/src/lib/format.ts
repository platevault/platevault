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
  const value = bytes / Math.pow(1024, i);
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
