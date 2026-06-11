/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectNotesSection tests — spec 024 T4.2.
 *
 * Tests:
 * 1. Renders "No notes." placeholder when no content.
 * 2. Renders existing notes body.
 * 3. Shows "Edit" button when not read-only.
 * 4. Hides "Edit" button when readOnly=true.
 * 5. Opens textarea on Edit click.
 * 6. Cancel restores original content and hides textarea.
 * 7. Save button calls saveNote and closes editing.
 * 8. Content too large shows field error.
 * 9. Byte counter reflects current content size.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSaveNote } = vi.hoisted(() => ({
  mockSaveNote: vi.fn(),
}));

vi.mock('./manifests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manifests')>();
  return {
    ...actual,
    saveNote: mockSaveNote,
  };
});

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { ProjectNotesSection } from './ProjectNotesSection';
import { MAX_NOTE_BYTES } from './manifests';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNotes(
  props: Partial<React.ComponentProps<typeof ProjectNotesSection>> & { projectId?: string } = {},
) {
  return render(
    <ProjectNotesSection
      projectId={props.projectId ?? 'proj-test'}
      initialContent={props.initialContent}
      readOnly={props.readOnly}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProjectNotesSection', () => {
  beforeEach(() => {
    mockSaveNote.mockReset();
  });

  it('1. renders "No notes." placeholder when no content', () => {
    renderNotes({ initialContent: null });
    expect(screen.getByTestId('notes-empty')).toHaveTextContent('No notes.');
  });

  it('2. renders existing notes body', () => {
    renderNotes({ initialContent: 'My telescope setup' });
    expect(screen.getByTestId('notes-body')).toHaveTextContent('My telescope setup');
  });

  it('3. shows Edit button when not read-only', () => {
    renderNotes({ initialContent: 'Some notes' });
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('4. hides Edit button when readOnly=true', () => {
    renderNotes({ initialContent: 'Archived notes', readOnly: true });
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('5. opens textarea on Edit click', async () => {
    renderNotes({ initialContent: 'Some notes' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    });
    expect(screen.getByTestId('notes-textarea')).toBeInTheDocument();
  });

  it('6. Cancel restores original content and hides textarea', async () => {
    renderNotes({ initialContent: 'Original' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    });
    const textarea = screen.getByTestId('notes-textarea');
    fireEvent.change(textarea, { target: { value: 'Modified' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });
    expect(screen.queryByTestId('notes-textarea')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes-body')).toHaveTextContent('Original');
  });

  it('7. Save button calls saveNote and closes editing', async () => {
    mockSaveNote.mockResolvedValue({ updatedAt: '2026-06-01T12:00:00Z' });
    renderNotes({ initialContent: 'Hello' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    await waitFor(() => {
      expect(mockSaveNote).toHaveBeenCalledWith('proj-test', 'Hello');
    });
    expect(screen.queryByTestId('notes-textarea')).not.toBeInTheDocument();
  });

  it('8. content too large shows Save button as disabled', async () => {
    renderNotes({ initialContent: '' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    });
    const textarea = screen.getByTestId('notes-textarea');
    // Set content to 1 byte over the limit.
    fireEvent.change(textarea, { target: { value: 'x'.repeat(MAX_NOTE_BYTES + 1) } });
    // Save button should be disabled (overLimit guard).
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeDisabled();
    // Byte counter should be visible and show over-limit count.
    expect(screen.getByTestId('notes-byte-counter')).toBeInTheDocument();
  });

  it('9. byte counter reflects current content size', async () => {
    renderNotes({ initialContent: '' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    });
    const textarea = screen.getByTestId('notes-textarea');
    fireEvent.change(textarea, { target: { value: 'abc' } });
    expect(screen.getByTestId('notes-byte-counter')).toHaveTextContent('3');
  });
});
