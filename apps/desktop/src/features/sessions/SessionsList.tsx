/**
 * SessionsList -- uses the standard ListSidebar component for consistent
 * search, group, sort, filter pill layout across all list-detail screens.
 * Rewritten per spec 030 to remove Confidence, inline formatIntegration,
 * inline stateVariant/stateLabel, and manual set-toggle patterns.
 */

import { useMemo, useState } from 'react';
import type { AcquisitionSession, AppPreferences } from '@/bindings/types';
import { Pill } from '@/ui';
import { ListSidebar, ListItem } from '@/components';
import type { SelectOption, FilterPill, DropdownDef } from '@/components';
import { usePreference } from '@/data/preferences';
import { formatIntegration } from '@/lib/format';
import { sessionStateVariant, sessionStateLabel } from '@/lib/display';
import { useSetToggle } from '@/hooks/useSetToggle';

type GroupByMode = AppPreferences['sessionsGroupBy'];
type SortMode = 'date_desc' | 'confidence_asc' | 'integration_desc';

const GROUP_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: 'target', label: 'Target' },
  { value: 'month', label: 'Month' },
  { value: 'filter', label: 'Filter' },
  { value: 'train', label: 'Optical Train' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'integration_desc', label: 'Integration (most)' },
];

const STATE_FILTERS = [
  'confirmed',
  'needs_review',
  'discovered',
  'candidate',
  'rejected',
  'ignored',
] as const;

function groupKeyFor(session: AcquisitionSession, groupBy: GroupByMode): string {
  switch (groupBy) {
    case 'target': return session.session_key.target;
    case 'month': return session.session_key.night.slice(0, 7);
    case 'filter': return session.session_key.filter;
    case 'train': return session.optical_train_id.slice(0, 8);
    default: return '';
  }
}

interface SessionsListProps {
  sessions: AcquisitionSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SessionsList({ sessions, selectedId, onSelect }: SessionsListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = usePreference('sessionsGroupBy');
  const [sortMode, setSortMode] = useState<SortMode>('date_desc');
  const [stateFilter, toggleState] = useSetToggle<string>();
  const [filterFilter, setFilterFilter] = useState<string>('');
  const [trainFilter, setTrainFilter] = useState<string>('');

  // Unique values for filter dropdowns
  const filterNames = useMemo(() => {
    const set = new Set(sessions.map((s) => s.session_key.filter));
    return Array.from(set).sort();
  }, [sessions]);

  const trainIds = useMemo(() => {
    const set = new Set(sessions.map((s) => s.optical_train_id));
    return Array.from(set);
  }, [sessions]);

  // Filter
  const filtered = useMemo(() => {
    let result = sessions;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.session_key.target.toLowerCase().includes(q) ||
          s.session_key.filter.toLowerCase().includes(q) ||
          s.optical_train_id.toLowerCase().includes(q),
      );
    }

    if (stateFilter.size > 0) {
      result = result.filter((s) => stateFilter.has(s.state));
    }

    if (filterFilter) {
      result = result.filter((s) => s.session_key.filter === filterFilter);
    }

    if (trainFilter) {
      result = result.filter((s) => s.optical_train_id === trainFilter);
    }

    return result;
  }, [sessions, searchQuery, stateFilter, filterFilter, trainFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case 'date_desc':
        arr.sort((a, b) => b.session_key.night.localeCompare(a.session_key.night));
        break;
      case 'integration_desc':
        arr.sort((a, b) => b.total_integration_seconds - a.total_integration_seconds);
        break;
    }
    return arr;
  }, [filtered, sortMode]);

  // Group
  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', items: sorted }];
    const map = new Map<string, AcquisitionSession[]>();
    for (const s of sorted) {
      const key = groupKeyFor(s, groupBy);
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [sorted, groupBy]);

  // Filter pills for state
  const filterPills: FilterPill[] = STATE_FILTERS.map((state) => ({
    value: state,
    label: sessionStateLabel(state),
    active: stateFilter.has(state),
  }));

  // Dropdown defs for filter name and optical train
  const dropdowns: DropdownDef[] = [
    {
      label: 'Filter name',
      value: filterFilter || 'all',
      options: [
        { value: 'all', label: 'All filters' },
        ...filterNames.map((f) => ({ value: f, label: f })),
      ],
      onChange: (v) => setFilterFilter(v === 'all' ? '' : v),
    },
    {
      label: 'Optical train',
      value: trainFilter || 'all',
      options: [
        { value: 'all', label: 'All trains' },
        ...trainIds.map((t) => ({ value: t, label: `${t.slice(0, 8)}...` })),
      ],
      onChange: (v) => setTrainFilter(v === 'all' ? '' : v),
    },
  ];

  // Track the first reviewable session so we can tag it for the guided tour.
  const firstTourId = useMemo(() => {
    const reviewable = new Set(['discovered', 'candidate', 'needs_review']);
    const match = sorted.find((s) => reviewable.has(s.state));
    return match?.id ?? sorted[0]?.id ?? null;
  }, [sorted]);

  return (
    <ListSidebar
      searchPlaceholder="Search target, filter, train..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      groupOptions={GROUP_OPTIONS}
      groupValue={groupBy}
      onGroupChange={(v) => setGroupBy(v as GroupByMode)}
      sortOptions={SORT_OPTIONS}
      sortValue={sortMode}
      onSortChange={(v) => setSortMode(v as SortMode)}
      filterPills={filterPills}
      onFilterToggle={toggleState}
      dropdowns={dropdowns}
      itemCount={sorted.length}
    >
      {sorted.length === 0 && (
        <div className="alm-list-sidebar__empty">No sessions match filters</div>
      )}
      {grouped.map((group) => (
        <div key={group.key || '__all'} role="presentation">
          {group.key && (
            <div className="alm-list-sidebar__group-header" role="presentation">
              {group.key}
            </div>
          )}
          {group.items.map((session) => (
            <ListItem
              key={session.id}
              id={session.id}
              selected={selectedId === session.id}
              onSelect={onSelect}
              {...(session.id === firstTourId ? { 'data-tour': 'first-session' } as Record<string, string> : undefined)}
            >
              <div className="alm-list-item__row">
                <span className="alm-list-item__name">
                  {session.session_key.target}
                </span>
                <Pill
                  label={session.session_key.filter}
                  variant="ghost"
                  size="sm"
                />
                {session.warnings.length > 0 && (
                  <span
                    className="alm-list-item__warn"
                    title={session.warnings.join('\n')}
                  >
                    &#x26A0;
                  </span>
                )}
              </div>
              <div className="alm-list-item__meta">
                <span className="alm-mono">{session.session_key.night}</span>
                <span className="alm-list-item__dot" />
                <span className="alm-mono">
                  {formatIntegration(session.total_integration_seconds)}
                </span>
                <span className="alm-list-item__dot" />
                <Pill
                  label={sessionStateLabel(session.state)}
                  variant={sessionStateVariant(session.state)}
                  size="sm"
                />
              </div>
            </ListItem>
          ))}
        </div>
      ))}
    </ListSidebar>
  );
}
