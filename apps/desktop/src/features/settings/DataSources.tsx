// spec 003 (roots/sources) — wired to real backend via listRoots/registerRoot.
// Redesigned to match platevault-settings-menu.html data pane (authoritative mock).
import { useState, useEffect, useCallback } from 'react';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import {
  listRoots,
  registerRoot,
  rescanRoot,
  reconcileRoot,
  setRootActive,
  deleteRoot,
  settingsSourceOverrideSet,
  settingsOverridableKeys,
} from './settingsIpc';
import type { LibraryRoot } from '@/bindings/types';
import type { RootCategory } from '@/bindings/index';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';
import { queryClient } from '@/data/queryClient';
import { queryKeys } from '@/data/queryKeys';
import { useInvalidateInventory } from '@/features/sessions/store';
import { SettingsSection, RestoreDefaultsBtn } from './SettingsKit';
import { SourceProtectionOverride } from './SourceProtectionOverride';
import { RemapRootDialog } from './RemapRootDialog';
import { ConfirmOverlay } from '@/components';
import { RootDetectionConfig } from '@/features/inventory/RootDetectionConfig';

const SOURCES_KEYS = [
  'followSymlinks',
  'hashOnScan',
  'alwaysPreviewBeforePlan',
];

// Fallback list used before the backend responds or if the call fails.
const OVERRIDABLE_KEYS_FALLBACK = ['hashOnScan', 'followSymlinks'] as const;
type OverridableKey = string;

interface DataSourcesProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

/** Display order and labels for category groups (matches mock: Raw / Calibration / Project / Inbox). */
const CATEGORY_ORDER: RootCategory[] = [
  'raw',
  'calibration',
  'project',
  'inbox',
];

/** Render-time factory (spec 046 #8b) so category labels re-read the active locale. */
function categoryLabel(category: RootCategory): string {
  switch (category) {
    case 'raw':
      return m.settings_datasources_category_raw();
    case 'calibration':
      return m.settings_datasources_category_calibration();
    case 'project':
      return m.settings_datasources_category_project();
    case 'inbox':
      return m.settings_datasources_category_inbox();
  }
}

export function DataSources({ save: _save }: DataSourcesProps) {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const invalidateInventory = useInvalidateInventory();

  const [showAdd, setShowAdd] = useState(false);
  const [addingPath, setAddingPath] = useState('');
  const [addingCategory, setAddingCategory] = useState<RootCategory>('raw');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ── Rescan (P6a) ──────────────────────────────────────────────────────────
  const [rescanningId, setRescanningId] = useState<string | null>(null);

  // ── Reconcile (spec 048 T022) ─────────────────────────────────────────────
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  // ── Remap dialog (P6a) ────────────────────────────────────────────────────
  const [remapRoot, setRemapRoot] = useState<LibraryRoot | null>(null);

  // ── Disable/Enable (P6b) ──────────────────────────────────────────────────
  const [disableTarget, setDisableTarget] = useState<LibraryRoot | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);
  const [toggleActiveError, setToggleActiveError] = useState<string | null>(
    null,
  );

  // ── Delete (P6b) ───────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<LibraryRoot | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Overridable keys — fetched from backend (T025) ──────────────────────────
  const [overridableKeys, setOverridableKeys] = useState<string[]>([
    ...OVERRIDABLE_KEYS_FALLBACK,
  ]);

  useEffect(() => {
    settingsOverridableKeys()
      .then(setOverridableKeys)
      .catch(() => {
        // Keep fallback list on failure.
      });
  }, []);

  // ── Per-source override (T025) ────────────────────────────────────────────
  const [overrideSourceId, setOverrideSourceId] = useState('');
  const [overrideKey, setOverrideKey] = useState<OverridableKey>('hashOnScan');
  const [overrideValue, setOverrideValue] = useState('true');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideApplying, setOverrideApplying] = useState(false);

  const handleOverrideApply = async () => {
    if (!overrideSourceId) return;
    setOverrideApplying(true);
    setOverrideError(null);
    try {
      // Value arrives as string from the text input; cast to boolean when the
      // key is a known boolean flag, otherwise pass as string.
      const coerced: unknown =
        overrideValue === 'true'
          ? true
          : overrideValue === 'false'
            ? false
            : overrideValue;
      await settingsSourceOverrideSet({
        sourceId: overrideSourceId,
        key: overrideKey,
        value: coerced,
      });
    } catch (err: unknown) {
      setOverrideError(errMessage(err));
    } finally {
      setOverrideApplying(false);
    }
  };

  const loadRoots = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listRoots()
      .then((data) => setRoots(data))
      .catch((err: unknown) => setLoadError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRoots();
  }, [loadRoots]);

  const handleAdd = async () => {
    if (!addingPath.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await registerRoot({
        path: addingPath.trim(),
        category: addingCategory,
        scanSettings: {},
      });
      setAddingPath('');
      setAddingCategory('raw');
      setShowAdd(false);
      loadRoots();
    } catch (err: unknown) {
      setAddError(errMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const handleRescan = async (root: LibraryRoot) => {
    setRescanningId(root.id);
    try {
      await rescanRoot({ rootId: root.id, rootAbsolutePath: root.path });
      // Real scan has already completed — reload immediately (no guess-delay).
      loadRoots();
    } catch (err: unknown) {
      console.error('Rescan failed:', errMessage(err));
    } finally {
      setRescanningId(null);
    }
  };

  // Per-frame reconcile (missing/recovered/size-backfill) only applies to
  // raw/calibration roots — those are the categories `file_record` rows are
  // populated for (light + calibration frame apply). The command exists on
  // `commands.inventoryReconcileRun` but had zero frontend callers before this
  // (`git grep -rl inventoryReconcileRun apps/desktop/src` matched only the
  // generated bindings) — session/inventory frame counts could only refresh
  // by waiting out the 30s default query `staleTime`. Two independent readers
  // need invalidating: `sessions.all()` backs `SessionSourcePicker` (real-UI
  // journey evidence: its frame count goes stale after reconcile) and the
  // inventory prefix backs the Sessions/Inventory page's own query
  // (`useInventorySources`, `sessions/store.ts`) via the shared
  // `useInvalidateInventory()` hook.
  const handleReconcile = async (root: LibraryRoot) => {
    setReconcilingId(root.id);
    setReconcileError(null);
    try {
      await reconcileRoot({ rootId: root.id });
      invalidateInventory();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.all(),
      });
      loadRoots();
    } catch (err: unknown) {
      setReconcileError(errMessage(err));
    } finally {
      setReconcilingId(null);
    }
  };

  // ── Disable/Enable (P6b) ──────────────────────────────────────────────────
  //
  // Disabling stops the root from being scanned/ingested but keeps its full
  // history intact, so it is gated by a lightweight confirm. Re-enabling is
  // restorative (non-destructive) and applies immediately, no confirm needed.
  const requestToggleActive = (root: LibraryRoot) => {
    if (root.active) {
      setToggleActiveError(null);
      setDisableTarget(root);
    } else {
      void applyToggleActive(root, true);
    }
  };

  const applyToggleActive = async (root: LibraryRoot, active: boolean) => {
    setTogglingActiveId(root.id);
    setToggleActiveError(null);
    try {
      await setRootActive({ rootId: root.id, active });
      loadRoots();
    } catch (err: unknown) {
      setToggleActiveError(errMessage(err));
    } finally {
      setTogglingActiveId(null);
    }
  };

  const handleConfirmDisable = async () => {
    if (!disableTarget) return;
    await applyToggleActive(disableTarget, false);
    setDisableTarget(null);
  };

  // ── Delete (P6b, decision D8) ─────────────────────────────────────────────
  //
  // Blocks server-side when dependent records exist (root.has_dependents);
  // the block reason is surfaced in the confirm dialog rather than closing it.
  const requestDelete = (root: LibraryRoot) => {
    setDeleteError(null);
    setDeleteTarget(root);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setDeleteError(null);
    try {
      await deleteRoot({ rootId: deleteTarget.id });
      setDeleteTarget(null);
      loadRoots();
    } catch (err: unknown) {
      setDeleteError(errMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  // Group roots by category, preserving display order
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    roots: roots.filter((r) => r.category === cat),
  })).filter((g) => g.roots.length > 0);

  return (
    <>
      <SettingsSection
        title={m.common_sources()}
        action={
          <div className="alm-datasources__action-row">
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
          <div className="alm-data-sources__add-form">
            <DirPicker
              value={addingPath}
              onChange={setAddingPath}
              label={m.settings_datasources_folder_label()}
              lastPathKind="inbox"
            />
            <div className="alm-data-sources__add-controls">
              <select
                className="alm-select"
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
              <div className="alm-data-sources__add-error">{addError}</div>
            )}
          </div>
        )}

        {loading && (
          <div className="alm-data-sources__status">{m.common_loading()}</div>
        )}

        {loadError && (
          <div className="alm-data-sources__load-error">
            {m.settings_datasources_load_error({ error: loadError })}
          </div>
        )}

        {!loading && !loadError && roots.length === 0 && (
          <div className="alm-data-sources__status">
            {m.settings_datasources_empty()}
          </div>
        )}

        {reconcileError && (
          <div className="alm-data-sources__add-error">
            {m.settings_datasources_reconcile_error({ error: reconcileError })}
          </div>
        )}

        {grouped.map(({ category, roots: groupRoots }) => (
          <div key={category} className="alm-data-sources__group">
            <h4 className="alm-data-sources__group-label">
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
          <span className="alm-field-error">{toggleActiveError}</span>
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
        {deleteError && <span className="alm-field-error">{deleteError}</span>}
      </ConfirmOverlay>

      {/* Per-source setting override (spec 018 T025) */}
      {roots.length > 0 && (
        <div
          className="alm-settings__group"
          data-testid="source-override-panel"
        >
          <div className="alm-settings__group-title">
            {m.settings_datasources_source_override_title()}
          </div>
          <div className="alm-settings__row">
            <div className="alm-settings__row-label">
              {m.settings_datasources_source_override_source_aria()}
            </div>
            <div className="alm-settings__row-content">
              <select
                className="alm-select"
                value={overrideSourceId}
                onChange={(e) => setOverrideSourceId(e.target.value)}
                aria-label={m.settings_datasources_source_override_source_aria()}
              >
                <option value="">
                  {m.settings_datasources_select_source()}
                </option>
                {roots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.path}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="alm-settings__row">
            <div className="alm-settings__row-label">
              {m.settings_datasources_source_override_key_aria()}
            </div>
            <div className="alm-settings__row-content">
              <select
                className="alm-select"
                value={overrideKey}
                onChange={(e) => setOverrideKey(e.target.value)}
                aria-label={m.settings_datasources_source_override_key_aria()}
              >
                {overridableKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="alm-settings__row">
            <div className="alm-settings__row-label">
              {m.settings_datasources_source_override_value_aria()}
            </div>
            <div className="alm-settings__row-content">
              <select
                className="alm-select"
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                aria-label={m.settings_datasources_source_override_value_aria()}
              >
                <option value="true">{m.common_true()}</option>
                <option value="false">{m.common_false()}</option>
              </select>
            </div>
          </div>
          {overrideError && (
            <div className="alm-data-sources__add-error">
              {m.settings_datasources_source_override_error({
                error: overrideError,
              })}
            </div>
          )}
          <div className="alm-settings__row">
            <div className="alm-settings__row-label" />
            <div className="alm-settings__row-content">
              <Btn
                size="sm"
                onClick={() => void handleOverrideApply()}
                disabled={!overrideSourceId || overrideApplying}
              >
                {m.settings_datasources_source_override_apply()}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Per-root card ─────────────────────────────────────────────────────────────

// Categories `file_record` rows are populated for (spec 048) — the only
// roots a reconcile pass has anything to diff against.
const RECONCILABLE_CATEGORIES: RootCategory[] = ['raw', 'calibration'];

interface RootCardProps {
  root: LibraryRoot;
  onRescan: (root: LibraryRoot) => void;
  rescanning: boolean;
  onReconcile: (root: LibraryRoot) => void;
  reconciling: boolean;
  onRemap: (root: LibraryRoot) => void;
  onToggleActive: (root: LibraryRoot) => void;
  togglingActive: boolean;
  onDelete: (root: LibraryRoot) => void;
  deleting: boolean;
}

function RootCard({
  root,
  onRescan,
  rescanning,
  onReconcile,
  reconciling,
  onRemap,
  onToggleActive,
  togglingActive,
  onDelete,
  deleting,
}: RootCardProps) {
  const isOffline = !root.online;

  const metaParts: string[] = [];
  if (root.fileCount != null && root.fileCount > 0) {
    metaParts.push(
      m.data_sources_file_count({
        count: root.fileCount,
        formatted: root.fileCount.toLocaleString(),
      }),
    );
  }
  if (root.lastScanned) {
    metaParts.push(m.settings_datasources_scanned({ date: root.lastScanned }));
  }
  const meta = metaParts.join(' · ');

  return (
    <div
      className={
        'alm-data-sources__root-card' +
        (isOffline ? ' alm-data-sources__root-card--offline' : '') +
        (root.active ? '' : ' alm-data-sources__root-card--disabled')
      }
    >
      {/* Left: path + offline/disabled pills + meta */}
      <div className="alm-data-sources__root-info">
        <div className="alm-data-sources__root-path-row">
          <code className="alm-mono alm-data-sources__root-path">
            {root.path}
          </code>
          {isOffline && (
            <Pill variant="warn" className="alm-data-sources__offline-pill">
              {m.nav_roots_offline_suffix()}
            </Pill>
          )}
          {!root.active && (
            <Pill variant="neutral" className="alm-data-sources__disabled-pill">
              {m.settings_datasources_disabled_pill()}
            </Pill>
          )}
        </div>
        {meta && <div className="alm-data-sources__root-meta">{meta}</div>}
        <SourceProtectionOverride sourceId={root.id} />
        {/* spec 048 US4: per-root detection config only applies to roots that
            carry `file_record` rows (raw/calibration). */}
        {RECONCILABLE_CATEGORIES.includes(root.category) && (
          <RootDetectionConfig rootId={root.id} />
        )}
      </div>

      {/* Right: action buttons */}
      <div className="alm-data-sources__root-actions">
        {!isOffline && (
          <Btn size="sm" onClick={() => onRescan(root)} disabled={rescanning}>
            {rescanning ? m.common_rescanning() : m.common_rescan()}
          </Btn>
        )}
        {!isOffline && RECONCILABLE_CATEGORIES.includes(root.category) && (
          <Btn
            size="sm"
            onClick={() => onReconcile(root)}
            disabled={reconciling}
          >
            {reconciling ? m.common_reconciling() : m.common_reconcile()}
          </Btn>
        )}
        {!isOffline && (
          <Btn
            size="sm"
            onClick={() => onToggleActive(root)}
            disabled={togglingActive}
          >
            {root.active
              ? togglingActive
                ? m.common_disabling()
                : m.settings_datasources_disable()
              : togglingActive
                ? m.common_enabling()
                : m.settings_datasources_enable()}
          </Btn>
        )}
        <Btn size="sm" onClick={() => onRemap(root)}>
          {m.settings_datasources_remap()}
        </Btn>
        {isOffline && (
          <Btn
            size="sm"
            variant="danger"
            onClick={() => onDelete(root)}
            disabled={deleting}
          >
            {deleting ? m.common_deleting() : m.settings_datasources_delete()}
          </Btn>
        )}
      </div>
    </div>
  );
}
