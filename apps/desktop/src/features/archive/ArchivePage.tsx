import { useNavigate, useSearch } from '@tanstack/react-router';
import { ARCHIVE_DATA } from '@/data/fixtures/archive';
import type { ArchiveFixture } from '@/data/fixtures/archive';
import {
  PageShell,
  ListDetailLayout,
  TopActionBar,
  ListSidebar,
  ListItem,
} from '@/components';
import { Btn, Pill } from '@/ui';
import type { BtnVariant } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { ArchiveDetail } from './ArchiveDetail';

interface ContextualAction {
  label: string;
  variant?: BtnVariant;
}

// Contextual actions for a selected archive item.
function archiveActions(item: ArchiveFixture): ContextualAction[] {
  switch (item.entityType) {
    case 'project':
      return [{ label: 'Restore project', variant: 'primary' }, { label: 'Delete permanently', variant: 'danger' }];
    case 'session':
      return [{ label: 'Restore session', variant: 'primary' }, { label: 'Delete permanently', variant: 'danger' }];
    case 'master':
      return [{ label: 'Restore master', variant: 'primary' }, { label: 'Delete permanently', variant: 'danger' }];
    default:
      return [{ label: 'Restore', variant: 'primary' }, { label: 'Delete permanently', variant: 'danger' }];
  }
}

export function ArchivePage() {
  const { selected } = useSearch({ from: '/shell/archive' });
  const navigate = useNavigate({ from: '/archive' });
  const item: ArchiveFixture | null = ARCHIVE_DATA.find((a) => a.id === selected) ?? null;

  useStaleSelectionCleanup(selected, item !== null, () => {
    void navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true });
  });

  const onSelect = (id: number) => navigate({ search: (prev) => ({ ...prev, selected: id }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Archive"
            subtitle={`${ARCHIVE_DATA.length} archived items`}
            right={
              item && (
                <>
                  {archiveActions(item).map((a) => (
                    <Btn key={a.label} size="sm" variant={a.variant}>
                      {a.label}
                    </Btn>
                  ))}
                  <Btn size="sm">Reveal in Explorer</Btn>
                </>
              )
            }
          />
        }
        list={
          <ListSidebar
            placeholder="Search archive..."
            footer={`${ARCHIVE_DATA.length} items`}
          >
            {ARCHIVE_DATA.map((a) => (
              <ListItem
                key={a.id}
                selected={selected === a.id}
                onClick={() => onSelect(a.id)}
                title={
                  <>
                    <strong>{a.name}</strong>
                    <Pill variant="ghost">{a.entityType}</Pill>
                  </>
                }
                meta={`Archived ${a.archivedAt}`}
              />
            ))}
          </ListSidebar>
        }
        detail={<ArchiveDetail item={item} />}
      />
    </PageShell>
  );
}
