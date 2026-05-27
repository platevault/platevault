import { PageShell, ListDetailLayout, TopActionBar, ListSidebar } from '@/components';
import { Btn, EmptyState } from '@/ui';

export function ArchivePage() {
  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Archive"
            right={
              <>
                <Btn disabled>Re-queue</Btn>
                <Btn variant="danger" disabled>Delete permanently</Btn>
              </>
            }
          />
        }
        list={
          <ListSidebar placeholder="Search archive...">
            <EmptyState title="No archived items" desc="Items moved to the archive will appear here." />
          </ListSidebar>
        }
        detail={
          <EmptyState
            title="Nothing archived yet"
            desc="Select an archived item to view its details."
          />
        }
      />
    </PageShell>
  );
}
