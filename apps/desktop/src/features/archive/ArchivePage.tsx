import { useState, useMemo } from 'react';
import { ListSidebar } from '@/components';
import { TopActionBar } from '@/components';
import { ConfirmOverlay } from '@/components';
import type { ActionDef } from '@/components';
import { EmptyState } from '@/ui';

interface ArchivedItem {
  id: string;
  name: string;
  entityType: string;
  archivedAt: string;
  sizeBytes: number;
}

const GROUP_OPTIONS = [
  { value: 'type', label: 'Type' },
  { value: 'date', label: 'Archive date' },
];

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'size-desc', label: 'Largest first' },
];

export function ArchivePage() {
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('type');
  const [sortBy, setSortBy] = useState('date-desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const items: ArchivedItem[] = [];

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, search]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const actions: ActionDef[] = [
    {
      label: 'Re-queue',
      hotkey: 'R',
      variant: 'ghost',
      disabled: !selected,
      onClick: () => {
        // TODO: re-queue from archive back to inbox
      },
    },
    {
      label: 'Delete',
      hotkey: 'Del',
      variant: 'danger',
      disabled: !selected,
      onClick: () => setConfirmDelete(true),
    },
  ];

  return (
    <div className="alm-archive-page">
      <ListSidebar
        searchPlaceholder="Search archive…"
        searchValue={search}
        onSearchChange={setSearch}
        groupOptions={GROUP_OPTIONS}
        groupValue={groupBy}
        onGroupChange={setGroupBy}
        sortOptions={SORT_OPTIONS}
        sortValue={sortBy}
        onSortChange={setSortBy}
        itemCount={filtered.length}
      >
        {filtered.length === 0 ? (
          <EmptyState title="No archived items" />
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`alm-archive-page__item ${selectedId === item.id ? 'alm-archive-page__item--selected' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="alm-archive-page__item-name">{item.name}</span>
              <span className="alm-archive-page__item-type">{item.entityType}</span>
            </button>
          ))
        )}
      </ListSidebar>

      <div className="alm-archive-page__detail">
        <TopActionBar title="Archive" actions={actions} />
        {selected ? (
          <div className="alm-archive-page__detail-content">
            <h2 className="alm-archive-page__detail-name">{selected.name}</h2>
            <p className="alm-archive-page__detail-meta">
              Archived: {selected.archivedAt}
            </p>
          </div>
        ) : (
          <EmptyState title="Select an archived item" />
        )}
      </div>

      <ConfirmOverlay
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          // TODO: delete via reviewable plan
          setConfirmDelete(false);
        }}
        title="Delete from archive"
        description="This will permanently remove the selected item. This action cannot be undone."
        confirmLabel="Delete permanently"
        confirmVariant="danger"
      />
    </div>
  );
}
