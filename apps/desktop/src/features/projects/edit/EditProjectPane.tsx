/**
 * EditProjectPane — spec 008 US3 + US4.
 *
 * Single pane for editing a project's name, tool, and notes (US3), plus
 * channel management with drift banner (US4 / US1c).
 *
 * Tool field is disabled when lifecycle is in a tool-locked state
 * (prepared, processing, completed, blocked).
 * All edits are disabled when lifecycle == 'archived'.
 *
 * Channel drift banner (US1c): shown when channelDrift.hasNewSources == true.
 * Primary action re-infers channels; secondary dismisses the banner.
 */

import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Btn, Banner } from '@/ui';
import { callUpdateProject, callReinferChannels, callDismissChannelDrift } from '@/features/projects/store';
import type { ProjectDetailDto, ProjectChannelDto } from '@/bindings/index';
import { editProjectFormSchema, type EditProjectFormValues } from '@/features/projects/schemas';

// ── Tool-lock and read-only helpers ──────────────────────────────────────────

const TOOL_LOCKED_LIFECYCLES = new Set(['prepared', 'processing', 'completed', 'blocked']);
const READ_ONLY_LIFECYCLES = new Set(['archived']);

function isToolLocked(lifecycle: string) {
  return TOOL_LOCKED_LIFECYCLES.has(lifecycle);
}

function isReadOnly(lifecycle: string) {
  return READ_ONLY_LIFECYCLES.has(lifecycle);
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface EditProjectPaneProps {
  project: ProjectDetailDto;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function EditProjectPane({ project, onClose }: EditProjectPaneProps) {
  const readOnly = isReadOnly(project.lifecycle);
  const toolLocked = isToolLocked(project.lifecycle);

  type ToolValue = 'PixInsight' | 'Siril';
  const toToolValue = (t: string | undefined): ToolValue =>
    t === 'Siril' ? 'Siril' : 'PixInsight';
  const [serverError, setServerError] = useState<string | null>(null);
  const [channelWorking, setChannelWorking] = useState(false);
  const [channels, setChannels] = useState<ProjectChannelDto[]>(project.channels ?? []);

  const {
    register,
    handleSubmit: rhfHandleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditProjectFormValues>({
    resolver: zodResolver(editProjectFormSchema),
    defaultValues: {
      name: project.name,
      tool: toToolValue(project.tool),
      notes: project.notes ?? '',
    },
    mode: 'onSubmit',
  });

  // Sync if parent project changes (e.g. detail re-fetched)
  useEffect(() => {
    reset({
      name: project.name,
      tool: toToolValue(project.tool),
      notes: project.notes ?? '',
    });
    setChannels(project.channels ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, reset]);

  // ── Save ──────────────────────────────────────────────────────────────────
  // The submit payload is delta-based: only fields whose validated value differs
  // from the original `project` are sent (others stay `undefined`). This matches
  // the pre-RHF behaviour byte-for-byte; zod only gates the name rules.

  const onValid = useCallback(
    async (values: EditProjectFormValues) => {
      if (readOnly) return;
      const trimmed = values.name.trim();

      setServerError(null);
      try {
        await callUpdateProject({
          requestId: crypto.randomUUID(),
          projectId: project.id,
          name: trimmed !== project.name ? trimmed : undefined,
          tool:
            values.tool !== (typeof project.tool === 'string' ? project.tool : 'PixInsight')
              ? values.tool
              : undefined,
          notes: values.notes !== (project.notes ?? '') ? values.notes : undefined,
        });
        onClose();
      } catch (err: unknown) {
        const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
        setServerError(mapUpdateError(code));
      }
    },
    [readOnly, project, onClose],
  );

  // ── Channel actions ───────────────────────────────────────────────────────

  const handleReinfer = useCallback(async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      const result = await callReinferChannels({
        requestId: crypto.randomUUID(),
        projectId: project.id,
      });
      setChannels(result.channels ?? []);
    } catch {
      // Non-fatal
    } finally {
      setChannelWorking(false);
    }
  }, [channelWorking, project.id]);

  const handleDismissDrift = useCallback(async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await callDismissChannelDrift({
        requestId: crypto.randomUUID(),
        projectId: project.id,
      });
    } catch {
      // Non-fatal
    } finally {
      setChannelWorking(false);
    }
  }, [channelWorking, project.id]);

  return (
    <div className="alm-edit-project-pane" aria-label="Edit project">

      {/* Channel drift banner (US1c / US4) */}
      {project.channelDrift?.hasNewSources && (
        <Banner variant="warn" role="status" aria-live="polite">
          <span>New sources were added since the last channel review.</span>
          <div className="alm-edit-project__drift-actions">
            <Btn size="sm" variant="primary" onClick={handleReinfer} disabled={channelWorking}>
              Re-infer channels
            </Btn>
            <Btn size="sm" variant="ghost" onClick={handleDismissDrift} disabled={channelWorking}>
              Dismiss
            </Btn>
          </div>
        </Banner>
      )}

      {/* Read-only notice */}
      {readOnly && (
        <Banner variant="warn" role="status">
          This project is archived. Settings are read-only.
        </Banner>
      )}

      <form
        onSubmit={rhfHandleSubmit(onValid)}
        noValidate
        className="alm-edit-project__form"
      >

        {/* Name */}
        <div>
          <label className="alm-field-label" htmlFor="ep-name">Project name</label>
          <input
            id="ep-name"
            className="alm-input"
            type="text"
            maxLength={130}
            disabled={readOnly}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'ep-name-error' : undefined}
            {...register('name')}
          />
          {errors.name && (
            <span id="ep-name-error" role="alert" className="alm-field-error">
              {errors.name.message}
            </span>
          )}
        </div>

        {/* Tool */}
        <div>
          <label className="alm-field-label" htmlFor="ep-tool">Processing tool</label>
          <select
            id="ep-tool"
            className="alm-input"
            disabled={readOnly || toolLocked}
            aria-describedby={toolLocked ? 'ep-tool-lock' : undefined}
            {...register('tool')}
          >
            <option value="PixInsight">PixInsight</option>
            <option value="Siril">Siril</option>
          </select>
          {toolLocked && (
            <span id="ep-tool-lock" className="alm-field-hint">
              Tool is locked in the current lifecycle state ({project.lifecycle}).
            </span>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="alm-field-label" htmlFor="ep-notes">Notes</label>
          <textarea
            id="ep-notes"
            className="alm-input"
            rows={4}
            maxLength={4106}
            disabled={readOnly}
            {...register('notes')}
          />
        </div>

        {/* Channels preview (US4) */}
        <div>
          <span className="alm-field-label">Channels</span>
          <div className="alm-edit-project__channels">
            {channels.length === 0 ? (
              <span className="alm-field-hint">No channels inferred yet.</span>
            ) : (
              channels.map((ch) => (
                <span
                  key={ch.label}
                  className={`alm-channel-chip alm-channel-chip--${ch.source}`}
                  title={ch.source === 'inferred' ? 'Auto-inferred from sources' : 'Manually added'}
                  aria-label={`${ch.label} (${ch.source})`}
                >
                  {ch.label}
                  {ch.source === 'inferred' && (
                    <span className="alm-channel-chip__tag">Auto</span>
                  )}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Server error */}
        {serverError && (
          <span role="alert" className="alm-field-error">{serverError}</span>
        )}

        {/* Actions */}
        <div className="alm-edit-project__actions">
          <Btn type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Btn>
          {!readOnly && (
            <Btn type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Btn>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Error mapping ─────────────────────────────────────────────────────────────

function mapUpdateError(code: string): string {
  switch (code) {
    case 'project.not_found': return 'Project not found.';
    case 'name.empty':        return 'Name cannot be empty.';
    case 'name.too_long':     return 'Name must be 120 characters or fewer.';
    case 'name.duplicate':    return 'A project with this name already exists.';
    case 'tool.unknown':      return 'Unknown processing tool.';
    case 'tool.locked':       return 'Tool cannot be changed in the current lifecycle state.';
    case 'lifecycle.read_only': return 'This project is archived and cannot be edited.';
    case 'no_op':             return 'No fields were changed.';
    default:                  return `Update failed (${code}).`;
  }
}
