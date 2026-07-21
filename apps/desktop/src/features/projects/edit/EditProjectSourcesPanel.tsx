// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sources panel for EditProjectPane (WP-008-C, extracted #1000).
 *
 * Current sources are listed with a per-row remove affordance; a "Add
 * sources" toggle reveals the shared `SessionSourcePicker` (the same
 * component the creation wizard uses), filtered to sessions not already
 * linked to this project.
 */

import { m } from '@/lib/i18n';
import { Btn } from '@/ui';
import { SessionSourcePicker } from '@/features/projects/SessionSourcePicker';
import type { ProjectSourceDto } from '@/bindings/index';

export interface EditProjectSourcesPanelProps {
  sources: ProjectSourceDto[];
  sessionNames: Map<string, string>;
  readOnly: boolean;
  sourceRemoveLocked: boolean;
  linkedSessionIds: string[];
  sourceError: string | null;
  removeBusyId: string | null;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  onRemoveSource: (inventoryId: string, confirmLastSource: boolean) => void;
  showAddSources: boolean;
  setShowAddSources: (show: boolean) => void;
  addSelection: string[];
  setAddSelection: (ids: string[]) => void;
  addError: string | null;
  setAddError: (error: string | null) => void;
  addBusy: boolean;
  onAddSources: () => void;
}

export function EditProjectSourcesPanel({
  sources,
  sessionNames,
  readOnly,
  sourceRemoveLocked,
  linkedSessionIds,
  sourceError,
  removeBusyId,
  confirmRemoveId,
  setConfirmRemoveId,
  onRemoveSource,
  showAddSources,
  setShowAddSources,
  addSelection,
  setAddSelection,
  addError,
  setAddError,
  addBusy,
  onAddSources,
}: EditProjectSourcesPanelProps) {
  return (
    <div className="pv-edit-project__sources-panel">
      <span className="pv-field-label">{m.common_sources()}</span>
      <div className="pv-edit-project__sources">
        {sources.length === 0 ? (
          <span className="pv-field-hint">{m.projects_sources_empty()}</span>
        ) : (
          <ul className="pv-edit-project__sources-list">
            {sources.map((src) => (
              <li key={src.inventoryId} className="pv-edit-project__source-row">
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
                      variant="destructive"
                      onClick={() => onRemoveSource(src.inventoryId, true)}
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
                    onClick={() => onRemoveSource(src.inventoryId, false)}
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
                  onClick={onAddSources}
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
  );
}
