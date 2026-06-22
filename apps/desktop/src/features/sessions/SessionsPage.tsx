/**
 * SessionsPage — spec 006 wired; spec 043 §4 redesign (task #36).
 *
 * The Sessions page is the inventory ledger. Per the design redesign it is now
 * a DENSE FULL-WIDTH sortable TABLE grouped by target (SessionsTable) rather
 * than a narrow master-detail sidebar list. Filters + search live in a
 * persistent top toolbar (SessionsToolbar) inside the always-visible page bar;
 * the table is the primary full-width surface; selecting a row opens the
 * existing SessionDetail in a right-side drawer. Confirm / Re-open / Reject
 * remain action-bound and live in the top bar (FR-006).
 *
 * Design decision (spec 006 §v4 reconciliation): the Sessions page IS the
 * inventory surface because sessions are the primary unit of the stable
 * working library.
 *
 * URL state (extends spec 020):
 *   selected     — string session UUID
 *   sourceFilter — optional LibraryRoot UUID or 'all'
 *   frameFilter  — optional frame type filter (light|dark|flat|bias|mixed)
 *   reviewFilter — optional review-state filter including 'all' and 'ignored'
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { PageShell } from '@/components';
import { Btn } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { SessionsTable, DEFAULT_SESSION_SORT } from './SessionsTable';
import type { SessionSort, SessionSortCol } from './SessionsTable';
import { SessionsToolbar } from './SessionsToolbar';
import { SessionDetail } from './SessionDetail';
import {
  useInventorySources,
  useSessionReview,
  type InventoryFilters,
} from './store';
import { addToast } from '@/shared/toast';
import type { InventorySource } from '@/api/commands';
import type { InventoryFrameFilter, ReviewFilter } from '@/lib/route-contract';

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

export function SessionsPage() {
  const { selected, sourceFilter, frameFilter, reviewFilter } = useSearch({
    from: '/shell/sessions',
  });
  const navigate = useNavigate({ from: '/sessions' });

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SessionSort>(DEFAULT_SESSION_SORT);

  // Build filters from URL params and pass directly to useInventorySources.
  const filters: InventoryFilters = {};
  if (sourceFilter && sourceFilter !== 'all') filters.sourceFilter = sourceFilter;
  if (frameFilter) filters.frameFilter = frameFilter;
  if (reviewFilter && reviewFilter !== 'all') filters.reviewFilter = reviewFilter;

  const { data: response, loading, error } = useInventorySources(filters);
  const { review, pending } = useSessionReview();

  const sources = useMemo(
    () => filterSourcesBySearch(response?.sources ?? [], search),
    [response?.sources, search],
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

  return (
    <PageShell>
      <div className="alm-page__bar">
        <SessionsToolbar
          search={search}
          onSearch={setSearch}
          frameFilter={frameFilter}
          reviewFilter={reviewFilter}
          onFrameFilter={(v: InventoryFrameFilter | null) =>
            navigate({ search: (prev) => ({ ...prev, frameFilter: v ?? undefined }) })
          }
          onReviewFilter={(v: ReviewFilter | null) =>
            navigate({ search: (prev) => ({ ...prev, reviewFilter: v ?? undefined }) })
          }
          actions={
            <>
              {confirmVisible && (
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => void handleConfirm()}
                  disabled={isPending}
                >
                  Confirm
                </Btn>
              )}
              {reopenVisible && (
                <Btn size="sm" onClick={() => void handleReopen()} disabled={isPending}>
                  Re-open review
                </Btn>
              )}
              {rejectVisible && (
                <Btn
                  size="sm"
                  variant="danger"
                  onClick={() => void handleReject()}
                  disabled={isPending}
                >
                  Reject
                </Btn>
              )}
            </>
          }
        />
      </div>

      <div className="alm-sessions-body">
        <div className="alm-sessions-body__table">
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
            />
          )}
        </div>

        {selectedSession != null && (
          <aside className="alm-sessions-body__drawer">
            <SessionDetail session={selectedSession} />
          </aside>
        )}
      </div>
    </PageShell>
  );
}
