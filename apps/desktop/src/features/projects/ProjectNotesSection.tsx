/**
 * ProjectNotesSection — spec 024 T4.2.
 *
 * Inline-edit section for project free-text notes. Features:
 * - Renders existing notes body or "No notes." placeholder.
 * - Edit affordance: click "Edit" to open a textarea with save/cancel.
 * - 5-second debounce before issuing `project.note.update` (A5).
 * - Byte counter with warning when approaching / exceeding 16 384-byte cap.
 * - `note.content_too_large` error mapped to inline validation message.
 * - `project.read_only` error surfaced as a toast (archived project).
 */

import { useState, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import { addToast } from '@/shared/toast';
import { saveNote, noteByteLength, MAX_NOTE_BYTES, NOTE_DEBOUNCE_MS } from './manifests';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ProjectNotesSectionProps {
  projectId: string;
  /** Current notes content from the project detail (may be null/undefined). */
  initialContent?: string | null;
  /** Whether the project lifecycle prevents editing (archived). */
  readOnly?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectNotesSection({
  projectId,
  initialContent,
  readOnly = false,
}: ProjectNotesSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialContent ?? '');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Sync draft with upstream changes (e.g. after a reload).
  useEffect(() => {
    if (!editing) {
      setDraft(initialContent ?? '');
    }
  }, [initialContent, editing]);

  const byteCount = noteByteLength(draft);
  const overLimit = byteCount > MAX_NOTE_BYTES;
  const nearLimit = byteCount > MAX_NOTE_BYTES * 0.9;

  // ── Debounced autosave ────────────────────────────────────────────────────

  // Debounced autosave. `useDebouncedCallback` cancels the pending save on
  // unmount and replaces it on each keystroke, preserving the prior
  // setTimeout/clearTimeout semantics at the same NOTE_DEBOUNCE_MS interval.
  const triggerSave = useDebouncedCallback(
    (content: string) => {
      // Keep the debounced callback void-returning (matching the prior
      // `setTimeout(async …)`); the async work runs in a fire-and-forget IIFE.
      void (async () => {
        if (noteByteLength(content) > MAX_NOTE_BYTES) return;
        setSaving(true);
        const { updatedAt, error } = await saveNote(projectId, content);
        setSaving(false);
        if (error === 'note.content_too_large') {
          setFieldError(`Note exceeds the ${MAX_NOTE_BYTES.toLocaleString()}-byte limit.`);
        } else if (error === 'project.read_only') {
          addToast({ message: m.projects_toast_archived_readonly(), variant: 'error' });
        } else if (error) {
          addToast({ message: m.projects_toast_save_notes_failed({ error: String(error) }), variant: 'error' });
        } else if (updatedAt) {
          setLastSaved(updatedAt);
          setFieldError(null);
        }
      })();
    },
    NOTE_DEBOUNCE_MS,
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    setFieldError(null);
    if (!readOnly) triggerSave(value);
  };

  const handleSave = async () => {
    if (overLimit) {
      setFieldError(`Note exceeds the ${MAX_NOTE_BYTES.toLocaleString()}-byte limit.`);
      return;
    }
    triggerSave.cancel();
    setSaving(true);
    const { updatedAt, error } = await saveNote(projectId, draft);
    setSaving(false);
    if (error === 'note.content_too_large') {
      setFieldError(`Note exceeds the ${MAX_NOTE_BYTES.toLocaleString()}-byte limit.`);
    } else if (error === 'project.read_only') {
      addToast({ message: m.projects_toast_archived_readonly(), variant: 'error' });
      setEditing(false);
    } else if (error) {
      addToast({ message: m.projects_toast_save_notes_failed({ error: String(error) }), variant: 'error' });
    } else if (updatedAt) {
      setLastSaved(updatedAt);
      setFieldError(null);
      setEditing(false);
    }
  };

  const handleCancel = () => {
    triggerSave.cancel();
    setDraft(initialContent ?? '');
    setFieldError(null);
    setEditing(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!editing) {
    return (
      <div className="alm-project-notes__root">
        {draft ? (
          <div
            data-testid="notes-body"
            className="alm-project-notes__body"
          >
            {draft}
          </div>
        ) : (
          <span
            data-testid="notes-empty"
            className="alm-project-notes__empty"
          >
            {m.projects_notes_empty()}
          </span>
        )}
        {!readOnly && (
          <div>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {m.projects_detail_edit_btn()}
            </Btn>
          </div>
        )}
        {lastSaved && (
          <span
            data-testid="notes-saved-indicator"
            className="alm-project-notes__saved"
          >
            {m.projects_notes_saved()}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="alm-project-notes__root">
      <textarea
        data-testid="notes-textarea"
        className="alm-input alm-project-notes__textarea"
        aria-label={m.projects_notes_label()}
        value={draft}
        onChange={handleChange}
        rows={6}
        disabled={saving}
        aria-invalid={Boolean(fieldError || overLimit)}
        aria-describedby={fieldError ? 'notes-field-error' : undefined}
      />
      <div className="alm-project-notes__toolbar">
        <span
          data-testid="notes-byte-counter"
          // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional token color (over-limit / near-limit / normal)
          style={{
            color: overLimit
              ? 'var(--alm-danger)'
              : nearLimit
                ? 'var(--alm-warn)'
                : 'var(--alm-text-muted)',
          }}
        >
          {byteCount.toLocaleString()} / {MAX_NOTE_BYTES.toLocaleString()} {m.projects_notes_bytes_unit()}
        </span>
        <div className="alm-project-notes__actions">
          <Btn size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
            {m.common_cancel()}
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            onClick={handleSave}
            disabled={saving || overLimit}
          >
            {saving ? m.common_saving() : m.projects_edit_save_btn()}
          </Btn>
        </div>
      </div>
      {fieldError && (
        <span
          id="notes-field-error"
          role="alert"
          data-testid="notes-field-error"
          className="alm-field-error"
        >
          {fieldError}
        </span>
      )}
    </div>
  );
}
