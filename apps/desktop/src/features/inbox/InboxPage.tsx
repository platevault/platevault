/**
 * InboxPage — two-pane classify / confirm workflow with an aggregate plan
 * surface in the bottom of the centre column.
 *
 * spec 039: the left list is a cross-root aggregate of all unacknowledged
 * items (inbox.list), grouped/labelled by their registered root.
 *
 * spec 041 (#1/#2/#3):
 *   - The right ActionSidebar is removed; Confirm lives in the top action bar
 *     and the destructive-destination control lives in the PlanPanel.
 *   - The bottom of the centre column shows EVERY open plan (inbox.plan.list.open)
 *     at once, grouped by ingestion, with per-group selection + Apply selected /
 *     Apply all / per-group Discard.
 *
 * Left list  : unacknowledged items from all registered roots (inbox.list).
 * Centre pane: per-item classification breakdown (inbox.classify) above the
 *              aggregate plan surface (inbox.plan.list.open).
 * Top bar    : Confirm / Split (inbox.confirm) + Rescan.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { addToast } from '@/shared/toast';
import { InboxList } from './InboxList';
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
  useInboxStats,
} from './store';
import { InboxStatsSummary } from './InboxStatsSummary';
import { usePlanApplyProgress } from '@/features/plans/usePlanApplyProgress';
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

  // spec 041: aggregate open-plan surface (all ingestions at once).
  const {
    data: openPlansData,
    refresh: refreshOpenPlans,
  } = useOpenInboxPlans();

  // spec 041 US6: aggregate inbox queue stats summary.
  const { data: statsData } = useInboxStats();
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

  // URL-backed selection is by list index so it stays stable across re-fetches.
  const selectedItem = selected !== undefined ? items[selected] : undefined;

  useStaleSelectionCleanup(selected, selectedItem !== undefined, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (idx: number) =>
    navigate({ search: (prev) => ({ ...prev, selected: idx }) });

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
    addToast({ message: 'Plan discarded. Item is available for re-confirmation.', variant: 'info' });
    refreshAll();
  };

  const hasOpenPlan = selectedItem?.state === 'plan_open';
  const canConfirm =
    !!selectedItem && !!classification && classification.type !== 'unclassified' && !hasOpenPlan;

  const planBusy = applyAllLoading || applySelectedLoading || cancelLoading;

  const confirmLabel =
    classification?.type === 'mixed' ? 'Generate split plan' : 'Confirm to inventory';

  const subtitle = listLoading
    ? 'Loading…'
    : isCapped
      ? `${items.length}+ folders to review (showing first ${listData?.limit ?? 500})`
      : `${items.length} folder${items.length !== 1 ? 's' : ''} to review`;

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Inbox"
            subtitle={subtitle}
            right={
              <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', alignItems: 'center' }}>
                {/* spec 041 T042: Confirm relocated from the deleted ActionSidebar. */}
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
              </div>
            }
          />
        }
        list={
          <InboxList
            items={items}
            selectedIdx={selected ?? null}
            onSelect={onSelect}
            filterType={type ?? 'all'}
            onFilterTypeChange={(t) =>
              navigate({ search: (prev) => ({ ...prev, type: t as FrameType | undefined }) })
            }
          />
        }
        detail={
          <div className="alm-inbox-center">
            {/* spec 041 US6: stats summary strip — always visible, never scrolls. */}
            {statsData && <InboxStatsSummary stats={statsData} />}
            <div className="alm-inbox-center__detail">
              {selectedItem ? (
                <InboxDetail
                  // Remount per item so per-item state (pending type overrides) never
                  // leaks across selections.
                  key={selectedItem.inboxItemId}
                  item={selectedItem}
                  rootAbsolutePath={selectedRootPath}
                  classification={classification ?? null}
                  fileMetadata={fileMetadata}
                />
              ) : (
                <EmptyState
                  title="Select a detection"
                  description="Pick an item from the list to review its classification before confirming."
                />
              )}
            </div>
            {/* spec 041: aggregate plan surface — visible whenever ≥1 open plan
                exists OR a destination-root pick is pending (US8/FR-029), the
                latter possible with zero open plans (no plan was created). */}
            {(openPlans.length > 0 || pendingRootPick) && (
              <div className="alm-inbox-center__plans">
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
                />
              </div>
            )}
          </div>
        }
      />
    </PageShell>
  );
}
