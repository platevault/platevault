import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  PageShell,
  ListDetailLayout,
  TopActionBar,
  ListSidebar,
  ListItem,
  Modal,
} from '@/components';
import { Btn, Pill, EmptyState } from '@/ui';
import { m } from '@/lib/i18n';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { ArchiveDetail } from './ArchiveDetail';
import { useArchiveList, useSendToTrash, usePermanentlyDelete } from './store';
import type { ArchiveEntry } from '@/bindings/index';

// Backend safety gate for `archive.permanently_delete` (spec 017 WP-B):
// the literal confirmation string the user must type before the action
// unlocks.
const DELETE_CONFIRM_TEXT = 'DELETE';

export function ArchivePage() {
  const { selected } = useSearch({ from: '/shell/archive' });
  const navigate = useNavigate({ from: '/archive' });
  const { data: entries = [], loading, error } = useArchiveList();
  const item: ArchiveEntry | null = entries.find((a) => a.id === selected) ?? null;

  const sendToTrash = useSendToTrash();
  const permanentlyDelete = usePermanentlyDelete();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  useStaleSelectionCleanup(selected, item !== null, () => {
    void navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true });
  });

  const onSelect = (id: string) => navigate({ search: (prev) => ({ ...prev, selected: id }) });

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setConfirmInput('');
  };

  const handleSendToTrash = () => {
    if (!item?.archivedViaPlanId) return;
    sendToTrash.mutate(item.archivedViaPlanId);
  };

  const handleConfirmDelete = () => {
    if (!item?.archivedViaPlanId || confirmInput !== DELETE_CONFIRM_TEXT) return;
    permanentlyDelete.mutate(item.archivedViaPlanId, { onSuccess: closeDeleteModal });
  };

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title={m.verb_archive()}
            subtitle={m.archive_subtitle_item_count({ count: entries.length })}
            right={
              item && (
                <>
                  <Btn
                    size="sm"
                    variant="danger"
                    disabled={!item.archivedViaPlanId || sendToTrash.isPending}
                    onClick={handleSendToTrash}
                  >
                    {m.archive_send_to_trash_btn()}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    disabled={!item.archivedViaPlanId}
                    onClick={() => setDeleteModalOpen(true)}
                  >
                    {m.archive_delete_permanently_btn()}
                  </Btn>
                  <Btn size="sm">{m.projects_detail_reveal_btn()}</Btn>
                </>
              )
            }
          />
        }
        list={
          <ListSidebar
            placeholder={m.archive_search_placeholder()}
            footer={m.common_item_count({ count: entries.length })}
          >
            {loading ? (
              <EmptyState title={m.common_loading()} />
            ) : error ? (
              <EmptyState title={m.archive_load_error()} />
            ) : entries.length === 0 ? (
              <EmptyState title={m.archive_empty_title()} desc={m.archive_empty_desc()} />
            ) : (
              entries.map((a) => (
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
                  meta={m.archive_item_archived_on({ date: a.archivedAt })}
                />
              ))
            )}
          </ListSidebar>
        }
        detail={<ArchiveDetail item={item} />}
      />

      {item && (
        <Modal
          open={deleteModalOpen}
          onClose={closeDeleteModal}
          title={m.archive_delete_permanently_confirm_title()}
          size="sm"
          ariaLabel={m.archive_delete_permanently_confirm_title()}
          footer={
            <>
              <Btn variant="ghost" onClick={closeDeleteModal} disabled={permanentlyDelete.isPending}>
                {m.common_cancel()}
              </Btn>
              <Btn
                variant="danger"
                disabled={confirmInput !== DELETE_CONFIRM_TEXT || permanentlyDelete.isPending}
                onClick={handleConfirmDelete}
              >
                {m.archive_delete_permanently_btn()}
              </Btn>
            </>
          }
        >
          <p>{m.archive_delete_permanently_confirm_desc({ name: item.name })}</p>
          <input
            className="alm-input"
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={DELETE_CONFIRM_TEXT}
            aria-label={m.archive_delete_permanently_confirm_aria()}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- focus moves to the confirm input when the destructive delete-permanently modal opens (expected modal behaviour)
            autoFocus
          />
        </Modal>
      )}
    </PageShell>
  );
}
