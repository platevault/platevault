// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * EditProjectPane — spec 008 US3 + US4 + WP-008-C.
 *
 * Single pane for editing a project's name, tool, and notes (US3), plus
 * channel management with drift banner (US4 / US1c, `ChannelDriftBanner` +
 * `useEditProjectChannels`) and post-creation source add/remove (WP-008-C,
 * `EditProjectSourcesPanel` + `useEditProjectSources`).
 *
 * Tool field is disabled when lifecycle is in a tool-locked state
 * (prepared, processing, completed, blocked).
 * All edits are disabled when lifecycle == 'archived'.
 */

import { useState, useEffect, useCallback } from 'react';
import { m } from '@/lib/i18n';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Btn, Banner } from '@/ui';
import { callUpdateProject, useSessionNames } from '@/features/projects/store';
import type { ProjectDetailDto } from '@/bindings/index';
import {
  editProjectFormSchema,
  type EditProjectFormValues,
} from '@/features/projects/schemas';
import { isContractError } from '@/lib/errors';
import {
  isToolLocked,
  isReadOnly,
  isSourceRemoveLocked,
} from './editProjectLifecycle';
import { mapUpdateError } from './editProjectErrors';
import { useEditProjectChannels } from './useEditProjectChannels';
import { ChannelDriftBanner } from './ChannelDriftBanner';
import { useEditProjectSources } from './useEditProjectSources';
import { EditProjectSourcesPanel } from './EditProjectSourcesPanel';

export interface EditProjectPaneProps {
  project: ProjectDetailDto;
  onClose: () => void;
}

export function EditProjectPane({ project, onClose }: EditProjectPaneProps) {
  const readOnly = isReadOnly(project.lifecycle);
  const toolLocked = isToolLocked(project.lifecycle);
  // #663: resolve raw session UUIDs to the same human names Sessions shows.
  const sessionNames = useSessionNames();

  type ToolValue = 'PixInsight' | 'Siril';
  const toToolValue = (t: string | undefined): ToolValue =>
    t === 'Siril' ? 'Siril' : 'PixInsight';
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    channels,
    setChannels,
    channelWorking,
    handleReinfer,
    handleDismissDrift,
  } = useEditProjectChannels(project.id, project.channels ?? []);

  const sourceRemoveLocked = isSourceRemoveLocked(project.lifecycle);
  const {
    linkedSessionIds,
    sourceError,
    removeBusyId,
    confirmRemoveId,
    setConfirmRemoveId,
    showAddSources,
    setShowAddSources,
    addSelection,
    setAddSelection,
    addError,
    setAddError,
    addBusy,
    handleRemoveSource,
    handleAddSources,
  } = useEditProjectSources(project);

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
    },
    mode: 'onSubmit',
  });

  // Sync if parent project changes (e.g. detail re-fetched)
  useEffect(() => {
    reset({
      name: project.name,
      tool: toToolValue(project.tool),
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
        // #790: `notes` is intentionally never submitted here — it is a
        // second, orphaned notes concept (ProjectDetailDto.notes) that no
        // surface displays. The one real project-notes UI is
        // ProjectNotesSection (project.note.get/update, spec 024), rendered
        // in ProjectBottomDetail. Sending it would silently discard input
        // into a field nothing shows.
        await callUpdateProject({
          requestId: crypto.randomUUID(),
          projectId: project.id,
          name: trimmed !== project.name ? trimmed : undefined,
          tool:
            values.tool !==
            (typeof project.tool === 'string' ? project.tool : 'PixInsight')
              ? values.tool
              : undefined,
        });
        onClose();
      } catch (err: unknown) {
        // isContractError first: a ContractError's `.message` is the raw
        // backend diagnostic (never shown to the user, FR-009), not the
        // `.code` that mapUpdateError switches on.
        const code = isContractError(err)
          ? err.code
          : typeof err === 'string'
            ? err
            : 'unknown';
        setServerError(mapUpdateError(code));
      }
    },
    [readOnly, project, onClose],
  );

  return (
    // No aria-label here: ProjectDetail always renders this pane inside a
    // Modal, which already supplies role=dialog + aria-label from the same
    // string (m.projects_edit_pane_aria()). A second aria-label on this root
    // would duplicate the accessible name and break getByLabel() queries with
    // a strict-mode violation (two matching elements).
    <div className="pv-edit-project-pane">
      <ChannelDriftBanner
        show={Boolean(project.channelDrift?.hasNewSources)}
        channelWorking={channelWorking}
        onReinfer={handleReinfer}
        onDismiss={handleDismissDrift}
      />

      {/* Read-only notice */}
      {readOnly && (
        <Banner variant="warn" role="status">
          {m.projects_edit_archived_notice()}
        </Banner>
      )}

      {/*
       * Sources (WP-008-C) — deliberately rendered OUTSIDE the <form> below.
       * Add/remove are independent, immediately-applied server actions (like
       * the channel-drift banner above), not part of the name/tool/notes
       * submit payload. Keeping it outside the form also sidesteps any
       * accidental-submit footgun from the embedded SessionSourcePicker's own
       * inputs/checkboxes (native <button>/<input> default behaviour inside
       * a <form>).
       */}
      <EditProjectSourcesPanel
        sources={project.sources}
        sessionNames={sessionNames}
        readOnly={readOnly}
        sourceRemoveLocked={sourceRemoveLocked}
        linkedSessionIds={linkedSessionIds}
        sourceError={sourceError}
        removeBusyId={removeBusyId}
        confirmRemoveId={confirmRemoveId}
        setConfirmRemoveId={setConfirmRemoveId}
        onRemoveSource={handleRemoveSource}
        showAddSources={showAddSources}
        setShowAddSources={setShowAddSources}
        addSelection={addSelection}
        setAddSelection={setAddSelection}
        addError={addError}
        setAddError={setAddError}
        addBusy={addBusy}
        onAddSources={handleAddSources}
      />

      <form
        onSubmit={rhfHandleSubmit(onValid)}
        noValidate
        className="pv-edit-project__form"
      >
        {/* Name */}
        <div>
          {}
          <label className="pv-field-label" htmlFor="ep-name">
            {m.projects_name_label()}
          </label>
          <input
            id="ep-name"
            className="pv-input"
            type="text"
            maxLength={130}
            disabled={readOnly}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'ep-name-error' : undefined}
            {...register('name')}
          />
          {errors.name && (
            <span id="ep-name-error" role="alert" className="pv-field-error">
              {errors.name.message}
            </span>
          )}
        </div>

        {/* Tool */}
        <div>
          {}
          <label className="pv-field-label" htmlFor="ep-tool">
            {m.projects_tool_label()}
          </label>
          <select
            id="ep-tool"
            className="pv-input"
            disabled={readOnly || toolLocked}
            aria-describedby={toolLocked ? 'ep-tool-lock' : undefined}
            {...register('tool')}
          >
            {/* eslint-disable-next-line alm/no-user-string -- proper noun: PixInsight is a brand name */}
            <option value="PixInsight">PixInsight</option>
            {/* eslint-disable-next-line alm/no-user-string -- proper noun: Siril is a brand name */}
            <option value="Siril">Siril</option>
          </select>
          {toolLocked && (
            <span id="ep-tool-lock" className="pv-field-hint">
              {m.projects_edit_tool_locked_hint({
                lifecycle: project.lifecycle,
              })}
            </span>
          )}
        </div>

        {/* #790: the second, orphaned Notes field (bound to the unused
            ProjectDetailDto.notes) was removed. Project notes are edited via
            ProjectNotesSection (ProjectBottomDetail), the one surface that
            actually displays saved notes (project.note.get/update, spec 024). */}

        {/* Channels preview (US4) */}
        <div>
          <span className="pv-field-label">
            {m.projects_edit_channels_label()}
          </span>
          <div className="pv-edit-project__channels">
            {channels.length === 0 ? (
              <span className="pv-field-hint">
                {m.projects_edit_channels_empty()}
              </span>
            ) : (
              channels.map((ch) => (
                <span
                  key={ch.label}
                  className={`pv-channel-chip pv-channel-chip--${ch.source}`}
                  title={
                    ch.source === 'inferred'
                      ? m.projects_edit_inferred_title()
                      : m.projects_edit_manual_title()
                  }
                  aria-label={`${ch.label} (${ch.source})`}
                >
                  {ch.label}
                  {ch.source === 'inferred' && (
                    <span className="pv-channel-chip__tag">
                      {m.projects_edit_channels_auto_tag()}
                    </span>
                  )}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Server error */}
        {serverError && (
          <span role="alert" className="pv-field-error">
            {serverError}
          </span>
        )}

        {/* Actions */}
        <div className="pv-edit-project__actions">
          <Btn
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {m.common_cancel()}
          </Btn>
          {!readOnly && (
            <Btn type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? m.common_saving() : m.projects_edit_save_btn()}
            </Btn>
          )}
        </div>
      </form>
    </div>
  );
}
