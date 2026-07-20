// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * EditProjectPane — spec 008 US3 + US4 + WP-008-C.
 *
 * Single pane for editing a project's name, tool, and notes (US3), plus
 * channel management with drift banner (US4 / US1c) and post-creation source
 * add/remove (WP-008-C).
 *
 * Tool field is disabled when lifecycle is in a tool-locked state
 * (prepared, processing, completed, blocked).
 * All edits are disabled when lifecycle == 'archived'.
 *
 * Channel drift banner (US1c): shown when channelDrift.hasNewSources == true.
 * Primary action re-infers channels; secondary dismisses the banner.
 *
 * Sources (WP-008-C): current sources are listed with a per-row remove
 * affordance; a "Add sources" toggle reveals the shared `SessionSourcePicker`
 * (the same component the creation wizard uses), filtered to sessions not
 * already linked to this project. Removing the project's last source
 * requires an inline confirm step (`lifecycle.last_confirmed_source`).
 */

import { useState, useEffect, useCallback } from 'react';
import { m } from '@/lib/i18n';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Btn, Banner } from '@/ui';
import {
  callUpdateProject,
  callReinferChannels,
  callDismissChannelDrift,
  callAddProjectSource,
  callRemoveProjectSource,
  useSessionNames,
} from '@/features/projects/store';
import { SessionSourcePicker } from '@/features/projects/SessionSourcePicker';
import type {
  ProjectDetailDto,
  ProjectChannelDto,
  ErrorCode,
} from '@/bindings/index';
import {
  editProjectFormSchema,
  type EditProjectFormValues,
} from '@/features/projects/schemas';
import { errMessage, isContractError } from '@/lib/errors';
import { ERROR_MESSAGES } from '@/lib/error-messages';

// ── Tool-lock and read-only helpers ──────────────────────────────────────────

const TOOL_LOCKED_LIFECYCLES = new Set([
  'prepared',
  'processing',
  'completed',
  'blocked',
]);
const READ_ONLY_LIFECYCLES = new Set(['archived']);
// Spec 008 FR-011 (crates/domain/core/src/project/validate.rs
// SOURCE_REMOVE_LOCKED_LIFECYCLES) — distinct from the tool lock set above:
// removal is refused for archived too, but not for 'blocked'.
const SOURCE_REMOVE_LOCKED_LIFECYCLES = new Set([
  'prepared',
  'processing',
  'completed',
  'archived',
]);

function isToolLocked(lifecycle: string) {
  return TOOL_LOCKED_LIFECYCLES.has(lifecycle);
}

function isReadOnly(lifecycle: string) {
  return READ_ONLY_LIFECYCLES.has(lifecycle);
}

function isSourceRemoveLocked(lifecycle: string) {
  return SOURCE_REMOVE_LOCKED_LIFECYCLES.has(lifecycle);
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
  // #663: resolve raw session UUIDs to the same human names Sessions shows.
  const sessionNames = useSessionNames();

  type ToolValue = 'PixInsight' | 'Siril';
  const toToolValue = (t: string | undefined): ToolValue =>
    t === 'Siril' ? 'Siril' : 'PixInsight';
  const [serverError, setServerError] = useState<string | null>(null);
  const [channelWorking, setChannelWorking] = useState(false);
  const [channels, setChannels] = useState<ProjectChannelDto[]>(
    project.channels ?? [],
  );

  // ── Sources state (WP-008-C) ────────────────────────────────────────────
  const sourceRemoveLocked = isSourceRemoveLocked(project.lifecycle);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showAddSources, setShowAddSources] = useState(false);
  const [addSelection, setAddSelection] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

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
    // Reset transient source-editing UI on a fresh project (e.g. after an
    // add/remove refetch) so stale confirm/add state doesn't linger.
    setSourceError(null);
    setConfirmRemoveId(null);
    setAddError(null);
    setAddSelection([]);
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

  // ── Source actions (WP-008-C) ───────────────────────────────────────────

  const linkedSessionIds = project.sources.map((s) => s.inventoryId);

  const handleRemoveSource = useCallback(
    async (inventoryId: string, confirmLastSource: boolean) => {
      if (removeBusyId) return;
      setSourceError(null);
      setRemoveBusyId(inventoryId);
      try {
        await callRemoveProjectSource({
          requestId: crypto.randomUUID(),
          projectId: project.id,
          projectSourceId: inventoryId,
          confirmLastSource,
        });
        setConfirmRemoveId(null);
      } catch (err: unknown) {
        if (
          isContractError(err) &&
          err.code === 'lifecycle.last_confirmed_source' &&
          !confirmLastSource
        ) {
          setConfirmRemoveId(inventoryId);
        } else {
          setConfirmRemoveId(null);
          setSourceError(errMessage(err));
        }
      } finally {
        setRemoveBusyId(null);
      }
    },
    [removeBusyId, project.id],
  );

  const handleAddSources = useCallback(async () => {
    if (addBusy || addSelection.length === 0) return;
    // Defensive: drop anything that landed in a previous partial attempt
    // (re-derived from the latest project prop, not mutated mid-loop) so a
    // retry after a failure doesn't re-request an already-linked session.
    const idsToAdd = addSelection.filter(
      (id) => !linkedSessionIds.includes(id),
    );
    if (idsToAdd.length === 0) {
      setShowAddSources(false);
      setAddSelection([]);
      return;
    }
    setAddError(null);
    setAddBusy(true);
    try {
      for (const inventorySessionId of idsToAdd) {
        // eslint-disable-next-line no-await-in-loop -- the backend links one
        // session per call; sources must be added sequentially.
        await callAddProjectSource({
          requestId: crypto.randomUUID(),
          projectId: project.id,
          inventorySessionId,
        });
      }
      setShowAddSources(false);
      setAddSelection([]);
    } catch (err: unknown) {
      setAddError(errMessage(err));
    } finally {
      setAddBusy(false);
    }
  }, [addBusy, addSelection, linkedSessionIds, project.id]);

  return (
    <div
      className="pv-edit-project-pane"
      aria-label={m.projects_edit_pane_aria()}
    >
      {/* Channel drift banner (US1c / US4) */}
      {project.channelDrift?.hasNewSources && (
        <Banner variant="warn" role="status" aria-live="polite">
          <span>{m.projects_edit_drift_banner()}</span>
          <div className="pv-edit-project__drift-actions">
            <Btn
              size="sm"
              variant="primary"
              onClick={handleReinfer}
              disabled={channelWorking}
            >
              {m.projects_detail_reinfer_btn()}
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={handleDismissDrift}
              disabled={channelWorking}
            >
              {m.projects_detail_dismiss_btn()}
            </Btn>
          </div>
        </Banner>
      )}

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
      <div className="pv-edit-project__sources-panel">
        <span className="pv-field-label">{m.common_sources()}</span>
        <div className="pv-edit-project__sources">
          {project.sources.length === 0 ? (
            <span className="pv-field-hint">{m.projects_sources_empty()}</span>
          ) : (
            <ul className="pv-edit-project__sources-list">
              {project.sources.map((src) => (
                <li
                  key={src.inventoryId}
                  className="pv-edit-project__source-row"
                >
                  <span className="pv-edit-project__source-name">
                    {src.name ||
                      sessionNames.get(src.inventoryId) ||
                      src.inventoryId}
                  </span>
                  {confirmRemoveId === src.inventoryId ? (
                    <span className="pv-edit-project__source-confirm">
                      <span className="pv-field-hint">
                        {m.err_lifecycle_last_confirmed_source()}
                      </span>
                      <Btn
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          handleRemoveSource(src.inventoryId, true)
                        }
                        disabled={removeBusyId !== null}
                      >
                        {removeBusyId === src.inventoryId
                          ? m.common_working()
                          : m.common_confirm()}
                      </Btn>
                      <Btn
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmRemoveId(null)}
                        disabled={removeBusyId !== null}
                      >
                        {m.common_cancel()}
                      </Btn>
                    </span>
                  ) : (
                    <Btn
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveSource(src.inventoryId, false)}
                      disabled={
                        readOnly || sourceRemoveLocked || removeBusyId !== null
                      }
                    >
                      {removeBusyId === src.inventoryId
                        ? m.common_working()
                        : m.common_remove()}
                    </Btn>
                  )}
                </li>
              ))}
            </ul>
          )}

          {sourceError && (
            <span role="alert" className="pv-field-error">
              {sourceError}
            </span>
          )}

          {!readOnly &&
            (showAddSources ? (
              <div className="pv-edit-project__add-sources">
                <SessionSourcePicker
                  selectedSessionIds={addSelection}
                  onChange={setAddSelection}
                  excludeSessionIds={linkedSessionIds}
                  emptyMessage={m.projects_edit_sources_add_empty()}
                />
                {addError && (
                  <span role="alert" className="pv-field-error">
                    {addError}
                  </span>
                )}
                <div className="pv-edit-project__add-sources-actions">
                  <Btn
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowAddSources(false);
                      setAddSelection([]);
                      setAddError(null);
                    }}
                    disabled={addBusy}
                  >
                    {m.common_cancel()}
                  </Btn>
                  <Btn
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={handleAddSources}
                    disabled={addBusy || addSelection.length === 0}
                  >
                    {addBusy
                      ? m.common_adding()
                      : m.projects_edit_sources_add_selected_btn({
                          count: String(addSelection.length),
                        })}
                  </Btn>
                </div>
              </div>
            ) : (
              <Btn
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowAddSources(true)}
                data-testid="edit-project-add-sources-toggle"
              >
                {m.projects_edit_sources_add_btn()}
              </Btn>
            ))}
        </div>
      </div>

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

// ── Error mapping ─────────────────────────────────────────────────────────────
// `projects.update` codes intentionally keep edit-specific wording where it is
// clearer than the shared catalog (e.g. "This project is archived and cannot
// be edited." vs. the generic "This item is read-only"); any other known code
// falls through to the shared errors.ts catalog before the generic fallback,
// so consolidation doesn't regress coverage for codes this switch never named.

function mapUpdateError(code: string): string {
  switch (code) {
    case 'project.not_found':
      return m.projects_edit_err_not_found();
    case 'name.empty':
      return m.projects_edit_err_name_empty();
    case 'name.too_long':
      return m.projects_edit_err_name_too_long();
    case 'name.duplicate':
      return m.projects_create_name_duplicate();
    case 'tool.unknown':
      return m.projects_edit_err_tool_unknown();
    case 'tool.locked':
      return m.projects_edit_err_tool_locked();
    case 'lifecycle.read_only':
      return m.projects_edit_err_read_only();
    case 'no_op':
      return m.projects_edit_err_no_op();
    default: {
      const resolve = ERROR_MESSAGES[code as ErrorCode] as
        | (() => string)
        | undefined;
      return resolve ? resolve() : m.projects_edit_err_generic();
    }
  }
}
