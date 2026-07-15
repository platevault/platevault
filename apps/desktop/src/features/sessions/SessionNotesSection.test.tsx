// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SessionNotesSection tests (#773).
 *
 * Uses the REAL use-debounce with fake timers — a synchronous debounce mock
 * would hide the cross-session race these tests exist to pin down (PR #891
 * review blocker 2).
 *
 * 1. Seeds the textarea from initialContent.
 * 2. Debounced autosave fires after the interval and shows the saved signal.
 * 3. Byte counter reflects content size.
 * 4. Over-limit content shows the error and never saves.
 * 5. Switching sessions with a save pending flushes it to the ORIGINAL
 *    session and leaves the new session untouched (keyed remount +
 *    flushOnExit contract).
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSaveSessionNote } = vi.hoisted(() => ({
  mockSaveSessionNote: vi.fn(),
}));

vi.mock('./store', () => ({ saveSessionNote: mockSaveSessionNote }));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

import { SessionNotesSection } from './SessionNotesSection';
import { MAX_NOTE_BYTES, NOTE_DEBOUNCE_MS } from '@/lib/notes';

/** Mirrors SessionDetail's usage: keyed per session (the component's
 *  documented contract), inside a query-client provider. */
function notesFor(sessionId: string, initialContent: string | null) {
  return (
    <SessionNotesSection
      key={sessionId}
      sessionId={sessionId}
      initialContent={initialContent}
    />
  );
}

function renderNotes(sessionId: string, initialContent: string | null) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      {notesFor(sessionId, initialContent)}
    </QueryClientProvider>,
  );
  return {
    ...view,
    switchTo: (nextId: string, nextContent: string | null) =>
      view.rerender(
        <QueryClientProvider client={client}>
          {notesFor(nextId, nextContent)}
        </QueryClientProvider>,
      ),
  };
}

async function elapse(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('SessionNotesSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSaveSessionNote.mockReset();
    mockSaveSessionNote.mockResolvedValue({ notes: 'x' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds the textarea from initialContent', () => {
    renderNotes('acq-1', 'Great seeing.');
    expect(screen.getByTestId('session-notes-textarea')).toHaveValue(
      'Great seeing.',
    );
  });

  it('autosaves after the debounce interval and shows the saved signal', async () => {
    renderNotes('acq-1', null);
    fireEvent.change(screen.getByTestId('session-notes-textarea'), {
      target: { value: 'Windy night' },
    });
    expect(mockSaveSessionNote).not.toHaveBeenCalled();

    await elapse(NOTE_DEBOUNCE_MS);

    expect(mockSaveSessionNote).toHaveBeenCalledExactlyOnceWith(
      'acq-1',
      'Windy night',
    );
    expect(screen.getByTestId('session-notes-saved')).toBeInTheDocument();
  });

  it('byte counter reflects content size', () => {
    renderNotes('acq-1', 'abc');
    expect(screen.getByTestId('session-notes-byte-counter')).toHaveTextContent(
      '3',
    );
  });

  it('over-limit content shows the error and never saves', async () => {
    renderNotes('acq-1', '');
    fireEvent.change(screen.getByTestId('session-notes-textarea'), {
      target: { value: 'x'.repeat(MAX_NOTE_BYTES + 1) },
    });
    expect(screen.getByTestId('session-notes-error')).toBeInTheDocument();

    await elapse(NOTE_DEBOUNCE_MS);
    expect(mockSaveSessionNote).not.toHaveBeenCalled();
  });

  it('flushes a pending save to the ORIGINAL session when switching sessions', async () => {
    const { switchTo } = renderNotes('acq-a', null);
    fireEvent.change(screen.getByTestId('session-notes-textarea'), {
      target: { value: "A's draft" },
    });
    expect(mockSaveSessionNote).not.toHaveBeenCalled();

    // Switch to session B while A's save is still pending in the debouncer.
    // flushOnExit fires synchronously in A's unmount cleanup.
    act(() => {
      switchTo('acq-b', 'B keeps its own notes');
    });

    // The pending save was flushed at unmount, targeting A — never B.
    expect(mockSaveSessionNote).toHaveBeenCalledExactlyOnceWith(
      'acq-a',
      "A's draft",
    );

    // B's editor is a fresh instance seeded from B's persisted notes.
    expect(screen.getByTestId('session-notes-textarea')).toHaveValue(
      'B keeps its own notes',
    );

    // Draining the full debounce window schedules nothing further against B.
    await elapse(NOTE_DEBOUNCE_MS * 2);
    expect(mockSaveSessionNote).toHaveBeenCalledTimes(1);
  });
});
