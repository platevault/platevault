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
import { m } from '@/lib/i18n';
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
      return [{ label: m.archive_restore_project_btn(), variant: 'primary' }, { label: m.archive_delete_permanently_btn(), variant: 'danger' }];
    case 'session':
      return [{ label: m.archive_restore_session_btn(), variant: 'primary' }, { label: m.archive_delete_permanently_btn(), variant: 'danger' }];
    case 'master':
      return [{ label: m.archive_restore_master_btn(), variant: 'primary' }, { label: m.archive_delete_permanently_btn(), variant: 'danger' }];
    default:
      return [{ label: m.archive_restore_btn(), variant: 'primary' }, { label: m.archive_delete_permanently_btn(), variant: 'danger' }];
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
            title={m.verb_archive()}
            subtitle={m.archive_subtitle_item_count({ count: ARCHIVE_DATA.length })}
            right={
              item && (
                <>
                  {archiveActions(item).map((a) => (
                    <Btn key={a.label} size="sm" variant={a.variant}>
                      {a.label}
                    </Btn>
                  ))}
                  <Btn size="sm">{m.projects_detail_reveal_btn()}</Btn>
                </>
              )
            }
          />
        }
        list={
          <ListSidebar
            placeholder={m.archive_search_placeholder()}
            footer={m.common_item_count({ count: ARCHIVE_DATA.length })}
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
