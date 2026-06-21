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
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '@base-ui-components/react/dialog';
import { Btn, RadioGroup, Pill } from '@/ui';
import type { RadioOption } from '@/ui';
import { callCreateProject } from '@/features/projects/store';
import { listProjects008 } from '@/api/commands';
import type { TargetSuggestion } from '@/api/commands';
import { TargetSearch } from '@/components';
import type { ProjectCreateResult } from '@/bindings/index';
import {
  createProjectFormSchema,
  type CreateProjectFormValues,
  MAX_NAME_LEN,
  MAX_NOTES_LEN,
} from '@/features/projects/schemas';

// ── Constants ────────────────────────────────────────────────────────────────

const TOOL_OPTIONS: RadioOption[] = [
  { value: 'PixInsight', label: 'PixInsight', desc: 'WBPP, StarAlignment, integration' },
  { value: 'Siril', label: 'Siril', desc: 'Free open-source stacking' },
];

// ── Props ────────────────────────────────────────────────────────────────────

export interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: ProjectCreateResult) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CreateProjectDialog({ open, onClose, onSuccess }: CreateProjectDialogProps) {
  // spec 035 US1: selected canonical target (optional). The current
  // projects.create contract has no target field, so the selection is held in
  // local state for now; persisting the association requires a backend contract
  // field (tracked separately, not part of T013).
  const [target, setTarget] = useState<TargetSuggestion | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit: rhfHandleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: { name: '', tool: 'PixInsight', path: '', notes: '' },
    mode: 'onSubmit',
  });

  // Reset form when dialog opens/closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        reset({ name: '', tool: 'PixInsight', path: '', notes: '' });
        setTarget(null);
        setServerError(null);
        onClose();
      }
    },
    [onClose, reset],
  );

  // ── Submit ──────────────────────────────────────────────────────────────────
  // zod (via the resolver) covers the synchronous rules (name/path required,
  // length caps, tool enum). The live duplicate check stays here because it hits
  // the network; on a hit we attach the error to the `name` field, matching the
  // pre-RHF behaviour and message.

  async function onValid(values: CreateProjectFormValues) {
    const trimmedName = values.name.trim();
    try {
      const list = await listProjects008();
      const dup = list.find((p) => p.name.toLowerCase() === trimmedName.toLowerCase());
      if (dup) {
        setError('name', { type: 'duplicate', message: 'A project with this name already exists.' });
        return;
      }
    } catch {
      // Non-fatal: let the server enforce uniqueness
    }

    setServerError(null);

    try {
      const result = await callCreateProject({
        requestId: crypto.randomUUID(),
        name: trimmedName,
        tool: values.tool,
        path: values.path.trim(),
        initialSources: [],
        notes: values.notes.trim() || undefined,
        canonicalTargetId: target?.targetId ?? null,
      });
      handleOpenChange(false);
      onSuccess(result);
    } catch (err: unknown) {
      const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
      setServerError(mapErrorCode(code));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="alm-confirm-overlay__backdrop" />
        <Dialog.Popup
          className="alm-confirm-overlay alm-create-project__popup"
          aria-label="Create project"
        >
          <form onSubmit={rhfHandleSubmit(onValid)} noValidate>
            {/* Header */}
            <div className="alm-confirm-overlay__header">
              <Dialog.Title className="alm-confirm-overlay__title">New project</Dialog.Title>
              <Dialog.Description className="alm-confirm-overlay__description">
                Set up a project to collect and organize acquisition sessions.
              </Dialog.Description>
            </div>

            {/* Body */}
            <div className="alm-confirm-overlay__body alm-create-project__body">

              {/* Name */}
              <div>
                <label className="alm-field-label" htmlFor="cp-name">Project name</label>
                <input
                  id="cp-name"
                  className="alm-input"
                  type="text"
                  placeholder="e.g. NGC 7000 Narrowband"
                  maxLength={MAX_NAME_LEN + 10}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                  autoFocus
                  {...register('name')}
                />
                {errors.name && (
                  <span id="name-error" role="alert" className="alm-field-error">
                    {errors.name.message}
                  </span>
                )}
              </div>

              {/* Target (optional) — spec 035 US1 */}
              <div>
                {target ? (
                  <>
                    <span className="alm-field-label">Target</span>
                    <div className="alm-create-project__target-row">
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
                <Controller
                  control={control}
                  name="tool"
                  render={({ field }) => (
                    <RadioGroup
                      options={TOOL_OPTIONS}
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      aria-label="Processing tool"
                    />
                  )}
                />
                {errors.tool && (
                  <span role="alert" className="alm-field-error">{errors.tool.message}</span>
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
                  aria-invalid={Boolean(errors.path)}
                  aria-describedby={errors.path ? 'path-error' : undefined}
                  {...register('path')}
                />
                {errors.path && (
                  <span id="path-error" role="alert" className="alm-field-error">
                    {errors.path.message}
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
                  rows={3}
                  maxLength={MAX_NOTES_LEN + 10}
                  {...register('notes')}
                />
              </div>

              {/* Server error */}
              {serverError && (
                <span role="alert" className="alm-field-error">{serverError}</span>
              )}
            </div>

            {/* Footer */}
            <div className="alm-confirm-overlay__footer">
              <Btn type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Btn>
              <Btn type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create project'}
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
