/**
 * ArchivePage -- two-pane layout using PageShell + ListDetailLayout.
 * TopActionBar ABOVE the split with Re-queue and Delete permanently actions.
 * Uses ListItem for list rows.
 * Rewritten per spec 030 composition contracts.
 */

import { useState, useMemo } from 'react';
import { EmptyState } from '@/ui';
import {
  PageShell,
  ListDetailLayout,
  TopActionBar,
  ListSidebar,
  ListItem,
  ConfirmOverlay,
} from '@/components';
import type { ActionDef, SelectOption } from '@/components';
import { formatBytes } from '@/lib/format';

interface ArchivedItem {
  id: string;
  name: string;
  entityType: string;
  archivedAt: string;
  sizeBytes: number;
}

const GROUP_OPTIONS: SelectOption[] = [
  { value: 'type', label: 'Type' },
  { value: 'date', label: 'Archive date' },
];

const SORT_OPTIONS: SelectOption[] = [
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
      label: 'Delete permanently',
      hotkey: 'Del',
      variant: 'danger',
      disabled: !selected,
      onClick: () => setConfirmDelete(true),
    },
  ];

  return (
    <PageShell testId="ArchivePage">
      <ListDetailLayout
        topBar={
          <TopActionBar title="Archive" actions={actions} />
        }
        list={
          <ListSidebar
            searchPlaceholder="Search archive..."
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
                <ListItem
                  key={item.id}
                  id={item.id}
                  selected={selectedId === item.id}
                  onSelect={setSelectedId}
                >
                  <div className="alm-list-item__row">
                    <span className="alm-list-item__name">{item.name}</span>
                    <span className="alm-list-item__badge">{item.entityType}</span>
                  </div>
                  <div className="alm-list-item__meta">
                    <span>{item.archivedAt}</span>
                    <span className="alm-list-item__dot" />
                    <span>{formatBytes(item.sizeBytes)}</span>
                  </div>
                </ListItem>
              ))
            )}
          </ListSidebar>
        }
        detail={
          selected ? (
            <div className="alm-archive-detail">
              <h2 className="alm-archive-detail__name">{selected.name}</h2>
              <p className="alm-archive-detail__meta">
                Archived: {selected.archivedAt}
              </p>
            </div>
          ) : (
            <EmptyState title="Select an archived item" />
          )
        }
      />

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
    </PageShell>
  );
}
