// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SessionNotesSection — post-hoc free-text notes for an inventory session
 * (#773, Journey 4 "Notes"). A single always-editable textarea with debounced
 * autosave (the journey's "autosave signal"): edits persist via
 * `inventory.session.notes.update` and survive navigation because the backend
 * write is invalidated back into the inventory query.
 *
 * Reuses the shared note constraints (`@/lib/notes`) and the project notes CSS
 * (`alm-project-notes__*`) so the two note editors stay visually identical
 * without duplicating rules.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';
import { queryKeys } from '@/data/queryKeys';
import { addToast } from '@/shared/toast';
import { m } from '@/lib/i18n';
import { MAX_NOTE_BYTES, NOTE_DEBOUNCE_MS, noteByteLength } from '@/lib/notes';
import { saveSessionNote } from './store';

export interface SessionNotesSectionProps {
  /**
   * MUST also be passed as the React `key` by the caller. The debounced-save
   * closure captures this id, so a single instance re-targeted to another
   * session would flush a pending save against the wrong session (cross-
   * session lost write). Keyed remount gives every session its own instance,
   * debouncer, and draft — the closure id can never diverge from the session
   * being edited — and naturally reseeds the draft on selection change.
   */
  sessionId: string;
  /** Persisted notes from the inventory projection (`null` when never set). */
  initialContent: string | null;
}

export function SessionNotesSection({
  sessionId,
  initialContent,
}: SessionNotesSectionProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initialContent ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const byteCount = noteByteLength(draft);
  const overLimit = byteCount > MAX_NOTE_BYTES;
  const nearLimit = byteCount > MAX_NOTE_BYTES * 0.9;

  const triggerSave = useDebouncedCallback(
    (content: string) => {
      // Client guard: never send content the backend would reject on its byte
      // cap — the counter already shows why nothing is being saved.
      if (noteByteLength(content) > MAX_NOTE_BYTES) return;
      void (async () => {
        setSaving(true);
        try {
          await saveSessionNote(sessionId, content);
          setSaved(true);
          // Persistence across navigation: refresh the cached inventory so a
          // later remount seeds the editor from the saved value (#773).
          void queryClient.invalidateQueries({
            queryKey: queryKeys.inventory.all(),
          });
        } catch {
          addToast({
            message: m.sessions_notes_save_failed(),
            variant: 'error',
          });
        } finally {
          setSaving(false);
        }
      })();
    },
    NOTE_DEBOUNCE_MS,
    // flushOnExit: a save still pending when this instance unmounts (user
    // switched sessions before the debounce fired) is flushed immediately —
    // to THIS session, per the keyed-remount contract above — instead of
    // being silently dropped.
    { flushOnExit: true },
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    setSaved(false);
    triggerSave(value);
  };

  return (
    <div className="alm-project-notes__root">
      <textarea
        data-testid="session-notes-textarea"
        className="alm-input alm-project-notes__textarea"
        aria-label={m.sessions_notes_label()}
        placeholder={m.sessions_notes_placeholder()}
        value={draft}
        onChange={handleChange}
        rows={4}
        aria-invalid={overLimit}
        aria-describedby={overLimit ? 'session-notes-error' : undefined}
        // Onboarding find-it spotlight anchor (spec 056 FR-026).
        data-guide-anchor="sessions.note-field"
      />
      <div className="alm-project-notes__toolbar">
        <span
          data-testid="session-notes-byte-counter"
          className={
            overLimit
              ? 'alm-project-notes__byte-counter--over'
              : nearLimit
                ? 'alm-project-notes__byte-counter--near'
                : 'alm-project-notes__byte-counter'
          }
        >
          {byteCount.toLocaleString()} / {MAX_NOTE_BYTES.toLocaleString()}{' '}
          {m.projects_notes_bytes_unit()}
        </span>
        {saving ? (
          <span className="alm-project-notes__saved">{m.common_saving()}</span>
        ) : (
          saved && (
            <span
              data-testid="session-notes-saved"
              className="alm-project-notes__saved"
            >
              {m.sessions_notes_saved()}
            </span>
          )
        )}
      </div>
      {overLimit && (
        <span
          id="session-notes-error"
          role="alert"
          data-testid="session-notes-error"
          className="alm-field-error"
        >
          {m.sessions_notes_byte_limit({
            max: MAX_NOTE_BYTES.toLocaleString(),
          })}
        </span>
      )}
    </div>
  );
}
