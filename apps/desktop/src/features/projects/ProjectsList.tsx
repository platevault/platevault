/**
 * ProjectsList -- uses the standard ListSidebar component for consistent
 * search, group, sort, filter pill layout across all list-detail screens.
 */

import { useMemo, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import type { Project, ProjectState } from '@/bindings/types';
import { Pill, Btn } from '@/ui';
import { ListSidebar } from '@/components';
import { targetNames } from '@/data/fixtures/projects';

// ─── Types ──────────────────────────────────────────────────────────────────

type GroupBy = 'none' | 'target' | 'profile' | 'state';
type SortBy = 'updated' | 'name' | 'integration' | 'size';

export interface ProjectsListProps {
  projects: Project[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onNewProject: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function lifecycleVariant(state: ProjectState) {
  const map: Record<ProjectState, 'warn' | 'ghost' | 'info' | 'ok' | 'neutral' | 'danger'> = {
    setup_incomplete: 'warn',
    ready: 'ghost',
    prepared: 'info',
    processing: 'info',
    completed: 'ok',
    archived: 'neutral',
    blocked: 'danger',
  };
  return map[state];
}

function lifecycleLabel(state: ProjectState): string {
  return state.replace(/_/g, ' ');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatIntegrationHours(hours: number): string {
  if (hours === 0) return '';
  return `${hours.toFixed(1)}h`;
}

function targetLabel(ids: string[]): string {
  if (ids.length === 0) return '?';
  if (ids.length === 1) {
    return targetNames[ids[0]] ?? ids[0].slice(-4);
  }
  return `${ids.length} targets`;
}

function sortProjects(projects: Project[], sortBy: SortBy): Project[] {
  const sorted = [...projects];
  switch (sortBy) {
    case 'updated':
      return sorted.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'integration':
      return sorted.sort((a, b) => b.integration_hours - a.integration_hours);
    case 'size':
      return sorted.sort(
        (a, b) => b.cleanup_state.reclaimable_bytes - a.cleanup_state.reclaimable_bytes,
      );
    default:
      return sorted;
  }
}

function groupProjects(
  projects: Project[],
  groupBy: GroupBy,
): { label: string; items: Project[] }[] {
  if (groupBy === 'none') {
    return [{ label: '', items: projects }];
  }

  const groups = new Map<string, Project[]>();

  for (const p of projects) {
    let key: string;
    switch (groupBy) {
      case 'target':
        key = targetLabel(p.target_ids);
        break;
      case 'profile':
        key = p.workflow_profile_id || '(none)';
        break;
      case 'state':
        key = lifecycleLabel(p.state);
        break;
      default:
        key = '';
    }
    const existing = groups.get(key) ?? [];
    existing.push(p);
    groups.set(key, existing);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

// ─── Filter pills ───────────────────────────────────────────────────────────

const STATE_FILTERS: { key: ProjectState; label: string }[] = [
  { key: 'processing', label: 'Processing' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
  { key: 'blocked', label: 'Blocked' },
];

const GROUP_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'target', label: 'Target' },
  { value: 'profile', label: 'Profile' },
  { value: 'state', label: 'Lifecycle' },
];

const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'name', label: 'Name' },
  { value: 'integration', label: 'Integration' },
  { value: 'size', label: 'Size' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectsList({
  projects,
  selectedId,
  onSelect,
  onNewProject,
}: ProjectsListProps) {
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [activeFilters, setActiveFilters] = useState<Set<ProjectState>>(new Set());

  const handleFilterToggle = useCallback((value: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      const key = value as ProjectState;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    let result = projects;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.workflow_profile_id.toLowerCase().includes(q) ||
          targetLabel(p.target_ids).toLowerCase().includes(q),
      );
    }

    if (activeFilters.size > 0) {
      result = result.filter((p) => activeFilters.has(p.state));
    }

    return result;
  }, [projects, search, activeFilters]);

  const sorted = useMemo(() => sortProjects(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupProjects(sorted, groupBy), [sorted, groupBy]);

  const filterPills = STATE_FILTERS.map((f) => ({
    value: f.key,
    label: f.label,
    active: activeFilters.has(f.key),
  }));

  return (
    <ListSidebar
      searchPlaceholder="Search projects..."
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
              <span className="alm-list-sidebar__group-count">{group.items.length}</span>
            </div>
          )}
          {group.items.map((project) => (
            <div
              key={project.id}
              className={clsx(
                'alm-list-sidebar__item',
                project.id === selectedId && 'alm-list-sidebar__item--selected',
              )}
              role="option"
              aria-selected={project.id === selectedId}
              tabIndex={0}
              onClick={() => onSelect(project.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(project.id);
                }
              }}
            >
              <div className="alm-list-sidebar__item-row">
                <span className="alm-list-sidebar__item-name">
                  {project.state === 'blocked' && (
                    <span className="alm-list-sidebar__item-warn" aria-label="Blocked">&#x26A0; </span>
                  )}
                  {project.name}
                </span>
                <Pill
                  label={lifecycleLabel(project.state)}
                  variant={lifecycleVariant(project.state)}
                  size="sm"
                />
              </div>
              <div className="alm-list-sidebar__item-meta">
                <span>{targetLabel(project.target_ids)}</span>
                {project.integration_hours > 0 && (
                  <>
                    <span className="alm-list-sidebar__item-dot" />
                    <span className="alm-mono">{formatIntegrationHours(project.integration_hours)}</span>
                  </>
                )}
                {project.cleanup_state.reclaimable_bytes > 0 && (
                  <>
                    <span className="alm-list-sidebar__item-dot" />
                    <span className="alm-mono">{formatBytes(project.cleanup_state.reclaimable_bytes)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="alm-list-sidebar__empty">
          {search ? `No projects match "${search}"` : 'No projects match filters'}
        </div>
      )}
      <div className="alm-list-sidebar__action-footer">
        <Btn variant="primary" size="sm" onClick={onNewProject} data-tour="new-project">
          + New project
        </Btn>
      </div>
    </ListSidebar>
  );
}
