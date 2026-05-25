import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReviewItem, ConfidenceLevel } from '@/api/types';
import { getReviewQueue, transitionSession } from '@/api/commands';
import { createQueryStore, useQuery } from '@/data/store';
import { ThreePane, EmptyState } from '@/ui';
import { ReviewQueue } from './ReviewQueue';
import { EvidencePane } from './EvidencePane';
import { DecisionPanel } from './DecisionPanel';
import { queueProgress } from '@/data/fixtures/review';

// --- Confidence sort order (ascending: lowest first) ---

const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  confirmed: 4,
  rejected: 5,
};

type SortKey = 'confidence' | 'date' | 'target';

function sortItems(items: ReviewItem[], key: SortKey): ReviewItem[] {
  const sorted = [...items];
  switch (key) {
    case 'confidence':
      return sorted.sort(
        (a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence],
      );
    case 'date':
      return sorted.sort((a, b) => {
        const dateA = String(a.evidence.night?.value ?? '');
        const dateB = String(b.evidence.night?.value ?? '');
        return dateB.localeCompare(dateA);
      });
    case 'target':
      return sorted.sort((a, b) => {
        const tA = a.suggested_target ?? '';
        const tB = b.suggested_target ?? '';
        return tA.localeCompare(tB);
      });
    default:
      return sorted;
  }
}

// --- Query store for the review queue ---

const reviewQueueStore = createQueryStore(() => getReviewQueue());

// --- Page component ---

export function ReviewPage() {
  const { data: rawItems, loading, error } = useQuery(reviewQueueStore);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('confidence');

  // Sort items
  const sortedItems = useMemo(() => {
    if (!rawItems) return [];
    return sortItems(rawItems, sortKey);
  }, [rawItems, sortKey]);

  // Clamp activeIndex when list changes
  useEffect(() => {
    if (activeIndex >= sortedItems.length && sortedItems.length > 0) {
      setActiveIndex(0);
    }
  }, [sortedItems.length, activeIndex]);

  const activeItem: ReviewItem | null = sortedItems[activeIndex] ?? null;

  // Handle decision: transition session, then auto-advance
  const handleDecision = useCallback(
    async (action: 'confirm' | 'reject' | 'skip') => {
      if (!activeItem) return;

      // Do not allow confirm when blocking reasons exist
      if (action === 'confirm' && activeItem.blocking_reasons.length > 0) return;

      // Transition via API if this is a session
      if (activeItem.session_id) {
        try {
          await transitionSession({
            id: activeItem.session_id,
            action,
          });
        } catch {
          // Silently handle for now; audit trail will capture failures
        }
      }

      // Auto-advance to next item (wrap to 0 at end)
      setActiveIndex((prev) => {
        if (sortedItems.length <= 1) return 0;
        return prev >= sortedItems.length - 1 ? 0 : prev + 1;
      });

      // Refresh the queue
      reviewQueueStore.invalidate();
    },
    [activeItem, sortedItems.length],
  );

  // Navigate with J/K, decide with Cmd+1/2/3
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Do not intercept when focus is inside an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // J / K navigation
      if (e.key === 'j' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev >= sortedItems.length - 1 ? 0 : prev + 1,
        );
        return;
      }
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? sortedItems.length - 1 : prev - 1,
        );
        return;
      }

      // Cmd/Ctrl + 1/2/3 for decisions
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '1') {
          e.preventDefault();
          void handleDecision('confirm');
        } else if (e.key === '2') {
          e.preventDefault();
          void handleDecision('reject');
        } else if (e.key === '3') {
          e.preventDefault();
          void handleDecision('skip');
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedItems.length, handleDecision]);

  // --- Render ---

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: 'var(--alm-danger)' }}>
          Failed to load review queue: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="ReviewPage"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <ThreePane
        listWidth={220}
        detailWidth={320}
        list={
          loading && sortedItems.length === 0 ? (
            <p style={{ padding: 16, color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
              Loading...
            </p>
          ) : sortedItems.length === 0 ? (
            <EmptyState
              icon={<span>&#x2713;</span>}
              title="All caught up"
              description="No items in the review queue right now."
            />
          ) : (
            <ReviewQueue
              items={sortedItems}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              sortValue={sortKey}
              onSortChange={(v) => {
                setSortKey(v as SortKey);
                setActiveIndex(0);
              }}
              acquisitionCount={queueProgress.acquisitionCount}
              calibrationCount={queueProgress.calibrationCount}
            />
          )
        }
        content={<EvidencePane item={activeItem} />}
        detail={<DecisionPanel item={activeItem} onDecision={handleDecision} />}
      />
    </div>
  );
}
