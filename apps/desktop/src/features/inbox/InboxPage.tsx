/**
 * InboxPage — three-pane review/confirm workflow (list + detail + ActionSidebar).
 * Design v4: standard frame with a TopActionBar; per-item confirm actions live
 * in the right ActionSidebar.
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { INBOX_DATA } from '@/data/fixtures/review';
import type { InboxFixture } from '@/data/fixtures/review';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { InboxList } from './InboxList';
import { InboxDetail } from './InboxDetail';
import { ActionSidebar } from './ActionSidebar';

export function InboxPage() {
  const { selected, type, group } = useSearch({ from: '/shell/inbox' });
  const navigate = useNavigate({ from: '/inbox' });

  const item: InboxFixture | undefined =
    selected !== undefined ? INBOX_DATA.find((i) => i.id === selected) : undefined;

  useStaleSelectionCleanup(selected, item !== undefined, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (id: number) => navigate({ search: (prev) => ({ ...prev, selected: id }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Inbox"
            subtitle={`${INBOX_DATA.length} sessions to review`}
            right={<Btn size="sm">Rescan inbox</Btn>}
          />
        }
        list={
          <InboxList
            items={INBOX_DATA}
            selectedId={selected ?? null}
            onSelect={onSelect}
            filterType={type ?? 'all'}
            onFilterTypeChange={(t) => navigate({ search: (prev) => ({ ...prev, type: t }) })}
            groupBy={group ?? 'none'}
            onGroupByChange={(g) => navigate({ search: (prev) => ({ ...prev, group: g }) })}
          />
        }
        detail={
          item ? (
            <InboxDetail item={item} />
          ) : (
            <EmptyState
              title="Select a session"
              description="Choose a session from the inbox to review its properties and confirm or adjust before organizing."
            />
          )
        }
        sidebar={<ActionSidebar hasSelection={item !== undefined} />}
      />
    </PageShell>
  );
}
