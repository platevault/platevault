/**
 * Manifest and notes helpers for spec 024.
 *
 * Pure functions and store helpers consumed by ManifestsAccordion and
 * ProjectNotesSection. No React imports.
 */

import {
  listManifests,
  getManifest,
  getProjectNote,
  updateProjectNote,
  revealManifestInOs,
} from '@/api/commands';
import type {
  ManifestListResponse,
  ManifestGetResponse,
  ProjectNoteGetResult,
  ProjectNoteUpdateResult,
} from '@/api/commands';
import type { ManifestSummaryDto } from '@/bindings/index';

// ── Re-exports ────────────────────────────────────────────────────────────────

export { listManifests, getManifest, getProjectNote, updateProjectNote, revealManifestInOs };
export type {
  ManifestListResponse,
  ManifestGetResponse,
  ManifestSummaryDto,
  ProjectNoteGetResult,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum note size enforced client-side (A5). */
export const MAX_NOTE_BYTES = 16_384;

/** Debounce delay in ms before issuing `project.note.update` (A5). */
export const NOTE_DEBOUNCE_MS = 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable label for a ManifestReason value. */
export function manifestReasonLabel(reason: string): string {
  switch (reason) {
    case 'created':
      return 'Project created';
    case 'source_change':
      return 'Source changed';
    case 'lifecycle_transition':
      return 'Lifecycle transition';
    case 'cleanup_applied':
      return 'Cleanup applied';
    case 'workflow_run':
      return 'Workflow run';
    default:
      return reason;
  }
}

/** Format an ISO-8601 UTC timestamp for display (e.g. "2026-04-12 18:01"). */
export function formatManifestTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Check whether note content exceeds the 16 384-byte cap.
 * Uses `TextEncoder` so the byte count matches the server-side UTF-8 check (A5).
 */
export function noteByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/** Returns `true` when content is within the allowed size. */
export function noteContentValid(content: string): boolean {
  return noteByteLength(content) <= MAX_NOTE_BYTES;
}

/**
 * Attempt to save a note via `project.note.update`.
 *
 * Returns `{ updatedAt }` on success, `{ error }` on failure.
 */
export async function saveNote(
  projectId: string,
  content: string,
): Promise<{ updatedAt?: string; error?: string }> {
  try {
    const result: ProjectNoteUpdateResult = await updateProjectNote({
      projectId,
      content,
    });
    return { updatedAt: result.updatedAt };
  } catch (err: unknown) {
    const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
    return { error: code };
  }
}
