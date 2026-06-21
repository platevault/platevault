/**
 * SessionsPage — spec 006 wired.
 *
 * Displays the inventory ledger: acquisition and calibration sessions grouped
 * by library root (InventorySource). Reads from `inventory.list` via the
 * sessions store instead of SESSIONS_DATA fixtures.
 *
 * Design decision (spec 006 §v4 reconciliation): design-v4 has no dedicated
 * `features/inventory/` directory; the Sessions page IS the inventory surface
 * because sessions are the primary unit of the stable working library.
 *
 * URL state (extends spec 020):
 *   selected     — string session UUID
 *   sourceFilter — optional LibraryRoot UUID or 'all'
 *   frameFilter  — optional frame type filter (light|dark|flat|bias|mixed)
 *   reviewFilter — optional review-state filter including 'all' and 'ignored'
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { SessionsList } from './SessionsList';
import { SessionDetail } from './SessionDetail';
import {
  useInventorySources,
  useSessionReview,
  type InventoryFilters,
} from './store';
import { addToast } from '@/shared/toast';
import type { InventoryFrameFilter, ReviewFilter } from '@/lib/route-contract';

export function SessionsPage() {
  const { selected, sourceFilter, frameFilter, reviewFilter } = useSearch({
    from: '/shell/sessions',
  });
  const navigate = useNavigate({ from: '/sessions' });

  // Build filters from URL params and pass directly to useInventorySources.
  const filters: InventoryFilters = {};
  if (sourceFilter && sourceFilter !== 'all') filters.sourceFilter = sourceFilter;
  if (frameFilter) filters.frameFilter = frameFilter;
  if (reviewFilter && reviewFilter !== 'all') filters.reviewFilter = reviewFilter;

  const { data: response, loading, error } = useInventorySources(filters);
  const { review, pending } = useSessionReview();

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

  const totalSessions = allSessions.length;
  const confirmedCount = allSessions.filter((s) => s.state === 'confirmed').length;
  const needsReviewCount = allSessions.filter(
    (s) => s.state === 'needs_review' || s.state === 'discovered' || s.state === 'candidate',
  ).length;
  const subtitle = loading
    ? 'Loading…'
    : error != null
      ? 'Failed to load sessions'
      : `${totalSessions} sessions · ${confirmedCount} confirmed · ${needsReviewCount} needs review`;

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
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Sessions"
            subtitle={subtitle}
            right={
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
        }
        list={
          <SessionsList
            sources={response?.sources ?? []}
            selected={selected ?? null}
            onSelect={onSelect}
            loading={loading}
            frameFilter={frameFilter}
            reviewFilter={reviewFilter}
            onFrameFilter={(v: InventoryFrameFilter | null) =>
              navigate({
                search: (prev) => ({ ...prev, frameFilter: v ?? undefined }),
              })
            }
            onReviewFilter={(v: ReviewFilter | null) =>
              navigate({
                search: (prev) => ({ ...prev, reviewFilter: v ?? undefined }),
              })
            }
          />
        }
        detail={
          <SessionDetail
            session={selectedSession ?? null}
            onConfirm={() => void handleConfirm()}
            onReopen={() => void handleReopen()}
            onReject={() => void handleReject()}
            isPending={isPending}
          />
        }
      />
    </PageShell>
  );
}
