import { useMemo, useState } from 'react';
import type { Project, ProjectState } from '@/bindings/types';
import { Pill, Btn } from '@/ui';
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

// ─── Filter chips ───────────────────────────────────────────────────────────

const STATE_FILTERS: { key: ProjectState; label: string }[] = [
  { key: 'processing', label: 'Processing' },
  { key: 'ready', label: 'Ready' },
  { key: 'prepared', label: 'Prepared' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
  { key: 'blocked', label: 'Blocked' },
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

  const filtered = useMemo(() => {
    let result = projects;

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.workflow_profile_id.toLowerCase().includes(q) ||
          targetLabel(p.target_ids).toLowerCase().includes(q),
      );
    }

    // State filters
    if (activeFilters.size > 0) {
      result = result.filter((p) => activeFilters.has(p.state));
    }

    return result;
  }, [projects, search, activeFilters]);

  const sorted = useMemo(() => sortProjects(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupProjects(sorted, groupBy), [sorted, groupBy]);

  function toggleFilter(state: ProjectState) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  }

  return (
    <div className="alm-proj-list">
      {/* Search */}
      <div className="alm-proj-list__search">
        <input
          type="text"
          className="alm-proj-list__input"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search projects"
        />
      </div>

      {/* Controls: group-by + sort */}
      <div className="alm-proj-list__controls">
        <label className="alm-proj-list__control-label">
          <span className="alm-proj-list__control-text">Group</span>
          <select
            className="alm-proj-list__select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
          >
            <option value="none">None</option>
            <option value="target">Target</option>
            <option value="profile">Profile</option>
            <option value="state">Lifecycle</option>
          </select>
        </label>
        <label className="alm-proj-list__control-label">
          <span className="alm-proj-list__control-text">Sort</span>
          <select
            className="alm-proj-list__select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort by"
          >
            <option value="updated">Updated</option>
            <option value="name">Name</option>
            <option value="integration">Integration</option>
            <option value="size">Size</option>
          </select>
        </label>
      </div>

      {/* Filter chips */}
      <div className="alm-proj-list__chips">
        {STATE_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`alm-proj-list__chip${activeFilters.has(f.key) ? ' alm-proj-list__chip--active' : ''}`}
            onClick={() => toggleFilter(f.key)}
            aria-pressed={activeFilters.has(f.key)}
            aria-label={`Filter by ${f.label}`}
          >
            {f.label}
          </button>
        ))}
        {activeFilters.size > 0 && (
          <button
            className="alm-proj-list__chip alm-proj-list__chip--clear"
            onClick={() => setActiveFilters(new Set())}
          >
            Clear
          </button>
        )}
      </div>

      {/* List items */}
      <ul className="alm-proj-list__items" role="listbox" aria-label="Projects">
        {groups.map((group) => (
          <li key={group.label || '__all'} role="presentation">
            {group.label && (
              <div className="alm-proj-list__group-header" role="presentation">
                {group.label}
                <span className="alm-proj-list__group-count">{group.items.length}</span>
              </div>
            )}
            {group.items.map((project) => (
              <div
                key={project.id}
                className={`alm-proj-list__item${project.id === selectedId ? ' alm-proj-list__item--selected' : ''}`}
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
                <div className="alm-proj-list__item-row">
                  <span className="alm-proj-list__item-name">
                    {project.state === 'blocked' && (
                      <span className="alm-proj-list__item-warn" aria-label="Blocked">&#x26A0; </span>
                    )}
                    {project.name}
                  </span>
                  <Pill
                    label={lifecycleLabel(project.state)}
                    variant={lifecycleVariant(project.state)}
                    size="sm"
                  />
                </div>
                <div className="alm-proj-list__item-meta">
                  <span>{targetLabel(project.target_ids)}</span>
                  {project.integration_hours > 0 && (
                    <>
                      <span className="alm-proj-list__item-dot" />
                      <span className="alm-mono">{formatIntegrationHours(project.integration_hours)}</span>
                    </>
                  )}
                  {project.cleanup_state.reclaimable_bytes > 0 && (
                    <>
                      <span className="alm-proj-list__item-dot" />
                      <span className="alm-mono">{formatBytes(project.cleanup_state.reclaimable_bytes)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </li>
        ))}
      </ul>

      {filtered.length === 0 && (
        <div className="alm-proj-list__empty">
          {search ? `No projects match "${search}"` : 'No projects match filters'}
        </div>
      )}

      {/* Footer: new project button */}
      <div className="alm-proj-list__footer">
        <Btn variant="primary" size="sm" onClick={onNewProject} data-tour="new-project">
          + New project
        </Btn>
      </div>
    </div>
  );
}
