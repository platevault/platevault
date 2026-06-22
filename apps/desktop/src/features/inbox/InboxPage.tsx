/**
 * InboxPage — classify / confirm workflow on the shared list-page layout.
 *
 * spec 043 (tasks #73/#75/#76/#61): the Inbox adopts the same shared layout
 * system as Sessions — a pinned `PageTopBar` (search + group-by + sort +
 * frame-type filter via `FilterToolbar`, plus Confirm / Rescan page actions)
 * over a `ListPageLayout` body. The detections list (`InboxList`) is the
 * primary content; the per-detection detail (classification / frame-type
 * breakdown / file metadata) lives in the right-hand detail pane.
 *
 *   - #61: the stats strip (Folders / Masters / Images + per-type) is pinned in
 *     the always-visible top region (a second `.alm-page__bar` below the top
 *     bar) — it never scrolls out of view with the content.
 *   - #76: the planned-actions surface moves OUT of the old full-width docked
 *     bottom panel and INTO the detail pane: when an open plan exists (or a
 *     destination-root pick is pending) the `PlanPanel` renders below the
 *     per-detection detail in the pane, not as a full-width bottom strip.
 *   - #75: the plan summary collapses per-file rows by default and shows an
 *     aggregate per group derived from FRAME TYPE — see `PlanPanel` +
 *     `frameTypeByItemId` below.
 *
 * spec 039: the left list is a cross-root aggregate of all unacknowledged
 * items (inbox.list), grouped/labelled by their registered root.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ListPageLayout, PageTopBar, FilterToolbar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { addToast } from '@/shared/toast';
import { InboxList } from './InboxList';
import { InboxControls, useInboxControls } from './InboxControls';
import { InboxDetail } from './InboxDetail';
import {
  useInboxList,
  useInboxRescan,
  useInboxClassification,
  useInboxItemMetadata,
  useInboxConfirm,
  useInboxPlanApplyAll,
  useInboxPlanCancel,
  useOpenInboxPlans,
  useApplySelectedInboxPlans,
} from './store';
import { InboxStatsSummary } from './InboxStatsSummary';
import { deriveInboxStats } from './inboxStatsFromItems';
import { PlanPanel } from './PlanPanel';
import type { DestructiveDestination, PendingRootPick } from './PlanPanel';
import { normalizeConfirmError } from './store';
import type { InboxConfirmDestination } from '@/api/commands';
import type { FrameType } from '@/lib/route-contract';

/** Shape of `inbox.destination_root_required` error details (spec 041 US8/FR-029). */
interface DestinationRootRequiredDetails {
  category: string;
  candidates: Array<{ rootId: string; path: string; kind: string }>;
}

/** Type-guard for the destination-root-required details payload. */
function asRootRequiredDetails(d: unknown): DestinationRootRequiredDetails | null {
  if (d && typeof d === 'object' && 'candidates' in d && Array.isArray((d as { candidates: unknown }).candidates)) {
    return d as DestinationRootRequiredDetails;
  }
  return null;
}

export function InboxPage() {
  const { selected, type } = useSearch({ from: '/shell/inbox' });
  const navigate = useNavigate({ from: '/inbox' });

  // FR-001 / FR-002: cross-root aggregate list replaces the hardcoded scan.
  const { data: listData, loading: listLoading, refresh: refreshList } = useInboxList();
  const items = listData?.items ?? [];

  // Search + grouping / sort / frame-type controls now live in the top bar
  // (spec 043 #73/#31). `useInboxControls` owns the persisted ordered grouping
  // dimensions + sort; the frame-type filter stays URL-backed (`type`).
  const [search, setSearch] = useState('');
  const { dims, sortBy, setSortBy, setSlot } = useInboxControls();

  // spec 041: aggregate open-plan surface (all ingestions at once).
  const {
    data: openPlansData,
    refresh: refreshOpenPlans,
  } = useOpenInboxPlans();

  const openPlans = openPlansData?.plans ?? [];
  const totalActions = openPlansData?.totalActions ?? 0;

  // Refresh both the inbox list and the aggregate plan surface after any
  // apply/cancel/confirm mutation.
  const refreshAll = useCallback(() => {
    refreshList();
    refreshOpenPlans();
  }, [refreshList, refreshOpenPlans]);

  // Derive the unique roots from the current item list so rescan knows which
  // roots to ping (FR-005). Deduplicated by rootId.
  const roots = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ rootId: string; rootAbsolutePath: string }> = [];
    for (const item of items) {
      if (!seen.has(item.rootId)) {
        seen.add(item.rootId);
        result.push({ rootId: item.rootId, rootAbsolutePath: item.rootAbsolutePath });
      }
    }
    return result;
  }, [items]);

  const onRescanComplete = useCallback(() => refreshAll(), [refreshAll]);
  const { loading: rescanLoading, rescan } = useInboxRescan(roots, onRescanComplete);

  // FR-006: items are already bounded at 500 by the backend; surface a notice
  // when the cap is hit.
  const isCapped = listData?.capped ?? false;

  // Client-side text search across the relative path (the list's primary key).
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.relativePath.toLowerCase().includes(q) ||
        (it.groupTarget ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  // URL-backed selection is by index into the FILTERED list so it stays stable
  // across re-fetches and tracks what the user actually sees.
  const selectedItem = selected !== undefined ? filteredItems[selected] : undefined;

  useStaleSelectionCleanup(selected, selectedItem !== undefined, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (idx: number) =>
    navigate({ search: (prev) => ({ ...prev, selected: idx }) });

  const clearSelection = useCallback(
    () => navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
    [navigate],
  );

  // Each item carries its own root path — use it for classify / confirm calls.
  const selectedRootPath = selectedItem?.rootAbsolutePath ?? '';

  // Load classification for the selected item (no-op when nothing selected).
  const { data: classification } = useInboxClassification(
    selectedItem?.inboxItemId ?? '',
    selectedRootPath,
  );

  // Load per-file extracted metadata for the selected item (spec 041 US2/FR-010).
  const { data: fileMetadata } = useInboxItemMetadata(
    selectedItem?.inboxItemId ?? null,
  );

  const { confirm, loading: confirmLoading } = useInboxConfirm();
  // FR-032: destructive-destination choice, defaults to 'archive' (Constitution §II).
  // The literal 'archive' | 'trash' values are exactly what inbox.confirm accepts.
  const [destructiveDestination, setDestructiveDestination] =
    useState<DestructiveDestination>('archive');

  // spec 041 US8/FR-029: when a confirm needs the user to pick among multiple
  // candidate library roots, hold the prompt + the item it belongs to so the
  // PlanPanel can render the picker and we can re-confirm with the chosen root.
  const [pendingRootPick, setPendingRootPick] = useState<PendingRootPick | null>(null);
  const [rootPickItemId, setRootPickItemId] = useState<string | null>(null);

  // spec 041 US8/FR-031: absolute destination paths keyed by source path,
  // accumulated from each successful confirm's `destinations[]`. Lets the plan
  // panel show the full absolute destination per action.
  const [absoluteByFromPath, setAbsoluteByFromPath] = useState<Record<string, string>>({});

  // Drop a pending root pick when the user navigates away from its item, so a
  // stale picker never lingers under a different selection.
  const selectedItemId = selectedItem?.inboxItemId ?? null;
  useEffect(() => {
    if (rootPickItemId && rootPickItemId !== selectedItemId) {
      setPendingRootPick(null);
      setRootPickItemId(null);
    }
  }, [rootPickItemId, selectedItemId]);

  const mergeDestinations = useCallback((destinations?: InboxConfirmDestination[] | null) => {
    if (!destinations || destinations.length === 0) return;
    setAbsoluteByFromPath((prev) => {
      const next = { ...prev };
      for (const d of destinations) {
        next[d.fromPath] = d.toAbsolutePath;
      }
      return next;
    });
  }, []);

  const { applyAll, loading: applyAllLoading } = useInboxPlanApplyAll();
  const { applySelected, loading: applySelectedLoading } = useApplySelectedInboxPlans();
  const { cancel, loading: cancelLoading } = useInboxPlanCancel();

  /**
   * Confirm `item` (optionally targeting a caller-chosen destination `rootId`).
   * Centralises the success path and the structured-error handling so the
   * initial confirm and a re-confirm after a root pick share one code path.
   */
  const runConfirm = useCallback(
    async (
      item: { inboxItemId: string; rootAbsolutePath: string },
      contentSignature: string,
      action: string,
      rootId?: string,
    ) => {
      try {
        const result = await confirm({
          inboxItemId: item.inboxItemId,
          action,
          contentSignature,
          rootAbsolutePath: item.rootAbsolutePath,
          destructiveDestination,
          rootId: rootId ?? null,
        });
        // Success: clear any pending root pick and capture absolute destinations.
        setPendingRootPick(null);
        setRootPickItemId(null);
        mergeDestinations(result.destinations);
        // spec 041: masters now always return a plan too — every confirm produces
        // a reviewable plan that appears in the aggregate surface below.
        addToast({
          message: `Plan created (${result.itemsTotal} items). Review below before applying.`,
          variant: 'info',
        });
        refreshAll();
      } catch (e) {
        const { code, message, details } = normalizeConfirmError(e);
        if (code === 'inbox.destination_root_required') {
          // FR-029: multiple candidate roots — prompt the user to choose one.
          const parsed = asRootRequiredDetails(details);
          if (parsed) {
            setPendingRootPick({ category: parsed.category, candidates: parsed.candidates });
            setRootPickItemId(item.inboxItemId);
            addToast({
              message: 'Choose a destination library root to generate the plan.',
              variant: 'warn',
            });
            return;
          }
        }
        if (code === 'inbox.invalid_destination_root') {
          addToast({ message: message || 'That destination root is not valid.', variant: 'error' });
          return;
        }
        if (code === 'inbox.no_destination_root') {
          addToast({
            message: message || 'No library root is registered for this frame type.',
            variant: 'error',
          });
          return;
        }
        if (code === 'inbox.missing_path_attributes') {
          // FR-032 (US9): files lack a path-load-bearing attribute. The detail
          // panel already annotates each blocked file; point the user there.
          addToast({
            message:
              'Some files are missing required attributes. Assign the missing values in the file list, then confirm again.',
            variant: 'warn',
          });
          return;
        }
        if (message.includes('inbox.has.open.plan')) {
          addToast({ message: 'An open plan already exists for this item.', variant: 'warn' });
        } else if (message.includes('classification.stale')) {
          addToast({ message: 'Folder changed since classification — rescan to refresh.', variant: 'warn' });
        } else {
          addToast({ message: `Confirm failed: ${message}`, variant: 'error' });
        }
      }
    },
    [confirm, destructiveDestination, mergeDestinations, refreshAll],
  );

  const handleConfirm = async () => {
    if (!selectedItem || !classification) return;
    const action = classification.type === 'mixed' ? 'split' : 'confirm';
    await runConfirm(
      { inboxItemId: selectedItem.inboxItemId, rootAbsolutePath: selectedRootPath },
      classification.contentSignature,
      action,
    );
  };

  /** FR-029: re-confirm the pending item with the chosen destination root. */
  const handlePickDestinationRoot = async (rootId: string) => {
    if (!rootPickItemId || !selectedItem || !classification) return;
    if (selectedItem.inboxItemId !== rootPickItemId) return;
    const action = classification.type === 'mixed' ? 'split' : 'confirm';
    await runConfirm(
      { inboxItemId: selectedItem.inboxItemId, rootAbsolutePath: selectedRootPath },
      classification.contentSignature,
      action,
      rootId,
    );
  };

  const handleApplySelected = async (inboxItemIds: string[]) => {
    if (inboxItemIds.length === 0) return;
    const result = await applySelected(inboxItemIds);
    if (result) {
      const failed = result.results.filter((r) => r.error != null).length;
      if (failed > 0) {
        addToast({
          message: `${result.results.length - failed} plan(s) applied; ${failed} failed.`,
          variant: 'warn',
        });
      } else {
        addToast({
          message: `${result.results.length} plan(s) are being applied.`,
          variant: 'info',
        });
      }
      refreshAll();
    } else {
      addToast({ message: 'Apply failed — please try again.', variant: 'error' });
    }
  };

  const handleApplyAll = async () => {
    const result = await applyAll();
    if (result) {
      const failed = result.results.filter((r) => r.error != null).length;
      if (failed > 0) {
        addToast({
          message: `${result.results.length - failed} plans applied; ${failed} failed.`,
          variant: 'warn',
        });
      } else {
        addToast({ message: `All ${result.results.length} plans are being applied.`, variant: 'info' });
      }
      refreshAll();
    }
  };

  const handleCancel = async (inboxItemId: string) => {
    await cancel(inboxItemId);
    addToast({ message: 'Plan discarded. Item is available for re-confirmation.', variant: 'info' });
    refreshAll();
  };

  const hasOpenPlan = selectedItem?.state === 'plan_open';

  // Confirm gating (spec 043 §4 / task #34): MISSING REQUIRED metadata blocks
  // confirm — any file lacking a path-load-bearing attribute cannot be routed
  // to a destination, so the backend rejects it (inbox.missing_path_attributes).
  // Disable confirm up-front and let the detail pane's danger alert explain why.
  // A MIXED folder is NOT blocked here: confirming it generates a split plan.
  const hasMissingRequiredMeta = useMemo(
    () => (fileMetadata ?? []).some((f) => (f.missingPathAttributes?.length ?? 0) > 0),
    [fileMetadata],
  );

  const canConfirm =
    !!selectedItem &&
    !!classification &&
    classification.type !== 'unclassified' &&
    !hasMissingRequiredMeta &&
    !hasOpenPlan;

  const planBusy = applyAllLoading || applySelectedLoading || cancelLoading;

  const confirmLabel =
    classification?.type === 'mixed' ? 'Generate split plan' : 'Confirm to inventory';

  // spec 041 US6: aggregate inbox queue stats. Derived from the SAME item list
  // the header/footer count from (distinct-folder counting) so the stats strip,
  // header, and footer always reconcile — a mixed folder counts once overall.
  const derivedStats = useMemo(() => deriveInboxStats(items), [items]);

  // #75: frame-type hint per ingestion, derived from the inbox item's
  // classification/breakdown (here: the dominant `groupFrameType`, or the
  // master's `masterFrameType`). PlanPanel uses this to label each collapsed
  // group bucket by frame type (bias/dark/flat/light/master) instead of
  // degenerating to one line per catalogue action.
  const frameTypeByItemId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) {
      const ft = it.isMaster ? (it.masterFrameType ?? 'master') : it.groupFrameType;
      if (ft) m[it.inboxItemId] = ft;
    }
    return m;
  }, [items]);

  // Summary count (no page title — top-bar convention): folders / masters.
  const folderCount = items.filter((it) => !it.isMaster).length;
  const masterCount = items.filter((it) => it.isMaster).length;
  const summary = useMemo(() => {
    if (listLoading) return 'Loading…';
    const parts: string[] = [];
    if (folderCount > 0) parts.push(`${folderCount} folder${folderCount !== 1 ? 's' : ''}`);
    if (masterCount > 0) parts.push(`${masterCount} master${masterCount !== 1 ? 's' : ''}`);
    const base = parts.length > 0 ? parts.join(' · ') : '0 detections';
    return isCapped ? `${base} (first ${listData?.limit ?? 500})` : base;
  }, [listLoading, folderCount, masterCount, isCapped, listData?.limit]);

  // ── Top bar: NO page title (top-bar convention); search + group/sort/filter
  // controls in the FilterToolbar; Confirm + Rescan as right-aligned actions. ──
  const topBar = (
    <>
      <PageTopBar
        summary={<span>{summary}</span>}
        filters={
          <FilterToolbar
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Search detections…',
              ariaLabel: 'Search inbox',
            }}
            actions={
              <InboxControls
                dims={dims}
                setSlot={setSlot}
                sortBy={sortBy}
                onSortByChange={setSortBy}
                filterType={type ?? 'all'}
                onFilterTypeChange={(t) =>
                  navigate({ search: (prev) => ({ ...prev, type: t as FrameType | undefined }) })
                }
              />
            }
          />
        }
        actions={
          <>
            <Btn
              size="sm"
              variant="accent"
              disabled={confirmLoading || !canConfirm}
              onClick={() => void handleConfirm()}
              aria-label={confirmLabel}
              data-testid="inbox-confirm-btn"
              data-guide-anchor="inbox.confirm-row"
            >
              {confirmLoading ? 'Working…' : confirmLabel}
            </Btn>
            <Btn
              size="sm"
              disabled={rescanLoading}
              onClick={() => void rescan()}
              aria-label="Rescan all roots"
            >
              {rescanLoading ? 'Rescanning…' : 'Rescan'}
            </Btn>
          </>
        }
      />
      {/* #61: stats strip pinned in the always-visible top region — a second
          `.alm-page__bar` so it never scrolls out of view with the content. */}
      {!listLoading && (
        <div className="alm-page__bar alm-inbox-statsbar">
          <InboxStatsSummary stats={derivedStats} />
        </div>
      )}
    </>
  );

  // ── Detail pane: per-detection detail + (when present) the plan surface. ──
  const showPlans = openPlans.length > 0 || pendingRootPick != null;
  const detail =
    selectedItem != null || showPlans ? (
      <div className="alm-inbox-detail-pane">
        {selectedItem != null ? (
          <InboxDetail
            // Remount per item so per-item state (pending type overrides) never
            // leaks across selections.
            key={selectedItem.inboxItemId}
            item={selectedItem}
            rootAbsolutePath={selectedRootPath}
            classification={classification ?? null}
            fileMetadata={fileMetadata}
            // task #34: inline "Generate split plan" action inside the
            // mixed-folder alert reuses the same confirm/split flow the top-bar
            // Confirm button runs (handleConfirm picks 'split' when mixed).
            onGenerateSplitPlan={() => void handleConfirm()}
            splitPlanBusy={confirmLoading}
          />
        ) : (
          <EmptyState
            title="Open plans"
            description="Review the planned actions below before applying."
          />
        )}
        {/* #76: planned-actions live in the detail pane (not a full-width bottom
            strip). Shown whenever ≥1 open plan exists OR a destination-root pick
            is pending (the latter possible with zero open plans). */}
        {showPlans && (
          <div
            className={`alm-inbox-detail-plans${selectedItem == null ? ' alm-inbox-detail-plans--solo' : ''}`}
          >
            <PlanPanel
              plans={openPlans}
              totalActions={totalActions}
              destructiveDestination={destructiveDestination}
              onDestructiveDestinationChange={setDestructiveDestination}
              onApplySelected={(ids) => void handleApplySelected(ids)}
              onApplyAll={() => void handleApplyAll()}
              onCancel={(id) => void handleCancel(id)}
              busy={planBusy}
              pendingRootPick={pendingRootPick}
              onPickDestinationRoot={(rootId) => void handlePickDestinationRoot(rootId)}
              rootPickBusy={confirmLoading}
              absoluteByFromPath={absoluteByFromPath}
              frameTypeByItemId={frameTypeByItemId}
            />
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <ListPageLayout
      topBar={topBar}
      detail={detail}
      onCloseDetail={selectedItem != null ? clearSelection : undefined}
      detailLabel="Detection details"
    >
      <InboxList
        items={filteredItems}
        selectedIdx={selected ?? null}
        onSelect={onSelect}
        filterType={type ?? 'all'}
        dims={dims}
        sortBy={sortBy}
      />
    </ListPageLayout>
  );
}
