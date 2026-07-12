/**
 * ArchivePage — spec 017 WP-B (real archive backend) on the spec 043
 * SINGLE-COLUMN list-page layout.
 *
 * Alignment pass over the #401-shipped page (which used the deprecated
 * two-pane `ListDetailLayout` + `ListSidebar`): the page now follows the
 * shared list-page system every other list page uses —
 *
 *   - pinned `PageTopBar`: search (wired) + the selected entry's actions on
 *     the right. NO title / NO summary / NO duplicated counts (top-bar
 *     convention, task #80 — the sidebar footer count + subtitle count of the
 *     old layout are gone).
 *   - full-width sortable `ArchiveTable` (shared Table + SortHeader).
 *   - single-column `ArchiveDetail` docked BELOW on selection (spec 043 §4
 *     Archive: no rail; the panel mounts only when an entry is selected — no
 *     empty centered dashboard).
 *
 * Management actions stay in the top bar per spec 043 §4 Archive (Send to
 * trash / Delete permanently / Reveal). Delete permanently keeps the typed
 * "DELETE" confirmation modal gating `archive.permanently_delete`.
 */

import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ListPageLayout, PageTopBar, FilterToolbar, Modal } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { m } from '@/lib/i18n';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { revealLabel } from '@/lib/reveal-label';
import { ArchiveDetail } from './ArchiveDetail';
import { ArchiveTable, DEFAULT_ARCHIVE_SORT } from './ArchiveTable';
import type { ArchiveSort, ArchiveSortCol } from './ArchiveTable';
import { useArchiveList, useSendToTrash, usePermanentlyDelete } from './store';
import type { ArchiveEntry } from '@/bindings/index';

// Backend safety gate for `archive.permanently_delete` (spec 017 WP-B):
// the literal confirmation string the user must type before the action
// unlocks.
const DELETE_CONFIRM_TEXT = 'DELETE';

/** Client-side text search across name / reason / original path. */
function filterEntries(entries: ArchiveEntry[], query: string): ArchiveEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.reason.toLowerCase().includes(q) ||
      a.originalPath.toLowerCase().includes(q),
  );
}

export function ArchivePage() {
  const { selected } = useSearch({ from: '/shell/archive' });
  const navigate = useNavigate({ from: '/archive' });
  const { data: entries = [], loading, error } = useArchiveList();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ArchiveSort>(DEFAULT_ARCHIVE_SORT);
  const filtered = filterEntries(entries, search);

  const item: ArchiveEntry | null =
    entries.find((a) => a.id === selected) ?? null;

  const sendToTrash = useSendToTrash();
  const permanentlyDelete = usePermanentlyDelete();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  useStaleSelectionCleanup(selected, item !== null, () => {
    void navigate({
      search: (prev) => ({ ...prev, selected: undefined }),
      replace: true,
    });
  });

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });
  const clearSelection = () =>
    navigate({
      search: (prev) => ({ ...prev, selected: undefined }),
      replace: true,
    });

  const handleSort = (col: ArchiveSortCol) =>
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' },
    );

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setConfirmInput('');
  };

  const handleSendToTrash = () => {
    if (!item?.archivedViaPlanId) return;
    sendToTrash.mutate(item.archivedViaPlanId);
  };

  const handleConfirmDelete = () => {
    if (!item?.archivedViaPlanId || confirmInput !== DELETE_CONFIRM_TEXT)
      return;
    permanentlyDelete.mutate(item.archivedViaPlanId, {
      onSuccess: closeDeleteModal,
    });
  };

  // Top bar: search + the selected entry's management actions (spec 043 §4
  // Archive keeps these in the TOP BAR, unlike Sessions' detail-header set).
  const topBar = (
    <PageTopBar
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: m.archive_search_placeholder(),
            ariaLabel: m.archive_search_placeholder(),
          }}
        />
      }
      actions={
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
            {/* STUB: Reveal needs the app-managed archive location
                (.astro-plan-archive/<planId>/, D24) which the ArchiveEntry
                contract does not expose yet — disabled, no fake IPC. The old
                layout shipped this button ENABLED with no handler. Label is
                the shared platform-native revealLabel() (File Explorer /
                Finder / file manager). */}
            <Btn
              size="sm"
              disabled
              title={m.archive_reveal_unavailable_title()}
              data-testid="archive-reveal-btn"
            >
              {revealLabel()}
            </Btn>
          </>
        )
      }
    />
  );

  return (
    <>
      <ListPageLayout
        topBar={topBar}
        detailLabel={m.common_details()}
        detail={item != null ? <ArchiveDetail item={item} /> : undefined}
        onCloseDetail={item != null ? () => void clearSelection() : undefined}
      >
        {loading ? (
          <EmptyState title={m.common_loading()} />
        ) : error ? (
          <EmptyState title={m.archive_load_error()} />
        ) : entries.length === 0 ? (
          <EmptyState
            title={m.archive_empty_title()}
            desc={m.archive_empty_desc()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={m.archive_no_match()} />
        ) : (
          <ArchiveTable
            entries={filtered}
            selected={selected ?? null}
            onSelect={onSelect}
            sort={sort}
            onSort={handleSort}
          />
        )}
      </ListPageLayout>

      {item && (
        <Modal
          open={deleteModalOpen}
          onClose={closeDeleteModal}
          title={m.archive_delete_permanently_confirm_title()}
          size="sm"
          ariaLabel={m.archive_delete_permanently_confirm_title()}
          footer={
            <>
              <Btn
                variant="ghost"
                onClick={closeDeleteModal}
                disabled={permanentlyDelete.isPending}
              >
                {m.common_cancel()}
              </Btn>
              <Btn
                variant="danger"
                disabled={
                  confirmInput !== DELETE_CONFIRM_TEXT ||
                  permanentlyDelete.isPending
                }
                onClick={handleConfirmDelete}
              >
                {m.archive_delete_permanently_btn()}
              </Btn>
            </>
          }
        >
          <p>
            {m.archive_delete_permanently_confirm_desc({ name: item.name })}
          </p>
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
    </>
  );
}
