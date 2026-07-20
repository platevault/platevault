// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/** All stateful logic for the Data Sources pane: roots CRUD + rescan/reconcile/remap/disable/delete. */
import { useCallback, useEffect, useState } from 'react';
import { useMountedRef } from '@/hooks/useMountedRef';
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
import { queryClient } from '@/data/queryClient';
import { queryKeys } from '@/data/queryKeys';
import { useInvalidateInventory } from '@/features/sessions/store';
import { CATEGORY_ORDER } from './datasources-model';

export function useDataSources() {
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
  // mount, so a per-effect `cancelled` flag cannot reach every call site. A
  // mounted ref covers all of them.
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
  }, [mountedRef]);

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

  return {
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
  };
}
