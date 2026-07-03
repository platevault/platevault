/**
 * SessionsTable — spec 043 §4 Sessions redesign (task #36) + multi-level
 * grouping (spec 043 gold-standard, shared groupByDimensions engine).
 *
 * The table receives an ordered `dims` prop from SessionsPage (fed by
 * `useGrouping`) and produces collapsible multi-level group headers via the
 * shared `groupByDimensions` + `flattenVisibleGroups` + `useCollapsibleGroups`
 * machinery. When `dims` is empty the table renders a flat sorted list (no
 * synthetic "All" header).
 *
 * Columns: Target · Filter · Frames · Integration · Night · Camera · State ·
 * Projects. Sortable column headers call `onSort`. Selecting a row opens the
 * existing SessionDetail in a right-side drawer on SessionsPage.
 */

import { useMemo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { InventorySource, InventorySession } from '@/bindings/index';
import { Table, Pill } from '@/ui';
import { SortHeader } from '@/components';
import { m } from '@/lib/i18n';
import type { TableColumn, TableRow } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';
import {
  groupByDimensions,
  flattenVisibleGroups,
  type DimensionAccessor,
} from '@/lib/grouping';
import { useCollapsibleGroups } from '@/lib/use-grouping';

// ── Sort model ────────────────────────────────────────────────────────────────

export type SessionSortCol =
  | 'target'
  | 'filter'
  | 'frames'
  | 'exposure'
  | 'night'
  | 'camera'
  | 'state';
export type SortDir = 'asc' | 'desc';

export interface SessionSort {
  col: SessionSortCol;
  dir: SortDir;
}

export const DEFAULT_SESSION_SORT: SessionSort = { col: 'night', dir: 'desc' };

// ── Grouping dimensions ────────────────────────────────────────────────────────

export const SESSION_ACCESSORS: Readonly<Record<string, DimensionAccessor<InventorySession>>> = {
  target: (s) => s.target ?? s.name,
  filter: (s) => s.filter,
  night: (s) => s.capturedOn,
  camera: (s) => s.camera,
  month: (s) => s.capturedOn?.slice(0, 7),
};

// ── Sort helpers ────────────────────────────────────────────────────────────────

function compareStr(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '');
}

function compareSessions(a: InventorySession, b: InventorySession, sort: SessionSort): number {
  let cmp = 0;
  switch (sort.col) {
    case 'target':
      cmp = compareStr(a.target ?? a.name, b.target ?? b.name);
      break;
    case 'filter':
      cmp = compareStr(a.filter, b.filter);
      break;
    case 'frames':
      cmp = a.frames - b.frames;
      break;
    case 'exposure':
      cmp = compareStr(a.exposure, b.exposure);
      break;
    case 'night':
      cmp = compareStr(a.capturedOn, b.capturedOn);
      break;
    case 'camera':
      cmp = compareStr(a.camera, b.camera);
      break;
    case 'state':
      cmp = compareStr(a.state, b.state);
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

// ── Column model ────────────────────────────────────────────────────────────────

// `label` is a render-time thunk so headers re-read the active locale (spec 046 #8).
const COLUMNS: Array<{ key: string; label: () => string; sort?: SessionSortCol; className?: string }> = [
  { key: 'target', label: () => m.projects_create_target_label(), sort: 'target' },
  { key: 'filter', label: () => m.common_filter(), sort: 'filter' },
  { key: 'frames', label: () => m.projects_wizard_col_frames(), sort: 'frames', className: 'alm-sessions-cell--num' },
  { key: 'integration', label: () => m.projects_wizard_col_integration(), sort: 'exposure', className: 'alm-sessions-cell--mono' },
  { key: 'night', label: () => m.sessions_col_night(), sort: 'night', className: 'alm-sessions-cell--mono' },
  { key: 'camera', label: () => m.settings_calmatch_camera(), sort: 'camera', className: 'alm-sessions-cell--muted' },
  { key: 'state', label: () => m.sessions_col_state(), sort: 'state' },
  { key: 'projects', label: () => m.common_projects() },
];

const EMPTY_CELLS = {
  filter: '' as string | ReactNode,
  frames: '' as string | ReactNode | number,
  integration: '' as string | ReactNode,
  night: '' as string | ReactNode,
  camera: '' as string | ReactNode,
  state: '' as string | ReactNode,
  projects: '' as string | ReactNode,
};

const INDENT_PER_DEPTH = 12;

function isNeedsReview(state: string): boolean {
  return state === 'discovered' || state === 'candidate' || state === 'needs_review';
}

function stateLabel(state: string): string {
  return isNeedsReview(state) ? m.sessions_needs_review_aria() : sessionStateLabel(state);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  sources: InventorySource[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  sort: SessionSort;
  onSort: (col: SessionSortCol) => void;
  /**
   * Active ordered grouping dimension ids. Supplied by SessionsPage via
   * `useGrouping`. When empty the table renders a flat sorted list.
   */
  dims?: string[];
}

export function SessionsTable({
  sources,
  selected,
  onSelect,
  loading,
  sort,
  onSort,
  dims = [],
}: Props) {
  const { collapsed, toggle } = useCollapsibleGroups();

  // Flatten all sessions across sources, then sort.
  const allSessions = useMemo<InventorySession[]>(() => {
    const flat: InventorySession[] = [];
    for (const src of sources) flat.push(...src.sessions);
    return [...flat].sort((a, b) => compareSessions(a, b, sort));
  }, [sources, sort]);

  // Build the group tree (or a flat pass-through when dims is empty).
  const tree = useMemo(
    () => groupByDimensions(allSessions, dims, SESSION_ACCESSORS),
    [allSessions, dims],
  );

  const visualRows = useMemo(
    () => flattenVisibleGroups(tree, collapsed),
    [tree, collapsed],
  );

  // Build sortable column headers.
  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    label: c.sort ? (
      <SortHeader
        label={c.label()}
        active={sort.col === c.sort}
        dir={sort.dir}
        onClick={() => onSort(c.sort as SessionSortCol)}
        ariaLabel={m.sessions_sort_by_aria({ col: c.label() })}
      />
    ) : (
      c.label()
    ),
  }));

  const grouped = dims.length > 0;

  const rows: TableRow[] = useMemo(
    () =>
      visualRows.map((row) => {
        if (row.kind === 'header') {
          const { node, depth, path, collapsed: isCollapsed } = row;
          return {
            _rowClassName: 'alm-listgroup',
            target: (
              <button
                type="button"
                className="alm-listgroup__cell"
                data-testid={`sessions-group-${node.dimension}-${node.key}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggle(path)}
                // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based group-header indent
                style={{ paddingLeft: 8 + depth * INDENT_PER_DEPTH }}
              >
                <span className="alm-listgroup__caret" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="alm-listgroup__label">{node.label}</span>
                <span className="alm-listgroup__count">{node.count}</span>
              </button>
            ),
            ...EMPTY_CELLS,
          };
        }

        // Flat item or grouped leaf.
        const s = row.item;
        const indentPx = grouped ? 8 + row.depth * INDENT_PER_DEPTH : 0;
        const needsReview = isNeedsReview(s.state);
        const projects = s.linked?.projects ?? [];
        return {
          _rowClassName:
            'alm-sessions-table__row' +
            (selected === s.id ? ' alm-sessions-table__row--selected' : ''),
          _onClick: () => onSelect(s.id),
          target: needsReview ? (
            <span
              className="alm-sessions-cell--muted"
              // eslint-disable-next-line no-restricted-syntax -- dynamic: nested-group leaf indent
              style={indentPx ? { paddingLeft: indentPx } : undefined}
            >
              <AlertTriangle
                size={11}
                role="img"
                aria-label={m.sessions_needs_review_aria()}
                className="alm-sessions-cell__warn-icon"
              />
            </span>
          ) : (
            // eslint-disable-next-line no-restricted-syntax -- dynamic: nested-group leaf indent
            indentPx ? <span style={{ paddingLeft: indentPx }} /> : ''
          ),
          filter: s.filter ?? '—',
          frames: s.frames,
          integration: s.exposure ?? '—',
          night: s.capturedOn ?? '—',
          camera: s.camera ?? '—',
          state: (
            <Pill variant={sessionStateVariant(s.state)}>{stateLabel(s.state)}</Pill>
          ),
          projects:
            projects.length > 0 ? (
              <span className="alm-sessions-cell__projects">
                {projects.map((p) => (
                  <Pill key={p.id} variant="info">
                    {p.name}
                  </Pill>
                ))}
              </span>
            ) : (
              <span className="alm-sessions-cell--muted">—</span>
            ),
        };
      }),
    [visualRows, selected, onSelect, toggle, grouped],
  );

  if (allSessions.length === 0 && !loading) {
    return (
      <div className="alm-sessions-table__empty">{m.sessions_no_match()}</div>
    );
  }

  return <Table className="alm-sessions-table" columns={columns} rows={rows} />;
}
