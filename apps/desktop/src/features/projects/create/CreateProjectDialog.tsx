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
import { m } from '@/lib/i18n';
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
        setError('name', { type: 'duplicate', message: m.projects_create_name_duplicate() });
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
          aria-label={m.projects_create_btn()}
        >
          <form onSubmit={rhfHandleSubmit(onValid)} noValidate>
            {/* Header */}
            <div className="alm-confirm-overlay__header">
              <Dialog.Title className="alm-confirm-overlay__title">{m.projects_create_title()}</Dialog.Title>
              <Dialog.Description className="alm-confirm-overlay__description">
                {m.projects_create_desc()}
              </Dialog.Description>
            </div>

            {/* Body */}
            <div className="alm-confirm-overlay__body alm-create-project__body">

              {/* Name */}
              <div>
                <label className="alm-field-label" htmlFor="cp-name">{m.projects_name_label()}</label>
                <input
                  id="cp-name"
                  className="alm-input"
                  type="text"
                  placeholder={m.projects_create_name_placeholder()}
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
                    <span className="alm-field-label">{m.projects_create_target_label()}</span>
                    <div className="alm-create-project__target-row">
                      <Pill variant="accent">{target.primaryDesignation}</Pill>
                      {target.commonName && (
                        <span className="alm-field-hint">{target.commonName}</span>
                      )}
                      <Btn type="button" variant="ghost" onClick={() => setTarget(null)}>
                        {m.common_change()}
                      </Btn>
                    </div>
                  </>
                ) : (
                  <TargetSearch
                    label={m.projects_create_target_search_label()}
                    placeholder={m.projects_create_target_search_placeholder()}
                    onSelect={setTarget}
                  />
                )}
              </div>

              {/* Tool */}
              <div>
                <label className="alm-field-label">{m.projects_tool_label()}</label>
                <Controller
                  control={control}
                  name="tool"
                  render={({ field }) => (
                    <RadioGroup
                      options={TOOL_OPTIONS}
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      aria-label={m.projects_tool_label()}
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
                  {m.projects_create_path_label()}
                  <span className="alm-field-hint"> {m.projects_create_path_hint()}</span>
                </label>
                <input
                  id="cp-path"
                  className="alm-input"
                  type="text"
                  placeholder={m.projects_create_path_placeholder()}
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
                <label className="alm-field-label" htmlFor="cp-notes">{m.projects_create_notes_label()}</label>
                <textarea
                  id="cp-notes"
                  className="alm-input"
                  placeholder={m.projects_create_notes_placeholder()}
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
                {m.common_cancel()}
              </Btn>
              <Btn type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? m.projects_create_creating() : m.projects_create_btn()}
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
