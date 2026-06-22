/**
 * SessionsList — spec 006, dense sortable table grouped by InventorySource.
 *
 * Renders the inventory ledger as a sortable table with columns:
 *   Target | Filter | Night | Frames | Exposure | State
 *
 * Column headers are clickable to toggle asc/desc sort for that column.
 * An active-sort caret (▲/▼) is shown on the sorted column header.
 * Default sort: by night (capturedOn) descending.
 *
 * Grouping is by InventorySource (library root path) — source group headers
 * are preserved so each drive/root is visually separated and test-observable.
 *
 * // STUB: full-width table + bottom inspector (inbox parity) — future agent
 * // The deferred IA consolidation (full-width layout replacing the list pane,
 * // bottom inspector replacing the detail pane, inbox-style multi-level
 * // grouping configurator) is intentionally NOT done here. The existing
 * // master-detail layout (ListDetailLayout + detail pane + rail) is kept
 * // working. Only the left-list rendering changes from card rows → table rows.
 */

import { useState, useMemo, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { InventorySource, InventorySession } from '@/api/commands';
import { ListSidebar } from '@/components';
import { Pill } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';
import type { InventoryFrameFilter, ReviewFilter } from '@/lib/route-contract';
import { INVENTORY_FRAME_FILTERS, REVIEW_FILTERS } from '@/lib/route-contract';

// ── Source-state label helpers ────────────────────────────────────────────────

const SOURCE_STATE_LABELS: Record<string, string> = {
  active: 'active',
  missing: 'missing',
  disabled: 'disabled',
  reconnect_required: 'reconnect required',
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  local_disk: 'local disk',
  external_disk: 'external disk',
  removable: 'removable',
  network_share: 'network share',
};

function sourceMetaLine(src: InventorySource): string {
  const kind = SOURCE_KIND_LABELS[src.kind] ?? src.kind;
  const state = SOURCE_STATE_LABELS[src.state] ?? src.state;
  return src.state === 'active' ? kind : `${kind} · ${state}`;
}

// ── Review-filter display labels ──────────────────────────────────────────────

function reviewFilterLabel(v: string): string {
  if (v === 'discovered' || v === 'candidate') return 'Needs review (discovered/candidate)';
  if (v === 'needs_review') return 'Needs review';
  if (v === 'all') return 'All states';
  return sessionStateLabel(v);
}

// ── Sort model ────────────────────────────────────────────────────────────────

type SortCol = 'target' | 'filter' | 'night' | 'frames' | 'exposure' | 'state';
type SortDir = 'asc' | 'desc';

interface SortState {
  col: SortCol;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { col: 'night', dir: 'desc' };

function compareStr(a: string | null | undefined, b: string | null | undefined): number {
  const av = a ?? '';
  const bv = b ?? '';
  return av.localeCompare(bv);
}

function sortSessions(sessions: InventorySession[], sort: SortState): InventorySession[] {
  const sorted = [...sessions];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.col) {
      case 'target':
        cmp = compareStr(a.target, b.target);
        break;
      case 'filter':
        cmp = compareStr(a.filter, b.filter);
        break;
      case 'night':
        cmp = compareStr(a.capturedOn, b.capturedOn);
        break;
      case 'frames':
        cmp = a.frames - b.frames;
        break;
      case 'exposure':
        // Sort lexicographically on the exposure string (e.g. "300s", "600s").
        // Numeric parse would be better but the string values are not normalised
        // across all fixture/real data, so locale sort is safe for now.
        cmp = compareStr(a.exposure, b.exposure);
        break;
      case 'state':
        cmp = compareStr(a.state, b.state);
        break;
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// ── Column header button ──────────────────────────────────────────────────────

function ThBtn({
  col,
  label,
  sort,
  onSort,
}: {
  col: SortCol;
  label: string;
  sort: SortState;
  onSort: (col: SortCol) => void;
}) {
  const active = sort.col === col;
  const caret = active ? (sort.dir === 'asc' ? '▲' : '▼') : null;
  return (
    <button
      type="button"
      className="alm-sessions-table__th-btn"
      onClick={() => onSort(col)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {caret && (
        <span className="alm-sessions-table__sort-caret" aria-hidden="true">
          {caret}
        </span>
      )}
    </button>
  );
}

// ── Session table row ─────────────────────────────────────────────────────────

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: InventorySession;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const needsReview = session.state === 'discovered' || session.state === 'candidate';
  const stateLabel =
    needsReview ? 'Needs review' : sessionStateLabel(session.state);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(session.id);
      }
    },
    [session.id, onSelect],
  );

  return (
    <tr
      className={`alm-sessions-table__row${selected ? ' alm-sessions-table__row--selected' : ''}`}
      onClick={() => onSelect(session.id)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="row"
      aria-selected={selected}
      data-session-id={session.id}
    >
      {/* Target */}
      <td className="alm-sessions-table__td-target">
        <span title={session.target ?? session.name}>
          {session.target ?? session.name}
        </span>
        {needsReview && (
          <AlertTriangle
            size={10}
            role="img"
            aria-label="Needs review"
            className="alm-sessions-table__needs-review-icon"
          />
        )}
      </td>

      {/* Filter */}
      <td className="alm-sessions-table__td-filter">
        {session.filter ?? '—'}
      </td>

      {/* Night (capturedOn) */}
      <td className="alm-sessions-table__td-night">
        {session.capturedOn ?? '—'}
      </td>

      {/* Frames */}
      <td className="alm-sessions-table__td-frames">
        {session.frames}
      </td>

      {/* Exposure */}
      <td className="alm-sessions-table__td-exposure">
        {session.exposure ?? '—'}
      </td>

      {/* State */}
      <td className="alm-sessions-table__td-state">
        <Pill variant={sessionStateVariant(session.state)}>
          {stateLabel}
        </Pill>
      </td>
    </tr>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  sources: InventorySource[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  frameFilter?: string;
  reviewFilter?: string;
  onFrameFilter: (v: InventoryFrameFilter | null) => void;
  onReviewFilter: (v: ReviewFilter | null) => void;
}

export function SessionsList({
  sources,
  selected,
  onSelect,
  loading,
  frameFilter,
  reviewFilter,
  onFrameFilter,
  onReviewFilter,
}: Props) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const totalSessions = sources.reduce((acc, src) => acc + src.sessions.length, 0);

  const handleSort = useCallback((col: SortCol) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'night' ? 'desc' : 'asc' },
    );
  }, []);

  // Pre-sort sessions for each source (memoised; re-runs only when sort changes).
  const sortedSources = useMemo(
    () => sources.map((src) => ({ src, sessions: sortSessions(src.sessions, sort) })),
    [sources, sort],
  );

  return (
    <ListSidebar
      placeholder="Search target, filter, source…"
      controls={
        <div className="alm-sessions-table__controls">
          <div className="alm-sessions-table__filter-row">
            {/* Frame type filter */}
            <select
              value={frameFilter ?? ''}
              onChange={(e) => onFrameFilter((e.target.value as InventoryFrameFilter) || null)}
              aria-label="Frame type filter"
            >
              <option value="">Frame type: all</option>
              {INVENTORY_FRAME_FILTERS.map((ft) => (
                <option key={ft} value={ft}>
                  {ft}
                </option>
              ))}
            </select>

            {/* Review state filter */}
            <select
              value={reviewFilter ?? ''}
              onChange={(e) => onReviewFilter((e.target.value as ReviewFilter) || null)}
              aria-label="Review state filter"
            >
              <option value="">Review: default</option>
              {REVIEW_FILTERS.map((rf) => (
                <option key={rf} value={rf}>
                  {reviewFilterLabel(rf)}
                </option>
              ))}
            </select>
          </div>
        </div>
      }
      footer={loading ? 'Loading…' : `${totalSessions} sessions`}
    >
      {sources.length === 0 && !loading && (
        <div className="alm-list-empty">No sessions match the current filters.</div>
      )}

      {sortedSources.map(({ src, sessions }) => (
        <div key={src.id} className="alm-sessions-table__group">
          {/* Group header: source path + kind · state (FR-005, T400) */}
          <div className="alm-source-group-header">
            <span className="alm-source-group-header__path">{src.path}</span>
            {' · '}
            <span>{sourceMetaLine(src)}</span>
            {src.state !== 'active' && (
              <Pill variant={src.state === 'disabled' ? 'danger' : 'warn'}>
                {SOURCE_STATE_LABELS[src.state] ?? src.state}
              </Pill>
            )}
          </div>

          {/* Dense sortable table */}
          <table className="alm-sessions-table" role="grid">
            <colgroup>
              <col className="alm-sessions-table__col-target" />
              <col className="alm-sessions-table__col-filter" />
              <col className="alm-sessions-table__col-night" />
              <col className="alm-sessions-table__col-frames" />
              <col className="alm-sessions-table__col-exposure" />
              <col className="alm-sessions-table__col-state" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <ThBtn col="target" label="Target" sort={sort} onSort={handleSort} />
                </th>
                <th scope="col">
                  <ThBtn col="filter" label="Filter" sort={sort} onSort={handleSort} />
                </th>
                <th scope="col">
                  <ThBtn col="night" label="Night" sort={sort} onSort={handleSort} />
                </th>
                <th scope="col">
                  <ThBtn col="frames" label="Frames" sort={sort} onSort={handleSort} />
                </th>
                <th scope="col">
                  <ThBtn col="exposure" label="Exp." sort={sort} onSort={handleSort} />
                </th>
                <th scope="col">
                  <ThBtn col="state" label="State" sort={sort} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  selected={selected === s.id}
                  onSelect={onSelect}
                />
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="alm-sessions-table__empty">
                    No sessions in this source.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </ListSidebar>
  );
}
