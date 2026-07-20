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
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMountedRef } from '@/hooks/useMountedRef';
import { Btn, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { formatDistanceToNow } from 'date-fns';
import {
  listRoots,
  registerRoot,
  rescanRoot,
  reconcileRoot,
  setRootActive,
  deleteRoot,
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
import { Modal } from '@/components';
import { RootDetectionConfig } from '@/features/inventory/RootDetectionConfig';
import { revealInOs } from '@/shared/native/reveal';
import { revealLabel } from '@/lib/reveal-label';
import { addToast } from '@/shared/toast';

// Issue #623: followSymlinks/hashOnScan removed — retired from the
// overridable/scan-behavior duplicate (see the module doc comment above);
// resetting them here reset invisible keys with no control on this pane.
const SOURCES_KEYS = ['alwaysPreviewBeforePlan'];

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

  // `loadRoots` is re-invoked on user actions (add/delete/toggle), not just on
  // mount, so a per-effect `cancelled` flag cannot reach it. A mounted ref is
  // the guard that covers every call site.
  const mountedRef = useMountedRef();

  const loadRoots = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listRoots()
      .then((data) => {
        if (mountedRef.current) setRoots(data);
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setLoadError(errMessage(err));
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
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

  const closeDisableConfirm = () => {
    if (togglingActiveId) return;
    setDisableTarget(null);
    setToggleActiveError(null);
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

  const closeDeleteConfirm = () => {
    if (deletingId) return;
    setDeleteTarget(null);
    setDeleteError(null);
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

      {/* Disable confirm (P6b) — re-enable applies immediately, no confirm needed.
          Disabling is reversible (re-enable is one click, no data is removed),
          so this stays on `danger`, not `destructive` (handoff 06). */}
      <Modal
        open={disableTarget != null}
        onClose={closeDisableConfirm}
        title={m.settings_datasources_disable_confirm_title()}
        size="sm"
        hideClose
        footer={
          <>
            <Btn variant="ghost" onClick={closeDisableConfirm}>
              {m.common_cancel()}
            </Btn>
            <Btn variant="danger" onClick={() => void handleConfirmDisable()}>
              {togglingActiveId
                ? m.common_disabling()
                : m.settings_datasources_disable()}
            </Btn>
          </>
        }
      >
        <p className="pv-modal__message">
          {m.settings_datasources_disable_confirm_desc()}
        </p>
        {toggleActiveError && (
          <span className="pv-field-error">{toggleActiveError}</span>
        )}
      </Modal>

      {/* Delete confirm (P6b, decision D8) — surfaces the block reason inline
        (e.g. root.has_dependents) instead of closing the dialog on failure. */}
      <Modal
        open={deleteTarget != null}
        onClose={closeDeleteConfirm}
        title={m.settings_datasources_delete_confirm_title()}
        size="sm"
        hideClose
        footer={
          <>
            <Btn variant="ghost" onClick={closeDeleteConfirm}>
              {m.common_cancel()}
            </Btn>
            <Btn
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
            >
              {deletingId
                ? m.common_deleting()
                : m.settings_datasources_delete()}
            </Btn>
          </>
        }
      >
        <p className="pv-modal__message">
          {m.settings_datasources_delete_confirm_desc({
            path: deleteTarget?.path ?? '',
          })}
        </p>
        {deleteError && <span className="pv-field-error">{deleteError}</span>}
      </Modal>
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [editProtectionOpen, setEditProtectionOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the kebab menu on outside click or Escape — standard menu UX; no
  // shared close-on-outside helper exists yet in this codebase (single
  // consumer today), so this stays a small inline effect rather than a new
  // abstraction (YAGNI).
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

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
    // Issue #562: humanize the raw ISO timestamp ("2 days ago" instead of
    // "2026-07-11T09:42:02.2555817Z"). Falls back to the raw value if the
    // stored timestamp somehow fails to parse.
    let humanized = root.lastScanned;
    try {
      humanized = formatDistanceToNow(new Date(root.lastScanned), {
        addSuffix: true,
      });
    } catch {
      // keep raw fallback
    }
    metaParts.push(m.settings_datasources_scanned({ date: humanized }));
  }
  const meta = metaParts.join(' · ');

  const handleReveal = async () => {
    setMenuOpen(false);
    try {
      await revealInOs(root.path, {
        entityKind: 'registered_source',
        entityId: root.id,
      });
    } catch (err: unknown) {
      addToast({
        message: typeof err === 'string' ? err : m.common_reveal_error(),
        variant: 'error',
      });
    }
  };

  return (
    <div
      className={
        'pv-data-sources__root-card' +
        (isOffline ? ' pv-data-sources__root-card--offline' : '') +
        (root.active ? '' : ' pv-data-sources__root-card--disabled')
      }
    >
      {/* Row 1: path + compact protection pill + offline/disabled pills.
          Row 2: humanized meta line. */}
      <div className="pv-data-sources__root-info">
        <div className="pv-data-sources__root-path-row">
          <code className="pv-mono pv-data-sources__root-path">
            {root.path}
          </code>
          <SourceProtectionOverride
            sourceId={root.id}
            open={editProtectionOpen}
            onOpenChange={setEditProtectionOpen}
          />
          {isOffline && (
            <Pill variant="warn" className="pv-data-sources__offline-pill">
              {m.nav_roots_offline_suffix()}
            </Pill>
          )}
          {!root.active && (
            <Pill variant="neutral" className="pv-data-sources__disabled-pill">
              {m.settings_datasources_disabled_pill()}
            </Pill>
          )}
        </div>
        {meta && <div className="pv-data-sources__root-meta">{meta}</div>}
        {/* spec 048 US4: per-root detection config only applies to roots that
            carry `file_record` rows (raw/calibration). */}
        {RECONCILABLE_CATEGORIES.includes(root.category) && (
          <RootDetectionConfig rootId={root.id} />
        )}
      </div>

      {/* Right: kebab (⋯) menu — issue #562 consolidates every per-source
          action here instead of a scattered button row. */}
      <div className="pv-data-sources__root-actions" ref={menuRef}>
        <Btn
          size="sm"
          variant="ghost"
          className="pv-data-sources__kebab-btn"
          aria-label={m.settings_datasources_actions_aria()}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </Btn>
        {menuOpen && (
          <div className="pv-data-sources__kebab-menu" role="menu">
            {!isOffline && (
              <button
                type="button"
                role="menuitem"
                className="pv-data-sources__kebab-item"
                disabled={rescanning}
                // Stays open while in flight (unlike the other items) so the
                // disabled/relabeled "Rescanning…" state remains visible —
                // a background action, not a navigation to a dialog/panel.
                onClick={() => onRescan(root)}
              >
                {rescanning ? m.common_rescanning() : m.common_rescan()}
              </button>
            )}
            {!isOffline && RECONCILABLE_CATEGORIES.includes(root.category) && (
              <button
                type="button"
                role="menuitem"
                className="pv-data-sources__kebab-item"
                data-testid={`reconcile-now-${root.id}`}
                disabled={reconciling}
                onClick={() => onReconcile(root)}
              >
                {reconciling ? m.common_reconciling() : m.common_reconcile()}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="pv-data-sources__kebab-item"
              onClick={() => {
                setMenuOpen(false);
                onRemap(root);
              }}
            >
              {m.settings_datasources_remap()}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pv-data-sources__kebab-item"
              onClick={() => {
                setMenuOpen(false);
                setEditProtectionOpen(true);
              }}
            >
              {m.settings_datasources_edit_protection()}
            </button>
            {!isOffline && (
              <button
                type="button"
                role="menuitem"
                className="pv-data-sources__kebab-item"
                disabled={togglingActive}
                onClick={() => {
                  setMenuOpen(false);
                  onToggleActive(root);
                }}
              >
                {root.active
                  ? togglingActive
                    ? m.common_disabling()
                    : m.settings_datasources_disable()
                  : togglingActive
                    ? m.common_enabling()
                    : m.settings_datasources_enable()}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="pv-data-sources__kebab-item"
              onClick={() => void handleReveal()}
            >
              {revealLabel()}
            </button>
            {/* #559: Delete was only reachable for offline roots before this
                fix — the backend already blocks it server-side when the
                source has dependents (has_dependents), surfaced in the
                confirm dialog below. */}
            <button
              type="button"
              role="menuitem"
              className="pv-data-sources__kebab-item pv-data-sources__kebab-item--danger"
              disabled={deleting}
              onClick={() => {
                setMenuOpen(false);
                onDelete(root);
              }}
            >
              {deleting ? m.common_deleting() : m.settings_datasources_delete()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
