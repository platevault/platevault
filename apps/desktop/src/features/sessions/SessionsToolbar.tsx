/**
 * SessionsToolbar — persistent top toolbar for the Sessions page (task #36).
 *
 * Rendered inside the always-visible `.alm-page__bar` (NOT inside a scrolling
 * pane). Holds the session search box plus the frame-type and review-state
 * filters that previously lived in the old narrow list sidebar's controls
 * area. Sorting itself is driven by the table's clickable column headers, so
 * this toolbar carries filters + search only; review actions are rendered to
 * the right by the page.
 */

import type { InventoryFrameFilter, ReviewFilter } from '@/lib/route-contract';
import { INVENTORY_FRAME_FILTERS, REVIEW_FILTERS } from '@/lib/route-contract';
import { sessionStateLabel } from '@/lib/lifecycle';

function reviewFilterLabel(v: string): string {
  if (v === 'discovered' || v === 'candidate') return `Needs review (${v})`;
  if (v === 'needs_review') return 'Needs review';
  if (v === 'all') return 'All states';
  return sessionStateLabel(v);
}

interface Props {
  search: string;
  onSearch: (v: string) => void;
  frameFilter?: string;
  reviewFilter?: string;
  onFrameFilter: (v: InventoryFrameFilter | null) => void;
  onReviewFilter: (v: ReviewFilter | null) => void;
  /** Review actions (Confirm / Re-open / Reject) rendered at the toolbar's right. */
  actions?: React.ReactNode;
}

export function SessionsToolbar({
  search,
  onSearch,
  frameFilter,
  reviewFilter,
  onFrameFilter,
  onReviewFilter,
  actions,
}: Props) {
  return (
    <div className="alm-sessions-toolbar">
      <input
        type="search"
        className="alm-sessions-toolbar__search"
        placeholder="Search target, filter, camera…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        aria-label="Search sessions"
      />

      <label className="alm-sessions-toolbar__field">
        Frame
        <select
          value={frameFilter ?? ''}
          onChange={(e) => onFrameFilter((e.target.value as InventoryFrameFilter) || null)}
          aria-label="Frame type filter"
        >
          <option value="">All</option>
          {INVENTORY_FRAME_FILTERS.map((ft) => (
            <option key={ft} value={ft}>
              {ft}
            </option>
          ))}
        </select>
      </label>

      <label className="alm-sessions-toolbar__field">
        Review
        <select
          value={reviewFilter ?? ''}
          onChange={(e) => onReviewFilter((e.target.value as ReviewFilter) || null)}
          aria-label="Review state filter"
        >
          <option value="">Default</option>
          {REVIEW_FILTERS.map((rf) => (
            <option key={rf} value={rf}>
              {reviewFilterLabel(rf)}
            </option>
          ))}
        </select>
      </label>

      <span className="alm-sessions-toolbar__spacer" />
      {actions && <div className="alm-sessions-toolbar__actions">{actions}</div>}
    </div>
  );
}
