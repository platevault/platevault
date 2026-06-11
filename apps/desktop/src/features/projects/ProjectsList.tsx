/**
 * ProjectsList -- list sidebar for Projects page.
 * Spec 008: works with ProjectSummaryDto (real DB shape) instead of fixtures.
 */

import { useState, useMemo } from 'react';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';
import type { PillVariant } from '@/ui';
import type { ProjectSummaryDto } from '@/bindings/index';

// ─── Helpers ────────────────────────────────────────────────────────────────

function projectVariant(lifecycle: string): PillVariant {
  switch (lifecycle) {
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

function stateLabel(lifecycle: string): string {
  switch (lifecycle) {
    case 'setup_incomplete': return 'Setup';
    case 'ready':            return 'Ready';
    case 'prepared':         return 'Prepared';
    case 'processing':       return 'Processing';
    case 'completed':        return 'Completed';
    case 'archived':         return 'Archived';
    case 'blocked':          return 'Blocked';
    default:                 return lifecycle;
  }
}

type SortBy = 'updated' | 'name';

const LIFECYCLE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'setup_incomplete', label: 'Setup incomplete' },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProjectsListProps {
  projects: ProjectSummaryDto[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  lifecycle: string[];
  onLifecycleChange: (states: string[]) => void;
  loading?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectsList({
  projects,
  selectedId,
  onSelect,
  lifecycle,
  onLifecycleChange,
  loading = false,
}: ProjectsListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('updated');

  const filterValue = lifecycle.length === 1 ? lifecycle[0] : 'all';

  const filtered = useMemo(() => {
    const sorted =
      sortBy === 'name'
        ? [...projects].sort((a, b) => a.name.localeCompare(b.name))
        : projects; // already updated_at-desc from the backend
    return sorted;
  }, [projects, sortBy]);

  if (loading && projects.length === 0) {
    return (
      <ListSidebar placeholder="Search projects…">
        <div style={{ padding: 'var(--alm-sp-4)', color: 'var(--alm-text-muted)' }}>
          Loading projects…
        </div>
      </ListSidebar>
    );
  }

  return (
    <ListSidebar
      placeholder="Search projects…"
      controls={
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 8px' }}>
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
            value={filterValue}
            onChange={(e) => {
              const v = e.target.value;
              onLifecycleChange(v === 'all' ? [] : [v]);
            }}
            aria-label="Filter lifecycle"
          >
            {LIFECYCLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      }
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="alm-list-sidebar__count">{filtered.length} projects</span>
        </div>
      }
    >
      {filtered.length === 0 && (
        <div style={{ padding: 'var(--alm-sp-4)', color: 'var(--alm-text-muted)' }}>
          No projects found.
        </div>
      )}
      {filtered.map((project) => (
        <ListItem
          key={project.id}
          selected={project.id === selectedId}
          onClick={() => onSelect(project.id)}
          title={
            <>
              {project.lifecycle === 'blocked' && (
                <span
                  style={{ color: 'var(--alm-danger)', marginRight: 4 }}
                  aria-label="Blocked"
                >
                  &#x26A0;
                </span>
              )}
              {project.name}
            </>
          }
          pills={
            <Pill variant={projectVariant(project.lifecycle)}>
              {stateLabel(project.lifecycle)}
            </Pill>
          }
          meta={
            <span>
              {project.sourceCount > 0 && <>{project.sourceCount} sources</>}
              {project.channelDrift && (
                <span
                  style={{ color: 'var(--alm-warn)', marginLeft: 4 }}
                  title="Channel drift detected"
                >
                  ⚠ channels
                </span>
              )}
            </span>
          }
        />
      ))}
    </ListSidebar>
  );
}
