import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { AcquisitionSession, AppPreferences } from '@/bindings/types';
import { Pill, Confidence, Btn } from '@/ui';
import { usePreference } from '@/data/preferences';

type GroupByMode = AppPreferences['sessionsGroupBy'];
type SortMode = 'date_desc' | 'confidence_asc' | 'integration_desc';

const GROUP_MODES: Array<{ value: GroupByMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'target', label: 'Target' },
  { value: 'month', label: 'Month' },
  { value: 'filter', label: 'Filter' },
  { value: 'train', label: 'Optical Train' },
];

const SORT_MODES: Array<{ value: SortMode; label: string }> = [
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'confidence_asc', label: 'Confidence (lowest)' },
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

function stateVariant(state: string) {
  switch (state) {
    case 'confirmed': return 'ok' as const;
    case 'needs_review': return 'warn' as const;
    case 'rejected': return 'danger' as const;
    case 'discovered': return 'info' as const;
    default: return 'neutral' as const;
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'needs_review': return 'needs review';
    default: return state;
  }
}

function formatIntegration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const CONFIDENCE_ORDER: Record<string, number> = {
  unknown: 0,
  rejected: 1,
  low: 2,
  medium: 3,
  high: 4,
  confirmed: 5,
};

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
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set());
  const [filterFilter, setFilterFilter] = useState<string | null>(null);
  const [trainFilter, setTrainFilter] = useState<string | null>(null);

  // Unique values for filter chips
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
      case 'confidence_asc':
        arr.sort(
          (a, b) =>
            (CONFIDENCE_ORDER[a.confidence] ?? 0) - (CONFIDENCE_ORDER[b.confidence] ?? 0),
        );
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

  const toggleState = (state: string) => {
    setStateFilter((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  };

  const hasActiveFilters = stateFilter.size > 0 || filterFilter !== null || trainFilter !== null;

  // Track the first reviewable session so we can tag it for the guided tour.
  const firstTourId = useMemo(() => {
    const reviewable = new Set(['discovered', 'candidate', 'needs_review']);
    const match = sorted.find((s) => reviewable.has(s.state));
    return match?.id ?? sorted[0]?.id ?? null;
  }, [sorted]);

  return (
    <div className="alm-session-list">
      {/* Search */}
      <div className="alm-session-list__search">
        <input
          type="text"
          className="alm-session-list__input"
          placeholder="Search target, filter, train..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search sessions"
        />
      </div>

      {/* Controls: group + sort */}
      <div className="alm-session-list__controls">
        <div className="alm-session-list__control-row">
          <span className="alm-session-list__control-label">Group:</span>
          <select
            className="alm-select--sm alm-session-list__select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupByMode)}
            aria-label="Group sessions by"
          >
            {GROUP_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="alm-session-list__control-row">
          <span className="alm-session-list__control-label">Sort:</span>
          <select
            className="alm-select--sm alm-session-list__select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="Sort sessions by"
          >
            {SORT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter chips */}
      <div className="alm-session-list__filters">
        <div className="alm-session-list__filter-group">
          {STATE_FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              className={clsx(
                'alm-filter-chip alm-filter-chip--xs',
                stateFilter.has(state) && 'alm-filter-chip--active',
              )}
              onClick={() => toggleState(state)}
              aria-pressed={stateFilter.has(state)}
            >
              {stateLabel(state)}
            </button>
          ))}
        </div>
        <div className="alm-session-list__filter-group">
          <select
            className="alm-select--sm alm-session-list__select"
            value={filterFilter ?? ''}
            onChange={(e) => setFilterFilter(e.target.value || null)}
            aria-label="Filter by filter name"
          >
            <option value="">All filters</option>
            {filterNames.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select
            className="alm-select--sm alm-session-list__select"
            value={trainFilter ?? ''}
            onChange={(e) => setTrainFilter(e.target.value || null)}
            aria-label="Filter by optical train"
          >
            <option value="">All trains</option>
            {trainIds.map((t) => (
              <option key={t} value={t}>{t.slice(0, 8)}...</option>
            ))}
          </select>
        </div>
        {hasActiveFilters && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              setStateFilter(new Set());
              setFilterFilter(null);
              setTrainFilter(null);
            }}
          >
            Clear filters
          </Btn>
        )}
      </div>

      {/* Count */}
      <div className="alm-session-list__count">
        {sorted.length} session{sorted.length !== 1 ? 's' : ''}
      </div>

      {/* Session items */}
      <div className="alm-session-list__items" role="listbox" aria-label="Session list">
        {sorted.length === 0 && (
          <div className="alm-session-list__empty">No sessions match filters</div>
        )}
        {grouped.map((group) => (
          <div key={group.key || '__all'}>
            {group.key && (
              <div className="alm-session-list__group-header">{group.key}</div>
            )}
            {group.items.map((session) => (
              <button
                key={session.id}
                type="button"
                role="option"
                aria-selected={selectedId === session.id}
                className={clsx(
                  'alm-session-list__item',
                  selectedId === session.id && 'alm-session-list__item--selected',
                )}
                onClick={() => onSelect(session.id)}
                {...(session.id === firstTourId ? { 'data-tour': 'first-session' } : undefined)}
              >
                <div className="alm-session-list__item-top">
                  <span className="alm-session-list__item-target">
                    {session.session_key.target}
                  </span>
                  <Pill
                    label={session.session_key.filter}
                    variant="ghost"
                    size="sm"
                  />
                  {session.warnings.length > 0 && (
                    <span
                      className="alm-session-list__item-warn"
                      title={session.warnings.join('\n')}
                    >
                      &#x26A0;
                    </span>
                  )}
                </div>
                <div className="alm-session-list__item-meta">
                  <span className="alm-mono">{session.session_key.night}</span>
                  <span className="alm-session-list__item-dot" />
                  <span className="alm-mono">
                    {formatIntegration(session.total_integration_seconds)}
                  </span>
                  <span className="alm-session-list__item-dot" />
                  <Pill
                    label={stateLabel(session.state)}
                    variant={stateVariant(session.state)}
                    size="sm"
                  />
                </div>
                <div className="alm-session-list__item-confidence">
                  <Confidence level={session.confidence} />
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
