/**
 * ListPageLayout — standard list-page scaffold (spec 043, tasks #62/#73/#86/#89).
 *
 * The shared layout system generalized from the Sessions page. Composition:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ PageTopBar (pinned, never scrolls)           │  ← topBar
 *   ├──────────────────────────────────────────────┤
 *   │ primary content (FULL WIDTH)                 │  ← children
 *   │ table / list, scrolls                        │
 *   ├──────────────────────────────────────────────┤  ← top-border separator
 *   │ detail panel (full width, docked BELOW)      │  ← detail
 *   │ AUTO-SIZES to content; scrolls if very tall  │
 *   └──────────────────────────────────────────────┘
 *
 * "Standardize on the Sessions layout" means a consistent PINNED TOP BAR +
 * consistent button styling/placement + a consistent body shape. The detail
 * opens as a horizontal BOTTOM SPLIT below the primary content — NOT a right
 * side-panel. Rationale (task #86): a side panel reflows the full-width table
 * (columns shift as the detail mounts/unmounts); docking the detail BELOW keeps
 * the table full-width and column layout stable. The bottom panel has ample
 * horizontal room, so its rail/cards read side-by-side cleanly (we do NOT force
 * the single-column rail-collapse the old narrow side-panel needed).
 *
 * The bottom panel is NON-resizable (task #89, revising #86): it AUTO-SIZES to
 * its content (`height: fit-content`) with a `max-height` cap so large content
 * scrolls WITHIN the panel rather than pushing the table off-screen. There is no
 * splitter, no drag, and no persisted height. A close (✕) affordance hides the
 * detail and returns the table to full height. The panel mounts only when
 * `detail` is non-null (so we never show an empty centered dashboard).
 *
 * `detailPlacement` (DEFAULT `'bottom'`) chooses the dock. `'bottom'` is the
 * Sessions/Calibration/Targets reference above. `'side'` instead docks the
 * detail as a full-height RIGHT side panel (fixed ~420px width, own scroll,
 * keeps the close ✕) BESIDE the full-width primary content — suited to detail
 * that reads as a tall narrow column (Projects). The side variant simply
 * switches `.alm-listpage__body` from a column to a row and pins the detail
 * width; the primary content stays full-width to the left of it.
 *
 * Pass the top bar either as a ready `topBar` node (e.g. `<PageTopBar .../>`)
 * or via the convenience `topBarProps` slots, which this component forwards to
 * an internal `PageTopBar`. ListPageLayout is itself the `.alm-page` root, so
 * it must be the page's outermost element (do not nest it inside PageShell).
 */

import { type ReactNode } from 'react';
import { PageTopBar, type PageTopBarProps } from './PageTopBar';

export interface ListPageLayoutProps {
  /** A ready top-bar node. Mutually exclusive with `topBarProps`. */
  topBar?: ReactNode;
  /** Convenience: build the PageTopBar from slot props instead of a node. */
  topBarProps?: PageTopBarProps;
  /** Primary full-width content (table / list). */
  children: ReactNode;
  /** Detail content; the bottom panel is shown only when this is non-null. */
  detail?: ReactNode;
  /** Invoked when the panel's close affordance is used. Omit to hide it. */
  onCloseDetail?: () => void;
  /** Accessible label for the detail panel region. Default "Details". */
  detailLabel?: string;
  /**
   * Where the detail panel docks. DEFAULT `'bottom'` (the Sessions/Calibration/
   * Targets reference: a horizontal split BELOW the full-width primary content;
   * see the module header). `'side'` docks the detail as a full-height RIGHT
   * side panel (fixed width, own scroll) BESIDE the full-width primary content
   * instead — suited to detail that reads as a tall narrow column (Projects).
   */
  detailPlacement?: 'bottom' | 'side';
}

export function ListPageLayout({
  topBar,
  topBarProps,
  children,
  detail,
  onCloseDetail,
  detailLabel = 'Details',
  detailPlacement = 'bottom',
}: ListPageLayoutProps) {
  const hasDetail = detail != null;
  const isSide = detailPlacement === 'side';
  const bodyClass = isSide
    ? 'alm-listpage__body alm-listpage__body--side'
    : 'alm-listpage__body';
  const detailClass = isSide
    ? 'alm-listpage__detail alm-listpage__detail--side'
    : 'alm-listpage__detail';

  return (
    <div className="alm-page">
      {topBar ?? (topBarProps && <PageTopBar {...topBarProps} />)}

      <div className={bodyClass}>
        <div className="alm-listpage__main">{children}</div>

        {hasDetail && (
          <section className={detailClass} role="complementary" aria-label={detailLabel}>
            {onCloseDetail && (
              <div className="alm-listpage__detail-bar">
                <button
                  type="button"
                  className="alm-listpage__detail-close"
                  onClick={onCloseDetail}
                  aria-label="Close details"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="alm-listpage__detail-body">{detail}</div>
          </section>
        )}
      </div>
    </div>
  );
}
