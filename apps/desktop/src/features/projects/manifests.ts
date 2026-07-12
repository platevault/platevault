/**
 * Manifest and notes helpers for spec 024.
 *
 * Pure functions and store helpers consumed by ManifestsAccordion and
 * ProjectNotesSection. No React imports.
 */

import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { m } from '@/lib/i18n';
import type {
  ManifestGetRequest,
  ManifestRevealRequest,
  ManifestSummaryDto,
  ProjectNoteGetRequest,
  ProjectNoteGetResult,
  ProjectNoteUpdateRequest,
  ProjectNoteUpdateResult,
} from '@/bindings/index';
import type {
  ManifestListRequest,
  ManifestListResponse,
  ManifestGetResponse,
} from '@/bindings/aliases';

// ── IPC helpers ───────────────────────────────────────────────────────────────
// Migrated off the hand-written @/api/commands wrappers (spec 037) onto the
// generated bindings. unwrap() turns the generated Result into the
// throw-on-error contract ManifestsAccordion / ProjectNotesSection rely on.

/** `project.manifest.list` — list manifest snapshots for a project (spec 024). */
export async function listManifests(
  request: ManifestListRequest,
): Promise<ManifestListResponse> {
  return unwrap(await commands.manifestList(request));
}

/** `project.manifest.get` — fetch one manifest with its full structured body (spec 024). */
export async function getManifest(
  request: ManifestGetRequest,
): Promise<ManifestGetResponse> {
  return unwrap(await commands.manifestGet(request));
}

/** `project.note.get` — fetch current notes body for a project (spec 024). */
export async function getProjectNote(
  req: ProjectNoteGetRequest,
): Promise<ProjectNoteGetResult> {
  return unwrap(await commands.noteGet(req));
}

/** `project.note.update` — replace the project's free-text notes (spec 024). */
export async function updateProjectNote(
  req: ProjectNoteUpdateRequest,
): Promise<ProjectNoteUpdateResult> {
  return unwrap(await commands.noteUpdate(req));
}

/** `project.manifest.reveal_in_os` — open the manifest file in the OS file manager (spec 024). */
export async function revealManifestInOs(
  request: ManifestRevealRequest,
): Promise<void> {
  unwrap(await commands.manifestRevealInOs(request));
}

// ── Re-exports ────────────────────────────────────────────────────────────────

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
      return m.projects_manifest_reason_created();
    case 'source_change':
      return m.projects_manifest_reason_source_change();
    case 'lifecycle_transition':
      return m.projects_manifest_reason_lifecycle_transition();
    case 'cleanup_applied':
      return m.projects_manifest_reason_cleanup_applied();
    case 'workflow_run':
      return m.projects_manifest_reason_workflow_run();
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
    const code =
      typeof err === 'string' ? err : ((err as Error)?.message ?? 'unknown');
    return { error: code };
  }
}
