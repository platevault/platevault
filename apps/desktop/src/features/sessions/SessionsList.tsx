/**
 * SessionsList — spec 006 inventory ledger, grouped by InventorySource.
 *
 * Rendered inside the narrow `alm-list-sidebar` of the two-pane layout, so it
 * uses the SAME list-row pattern as the other master-detail pages (Inbox,
 * Calibration, Archive): a shared `ListItem` with a primary label (target) and
 * a compact secondary meta line (filter · night · frames), plus a full-label
 * state `Pill` (Confirmed / Needs review). This replaces the previous 6-column
 * sortable table, whose columns truncated badly at ~279px. Full session detail
 * lives in the detail pane on selection.
 *
 * Sort is preserved via a single sort dropdown in the controls area (was the
 * clickable table column headers). Search and the frame/review filters are
 * unchanged. Confirm/Reject behaviour lives in the detail/top bar, not here.
 */

import { useState, useMemo, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { InventorySource, InventorySession } from '@/api/commands';
import { ListSidebar, ListItem } from '@/components';
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

/** Sort options exposed in the single sort dropdown (value = `${col}:${dir}`). */
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'night:desc', label: 'Night (newest)' },
  { value: 'night:asc', label: 'Night (oldest)' },
  { value: 'target:asc', label: 'Target (A–Z)' },
  { value: 'target:desc', label: 'Target (Z–A)' },
  { value: 'filter:asc', label: 'Filter (A–Z)' },
  { value: 'frames:desc', label: 'Frames (most)' },
  { value: 'frames:asc', label: 'Frames (fewest)' },
  { value: 'exposure:asc', label: 'Exposure (A–Z)' },
  { value: 'state:asc', label: 'State (A–Z)' },
];

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

// ── Session list row ───────────────────────────────────────────────────────────

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
  const stateLabel = needsReview ? 'Needs review' : sessionStateLabel(session.state);

  // Compact secondary meta line: filter · night · frames (em-dash for absent).
  const metaParts = [
    session.filter ?? '—',
    session.capturedOn ?? '—',
    `${session.frames} frames`,
  ];

  return (
    <ListItem
      selected={selected}
      onClick={() => onSelect(session.id)}
      title={
        <>
          <span className="alm-session-row__target">
            {session.target ?? session.name}
          </span>
          {needsReview && (
            <AlertTriangle
              size={10}
              role="img"
              aria-label="Needs review"
              className="alm-session-row__needs-review-icon"
            />
          )}
        </>
      }
      pills={
        <Pill variant={sessionStateVariant(session.state)}>{stateLabel}</Pill>
      }
      meta={metaParts.join(' · ')}
    />
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

  const handleSortChange = useCallback((value: string) => {
    const [col, dir] = value.split(':') as [SortCol, SortDir];
    setSort({ col, dir });
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
        <div className="alm-sessions-list__controls">
          <div className="alm-sessions-list__filter-row">
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

            {/* Sort control (was the clickable table column headers). */}
            <select
              value={`${sort.col}:${sort.dir}`}
              onChange={(e) => handleSortChange(e.target.value)}
              aria-label="Sort sessions"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  Sort: {o.label}
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
        <div key={src.id} className="alm-sessions-list__group">
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

          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              selected={selected === s.id}
              onSelect={onSelect}
            />
          ))}
          {sessions.length === 0 && (
            <div className="alm-list-empty">No sessions in this source.</div>
          )}
        </div>
      ))}
    </ListSidebar>
  );
}
