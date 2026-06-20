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

import { useCallback, useMemo, useState } from 'react';
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
} from './store';
import { PlanPanel } from './PlanPanel';
import type { DestructiveDestination } from './PlanPanel';
import type { FrameType } from '@/lib/route-contract';

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

  const { applyAll, loading: applyAllLoading } = useInboxPlanApplyAll();
  const { applySelected, loading: applySelectedLoading } = useApplySelectedInboxPlans();
  const { cancel, loading: cancelLoading } = useInboxPlanCancel();

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
      // spec 041: masters now always return a plan too — every confirm produces
      // a reviewable plan that appears in the aggregate surface below.
      addToast({
        message: `Plan created (${result.itemsTotal} items). Review below before applying.`,
        variant: 'info',
      });
      refreshAll();
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
          <div className="alm-inbox-center" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div
              className="alm-inbox-center__detail"
              style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
            >
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
                exists, regardless of which list item is selected. */}
            {openPlans.length > 0 && (
              <div
                className="alm-inbox-center__plans"
                style={{ flexShrink: 0, borderTop: '1px solid var(--alm-border)', paddingTop: 'var(--alm-sp-2)' }}
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
                />
              </div>
            )}
          </div>
        }
      />
    </PageShell>
  );
}
