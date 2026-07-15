// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SessionNotesSection tests (#773).
 *
 * 1. Seeds the textarea from initialContent.
 * 2. Debounced autosave calls saveSessionNote and shows the saved signal.
 * 3. Byte counter reflects content size.
 * 4. Over-limit content shows the error and does not save.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSaveSessionNote } = vi.hoisted(() => ({
  mockSaveSessionNote: vi.fn(),
}));

vi.mock('./store', () => ({ saveSessionNote: mockSaveSessionNote }));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

// Fire the debounced callback synchronously so the test does not juggle timers.
vi.mock('use-debounce', () => ({
  useDebouncedCallback: (fn: (...args: unknown[]) => void) => {
    const wrapped = (...args: unknown[]) => fn(...args);
    wrapped.cancel = vi.fn();
    return wrapped;
  },
}));

import { SessionNotesSection } from './SessionNotesSection';
import { MAX_NOTE_BYTES } from '@/lib/notes';

function renderNotes(initialContent: string | null) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SessionNotesSection sessionId="acq-1" initialContent={initialContent} />
    </QueryClientProvider>,
  );
}

describe('SessionNotesSection', () => {
  beforeEach(() => {
    mockSaveSessionNote.mockReset();
    mockSaveSessionNote.mockResolvedValue({ notes: 'x' });
  });

  it('seeds the textarea from initialContent', () => {
    renderNotes('Great seeing.');
    expect(screen.getByTestId('session-notes-textarea')).toHaveValue(
      'Great seeing.',
    );
  });

  it('autosaves on change and shows the saved signal', async () => {
    renderNotes(null);
    await act(async () => {
      fireEvent.change(screen.getByTestId('session-notes-textarea'), {
        target: { value: 'Windy night' },
      });
    });
    await waitFor(() =>
      expect(mockSaveSessionNote).toHaveBeenCalledWith('acq-1', 'Windy night'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('session-notes-saved')).toBeInTheDocument(),
    );
  });

  it('byte counter reflects content size', () => {
    renderNotes('abc');
    expect(screen.getByTestId('session-notes-byte-counter')).toHaveTextContent(
      '3',
    );
  });

  it('over-limit content shows the error and does not save', async () => {
    renderNotes('');
    await act(async () => {
      fireEvent.change(screen.getByTestId('session-notes-textarea'), {
        target: { value: 'x'.repeat(MAX_NOTE_BYTES + 1) },
      });
    });
    expect(screen.getByTestId('session-notes-error')).toBeInTheDocument();
    expect(mockSaveSessionNote).not.toHaveBeenCalled();
  });
});
