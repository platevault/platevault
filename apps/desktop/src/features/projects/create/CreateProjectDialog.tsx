/**
 * CreateProjectDialog — spec 008 US1.
 *
 * Single-form modal to create a new project. Fields:
 *   - name (required, ≤120 chars, live duplicate-check)
 *   - tool (required, radio group, PixInsight default)
 *   - path (required, library-root-relative)
 *   - notes (optional, ≤4096 chars)
 *
 * On success:
 *   - Closes the dialog.
 *   - Calls onSuccess(result) so the parent can navigate to the new project
 *     and show a toast linking to the plan review.
 *
 * Error codes surfaced inline:
 *   name.empty, name.too_long, name.duplicate, tool.unknown,
 *   path.invalid, path.collision.
 *
 * Uses @base-ui-components/react/dialog for focus-trapping modal behaviour,
 * consistent with ConfirmOverlay.
 */

import { useState, useCallback } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Btn, RadioGroup, Pill } from '@/ui';
import type { RadioOption } from '@/ui';
import { callCreateProject } from '@/features/projects/store';
import { listProjects008 } from '@/api/commands';
import type { TargetSuggestion } from '@/api/commands';
import { TargetSearch } from '@/components';
import type { ProjectCreateResult } from '@/bindings/index';

// ── Constants ────────────────────────────────────────────────────────────────

const TOOL_OPTIONS: RadioOption[] = [
  { value: 'PixInsight', label: 'PixInsight', desc: 'WBPP, StarAlignment, integration' },
  { value: 'Siril', label: 'Siril', desc: 'Free open-source stacking' },
  { value: 'Planetary Suite', label: 'Planetary Suite', desc: 'Planetary / lunar capture' },
];

const MAX_NAME_LEN = 120;
const MAX_NOTES_LEN = 4096;

// ── Props ────────────────────────────────────────────────────────────────────

export interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: ProjectCreateResult) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CreateProjectDialog({ open, onClose, onSuccess }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [tool, setTool] = useState('PixInsight');
  const [path, setPath] = useState('');
  const [notes, setNotes] = useState('');
  // spec 035 US1: selected canonical target (optional). The current
  // projects.create contract has no target field, so the selection is held in
  // local state for now; persisting the association requires a backend contract
  // field (tracked separately, not part of T013).
  const [target, setTarget] = useState<TargetSuggestion | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset form when dialog opens/closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setName('');
        setTool('PixInsight');
        setPath('');
        setNotes('');
        setTarget(null);
        setFieldErrors({});
        setServerError(null);
        setSubmitting(false);
        onClose();
      }
    },
    [onClose],
  );

  // ── Client-side validation ──────────────────────────────────────────────────

  async function validate(): Promise<boolean> {
    const errors: Record<string, string> = {};

    const trimmedName = name.trim();
    if (!trimmedName) {
      errors.name = 'Project name is required.';
    } else if (trimmedName.length > MAX_NAME_LEN) {
      errors.name = `Name must be ${MAX_NAME_LEN} characters or fewer.`;
    } else {
      // Live duplicate check: call list and scan names.
      try {
        const list = await listProjects008();
        const dup = list.find((p) => p.name.toLowerCase() === trimmedName.toLowerCase());
        if (dup) {
          errors.name = 'A project with this name already exists.';
        }
      } catch {
        // Non-fatal: let the server enforce uniqueness
      }
    }

    if (!path.trim()) {
      errors.path = 'Project folder path is required.';
    }

    if (!tool) {
      errors.tool = 'Please select a processing tool.';
    }

    if (notes.length > MAX_NOTES_LEN) {
      errors.notes = `Notes must be ${MAX_NOTES_LEN} characters or fewer.`;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const valid = await validate();
    if (!valid) return;

    setSubmitting(true);
    setServerError(null);

    try {
      const result = await callCreateProject({
        requestId: crypto.randomUUID(),
        name: name.trim(),
        tool: tool as 'PixInsight' | 'Siril' | 'Planetary Suite',
        path: path.trim(),
        initialSources: [],
        notes: notes.trim() || undefined,
        canonicalTargetId: target?.targetId ?? null,
      });
      handleOpenChange(false);
      onSuccess(result);
    } catch (err: unknown) {
      const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
      setServerError(mapErrorCode(code));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="alm-confirm-overlay__backdrop" />
        <Dialog.Popup
          className="alm-confirm-overlay"
          aria-label="Create project"
          style={{ maxWidth: 520 }}
        >
          <form onSubmit={handleSubmit} noValidate>
            {/* Header */}
            <div className="alm-confirm-overlay__header">
              <Dialog.Title className="alm-confirm-overlay__title">New project</Dialog.Title>
              <Dialog.Description className="alm-confirm-overlay__description">
                Set up a project to collect and organize acquisition sessions.
              </Dialog.Description>
            </div>

            {/* Body */}
            <div className="alm-confirm-overlay__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-4)' }}>

              {/* Name */}
              <div>
                <label className="alm-field-label" htmlFor="cp-name">Project name</label>
                <input
                  id="cp-name"
                  className="alm-input"
                  type="text"
                  placeholder="e.g. NGC 7000 Narrowband"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_NAME_LEN + 10}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                  autoFocus
                />
                {fieldErrors.name && (
                  <span id="name-error" role="alert" className="alm-field-error">
                    {fieldErrors.name}
                  </span>
                )}
              </div>

              {/* Target (optional) — spec 035 US1 */}
              <div>
                {target ? (
                  <>
                    <span className="alm-field-label">Target</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
                      <Pill variant="accent">{target.primaryDesignation}</Pill>
                      {target.commonName && (
                        <span className="alm-field-hint">{target.commonName}</span>
                      )}
                      <Btn type="button" variant="ghost" onClick={() => setTarget(null)}>
                        Change
                      </Btn>
                    </div>
                  </>
                ) : (
                  <TargetSearch
                    label="Target (optional)"
                    placeholder="e.g. M31, NGC 224, Andromeda"
                    onSelect={setTarget}
                  />
                )}
              </div>

              {/* Tool */}
              <div>
                <label className="alm-field-label">Processing tool</label>
                <RadioGroup
                  options={TOOL_OPTIONS}
                  value={tool}
                  onChange={setTool}
                  aria-label="Processing tool"
                />
                {fieldErrors.tool && (
                  <span role="alert" className="alm-field-error">{fieldErrors.tool}</span>
                )}
              </div>

              {/* Path */}
              <div>
                <label className="alm-field-label" htmlFor="cp-path">
                  Folder path
                  <span className="alm-field-hint"> — library-root-relative (e.g. projects/NGC7000_NB)</span>
                </label>
                <input
                  id="cp-path"
                  className="alm-input"
                  type="text"
                  placeholder="projects/my-project"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.path)}
                  aria-describedby={fieldErrors.path ? 'path-error' : undefined}
                />
                {fieldErrors.path && (
                  <span id="path-error" role="alert" className="alm-field-error">
                    {fieldErrors.path}
                  </span>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="alm-field-label" htmlFor="cp-notes">Notes (optional)</label>
                <textarea
                  id="cp-notes"
                  className="alm-input"
                  placeholder="Any notes about this project…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={MAX_NOTES_LEN + 10}
                />
              </div>

              {/* Server error */}
              {serverError && (
                <span role="alert" className="alm-field-error">{serverError}</span>
              )}
            </div>

            {/* Footer */}
            <div className="alm-confirm-overlay__footer">
              <Btn type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
                Cancel
              </Btn>
              <Btn type="submit" variant="primary" disabled={submitting || !tool}>
                {submitting ? 'Creating…' : 'Create project'}
              </Btn>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Error code → user-facing message ─────────────────────────────────────────

function mapErrorCode(code: string): string {
  switch (code) {
    case 'name.empty':      return 'Project name is required.';
    case 'name.too_long':   return 'Project name is too long (max 120 characters).';
    case 'name.duplicate':  return 'A project with this name already exists.';
    case 'tool.unknown':    return 'Unknown processing tool selected.';
    case 'path.invalid':    return 'Folder path is required.';
    case 'path.collision':  return 'Another project already uses this folder path.';
    default:                return `Could not create project (${code}).`;
  }
}
