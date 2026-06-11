/**
 * Vitest unit tests for spec 024 manifest helpers.
 *
 * Tests cover:
 * 1. manifestReasonLabel — all known reasons + unknown fallback.
 * 2. formatManifestTimestamp — happy path and invalid input.
 * 3. noteByteLength / noteContentValid — ASCII, multi-byte UTF-8, boundary.
 * 4. saveNote — success and error paths via mocked updateProjectNote.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  manifestReasonLabel,
  formatManifestTimestamp,
  noteByteLength,
  noteContentValid,
  saveNote,
  MAX_NOTE_BYTES,
} from './manifests';

// ── Mock updateProjectNote ────────────────────────────────────────────────────

const { mockUpdateProjectNote } = vi.hoisted(() => ({
  mockUpdateProjectNote: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  listManifests: vi.fn(),
  getManifest: vi.fn(),
  updateProjectNote: mockUpdateProjectNote,
  revealManifestInOs: vi.fn(),
}));

// ── manifestReasonLabel ───────────────────────────────────────────────────────

describe('manifestReasonLabel', () => {
  it('returns human label for created', () => {
    expect(manifestReasonLabel('created')).toBe('Project created');
  });

  it('returns human label for source_change', () => {
    expect(manifestReasonLabel('source_change')).toBe('Source changed');
  });

  it('returns human label for lifecycle_transition', () => {
    expect(manifestReasonLabel('lifecycle_transition')).toBe('Lifecycle transition');
  });

  it('returns human label for cleanup_applied', () => {
    expect(manifestReasonLabel('cleanup_applied')).toBe('Cleanup applied');
  });

  it('returns human label for workflow_run', () => {
    expect(manifestReasonLabel('workflow_run')).toBe('Workflow run');
  });

  it('returns the raw value for unknown reasons', () => {
    expect(manifestReasonLabel('future_reason')).toBe('future_reason');
  });
});

// ── formatManifestTimestamp ───────────────────────────────────────────────────

describe('formatManifestTimestamp', () => {
  it('formats a valid ISO-8601 timestamp', () => {
    expect(formatManifestTimestamp('2026-04-12T18:01:00Z')).toBe('2026-04-12 18:01');
  });

  it('returns the raw string for invalid input', () => {
    expect(formatManifestTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('pads single-digit months and days', () => {
    expect(formatManifestTimestamp('2026-01-05T09:03:00Z')).toBe('2026-01-05 09:03');
  });
});

// ── noteByteLength / noteContentValid ────────────────────────────────────────

describe('noteByteLength', () => {
  it('counts ASCII bytes correctly', () => {
    expect(noteByteLength('hello')).toBe(5);
  });

  it('counts multi-byte UTF-8 characters correctly', () => {
    // '©' is U+00A9, 2 bytes in UTF-8
    expect(noteByteLength('©')).toBe(2);
    // '€' is U+20AC, 3 bytes in UTF-8
    expect(noteByteLength('€')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(noteByteLength('')).toBe(0);
  });
});

describe('noteContentValid', () => {
  it('accepts content within 16 384 bytes', () => {
    expect(noteContentValid('a'.repeat(MAX_NOTE_BYTES))).toBe(true);
  });

  it('rejects content exceeding 16 384 bytes', () => {
    expect(noteContentValid('a'.repeat(MAX_NOTE_BYTES + 1))).toBe(false);
  });

  it('accepts empty string', () => {
    expect(noteContentValid('')).toBe(true);
  });
});

// ── saveNote ──────────────────────────────────────────────────────────────────

describe('saveNote', () => {
  beforeEach(() => {
    mockUpdateProjectNote.mockReset();
  });

  it('returns updatedAt on success', async () => {
    mockUpdateProjectNote.mockResolvedValue({
      projectId: 'proj-1',
      updatedAt: '2026-06-01T12:00:00Z',
    });
    const result = await saveNote('proj-1', 'My notes');
    expect(result.updatedAt).toBe('2026-06-01T12:00:00Z');
    expect(result.error).toBeUndefined();
  });

  it('returns error code on command failure (string rejection)', async () => {
    mockUpdateProjectNote.mockRejectedValue('note.content_too_large');
    const result = await saveNote('proj-1', 'x'.repeat(MAX_NOTE_BYTES + 1));
    expect(result.error).toBe('note.content_too_large');
    expect(result.updatedAt).toBeUndefined();
  });

  it('returns error message on Error rejection', async () => {
    mockUpdateProjectNote.mockRejectedValue(new Error('project.read_only'));
    const result = await saveNote('proj-arch', 'Some content');
    expect(result.error).toBe('project.read_only');
  });

  it('passes projectId and content to the command', async () => {
    mockUpdateProjectNote.mockResolvedValue({
      projectId: 'proj-2',
      updatedAt: '2026-06-01T12:00:00Z',
    });
    await saveNote('proj-2', 'Content here');
    expect(mockUpdateProjectNote).toHaveBeenCalledWith({
      projectId: 'proj-2',
      content: 'Content here',
    });
  });
});
