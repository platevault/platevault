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
 * Search + the review filter + the Group-by control now live in the persistent
 * top bar (shared PageTopBar + FilterToolbar), not inside this surface. The
 * group key is configurable via the `groupBy` prop (Target / Camera / Filter /
 * Month); the legacy frame-type filter was removed (sessions are light frames).
 */

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { InventorySource, InventorySession } from '@/api/commands';
import { Table, Pill } from '@/ui';
import { m } from '@/lib/i18n';
import type { TableColumn, TableRow } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';

// ── Grouping model ────────────────────────────────────────────────────────────

/** What the table groups rows by (spec 043 §4 toolbar Group-by control). */
export type SessionGroupBy = 'target' | 'camera' | 'filter' | 'month';
export const DEFAULT_SESSION_GROUP_BY: SessionGroupBy = 'target';

/** Resolve the group key + display headline for a session under `groupBy`. */
function groupKeyOf(s: InventorySession, groupBy: SessionGroupBy): string {
  switch (groupBy) {
    case 'camera':
      return s.camera ?? 'Unknown camera';
    case 'filter':
      return s.filter ?? 'No filter';
    case 'month':
      // capturedOn is an ISO date (e.g. "2026-04-12"); group by year-month.
      return s.capturedOn ? s.capturedOn.slice(0, 7) : 'Unknown date';
    case 'target':
    default:
      return s.target ?? s.name ?? 'Untitled';
  }
}

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

// ── Grouping ──────────────────────────────────────────────────────────────────

interface SessionGroup {
  /** Display headline for the spanning group-header row. */
  label: string;
  sessions: InventorySession[];
}

/**
 * Flatten all sessions across sources, group by the selected key, sort sessions
 * within each group, then order the groups by their first (sorted) row.
 */
function groupSessions(
  sources: InventorySource[],
  sort: SessionSort,
  groupBy: SessionGroupBy,
): SessionGroup[] {
  const byKey = new Map<string, InventorySession[]>();
  for (const src of sources) {
    for (const s of src.sessions) {
      const key = groupKeyOf(s, groupBy);
      const list = byKey.get(key);
      if (list) list.push(s);
      else byKey.set(key, [s]);
    }
  }

  const groups: SessionGroup[] = [];
  for (const [label, sessions] of byKey) {
    groups.push({ label, sessions: [...sessions].sort((a, b) => compareSessions(a, b, sort)) });
  }

  // Order groups by their first row under the active sort, breaking ties by the
  // group label so ordering stays stable and reads naturally.
  groups.sort((ga, gb) => {
    const c = compareSessions(ga.sessions[0], gb.sessions[0], sort);
    return c !== 0 ? c : ga.label.localeCompare(gb.label);
  });
  return groups;
}

// ── Column model ────────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: string; label: string; sort?: SessionSortCol; className?: string }> = [
  { key: 'target', label: m.projects_create_target_label(), sort: 'target' },
  { key: 'filter', label: m.common_filter(), sort: 'filter' },
  { key: 'frames', label: m.projects_wizard_col_frames(), sort: 'frames', className: 'alm-sessions-cell--num' },
  { key: 'integration', label: m.projects_wizard_col_integration(), sort: 'exposure', className: 'alm-sessions-cell--mono' },
  { key: 'night', label: m.sessions_col_night(), sort: 'night', className: 'alm-sessions-cell--mono' },
  { key: 'camera', label: m.settings_calmatch_camera(), sort: 'camera', className: 'alm-sessions-cell--muted' },
  { key: 'state', label: m.sessions_col_state(), sort: 'state' },
  { key: 'projects', label: m.common_projects() },
];

function isNeedsReview(state: string): boolean {
  return state === 'discovered' || state === 'candidate' || state === 'needs_review';
}

function stateLabel(state: string): string {
  // Full label, never truncated: all "needs review"-class states collapse to a
  // single readable label; everything else uses the canonical lifecycle label.
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
  /** Key the spanning group-header rows are built from. Default 'target'. */
  groupBy?: SessionGroupBy;
}

export function SessionsTable({
  sources,
  selected,
  onSelect,
  loading,
  sort,
  onSort,
  groupBy = DEFAULT_SESSION_GROUP_BY,
}: Props) {
  const groups = useMemo(
    () => groupSessions(sources, sort, groupBy),
    [sources, sort, groupBy],
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
          {group.label}
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
        // The group headline lives on the spanning header row; per-session
        // rows carry only the needs-review marker in the first column so it
        // stays aligned without repeating the group label on every row.
        target: needsReview ? (
          <span className="alm-sessions-cell--muted">
            <AlertTriangle
              size={11}
              role="img"
              aria-label={m.sessions_needs_review_aria()}
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
      <div className="alm-sessions-table__empty">{m.sessions_no_match()}</div>
    );
  }

  // The total count moved to the bottom status bar (top-bar convention,
  // task #80) — no in-table footer count line.
  return <Table className="alm-sessions-table" columns={columns} rows={rows} />;
}
