// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
// Redesigned to match platevault-settings-menu.html data pane (authoritative mock).
//
// Issue #562: per-source actions consolidated into a kebab (⋯) menu and the
// card decluttered — one path/pill/kebab row + one humanized meta row. The
// former detached bottom "Per-source setting override" panel (source picker +
// key/value selects covering followSymlinks/hashOnScan/defaultProtection) is
// folded into each card's contextual "Edit protection…" panel. Issue #563:
// that bottom panel let `defaultProtection` be set through a second write
// path (`settings.source_override.set`) that `source.protection.get` never
// reads back — a real dual-source-of-truth. Removing it and routing
// protection level exclusively through `SourceProtectionOverride`
// (`source.protection.set`/`get`) removes that inconsistency at the root.
//
// Issue #623/#646: the remaining scan-behavior override widget
// (`followSymlinks`/`hashOnScan`) duplicated the canonical `IngestionSettings`
// document (Settings → Ingestion) and could never succeed for `hashOnScan`
// (needs a string; the widget only ever offered a boolean). Both keys were
// retired from the overridable set (`descriptors.rs`) — with `defaultProtection`
// already excluded above, there is nothing left to render here, so the whole
// contextual scan-override panel is removed rather than kept as always-empty
// dead code.
import { Btn } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import type { RootCategory } from '@/bindings/index';
import { m } from '@/lib/i18n';
import { SettingsSection, RestoreDefaultsBtn } from './SettingsKit';
import { RemapRootDialog } from './RemapRootDialog';
import { ConfirmOverlay } from '@/components';
import { categoryLabel, SOURCES_KEYS } from './datasources-model';
import { RootCard } from './RootCard';
import { useDataSources } from './useDataSources';

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function DataSources({ save: _save }: DataSourcesProps) {
  const {
    roots,
    loading,
    loadError,
    grouped,

    showAdd,
    setShowAdd,
    addingPath,
    setAddingPath,
    addingCategory,
    setAddingCategory,
    addError,
    setAddError,
    adding,
    handleAdd,

    loadRoots,

    rescanningId,
    handleRescan,

    reconcilingId,
    reconcileError,
    handleReconcile,

    remapRoot,
    setRemapRoot,

    disableTarget,
    setDisableTarget,
    togglingActiveId,
    toggleActiveError,
    setToggleActiveError,
    requestToggleActive,
    handleConfirmDisable,

    deleteTarget,
    setDeleteTarget,
    deletingId,
    deleteError,
    setDeleteError,
    requestDelete,
    handleConfirmDelete,
  } = useDataSources();

  return (
    <>
      <SettingsSection
        title={m.common_sources()}
        action={
          <div className="pv-datasources__action-row">
            <RestoreDefaultsBtn
              scope="sources"
              keys={SOURCES_KEYS}
              onRestored={() => {
                /* sources pane has no controlled inputs to re-hydrate */
              }}
            />
            <Btn
              variant="primary"
              size="sm"
              onClick={() => {
                setShowAdd(true);
                setAddError(null);
              }}
            >
              {m.settings_datasources_add_btn()}
            </Btn>
          </div>
        }
      >
        {showAdd && (
          <div className="pv-data-sources__add-form">
            <DirPicker
              value={addingPath}
              onChange={setAddingPath}
              label={m.settings_datasources_folder_label()}
              lastPathKind="inbox"
            />
            <div className="pv-data-sources__add-controls">
              <select
                className="pv-select"
                value={addingCategory}
                onChange={(e) =>
                  setAddingCategory(e.target.value as RootCategory)
                }
                aria-label={m.settings_datasources_category_aria()}
              >
                <option value="raw">
                  {m.settings_datasources_category_raw()}
                </option>
                <option value="calibration">
                  {m.settings_datasources_category_calibration()}
                </option>
                <option value="project">
                  {m.settings_datasources_category_project()}
                </option>
                <option value="inbox">
                  {m.settings_datasources_category_inbox()}
                </option>
              </select>
              <Btn
                size="sm"
                onClick={handleAdd}
                disabled={!addingPath.trim() || adding}
              >
                {adding ? m.common_adding() : m.common_add()}
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAdd(false);
                  setAddError(null);
                  setAddingPath('');
                }}
              >
                {m.common_cancel()}
              </Btn>
            </div>
            {addError && (
              <div className="pv-data-sources__add-error">{addError}</div>
            )}
          </div>
        )}

        {loading && (
          <div className="pv-data-sources__status">{m.common_loading()}</div>
        )}

        {loadError && (
          <div className="pv-data-sources__load-error">
            {m.settings_datasources_load_error({ error: loadError })}
          </div>
        )}

        {!loading && !loadError && roots.length === 0 && (
          <div className="pv-data-sources__status">
            {m.settings_datasources_empty()}
          </div>
        )}

        {reconcileError && (
          <div className="pv-data-sources__add-error">
            {m.settings_datasources_reconcile_error({ error: reconcileError })}
          </div>
        )}

        {grouped.map(({ category, roots: groupRoots }) => (
          <div key={category} className="pv-data-sources__group">
            <h4 className="pv-data-sources__group-label">
              {categoryLabel(category)}
            </h4>
            {groupRoots.map((root) => (
              <RootCard
                key={root.id}
                root={root}
                onRescan={handleRescan}
                rescanning={rescanningId === root.id}
                onReconcile={handleReconcile}
                reconciling={reconcilingId === root.id}
                onRemap={setRemapRoot}
                onToggleActive={requestToggleActive}
                togglingActive={togglingActiveId === root.id}
                onDelete={requestDelete}
                deleting={deletingId === root.id}
              />
            ))}
          </div>
        ))}
      </SettingsSection>

      <RemapRootDialog
        root={remapRoot}
        onClose={() => setRemapRoot(null)}
        onApplied={loadRoots}
      />

      {/* Disable confirm (P6b) — re-enable applies immediately, no confirm needed. */}
      <ConfirmOverlay
        open={disableTarget != null}
        onClose={() => {
          if (togglingActiveId) return;
          setDisableTarget(null);
          setToggleActiveError(null);
        }}
        onConfirm={() => void handleConfirmDisable()}
        title={m.settings_datasources_disable_confirm_title()}
        description={m.settings_datasources_disable_confirm_desc()}
        confirmLabel={
          togglingActiveId
            ? m.common_disabling()
            : m.settings_datasources_disable()
        }
        confirmVariant="danger"
      >
        {toggleActiveError && (
          <span className="pv-field-error">{toggleActiveError}</span>
        )}
      </ConfirmOverlay>

      {/* Delete confirm (P6b, decision D8) — surfaces the block reason inline
        (e.g. root.has_dependents) instead of closing the dialog on failure. */}
      <ConfirmOverlay
        open={deleteTarget != null}
        onClose={() => {
          if (deletingId) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
        title={m.settings_datasources_delete_confirm_title()}
        description={m.settings_datasources_delete_confirm_desc({
          path: deleteTarget?.path ?? '',
        })}
        confirmLabel={
          deletingId ? m.common_deleting() : m.settings_datasources_delete()
        }
        confirmVariant="danger"
      >
        {deleteError && <span className="pv-field-error">{deleteError}</span>}
      </ConfirmOverlay>
    </>
  );
}
