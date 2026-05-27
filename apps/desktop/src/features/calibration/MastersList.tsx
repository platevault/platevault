/**
 * MastersList -- uses the standard ListSidebar + ListItem components for
 * consistent search, group, sort, filter pill layout.
 * Rewritten per spec 030 to remove native <select>, manual set-toggle,
 * inline styles, and custom list item markup.
 */

import { useState, useMemo } from 'react';
import type { CalibrationMasterFixture } from '@/data/fixtures/calibration';
import { ListSidebar, ListItem } from '@/components';
import type { SelectOption, FilterPill } from '@/components';
import { useSetToggle } from '@/hooks/useSetToggle';

export interface MastersListProps {
  masters: CalibrationMasterFixture[];
  selectedId?: string;
  onSelect: (id: string) => void;
  groupValue: string;
  onGroupChange: (value: string) => void;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type SortBy = 'name' | 'age' | 'sessions';

// ─── Constants ───────────────────────────────────────────────────────────────

const KIND_ORDER = ['dark', 'flat', 'bias'] as const;
const KIND_LABELS: Record<string, string> = {
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
};

const GROUP_OPTIONS: SelectOption[] = [
  { value: 'kind', label: 'Kind' },
  { value: 'camera', label: 'Camera' },
  { value: 'age', label: 'Age' },
  { value: 'none', label: 'None' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'name', label: 'Name' },
  { value: 'age', label: 'Age' },
  { value: 'sessions', label: 'Sessions' },
];

const KIND_FILTER_PILLS: { value: string; label: string }[] = [
  { value: 'dark', label: 'Darks' },
  { value: 'flat', label: 'Flats' },
  { value: 'bias', label: 'Bias' },
  { value: 'aging', label: 'Aging (>90d)' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortMasters(
  masters: CalibrationMasterFixture[],
  sortBy: SortBy,
): CalibrationMasterFixture[] {
  const arr = [...masters];
  switch (sortBy) {
    case 'name':
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'age':
      return arr.sort((a, b) => b.ageDays - a.ageDays);
    case 'sessions':
      return arr.sort((a, b) => b.sessions - a.sessions);
  }
}

function groupMasters(
  masters: CalibrationMasterFixture[],
  groupValue: string,
): { label: string; items: CalibrationMasterFixture[] }[] {
  if (groupValue === 'none') {
    return [{ label: '', items: masters }];
  }

  if (groupValue === 'camera') {
    const map = new Map<string, CalibrationMasterFixture[]>();
    for (const m of masters) {
      const arr = map.get(m.cam) ?? [];
      arr.push(m);
      map.set(m.cam, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }

  if (groupValue === 'age') {
    const buckets: Array<{ label: string; test: (d: number) => boolean }> = [
      { label: '≤ 30d', test: (d) => d <= 30 },
      { label: '31–90d', test: (d) => d > 30 && d <= 90 },
      { label: '> 90d', test: (d) => d > 90 },
    ];
    return buckets
      .map(({ label, test }) => ({
        label,
        items: masters.filter((m) => test(m.ageDays)),
      }))
      .filter((g) => g.items.length > 0);
  }

  // Default: group by kind, respecting KIND_ORDER
  const map = new Map<string, CalibrationMasterFixture[]>();
  for (const m of masters) {
    const arr = map.get(m.kind) ?? [];
    arr.push(m);
    map.set(m.kind, arr);
  }
  return KIND_ORDER.filter((k) => map.has(k)).map((k) => ({
    label: KIND_LABELS[k] ?? k,
    items: map.get(k)!,
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MastersList({
  masters,
  selectedId,
  onSelect,
  groupValue,
  onGroupChange,
}: MastersListProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [kindFilter, toggleKind] = useSetToggle<string>();

  // Filter
  const filtered = useMemo(() => {
    let result = masters;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.cam.toLowerCase().includes(q),
      );
    }

    // Kind filters (dark, flat, bias)
    const kindFilterValues = new Set<string>();
    let agingOnly = false;
    for (const v of kindFilter) {
      if (v === 'aging') {
        agingOnly = true;
      } else {
        kindFilterValues.add(v);
      }
    }

    if (kindFilterValues.size > 0) {
      result = result.filter((m) => kindFilterValues.has(m.kind));
    }

    if (agingOnly) {
      result = result.filter((m) => m.warn === 'aging');
    }

    return result;
  }, [masters, search, kindFilter]);

  // Sort then group
  const sorted = useMemo(() => sortMasters(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupMasters(sorted, groupValue), [sorted, groupValue]);

  // Filter pills
  const filterPills: FilterPill[] = KIND_FILTER_PILLS.map((f) => ({
    value: f.value,
    label: f.label,
    active: kindFilter.has(f.value),
  }));

  return (
    <ListSidebar
      searchPlaceholder="Search name, camera..."
      searchValue={search}
      onSearchChange={setSearch}
      groupOptions={GROUP_OPTIONS}
      groupValue={groupValue}
      onGroupChange={onGroupChange}
      sortOptions={SORT_OPTIONS}
      sortValue={sortBy}
      onSortChange={(v) => setSortBy(v as SortBy)}
      filterPills={filterPills}
      onFilterToggle={toggleKind}
      itemCount={sorted.length}
    >
      {sorted.length === 0 && (
        <div className="alm-list-sidebar__empty">No masters match your search</div>
      )}
      {groups.map((group) => (
        <div key={group.label || '__all'} role="presentation">
          {group.label && (
            <div className="alm-list-sidebar__group-header" role="presentation">
              {group.label}
            </div>
          )}
          {group.items.map((m) => (
            <ListItem
              key={m.id}
              id={m.id}
              selected={m.id === selectedId}
              onSelect={onSelect}
            >
              <div className="alm-list-item__row">
                <span className="alm-list-item__name alm-mono" title={m.name}>
                  {m.name}
                </span>
              </div>
              <div className="alm-list-item__meta">
                <span className="alm-mono">
                  {m.exp} · g{m.gain}
                </span>
                <span className="alm-list-item__dot" />
                <span>{m.cam.replace('ASI', '')}</span>
                {m.warn && (
                  <span className="alm-list-item__warn">
                    &#x26A0; {m.age}
                  </span>
                )}
              </div>
            </ListItem>
          ))}
        </div>
      ))}
    </ListSidebar>
  );
}
