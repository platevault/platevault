/**
 * SessionsPage — spec 006 wired; spec 043 §4 redesign (task #36) + shared
 * layout-system adoption (tasks #62/#63/#73).
 *
 * The Sessions page is the inventory ledger and the REFERENCE adoption of the
 * shared list-page system: a pinned `PageTopBar` (title + summary counts +
 * `FilterToolbar` + right-aligned review actions) over a `ListPageLayout` body
 * — a dense full-width sortable table (SessionsTable) on the left and the
 * existing SessionDetail in a right-side detail pane that mounts on selection.
 * Confirm / Re-open / Reject are contextual (they act on the selected session)
 * and live in the SessionDetail header, not the global top bar (task #79).
 *
 * Toolbar (spec 043 §4): search + review-state filter + a Group-by control
 * (Target default / Camera / Filter / Month). The legacy frame-type filter was
 * removed — sessions are by definition light frames, so it was meaningless.
 *
 * URL state (extends spec 020):
 *   selected     — string session UUID
 *   sourceFilter — optional LibraryRoot UUID or 'all'
 *   reviewFilter — optional review-state filter including 'all' and 'ignored'
 * (group-by is UI-only local state; it does not change the data query.)
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import type { FilterOption } from '@/components';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import {
  SessionsTable,
  DEFAULT_SESSION_SORT,
  DEFAULT_SESSION_GROUP_BY,
} from './SessionsTable';
import type { SessionSort, SessionSortCol, SessionGroupBy } from './SessionsTable';
import { SessionDetail } from './SessionDetail';
import {
  useInventorySources,
  useSessionReview,
  type InventoryFilters,
} from './store';
import { addToast } from '@/shared/toast';
import type { InventorySource } from '@/api/commands';
import type { ReviewFilter } from '@/lib/route-contract';
import { REVIEW_FILTERS } from '@/lib/route-contract';
import { sessionStateLabel } from '@/lib/lifecycle';

/** Client-side text search across the visible session fields. */
function filterSourcesBySearch(sources: InventorySource[], query: string): InventorySource[] {
  const q = query.trim().toLowerCase();
  if (!q) return sources;
  const matches = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(q);
  return sources
    .map((src) => ({
      ...src,
      sessions: src.sessions.filter(
        (s) =>
          matches(s.target) ||
          matches(s.name) ||
          matches(s.filter) ||
          matches(s.camera),
      ),
    }))
    .filter((src) => src.sessions.length > 0);
}

// Toolbar option vocab (label maps live here so the generic FilterToolbar
// stays presentation-only).
function reviewFilterLabel(v: string): string {
  if (v === 'discovered' || v === 'candidate') return `Needs review (${v})`;
  if (v === 'needs_review') return 'Needs review';
  if (v === 'all') return 'All states';
  return sessionStateLabel(v);
}

const REVIEW_OPTIONS: FilterOption[] = REVIEW_FILTERS.map((rf) => ({
  value: rf,
  label: reviewFilterLabel(rf),
}));

const GROUP_BY_OPTIONS: FilterOption[] = [
  { value: 'target', label: 'Target' },
  { value: 'camera', label: 'Camera' },
  { value: 'filter', label: 'Filter' },
  { value: 'month', label: 'Month' },
];

export function SessionsPage() {
  const { selected, sourceFilter, reviewFilter } = useSearch({
    from: '/shell/sessions',
  });
  const navigate = useNavigate({ from: '/sessions' });

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SessionSort>(DEFAULT_SESSION_SORT);
  const [groupBy, setGroupBy] = useState<SessionGroupBy>(DEFAULT_SESSION_GROUP_BY);

  // Build filters from URL params and pass directly to useInventorySources.
  const filters: InventoryFilters = {};
  if (sourceFilter && sourceFilter !== 'all') filters.sourceFilter = sourceFilter;
  if (reviewFilter && reviewFilter !== 'all') filters.reviewFilter = reviewFilter;

  const { data: response, loading, error } = useInventorySources(filters);
  const { review, pending } = useSessionReview();

  const sources = useMemo(
    () => filterSourcesBySearch(response?.sources ?? [], search),
    [response?.sources, search],
  );

  const total = useMemo(
    () => (response?.sources ?? []).reduce((acc, src) => acc + src.sessions.length, 0),
    [response?.sources],
  );

  // Flatten all sessions across sources to find the selected one.
  const allSessions = response?.sources.flatMap((src) => src.sessions) ?? [];
  const selectedSession = selected != null ? allSessions.find((s) => s.id === selected) : undefined;

  // Clear stale selection when the session disappears after a filter change.
  const clearSelection = useCallback(
    () =>
      navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
    [navigate],
  );
  useStaleSelectionCleanup(selected, selectedSession !== undefined, clearSelection);

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });

  const handleSort = useCallback((col: SessionSortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    );
  }, []);

  const handleSortColChange = useCallback((value: string) => {
    setSort((prev) => ({ col: value as SessionSortCol, dir: prev.dir }));
  }, []);

  const handleSortDirToggle = useCallback(() => {
    setSort((prev) => ({ col: prev.col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }));
  }, []);

  // Review action handlers — dispatch to store and surface feedback.
  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    const result = await review(selected, 'confirm');
    if (result.noop) return;
    if (result.ok) {
      addToast({ message: 'Session confirmed.', variant: 'success' });
    } else {
      addToast({ message: result.error ?? 'Confirm failed.', variant: 'error' });
    }
  }, [selected, review]);

  const handleReopen = useCallback(async () => {
    if (!selected) return;
    const result = await review(selected, 'reopen');
    if (result.noop) return;
    if (result.ok) {
      addToast({ message: 'Review re-opened.', variant: 'info' });
    } else {
      addToast({ message: result.error ?? 'Re-open failed.', variant: 'error' });
    }
  }, [selected, review]);

  const handleReject = useCallback(async () => {
    if (!selected) return;
    const result = await review(selected, 'reject');
    if (result.noop) return;
    if (result.ok) {
      addToast({ message: 'Session rejected.', variant: 'warn' });
    } else {
      addToast({ message: result.error ?? 'Reject failed.', variant: 'error' });
    }
  }, [selected, review]);

  const isPending = pending === selected;

  // Action-bound CTAs: visibility driven by selected session's canonical state
  // (spec 006 FR-006, action-bound review pattern).
  const confirmVisible =
    selectedSession != null &&
    ['discovered', 'candidate', 'needs_review'].includes(selectedSession.state);
  const reopenVisible =
    selectedSession != null && ['confirmed', 'rejected'].includes(selectedSession.state);
  const rejectVisible =
    selectedSession != null && selectedSession.state !== 'rejected';

  // Sort column vocab mirrors the table's sortable columns.
  const sortOptions: FilterOption[] = [
    { value: 'target', label: 'Target' },
    { value: 'filter', label: 'Filter' },
    { value: 'frames', label: 'Frames' },
    { value: 'exposure', label: 'Integration' },
    { value: 'night', label: 'Night' },
    { value: 'camera', label: 'Camera' },
    { value: 'state', label: 'State' },
  ];

  const topBar = (
    <PageTopBar
      title={<h1 className="alm-topbar__heading">Sessions</h1>}
      summary={
        <span>
          {loading ? 'Loading…' : `${total} ${total === 1 ? 'session' : 'sessions'}`}
        </span>
      }
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'Search target, filter, camera…',
            ariaLabel: 'Search sessions',
          }}
          fields={[
            {
              key: 'review',
              label: 'Review',
              value: reviewFilter ?? '',
              options: REVIEW_OPTIONS,
              allLabel: 'Default',
              onChange: (v) =>
                navigate({
                  search: (prev) => ({ ...prev, reviewFilter: (v as ReviewFilter) || undefined }),
                }),
            },
          ]}
          groupBy={{
            value: groupBy,
            options: GROUP_BY_OPTIONS,
            onChange: (v) => setGroupBy(v as SessionGroupBy),
          }}
          sort={{
            value: sort.col,
            options: sortOptions,
            onChange: handleSortColChange,
            dir: sort.dir,
            onDirToggle: handleSortDirToggle,
          }}
        />
      }
    />
  );

  return (
    <ListPageLayout
      topBar={topBar}
      detail={
        selectedSession != null ? (
          <SessionDetail
            session={selectedSession}
            onConfirm={() => void handleConfirm()}
            onReopen={() => void handleReopen()}
            onReject={() => void handleReject()}
            confirmVisible={confirmVisible}
            reopenVisible={reopenVisible}
            rejectVisible={rejectVisible}
            pending={isPending}
          />
        ) : undefined
      }
      onCloseDetail={selectedSession != null ? clearSelection : undefined}
      detailLabel="Session details"
    >
      {error != null ? (
        <div className="alm-sessions-table__empty">Failed to load sessions.</div>
      ) : (
        <SessionsTable
          sources={sources}
          selected={selected ?? null}
          onSelect={onSelect}
          loading={loading}
          sort={sort}
          onSort={handleSort}
          groupBy={groupBy}
        />
      )}
    </ListPageLayout>
  );
}
