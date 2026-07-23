// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared free-text note constraints for the debounced-autosave note editors
 * (projects — spec 024 — and sessions — #773). The byte cap and UTF-8 count
 * mirror the backend's `MAX_NOTE_BYTES` trim-and-reject check so the
 * client-side counter matches what the server accepts.
 */

/** Maximum note size enforced client-side, matching the backend cap. */
export const MAX_NOTE_BYTES = 16_384;

/** Debounce delay in ms before issuing a note-update command. */
export const NOTE_DEBOUNCE_MS = 5_000;

/**
 * Byte length of note content under UTF-8. Uses `TextEncoder` so the count
 * matches the server-side byte check.
 */
export function noteByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/** Returns `true` when content is within the allowed size. */
export function noteContentValid(content: string): boolean {
  return noteByteLength(content) <= MAX_NOTE_BYTES;
}
