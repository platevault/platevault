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
} from './store';
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
  const [destructiveDestination, setDestructiveDestination] = useState<'archive' | 'trash'>('archive');

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
      } else {
        addToast({
          message: `Plan created (${result.itemsTotal} items). Review before applying.`,
          variant: 'info',
          action: {
            label: 'View plan',
            onClick: () =>
              navigate({ to: '/archive', search: { selected: undefined } as never }),
          },
        });
      }
      // Refresh so confirmed item drops out (FR-003).
      refreshList();
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
            <InboxDetail
              item={selectedItem}
              rootAbsolutePath={selectedRootPath}
              classification={classification ?? null}
            />
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
            onOpenExistingPlan={() =>
              navigate({ to: '/archive', search: { selected: undefined } as never })
            }
          />
        }
      />
    </PageShell>
  );
}
