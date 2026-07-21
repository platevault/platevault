// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * All stateful logic for the Data Sources pane: roots CRUD + rescan/reconcile/
 * remap/disable/delete — TanStack Query (issues #615/#630), replacing the
 * hand-rolled `useState`/`useEffect` fetch + manual `useMountedRef` guard that
 * preceded it. Query/mutation state supersedes the mounted-ref guard: updates
 * land in the query cache, not local component state, so there is nothing left
 * to guard against setting state on an unmounted component.
 */
import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { queryKeys } from '@/data/queryKeys';
import { useInvalidateInventory } from '@/features/sessions/store';
import { CATEGORY_ORDER } from './datasources-model';

export function useDataSources() {
  const queryClient = useQueryClient();
  const invalidateInventory = useInvalidateInventory();
  const invalidateRoots = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.roots.all() }),
    [queryClient],
  );

  const {
    data: rootsData,
    isFetching: loading,
    error: loadErrorRaw,
  } = useQuery({
    queryKey: queryKeys.roots.all(),
    queryFn: listRoots,
  });
  const roots = rootsData ?? [];
  const loadError = loadErrorRaw ? errMessage(loadErrorRaw) : null;

  const [showAdd, setShowAdd] = useState(false);
  const [addingPath, setAddingPath] = useState('');
  const [addingCategory, setAddingCategory] = useState<RootCategory>('raw');
  const [remapRoot, setRemapRoot] = useState<LibraryRoot | null>(null);

  // ── Add ────────────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (args: { path: string; category: RootCategory }) =>
      registerRoot({
        path: args.path,
        category: args.category,
        scanSettings: {},
      }),
    onSuccess: invalidateRoots,
  });
  const addError = addMutation.error ? errMessage(addMutation.error) : null;
  const clearAddError = () => addMutation.reset();

  const handleAdd = async () => {
    if (!addingPath.trim()) return;
    try {
      await addMutation.mutateAsync({
        path: addingPath.trim(),
        category: addingCategory,
      });
      setAddingPath('');
      setAddingCategory('raw');
      setShowAdd(false);
    } catch {
      // addError below surfaces the failure; form stays open for retry.
    }
  };

  // ── Rescan (P6a) ──────────────────────────────────────────────────────────
  const rescanMutation = useMutation({
    mutationFn: (args: { rootId: string; rootAbsolutePath: string }) =>
      rescanRoot(args),
    onSuccess: invalidateRoots,
  });
  const rescanningId = rescanMutation.isPending
    ? (rescanMutation.variables?.rootId ?? null)
    : null;

  const handleRescan = async (root: LibraryRoot) => {
    try {
      // Real scan has already completed — reload immediately (no guess-delay).
      await rescanMutation.mutateAsync({
        rootId: root.id,
        rootAbsolutePath: root.path,
      });
    } catch (err: unknown) {
      console.error('Rescan failed:', errMessage(err));
    }
  };

  // ── Reconcile (spec 048 T022) ─────────────────────────────────────────────
  //
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
  const reconcileMutation = useMutation({
    mutationFn: (args: { rootId: string }) => reconcileRoot(args),
    onSuccess: () => {
      invalidateInventory();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.all(),
      });
      void invalidateRoots();
    },
  });
  const reconcilingId = reconcileMutation.isPending
    ? (reconcileMutation.variables?.rootId ?? null)
    : null;
  const reconcileError = reconcileMutation.error
    ? errMessage(reconcileMutation.error)
    : null;

  const handleReconcile = async (root: LibraryRoot) => {
    try {
      await reconcileMutation.mutateAsync({ rootId: root.id });
    } catch (err: unknown) {
      console.error('Reconcile failed:', errMessage(err));
    }
  };

  // ── Disable/Enable (P6b) ──────────────────────────────────────────────────
  //
  // Disabling stops the root from being scanned/ingested but keeps its full
  // history intact, so it is gated by a lightweight confirm. Re-enabling is
  // restorative (non-destructive) and applies immediately, no confirm needed.
  const [disableTarget, setDisableTarget] = useState<LibraryRoot | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (args: { rootId: string; active: boolean }) =>
      setRootActive(args),
    onSuccess: invalidateRoots,
  });
  const togglingActiveId = toggleMutation.isPending
    ? (toggleMutation.variables?.rootId ?? null)
    : null;
  const toggleActiveError = toggleMutation.error
    ? errMessage(toggleMutation.error)
    : null;
  const clearToggleActiveError = () => toggleMutation.reset();

  const applyToggleActive = async (root: LibraryRoot, active: boolean) => {
    try {
      await toggleMutation.mutateAsync({ rootId: root.id, active });
    } catch {
      // toggleActiveError below would surface the failure, but
      // handleConfirmDisable closes the dialog unconditionally after confirm
      // (matching the prior behaviour), so it is never actually shown.
    }
  };

  const requestToggleActive = (root: LibraryRoot) => {
    if (root.active) {
      clearToggleActiveError();
      setDisableTarget(root);
    } else {
      void applyToggleActive(root, true);
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
  const [deleteTarget, setDeleteTarget] = useState<LibraryRoot | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (args: { rootId: string }) => deleteRoot(args),
    onSuccess: invalidateRoots,
  });
  const deletingId = deleteMutation.isPending
    ? (deleteMutation.variables?.rootId ?? null)
    : null;
  const deleteError = deleteMutation.error
    ? errMessage(deleteMutation.error)
    : null;
  const clearDeleteError = () => deleteMutation.reset();

  const requestDelete = (root: LibraryRoot) => {
    clearDeleteError();
    setDeleteTarget(root);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ rootId: deleteTarget.id });
      setDeleteTarget(null);
    } catch {
      // Dialog stays open; deleteError below surfaces the block reason
      // (e.g. root.has_dependents) instead of closing on failure.
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
    clearAddError,
    adding: addMutation.isPending,
    handleAdd,

    loadRoots: invalidateRoots,

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
    clearToggleActiveError,
    requestToggleActive,
    handleConfirmDisable,

    deleteTarget,
    setDeleteTarget,
    deletingId,
    deleteError,
    clearDeleteError,
    requestDelete,
    handleConfirmDelete,
  };
}
