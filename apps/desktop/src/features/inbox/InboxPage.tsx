/**
 * InboxPage -- three-pane layout (list + detail + action sidebar).
 * Uses fixture data from @/data/fixtures/review.
 * Design V3 rewrite.
 */

import { useState } from 'react';
import { PageShell, ListDetailLayout } from '@/components';
import { EmptyState } from '@/ui';
import { INBOX_DATA } from '@/data/fixtures/review';
import type { InboxFixture } from '@/data/fixtures/review';
import { InboxList } from './InboxList';
import { InboxDetail } from './InboxDetail';
import { ActionSidebar } from './ActionSidebar';

export function InboxPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected: InboxFixture | undefined = selectedId !== null
    ? INBOX_DATA.find((item) => item.id === selectedId)
    : undefined;

  return (
    <PageShell>
      <ListDetailLayout
        list={
          <InboxList
            items={INBOX_DATA}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
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
