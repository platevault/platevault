/**
 * InboxPage — three-pane review/confirm workflow (list + detail + ActionSidebar).
 * Design v4: standard frame with a TopActionBar; per-item confirm actions live
 * in the right ActionSidebar.
 */

import { useState } from 'react';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { INBOX_DATA } from '@/data/fixtures/review';
import type { InboxFixture } from '@/data/fixtures/review';
import { InboxList } from './InboxList';
import { InboxDetail } from './InboxDetail';
import { ActionSidebar } from './ActionSidebar';

export function InboxPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected: InboxFixture | undefined =
    selectedId !== null ? INBOX_DATA.find((item) => item.id === selectedId) : undefined;

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
        list={<InboxList items={INBOX_DATA} selectedId={selectedId} onSelect={setSelectedId} />}
        detail={
          selected ? (
            <InboxDetail item={selected} />
          ) : (
            <EmptyState
              title="Select a session"
              description="Choose a session from the inbox to review its properties and confirm or adjust before organizing."
            />
          )
        }
        sidebar={<ActionSidebar hasSelection={selectedId !== null} />}
      />
    </PageShell>
  );
}
