/**
 * InboxPage — classify / confirm workflow on the Inbox's OWN 3-zone layout.
 *
 * spec 043 (#83 inbox redesign): the Inbox is a special page that does NOT use
 * the shared `ListPageLayout` bottom-split. It shares only the pinned
 * `PageTopBar` convention (search + group/sort/frame-type filter + Confirm /
 * Rescan actions, no page title) and then composes its OWN body with three
 * zones:
 *
 *   ┌──────────────── PageTopBar (pinned) ─────────────────┐
 *   ├───────────────────────────────┬──────────────────────┤
 *   │ detection LIST (primary,       │ file-details SIDE    │
 *   │ full height of the top region) │ panel (selected      │
 *   │                                │ detection: class +   │
 *   │                                │ breakdown + metadata)│
 *   ├═════════ planned-actions BOTTOM panel (docked) ═══════┤
 *   │ full width · own scroll · shown only when a plan/root │
 *   │ pick exists · never steals the list or side panel     │
 *   └───────────────────────────────────────────────────────┘
 *
 *   - #83: ONE search only (top-bar FilterToolbar). The list no longer wraps in
 *     ListSidebar (which carried a 2nd search box + a 3rd folder/master count).
 *     The triplicate counts collapse to a single compact per-frame-type
 *     breakdown in the top-bar summary; global totals live in the status bar.
 *   - The SIDE panel holds the selected detection's detail (`InboxDetail`):
 *     classification + breakdown + per-file metadata, at a sensible fixed width.
 *   - The BOTTOM panel holds the aggregate `PlanPanel` (every open plan), docked
 *     full-width with its own scroll. #75: per-group summaries collapse per-file
 *     rows and aggregate by ACTUAL frame type from the item's breakdown.
 *
 * spec 039: the left list is a cross-root aggregate of all unacknowledged
 * items (inbox.list), grouped/labelled by their registered root.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageTopBar, FilterToolbar } from '@/components';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import { useSetPageStatus } from '@/app/PageStatusContext';
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
  useInboxPlanBreakdowns,
} from './store';
import type { InboxBreakdownTarget } from './store';
import { InboxStatsSummary } from './InboxStatsSummary';
import { deriveInboxStats } from './inboxStatsFromItems';
import { usePlanApplyProgress } from '@/features/plans/usePlanApplyProgress';
import { PlanPanel, buildBreakdownFromActions } from './PlanPanel';
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

  // task 33: breakdown-row filter. Clicking a frame-type row in InboxDetail
  // sets this to that frame type; the list is further filtered to items whose
  // groupFrameType matches. Cleared when the user clicks the active row again
  // or uses the "clear" link in the detail panel.
  const [breakdownFilter, setBreakdownFilter] = useState<string | null>(null);

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
  // task 33: also apply the breakdown-row frame-type filter when active.
  const filteredItems = useMemo(() => {
    let result = items;
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (it) =>
          it.relativePath.toLowerCase().includes(q) ||
          (it.groupTarget ?? '').toLowerCase().includes(q),
      );
    }
    if (breakdownFilter) {
      result = result.filter(
        (it) =>
          (it.groupFrameType ?? '').toLowerCase() === breakdownFilter.toLowerCase() ||
          (it.masterFrameType ?? '').toLowerCase() === breakdownFilter.toLowerCase(),
      );
    }
    return result;
  }, [items, search, breakdownFilter]);

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
  // Live long-op progress consumer (spec 042 US16 / FR-021): streams per-item
  // OperationEvents over the channel when applying a single ingestion plan.
  const { progress: applyProgress, run: runPlanApply } = usePlanApplyProgress();
  const [progressPlanId, setProgressPlanId] = useState<string | null>(null);

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
          message: m.inbox_toast_plan_created({ count: String(result.itemsTotal) }),
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
              message: m.inbox_toast_choose_dest_root(),
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
            message: m.inbox_toast_missing_path_attrs(),
            variant: 'warn',
          });
          return;
        }
        if (message.includes('inbox.has.open.plan')) {
          addToast({ message: m.inbox_toast_has_open_plan(), variant: 'warn' });
        } else if (message.includes('classification.stale')) {
          addToast({ message: m.inbox_toast_stale_classification(), variant: 'warn' });
        } else {
          addToast({ message: m.inbox_toast_confirm_failed({ message }), variant: 'error' });
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

  // task 35: bulk-confirm all cleanly-classified detections in sequence.
  // "Cleanly classified" = state is 'classified', no open plan, and
  // classification.type is 'single_type' (not mixed / unclassified). We use
  // the item's contentSignature from the list (same value InboxPage uses for
  // the single-item confirm) and always pass action='confirm' (never 'split').
  // Items that fail individually are reported; the rest proceed.
  const [bulkConfirmLoading, setBulkConfirmLoading] = useState(false);

  // Eligible items: classified state, no plan open, not a mixed type.
  // We only know classification type per-item when it is loaded; the list item
  // carries `state` and `contentSignature`, so we filter on those. The backend
  // will reject anything that turns out to be unclassified or missing attrs, and
  // each failure produces a toast. This matches the pattern for rescan.
  const bulkEligibleItems = useMemo(
    () =>
      items.filter(
        (it) => it.state === 'classified',
      ),
    [items],
  );

  const canBulkConfirm = bulkEligibleItems.length > 0 && !bulkConfirmLoading;

  const handleBulkConfirm = async () => {
    if (bulkEligibleItems.length === 0) return;
    setBulkConfirmLoading(true);
    let successCount = 0;
    let failCount = 0;
    for (const it of bulkEligibleItems) {
      try {
        await confirm({
          inboxItemId: it.inboxItemId,
          action: 'confirm',
          contentSignature: it.contentSignature,
          rootAbsolutePath: it.rootAbsolutePath,
          destructiveDestination,
          rootId: null,
        });
        successCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setBulkConfirmLoading(false);
    if (failCount > 0 && successCount > 0) {
      addToast({
        message: m.inbox_toast_bulk_partial({ success: String(successCount), fail: String(failCount) }),
        variant: 'warn',
      });
    } else if (failCount > 0 && successCount === 0) {
      addToast({
        message: m.inbox_toast_bulk_all_need_review(),
        variant: 'warn',
      });
    } else {
      addToast({
        message: m.inbox_toast_bulk_confirmed({ success: String(successCount), suffix: successCount !== 1 ? 's' : '' }),
        variant: 'info',
      });
    }
    refreshAll();
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
          message: m.inbox_toast_plans_partial({ applied: String(result.results.length - failed), failed: String(failed) }),
          variant: 'warn',
        });
      } else {
        addToast({
          message: m.inbox_toast_plans_applying({ count: String(result.results.length) }),
          variant: 'info',
        });
      }
      refreshAll();
    } else {
      addToast({ message: m.inbox_toast_apply_failed(), variant: 'error' });
    }
  };

  const handleApplyAll = async () => {
    const result = await applyAll();
    if (result) {
      const failed = result.results.filter((r) => r.error != null).length;
      if (failed > 0) {
        addToast({
          message: m.inbox_toast_all_plans_partial({ applied: String(result.results.length - failed), failed: String(failed) }),
          variant: 'warn',
        });
      } else {
        addToast({ message: m.inbox_toast_all_plans_applying({ count: String(result.results.length) }), variant: 'info' });
      }
      refreshAll();
    }
  };

  // Apply a single ingestion plan with live per-item progress streamed over
  // the long-operation OperationEvent channel (spec 042 US16 / FR-021). This is
  // the end-to-end consumer of the channel contract on the inbox plan surface.
  const handleApplyOne = async (planId: string) => {
    setProgressPlanId(planId);
    const response = await runPlanApply({ id: planId });
    if (response) {
      addToast({ message: 'Plan applied.', variant: 'info' });
      refreshAll();
    } else {
      addToast({ message: 'Apply failed — please try again.', variant: 'error' });
    }
  };

  const handleCancel = async (inboxItemId: string) => {
    await cancel(inboxItemId);
    addToast({ message: m.inbox_toast_plan_discarded(), variant: 'info' });
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

  // #98: PRELOAD the authoritative per-type breakdown for EVERY item that has
  // an open plan — not just the selected one. Each open plan is mapped to its
  // item's registered root path (from the inbox list) so the classify query can
  // run. The hook shares `useInboxClassification`'s cache key, so the selected
  // item's classification is reused rather than re-fetched. The result is a
  // `inboxItemId → breakdown[]` map covering all unselected mixed folders, which
  // previously degraded to a dominant-type guess (e.g. "41 darks").
  const rootPathByItemId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) m[it.inboxItemId] = it.rootAbsolutePath;
    return m;
  }, [items]);

  const breakdownTargets = useMemo<InboxBreakdownTarget[]>(() => {
    const seen = new Set<string>();
    const out: InboxBreakdownTarget[] = [];
    for (const plan of openPlans) {
      const rootAbsolutePath = rootPathByItemId[plan.inboxItemId];
      if (!rootAbsolutePath || seen.has(plan.inboxItemId)) continue;
      seen.add(plan.inboxItemId);
      out.push({ inboxItemId: plan.inboxItemId, rootAbsolutePath });
    }
    return out;
  }, [openPlans, rootPathByItemId]);

  const preloadedBreakdowns = useInboxPlanBreakdowns(breakdownTargets);

  // #75/#98: per-ingestion frame-type BREAKDOWN for the collapsed plan summary —
  // the per-type bias/dark/flat/light/master counts (same shape the classify
  // breakdown / InboxStatsSummary use). Sourced + merged per item, preferring
  // the most authoritative source available:
  //   1. From each open plan's ACTIONS, classified by destination-path keyword
  //      + the per-item hint (`buildBreakdownFromActions`) — the always-present
  //      fallback. A MOVE/SPLIT plan whose files land in typed folders yields a
  //      TRUE multi-type tally even before classify resolves.
  //   2. The PRELOADED real classification `breakdown[]` for the plan's item
  //      (#98) — resolves a MIXED in-place catalogue the action paths cannot,
  //      for EVERY open plan regardless of selection.
  //   3. The SELECTED item's freshly-loaded classification breakdown — same
  //      data as (2) but guaranteed current for the active selection.
  // The result keys each plan to its tally so PlanPanel renders one summary
  // line ("10 bias · 21 dark · 12 light → (root)") instead of per-file rows.
  const breakdownByItemId = useMemo(() => {
    const m: Record<string, ReadonlyArray<{ kind: string; count: number }>> = {};
    for (const plan of openPlans) {
      m[plan.inboxItemId] = buildBreakdownFromActions(
        plan.actions,
        frameTypeByItemId[plan.inboxItemId],
        absoluteByFromPath,
      );
    }
    // Overlay the preloaded authoritative breakdown for every open plan item.
    for (const [id, breakdown] of Object.entries(preloadedBreakdowns)) {
      if (breakdown.length > 0 && m[id] != null) m[id] = breakdown;
    }
    // Prefer the selected item's authoritative classification breakdown.
    if (
      selectedItem &&
      classification?.breakdown &&
      classification.breakdown.length > 0 &&
      m[selectedItem.inboxItemId] != null
    ) {
      m[selectedItem.inboxItemId] = classification.breakdown.map((b) => ({
        kind: b.kind,
        count: b.count,
      }));
    }
    return m;
  }, [
    openPlans,
    frameTypeByItemId,
    absoluteByFromPath,
    preloadedBreakdowns,
    selectedItem,
    classification,
  ]);

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

  // ── Status bar: push the inbox-specific folder/master count + per-frame-type
  // breakdown into the global status bar's page-contextual slot. The top bar
  // reverts to filters + actions only (matching all other pages). The slot is
  // automatically cleared when this page unmounts (route change). ──
  useSetPageStatus(
    <span className="alm-inbox-summary" data-testid="statusbar-inbox-summary">
      <span className="alm-inbox-summary__count">{summary}</span>
      {!listLoading && <InboxStatsSummary stats={derivedStats} />}
    </span>,
  );

  // ── Top bar: NO page title, NO summary (top-bar convention matches other pages).
  // Search + group/sort/filter in FilterToolbar; Confirm + Rescan on the right. ──
  const topBar = (
    <PageTopBar
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: m.inbox_search_placeholder(),
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
          {/* task 35: bulk-confirm all cleanly-classified items in one action */}
          {bulkEligibleItems.length > 0 && (
            <Btn
              size="sm"
              variant="ghost"
              disabled={!canBulkConfirm}
              onClick={() => void handleBulkConfirm()}
              aria-label={m.inbox_bulk_confirm_aria({ count: bulkEligibleItems.length })}
              data-testid="inbox-bulk-confirm-btn"
            >
              {bulkConfirmLoading
                ? m.common_confirming()
                : `Confirm all (${bulkEligibleItems.length})`}
            </Btn>
          )}
          <Btn
            size="sm"
            variant="accent"
            disabled={confirmLoading || !canConfirm}
            onClick={() => void handleConfirm()}
            aria-label={confirmLabel}
            data-testid="inbox-confirm-btn"
            data-guide-anchor="inbox.confirm-row"
          >
            {confirmLoading ? m.common_working() : confirmLabel}
          </Btn>
          <Btn
            size="sm"
            disabled={rescanLoading}
            onClick={() => void rescan()}
            aria-label={m.inbox_rescan_all_roots_aria()}
          >
            {rescanLoading ? m.common_rescanning() : m.common_rescan()}
          </Btn>
        </>
      }
    />
  );

  // The PLAN now lives in the right SIDE panel — shown when ≥1 open plan exists
  // OR a destination-root pick is pending (the latter possible with zero open
  // plans). The file DETAILS now live in the BOTTOM dock — shown when a
  // detection is selected (#83 panel swap).
  const showPlans = openPlans.length > 0 || pendingRootPick != null;
  const planCount = openPlans.length;

  // ── 3-zone body (SWAPPED per #83) ──
  //   row 1: detection LIST (primary) + PLAN in the right SIDE panel
  //   row 2: file DETAILS in the docked BOTTOM panel (auto-size, own scroll)
  // Composed directly (not ListPageLayout) — the Inbox is a special page.
  return (
    <div className="alm-page alm-inbox-page">
      {topBar}

      <div className="alm-inbox-body">
        {/* Row 1: list + PLAN side panel */}
        <div className="alm-inbox-upper">
          <div className="alm-inbox-upper__list">
            <InboxList
              items={filteredItems}
              selectedIdx={selected ?? null}
              onSelect={onSelect}
              filterType={type ?? 'all'}
              dims={dims}
              sortBy={sortBy}
            />
          </div>

          {/* SIDE panel (swapped): the aggregate PLAN. Compact, fixed width;
              shown only when an open plan / pending root pick exists so the
              column never reads as a broken void. */}
          {showPlans && (
            <aside
              className="alm-inbox-side alm-inbox-side--plan"
              aria-label={m.inbox_planned_actions()}
              data-testid="inbox-plan-dock"
            >
              <div className="alm-inbox-side__head">
                <span className="alm-inbox-side__title">{m.inbox_planned_actions()}</span>
                {planCount > 0 && (
                  <span className="alm-inbox-side__badge">{planCount}</span>
                )}
              </div>
              <div className="alm-inbox-side__body">
                <PlanPanel
                  plans={openPlans}
                  totalActions={totalActions}
                  destructiveDestination={destructiveDestination}
                  onDestructiveDestinationChange={setDestructiveDestination}
                  onApplySelected={(ids) => void handleApplySelected(ids)}
                  onApplyAll={() => void handleApplyAll()}
                  onApplyOne={(planId) => void handleApplyOne(planId)}
                  progress={applyProgress}
                  progressPlanId={progressPlanId}
                  onCancel={(id) => void handleCancel(id)}
                  busy={planBusy || applyProgress.running}
                  pendingRootPick={pendingRootPick}
                  onPickDestinationRoot={(rootId) => void handlePickDestinationRoot(rootId)}
                  rootPickBusy={confirmLoading}
                  absoluteByFromPath={absoluteByFromPath}
                  frameTypeByItemId={frameTypeByItemId}
                  breakdownByItemId={breakdownByItemId}
                />
              </div>
            </aside>
          )}
        </div>

        {/* Row 2 (swapped): file DETAILS — docked full width, auto-sized to
            content (capped ~40vh) with its own scroll. Shown only when a
            detection is selected. */}
        {selectedItem != null && (
          <section
            className="alm-inbox-plandock alm-inbox-plandock--details"
            aria-label={m.inbox_detection_details()}
            data-testid="inbox-side-panel"
          >
            <div className="alm-inbox-plandock__head">
              <span className="alm-inbox-plandock__title">{m.inbox_detection_details()}</span>
              <span className="alm-inbox-plandock__spacer" />
              <button
                type="button"
                className="alm-inbox-plandock__close"
                onClick={clearSelection}
                aria-label={m.inbox_close_details_aria()}
              >
                ✕
              </button>
            </div>
            <div className="alm-inbox-plandock__scroll">
              <InboxDetail
                // Remount per item so per-item state (pending type
                // overrides) never leaks across selections.
                key={selectedItem.inboxItemId}
                item={selectedItem}
                rootAbsolutePath={selectedRootPath}
                classification={classification ?? null}
                fileMetadata={fileMetadata}
                // task #34: inline "Generate split plan" inside the
                // mixed-folder alert reuses the same confirm/split flow the
                // top-bar Confirm button runs (handleConfirm picks 'split').
                onGenerateSplitPlan={() => void handleConfirm()}
                splitPlanBusy={confirmLoading}
                // task 33: thread the breakdown-row filter so clicking a
                // frame-type row further filters the detection list.
                activeBreakdownFilter={breakdownFilter}
                onBreakdownFilterChange={setBreakdownFilter}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
