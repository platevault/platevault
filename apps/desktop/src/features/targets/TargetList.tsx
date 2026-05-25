import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import type { Target, TargetKind } from '@/api/types';
import { Btn } from '@/ui';

export interface TargetListProps {
  targets: Target[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type GroupBy = 'none' | 'kind';
type SortBy = 'name' | 'sessions' | 'integration';

// ─── Constants ───────────────────────────────────────────────────────────────

const GROUP_MODES: Array<{ value: GroupBy; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'kind', label: 'Kind' },
];

const SORT_MODES: Array<{ value: SortBy; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'integration', label: 'Integration hours' },
];

const KIND_FILTERS: Array<{ key: TargetKind; label: string }> = [
  { key: 'deep_sky', label: 'Deep sky' },
  { key: 'planetary', label: 'Planetary' },
  { key: 'lunar', label: 'Lunar' },
  { key: 'solar', label: 'Solar' },
];

const KIND_LABELS: Record<TargetKind, string> = {
  deep_sky: 'Deep Sky',
  planetary: 'Planetary',
  lunar: 'Lunar',
  solar: 'Solar',
  landscape: 'Landscape',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasCoverageWarning(t: Target): boolean {
  return Object.entries(t.recommended_hours).some(
    ([filter, hours]) => (t.coverage[filter] ?? 0) < hours,
  );
}

function sortTargets(targets: Target[], sortBy: SortBy): Target[] {
  const arr = [...targets];
  switch (sortBy) {
    case 'name':
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'sessions':
      return arr.sort((a, b) => b.session_count - a.session_count);
    case 'integration':
      return arr.sort(
        (a, b) => b.total_integration_hours - a.total_integration_hours,
      );
  }
}

function groupTargets(
  targets: Target[],
  groupBy: GroupBy,
): { label: string; items: Target[] }[] {
  if (groupBy === 'none') return [{ label: '', items: targets }];

  const map = new Map<string, Target[]>();
  for (const t of targets) {
    const key = KIND_LABELS[t.kind] ?? t.kind;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Target list pane (left side of three-pane layout).
 * Matches wireframe: search bar, group/sort controls, filter chips,
 * items showing name + alias + stats.
 */
export function TargetList({ targets, selectedId, onSelect }: TargetListProps) {
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [kindFilter, setKindFilter] = useState<Set<TargetKind>>(new Set());
  const [coverageOnly, setCoverageOnly] = useState(false);

  const isUnresolved = (t: Target) => t.name === '(unresolved)';

  // Filter
  const filtered = useMemo(() => {
    let result = targets;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.aliases.some((a) => a.toLowerCase().includes(q)) ||
          Object.values(t.catalog_ids).some((v) =>
            String(v).toLowerCase().includes(q),
          ),
      );
    }

    if (kindFilter.size > 0) {
      result = result.filter((t) => kindFilter.has(t.kind));
    }

    if (coverageOnly) {
      result = result.filter(hasCoverageWarning);
    }

    return result;
  }, [targets, search, kindFilter, coverageOnly]);

  // Sort then group
  const sorted = useMemo(() => sortTargets(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupTargets(sorted, groupBy), [sorted, groupBy]);

  const toggleKind = (kind: TargetKind) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const hasActiveFilters = kindFilter.size > 0 || coverageOnly;

  return (
    <div className="alm-target-list">
      {/* Search bar */}
      <div className="alm-target-list__search">
        <input
          type="search"
          placeholder="Search targets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="alm-target-list__input"
          aria-label="Search targets"
        />
      </div>

      {/* Controls: group + sort */}
      <div className="alm-proj-list__controls">
        <label className="alm-proj-list__control-label">
          <span className="alm-proj-list__control-text">Group</span>
          <select
            className="alm-proj-list__select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group targets by"
          >
            {GROUP_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="alm-proj-list__control-label">
          <span className="alm-proj-list__control-text">Sort</span>
          <select
            className="alm-proj-list__select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort targets by"
          >
            {SORT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Filter chips */}
      <div className="alm-proj-list__chips">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={clsx(
              'alm-filter-chip alm-filter-chip--xs',
              kindFilter.has(f.key) && 'alm-filter-chip--active',
            )}
            onClick={() => toggleKind(f.key)}
            aria-pressed={kindFilter.has(f.key)}
            aria-label={`Filter by ${f.label}`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          className={clsx(
            'alm-filter-chip alm-filter-chip--xs',
            coverageOnly && 'alm-filter-chip--active',
          )}
          onClick={() => setCoverageOnly((v) => !v)}
          aria-pressed={coverageOnly}
          aria-label="Show only targets with coverage warning"
        >
          coverage warning
        </button>
        {hasActiveFilters && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              setKindFilter(new Set());
              setCoverageOnly(false);
            }}
          >
            Clear
          </Btn>
        )}
      </div>

      {/* Target items */}
      <div className="alm-target-list__items" role="listbox" aria-label="Targets">
        {groups.map((group) => (
          <div key={group.label || '__all'}>
            {group.label && (
              <div className="alm-session-list__group-header" role="presentation">
                {group.label}
              </div>
            )}
            {group.items.map((target) => (
              <div
                key={target.id}
                className={clsx(
                  'alm-target-list__item',
                  target.id === selectedId && 'alm-target-list__item--selected',
                )}
                role="option"
                aria-selected={target.id === selectedId}
                onClick={() => onSelect(target.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(target.id);
                  }
                }}
                tabIndex={0}
              >
                {/* Row 1: name + warning */}
                <div className="alm-target-list__row">
                  <span className="alm-target-list__name">
                    {target.name}
                  </span>
                  {isUnresolved(target) && (
                    <span className="alm-target-list__warn" aria-label="Unresolved target">&#x26A0;</span>
                  )}
                  {hasCoverageWarning(target) && !isUnresolved(target) && (
                    <span className="alm-target-list__warn" aria-label="Coverage warning">&#x26A0;</span>
                  )}
                </div>

                {/* Row 2: alias (if present) */}
                {target.aliases.length > 0 && target.aliases[0] && (
                  <div className="alm-target-list__alias">{target.aliases[0]}</div>
                )}

                {/* Row 3: stats */}
                <div className="alm-target-list__meta">
                  <span>{target.session_count} sess</span>
                  <span className="alm-target-list__dot" aria-hidden="true" />
                  <span>{target.total_integration_hours.toFixed(1)}h</span>
                  <span className="alm-target-list__dot" aria-hidden="true" />
                  <span>{target.project_count} proj</span>
                </div>
              </div>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="alm-target-list__empty">No targets match your search</div>
        )}
      </div>

      {/* New target footer */}
      <div className="alm-target-list__footer">+ new target</div>
    </div>
  );
}
