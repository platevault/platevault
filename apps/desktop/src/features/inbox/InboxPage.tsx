/**
 * InboxPage — three-pane classify / confirm / reclassify workflow.
 *
 * spec 039: the left list is now a cross-root aggregate of all unacknowledged
 * items (inbox.list), grouped/labelled by their registered root.  The
 * hardcoded DEV_ROOT_ID / DEV_ROOT_PATH stub has been removed.
 *
 * Left list  : unacknowledged items from all registered roots (inbox.list).
 * Centre pane: per-item classification breakdown (inbox.classify).
 * Right bar  : Confirm / Split → plan review (inbox.confirm).
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { addToast } from '@/shared/toast';
import { InboxList } from './InboxList';
import { InboxDetail } from './InboxDetail';
import { ActionSidebar } from './ActionSidebar';
import {
  useInboxList,
  useInboxRescan,
  useInboxClassification,
  useInboxConfirm,
  useInboxPlan,
  useInboxPlanApply,
  useInboxPlanApplyAll,
  useInboxPlanCancel,
} from './store';
import { PlanPanel } from './PlanPanel';
import type { PlanView, PlanActionKind, DestructiveDestination } from './PlanPanel';
import type { FrameType, InboxGroup } from '@/lib/route-contract';

export function InboxPage() {
  const { selected, type, group } = useSearch({ from: '/shell/inbox' });
  const navigate = useNavigate({ from: '/inbox' });

  // FR-001 / FR-002: cross-root aggregate list replaces the hardcoded scan.
  const { data: listData, loading: listLoading, refresh: refreshList } = useInboxList();
  const items = listData?.items ?? [];

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

  const onRescanComplete = useCallback(() => refreshList(), [refreshList]);
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

  const { confirm, loading: confirmLoading } = useInboxConfirm();
  // FR-032: destructive-destination choice, defaults to 'archive' (Constitution §II).
  const [destructiveDestination, setDestructiveDestination] = useState<DestructiveDestination>('archive');

  // spec 041: plan surface — fetch + hold the open plan for the selected item.
  const {
    plan: rawPlan,
    loading: planLoading,
    fetchPlan,
  } = useInboxPlan(selectedItem?.state === 'plan_open' ? (selectedItem?.inboxItemId ?? '') : '');
  const { apply, loading: applyLoading } = useInboxPlanApply();
  const { applyAll, loading: applyAllLoading } = useInboxPlanApplyAll();
  const { cancel, loading: cancelLoading } = useInboxPlanCancel();

  // Map InboxPlanView → PlanView for PlanPanel.
  const planView: PlanView | null = rawPlan
    ? {
        planId: rawPlan.planId,
        state: rawPlan.state,
        stale: rawPlan.stale,
        actions: rawPlan.actions.map((a) => ({
          index: a.index,
          action: a.action as PlanActionKind,
          fromPath: a.fromPath,
          toPath: a.toPath,
          destinationPreview: a.destinationPreview,
          requiresDestructiveConfirm: a.requiresDestructiveConfirm,
        })),
      }
    : null;

  const handleConfirm = async () => {
    if (!selectedItem || !classification) return;
    const action = classification.type === 'mixed' ? 'split' : 'confirm';
    try {
      const result = await confirm({
        inboxItemId: selectedItem.inboxItemId,
        action,
        contentSignature: classification.contentSignature,
        rootAbsolutePath: selectedRootPath,
        destructiveDestination,
      });
      if (result.registeredAsMaster) {
        // Master path (Path 1): registered directly, no plan to review.
        addToast({
          message: 'Registered as calibration master.',
          variant: 'info',
        });
        refreshList();
      } else {
        // spec 041: fetch the plan inline; item stays visible as `plan_open`.
        addToast({
          message: `Plan created (${result.itemsTotal} items). Review below before applying.`,
          variant: 'info',
        });
        refreshList();
        await fetchPlan();
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('inbox.has.open.plan')) {
        addToast({ message: 'An open plan already exists for this item.', variant: 'warn' });
      } else if (msg.includes('classification.stale')) {
        addToast({ message: 'Folder changed since classification — rescan to refresh.', variant: 'warn' });
      } else {
        addToast({ message: `Confirm failed: ${msg}`, variant: 'error' });
      }
    }
  };

  const handlePlanApply = async () => {
    if (!selectedItem) return;
    const result = await apply(selectedItem.inboxItemId);
    if (result) {
      addToast({ message: 'Plan is being applied. The item will move to Resolved when done.', variant: 'info' });
      refreshList();
    } else {
      addToast({ message: 'Apply failed — check the error above.', variant: 'error' });
    }
  };

  const handlePlanApplyAll = async () => {
    const result = await applyAll();
    if (result) {
      const failed = result.results.filter((r) => r.error != null).length;
      if (failed > 0) {
        addToast({ message: `${result.results.length - failed} plans applied; ${failed} failed.`, variant: 'warn' });
      } else {
        addToast({ message: `All ${result.results.length} plans are being applied.`, variant: 'info' });
      }
      refreshList();
    }
  };

  const handlePlanCancel = async () => {
    if (!selectedItem) return;
    await cancel(selectedItem.inboxItemId);
    addToast({ message: 'Plan discarded. Item is available for re-confirmation.', variant: 'info' });
    refreshList();
  };

  const hasOpenPlan = selectedItem?.state === 'plan_open';
  const canConfirm =
    !!selectedItem && !!classification && classification.type !== 'unclassified' && !hasOpenPlan;

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
              <Btn
                size="sm"
                disabled={rescanLoading}
                onClick={() => void rescan()}
                aria-label="Rescan all roots"
              >
                {rescanLoading ? 'Rescanning…' : 'Rescan'}
              </Btn>
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
            groupBy={group ?? 'none'}
            onGroupByChange={(g) =>
              navigate({ search: (prev) => ({ ...prev, group: g as InboxGroup | undefined }) })
            }
          />
        }
        detail={
          selectedItem ? (
            <>
              <InboxDetail
                // Remount per item so per-item state (pending type overrides) never
                // leaks across selections — leaked overrides were being sent to the
                // wrong item's reclassify and rejected as "not found in evidence".
                key={selectedItem.inboxItemId}
                item={selectedItem}
                rootAbsolutePath={selectedRootPath}
                classification={classification ?? null}
              />
              {/* spec 041: show plan panel when item is in plan_open state */}
              {(hasOpenPlan || planLoading) && (
                <PlanPanel
                  plan={planView}
                  destructiveDestination={destructiveDestination}
                  onDestructiveDestinationChange={setDestructiveDestination}
                  onApply={() => void handlePlanApply()}
                  onApplyAll={() => void handlePlanApplyAll()}
                  onCancel={() => void handlePlanCancel()}
                  busy={applyLoading || applyAllLoading || cancelLoading || planLoading}
                />
              )}
            </>
          ) : (
            <EmptyState
              title="Select a detection"
              description="Pick an item from the list to review its classification before confirming."
            />
          )
        }
        sidebar={
          <ActionSidebar
            hasSelection={!!selectedItem}
            classification={classification ?? null}
            hasOpenPlan={hasOpenPlan}
            confirmLoading={confirmLoading}
            canConfirm={canConfirm}
            destructiveDestination={destructiveDestination}
            onDestructiveDestinationChange={setDestructiveDestination}
            onConfirm={handleConfirm}
            onOpenExistingPlan={() => void fetchPlan()}
          />
        }
      />
    </PageShell>
  );
}
