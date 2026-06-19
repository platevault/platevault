/**
 * InboxPage — three-pane classify / confirm / reclassify workflow.
 *
 * Left list  : inbox items from inbox.scan.folder (real command).
 * Centre pane: per-item classification breakdown from inbox.classify with
 *              "Needs review" group and reclassify picker.
 * Right bar  : Confirm / Split action wired to inbox.confirm → plan review.
 */

import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { addToast } from '@/shared/toast';
import { InboxList } from './InboxList';
import { InboxDetail } from './InboxDetail';
import { ActionSidebar } from './ActionSidebar';
import { useInboxScan, useInboxClassification, useInboxConfirm } from './store';
import type { FrameType, InboxGroup } from '@/lib/route-contract';

// Temporary: during development use stub root values until a settings-backed
// root is available. Replace with a real lookup from the roots store once
// spec 006 is wired. These values are also used by mocks.ts.
const DEV_ROOT_ID = 'root-inbox-001';
const DEV_ROOT_PATH = '/astro/inbox';

export function InboxPage() {
  const { selected, type, group } = useSearch({ from: '/shell/inbox' });
  const navigate = useNavigate({ from: '/inbox' });

  const { data: scan, loading: scanLoading } = useInboxScan(DEV_ROOT_ID, DEV_ROOT_PATH);
  const items = scan?.items ?? [];

  // URL-backed selection is by list index so it stays stable across re-fetches.
  const selectedItem = selected !== undefined ? items[selected] : undefined;

  useStaleSelectionCleanup(selected, selectedItem !== undefined, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (idx: number) =>
    navigate({ search: (prev) => ({ ...prev, selected: idx }) });

  // Load classification for the selected item (no-op when nothing selected).
  const { data: classification } = useInboxClassification(
    selectedItem?.inboxItemId ?? '',
    DEV_ROOT_PATH,
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
        rootAbsolutePath: DEV_ROOT_PATH,
        destructiveDestination,
      });
      addToast({
        message: `Plan created (${result.itemsTotal} items). Review before applying.`,
        variant: 'info',
        action: {
          label: 'View plan',
          onClick: () =>
            navigate({ to: '/archive', search: { selected: undefined } as never }),
        },
      });
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

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Inbox"
            subtitle={
              scanLoading
                ? 'Scanning…'
                : `${items.length} folder${items.length !== 1 ? 's' : ''} to review`
            }
            right={<Btn size="sm">Rescan inbox</Btn>}
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
              rootAbsolutePath={DEV_ROOT_PATH}
              classification={classification ?? null}
            />
          ) : (
            <EmptyState
              title="Select a folder"
              description="Choose an inbox folder to review its classification before confirming."
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
