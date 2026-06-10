/**
 * ProjectsList -- list sidebar for Projects page.
 * Uses fixture data. Design V3 rewrite.
 */

import { useState, useMemo } from 'react';
import { ListSidebar, ListItem } from '@/components';
import { Pill, Btn } from '@/ui';
import type { ProjectFixture } from '@/data/fixtures/projects';
import type { PillVariant } from '@/ui';

// ─── Helpers ────────────────────────────────────────────────────────────────

function projectVariant(state: ProjectFixture['state']): PillVariant {
  switch (state) {
    case 'completed':
    case 'archived':
      return 'ok';
    case 'processing':
      return 'info';
    case 'prepared':
      return 'accent';
    case 'ready':
      return 'neutral';
    case 'blocked':
      return 'danger';
    case 'setup_incomplete':
      return 'ghost';
    default:
      return 'neutral';
  }
}

function stateLabel(state: ProjectFixture['state']): string {
  switch (state) {
    case 'setup_incomplete': return 'Setup';
    case 'ready': return 'Ready';
    case 'prepared': return 'Prepared';
    case 'processing': return 'Processing';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
    case 'blocked': return 'Blocked';
    default: return state;
  }
}

type FilterState = 'all' | ProjectFixture['state'];
type SortBy = 'updated' | 'name';
type GroupBy = 'none' | 'state';

const FILTER_OPTIONS: { value: FilterState; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'blocked', label: 'Blocked' },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProjectsListProps {
  projects: ProjectFixture[];
  selectedId: number;
  onSelect: (id: number) => void;
  /** Controlled lifecycle filter (URL-backed, multi-value). Empty = no filter. */
  lifecycle: ProjectFixture['state'][];
  onLifecycleChange: (states: ProjectFixture['state'][]) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectsList({
  projects,
  selectedId,
  onSelect,
  lifecycle,
  onLifecycleChange,
}: ProjectsListProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy, setSortBy] = useState<SortBy>('updated');

  // The select is single-value; the URL param is an array. Show the lone
  // selection, or 'all' when empty / multi-valued (e.g. from a pasted link).
  const filter: FilterState = lifecycle.length === 1 ? lifecycle[0] : 'all';

  const filtered = useMemo(() => {
    let result = projects;
    if (lifecycle.length > 0) {
      result = result.filter((p) => lifecycle.includes(p.state));
    }
    if (sortBy === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    }
    return result;
  }, [projects, lifecycle, sortBy]);

  return (
    <ListSidebar
      placeholder="Search projects..."
      controls={
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 8px' }}>
          <select
            className="alm-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
          >
            <option value="none">Group: none</option>
            <option value="state">Group: state</option>
          </select>
          <select
            className="alm-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort by"
          >
            <option value="updated">Sort: updated</option>
            <option value="name">Sort: name</option>
          </select>
          <select
            className="alm-select"
            value={filter}
            onChange={(e) => {
              const v = e.target.value as FilterState;
              onLifecycleChange(v === 'all' ? [] : [v]);
            }}
            aria-label="Filter"
          >
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      }
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="alm-list-sidebar__count">{filtered.length} projects</span>
          <Btn variant="accent" size="sm">+ New project</Btn>
        </div>
      }
    >
      {filtered.map((project) => (
        <ListItem
          key={project.id}
          selected={project.id === selectedId}
          onClick={() => onSelect(project.id)}
          title={
            <>
              {project.state === 'blocked' && (
                <span style={{ color: 'var(--alm-color-danger)', marginRight: 4 }} aria-label="Blocked">
                  &#x26A0;
                </span>
              )}
              {project.name}
            </>
          }
          pills={<Pill variant={projectVariant(project.state)}>{stateLabel(project.state)}</Pill>}
          meta={
            <span>
              {project.target}
              {project.hours > 0 && <> &middot; {project.hours}h</>}
              {project.size !== '0' && <> &middot; {project.size}</>}
            </span>
          }
        />
      ))}
    </ListSidebar>
  );
}
