/**
 * ProjectsList -- list sidebar for Projects page.
 * Spec 008: works with ProjectSummaryDto (real DB shape) instead of fixtures.
 */

import { useMemo, useState } from 'react';
import { Menu } from '@base-ui-components/react/menu';
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

type SortBy = 'updated' | 'name' | 'created' | 'sources';

// All selectable lifecycle states (excludes the synthetic 'all' sentinel — empty array means all).
const LIFECYCLE_STATES: Array<{ value: string; label: string }> = [
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'prepared', label: 'Prepared' },
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

  const filtered = useMemo(() => {
    let sorted: typeof projects;
    if (sortBy === 'name') {
      sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'created') {
      sorted = [...projects].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } else if (sortBy === 'sources') {
      sorted = [...projects].sort((a, b) => b.sourceCount - a.sourceCount);
    } else {
      sorted = projects; // 'updated': already updated_at-desc from the backend
    }
    // Apply multiselect lifecycle filter (empty = show all).
    if (lifecycle.length === 0) return sorted;
    return sorted.filter((p) => lifecycle.includes(p.lifecycle));
  }, [projects, sortBy, lifecycle]);

  const handleLifecycleToggle = (value: string, checked: boolean) => {
    if (checked) {
      onLifecycleChange([...lifecycle, value]);
    } else {
      onLifecycleChange(lifecycle.filter((v) => v !== value));
    }
  };

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
            <option value="created">Sort: created</option>
            <option value="name">Sort: name</option>
            <option value="sources">Sort: sources</option>
          </select>
          {/* FR-022 / T055: multiselect lifecycle filter.
              base-ui Menu provides click-outside dismiss + Escape-to-close +
              focus management (replaces the prior hand-rolled dropdown, which
              had neither). `closeOnClick={false}` keeps the menu open while the
              user toggles multiple states. */}
          <Menu.Root>
            <Menu.Trigger
              className="alm-select"
              aria-label="Filter lifecycle"
              style={{ cursor: 'pointer', minWidth: 110, textAlign: 'left' }}
            >
              {lifecycle.length === 0
                ? 'State: all'
                : lifecycle.length === 1
                  ? `State: ${LIFECYCLE_STATES.find((s) => s.value === lifecycle[0])?.label ?? lifecycle[0]}`
                  : `State: ${lifecycle.length} selected`}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="alm-menu__positioner" sideOffset={4} align="start">
                <Menu.Popup className="alm-menu__popup" aria-label="Lifecycle states">
                  <Menu.CheckboxItem
                    className="alm-menu__item"
                    closeOnClick={false}
                    checked={lifecycle.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) onLifecycleChange([]);
                    }}
                    aria-label="All states"
                  >
                    <Menu.CheckboxItemIndicator className="alm-menu__indicator">
                      &#x2713;
                    </Menu.CheckboxItemIndicator>
                    <span className="alm-menu__label">All</span>
                  </Menu.CheckboxItem>
                  {LIFECYCLE_STATES.map((opt) => (
                    <Menu.CheckboxItem
                      key={opt.value}
                      className="alm-menu__item"
                      closeOnClick={false}
                      checked={lifecycle.includes(opt.value)}
                      onCheckedChange={(checked) => handleLifecycleToggle(opt.value, checked)}
                      aria-label={opt.label}
                    >
                      <Menu.CheckboxItemIndicator className="alm-menu__indicator">
                        &#x2713;
                      </Menu.CheckboxItemIndicator>
                      <span className="alm-menu__label">{opt.label}</span>
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
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
