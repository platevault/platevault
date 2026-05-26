/**
 * TargetList -- uses ListSidebar with 4 grouping options:
 * type, constellation, catalog, project.
 * Refactored per spec 030 T077.
 */

import { useState, useMemo, useCallback } from 'react';
import { clsx } from 'clsx';
import type { Target, TargetKind } from '@/bindings/types';
import { Pill } from '@/ui';
import { ListSidebar } from '@/components';

export interface TargetListProps {
  targets: Target[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type GroupBy = 'none' | 'type' | 'constellation' | 'catalog' | 'project';
type SortBy = 'name' | 'sessions' | 'integration';

// ─── Constants ───────────────────────────────────────────────────────────────

const GROUP_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'constellation', label: 'Constellation' },
  { value: 'catalog', label: 'Catalog' },
  { value: 'project', label: 'Project' },
];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'integration', label: 'Integration hours' },
];

const KIND_LABELS: Record<TargetKind, string> = {
  deep_sky: 'Deep Sky',
  planetary: 'Planetary',
  lunar: 'Lunar',
  solar: 'Solar',
  landscape: 'Landscape',
};

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: 'deep_sky', label: 'Deep sky' },
  { value: 'planetary', label: 'Planetary' },
  { value: 'lunar', label: 'Lunar' },
  { value: 'solar', label: 'Solar' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Approximate constellation from RA for demo purposes. */
function constellationFromRa(ra?: number): string {
  if (ra == null) return 'Unknown';
  if (ra >= 20 && ra < 22) return 'Cygnus';
  if (ra >= 0 && ra < 2) return 'Andromeda';
  if (ra >= 21 && ra < 23) return 'Cepheus';
  if (ra >= 5 && ra < 7) return 'Orion';
  return 'Other';
}

function catalogLabel(t: Target): string {
  const entries = Object.entries(t.catalog_ids).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return 'No catalog';
  return entries.map(([cat]) => cat.toUpperCase()).join(', ');
}

function projectLabel(t: Target): string {
  return t.project_count > 0 ? `${t.project_count} project${t.project_count !== 1 ? 's' : ''}` : 'No project';
}

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
    let key: string;
    switch (groupBy) {
      case 'type':
        key = KIND_LABELS[t.kind] ?? t.kind;
        break;
      case 'constellation':
        key = constellationFromRa(t.coordinates?.ra);
        break;
      case 'catalog':
        key = catalogLabel(t);
        break;
      case 'project':
        key = projectLabel(t);
        break;
      default:
        key = '';
    }
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TargetList({ targets, selectedId, onSelect }: TargetListProps) {
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const handleFilterToggle = useCallback((value: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const isUnresolved = (t: Target) => t.name === '(unresolved)';

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

    if (activeFilters.size > 0) {
      result = result.filter((t) => activeFilters.has(t.kind));
    }

    return result;
  }, [targets, search, activeFilters]);

  const sorted = useMemo(() => sortTargets(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupTargets(sorted, groupBy), [sorted, groupBy]);

  const filterPills = KIND_FILTERS.map((f) => ({
    value: f.value,
    label: f.label,
    active: activeFilters.has(f.value),
  }));

  return (
    <ListSidebar
      searchPlaceholder="Search targets..."
      searchValue={search}
      onSearchChange={setSearch}
      groupOptions={GROUP_OPTIONS}
      groupValue={groupBy}
      onGroupChange={(v) => setGroupBy(v as GroupBy)}
      sortOptions={SORT_OPTIONS}
      sortValue={sortBy}
      onSortChange={(v) => setSortBy(v as SortBy)}
      filterPills={filterPills}
      onFilterToggle={handleFilterToggle}
      itemCount={filtered.length}
    >
      {groups.map((group) => (
        <div key={group.label || '__all'} role="presentation">
          {group.label && (
            <div className="alm-list-sidebar__group-header" role="presentation">
              {group.label}
            </div>
          )}
          {group.items.map((target) => (
            <div
              key={target.id}
              className={clsx(
                'alm-list-sidebar__item',
                target.id === selectedId && 'alm-list-sidebar__item--selected',
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
              <div className="alm-list-sidebar__item-row">
                <span className="alm-list-sidebar__item-name">
                  {target.name}
                </span>
                {isUnresolved(target) && (
                  <span className="alm-list-sidebar__item-warn" aria-label="Unresolved target">&#x26A0;</span>
                )}
                {hasCoverageWarning(target) && !isUnresolved(target) && (
                  <span className="alm-list-sidebar__item-warn" aria-label="Coverage warning">&#x26A0;</span>
                )}
              </div>
              {target.aliases.length > 0 && target.aliases[0] && (
                <div className="alm-list-sidebar__item-alias">{target.aliases[0]}</div>
              )}
              <div className="alm-list-sidebar__item-meta">
                <span>{target.session_count} sess</span>
                <span className="alm-list-sidebar__item-dot" aria-hidden="true" />
                <span>{target.total_integration_hours.toFixed(1)}h</span>
                <span className="alm-list-sidebar__item-dot" aria-hidden="true" />
                <span>{target.project_count} proj</span>
              </div>
            </div>
          ))}
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="alm-list-sidebar__empty">No targets match your search</div>
      )}
    </ListSidebar>
  );
}
