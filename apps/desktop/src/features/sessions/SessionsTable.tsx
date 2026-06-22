/**
 * SessionsTable — spec 043 §4 Sessions redesign (task #36).
 *
 * Replaces the old narrow `alm-sessions-list` sidebar with a DENSE, FULL-WIDTH
 * sortable table — the same surface pattern as the Audit Log and Equipment
 * settings panes (shared `Table` from `@/ui`). Sessions are flattened across
 * inventory sources and GROUPED BY TARGET: each target is a spanning header
 * row, with its sessions listed beneath.
 *
 * Columns: Target · Filter · Frames · Integration · Night · Camera · State ·
 * Projects. State renders as a full-label `Pill` (Confirmed / Needs review —
 * never truncated). The observing NIGHT (capturedOn) is shown once.
 *
 * Sort: clickable sortable column headers (Target / Filter / Frames /
 * Integration / Night / Camera / State). Grouping by target is always on; the
 * sort orders sessions WITHIN each target group, and orders the target groups
 * themselves by their first row.
 *
 * Selecting a row opens the existing SessionDetail in a right-side drawer on
 * SessionsPage. Confirm/Reject live in the page top action bar (unchanged).
 *
 * Search + frame-type/review filters now live in the persistent top toolbar
 * (SessionsToolbar, rendered in `.alm-page__bar`), not inside this surface.
 */

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { InventorySource, InventorySession } from '@/api/commands';
import { Table, Pill } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';

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

// ── Target grouping ─────────────────────────────────────────────────────────────

interface TargetGroup {
  target: string;
  sessions: InventorySession[];
}

/**
 * Flatten all sessions across sources, group by target identity, sort sessions
 * within each group, then order the groups by their first (sorted) row.
 */
function groupByTarget(sources: InventorySource[], sort: SessionSort): TargetGroup[] {
  const byTarget = new Map<string, InventorySession[]>();
  for (const src of sources) {
    for (const s of src.sessions) {
      const key = s.target ?? s.name ?? 'Untitled';
      const list = byTarget.get(key);
      if (list) list.push(s);
      else byTarget.set(key, [s]);
    }
  }

  const groups: TargetGroup[] = [];
  for (const [target, sessions] of byTarget) {
    groups.push({ target, sessions: [...sessions].sort((a, b) => compareSessions(a, b, sort)) });
  }

  // Order groups by their first row under the active sort (target-name sort
  // collapses to alphabetical group order, which reads naturally).
  groups.sort((ga, gb) => {
    if (sort.col === 'target') return compareSessions(ga.sessions[0], gb.sessions[0], sort);
    const c = compareSessions(ga.sessions[0], gb.sessions[0], sort);
    return c !== 0 ? c : ga.target.localeCompare(gb.target);
  });
  return groups;
}

// ── Column model ────────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: string; label: string; sort?: SessionSortCol; className?: string }> = [
  { key: 'target', label: 'Target', sort: 'target' },
  { key: 'filter', label: 'Filter', sort: 'filter' },
  { key: 'frames', label: 'Frames', sort: 'frames', className: 'alm-sessions-cell--num' },
  { key: 'integration', label: 'Integration', sort: 'exposure', className: 'alm-sessions-cell--mono' },
  { key: 'night', label: 'Night', sort: 'night', className: 'alm-sessions-cell--mono' },
  { key: 'camera', label: 'Camera', sort: 'camera', className: 'alm-sessions-cell--muted' },
  { key: 'state', label: 'State', sort: 'state' },
  { key: 'projects', label: 'Projects' },
];

function isNeedsReview(state: string): boolean {
  return state === 'discovered' || state === 'candidate' || state === 'needs_review';
}

function stateLabel(state: string): string {
  // Full label, never truncated: all "needs review"-class states collapse to a
  // single readable label; everything else uses the canonical lifecycle label.
  return isNeedsReview(state) ? 'Needs review' : sessionStateLabel(state);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  sources: InventorySource[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  sort: SessionSort;
  onSort: (col: SessionSortCol) => void;
}

export function SessionsTable({ sources, selected, onSelect, loading, sort, onSort }: Props) {
  const groups = useMemo(() => groupByTarget(sources, sort), [sources, sort]);
  const total = useMemo(
    () => sources.reduce((acc, src) => acc + src.sessions.length, 0),
    [sources],
  );

  // Build sortable header labels as button elements (column header passthrough).
  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    label: c.sort ? (
      <button
        type="button"
        className={
          'alm-sessions-sorth' + (sort.col === c.sort ? ' alm-sessions-sorth--active' : '')
        }
        onClick={() => onSort(c.sort as SessionSortCol)}
        aria-label={`Sort by ${c.label}`}
      >
        {c.label}
        {sort.col === c.sort && (
          <span className="alm-sessions-sorth__arrow" aria-hidden="true">
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    ) : (
      c.label
    ),
  }));

  // Flatten groups into rows: a spanning group header row, then session rows.
  const rows: TableRow[] = [];
  for (const group of groups) {
    rows.push({
      _rowClassName: 'alm-sessions-table__group',
      target: (
        <span>
          {group.target}
          <span className="alm-sessions-table__group-count">
            {group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}
          </span>
        </span>
      ),
      // Remaining cells render empty for the group header row.
      filter: '',
      frames: '',
      integration: '',
      night: '',
      camera: '',
      state: '',
      projects: '',
    });

    for (const s of group.sessions) {
      const needsReview = isNeedsReview(s.state);
      const projects = s.linked?.projects ?? [];
      rows.push({
        _rowClassName:
          'alm-sessions-table__row' +
          (selected === s.id ? ' alm-sessions-table__row--selected' : ''),
        _onClick: () => onSelect(s.id),
        // Target is the group headline; per-session rows carry only the
        // needs-review marker here so the column stays aligned without
        // repeating the target name on every row.
        target: needsReview ? (
          <span className="alm-sessions-cell--muted">
            <AlertTriangle
              size={11}
              role="img"
              aria-label="Needs review"
              className="alm-sessions-cell__warn-icon"
            />
          </span>
        ) : (
          ''
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
      });
    }
  }

  if (groups.length === 0 && !loading) {
    return (
      <div className="alm-sessions-table__empty">No sessions match the current filters.</div>
    );
  }

  return (
    <div>
      <Table className="alm-sessions-table" columns={columns} rows={rows} />
      <div className="alm-sessions-table__footer">
        {loading ? 'Loading…' : `${total} ${total === 1 ? 'session' : 'sessions'}`}
      </div>
    </div>
  );
}
