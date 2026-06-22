/**
 * ListPageLayout — standard list-page scaffold (spec 043, tasks #62/#73).
 *
 * The shared layout system generalized from the Sessions page. Composition:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ PageTopBar (pinned, never scrolls)           │  ← topBar
 *   ├──────────────────────────────────┬───────────┤
 *   │ primary content (full-width)     │ detail    │  ← children + detail
 *   │ table / list, scrolls            │ pane      │
 *   └──────────────────────────────────┴───────────┘
 *
 * "Standardize on the Sessions layout" means a consistent PINNED TOP BAR +
 * consistent button styling/placement + a consistent body shape — NOT removing
 * sidebars/rails. The right-hand detail PANE is preserved (it is not collapsed
 * into a hidden drawer): it has a sensible `min-width` so its rail content is
 * fully visible and is never horizontally squeezed or clipped — content wraps
 * rather than truncating. The pane mounts only when `detail` is non-null (so we
 * never show an empty centered dashboard), and an optional close affordance
 * lets it be dismissed back to full-width content.
 *
 * Pass the top bar either as a ready `topBar` node (e.g. `<PageTopBar .../>`)
 * or via the convenience `topBarProps` slots, which this component forwards to
 * an internal `PageTopBar`. ListPageLayout is itself the `.alm-page` root, so
 * it must be the page's outermost element (do not nest it inside PageShell).
 */

import type { ReactNode } from 'react';
import { PageTopBar, type PageTopBarProps } from './PageTopBar';

export interface ListPageLayoutProps {
  /** A ready top-bar node. Mutually exclusive with `topBarProps`. */
  topBar?: ReactNode;
  /** Convenience: build the PageTopBar from slot props instead of a node. */
  topBarProps?: PageTopBarProps;
  /** Primary full-width content (table / list). */
  children: ReactNode;
  /** Detail pane content; the pane is shown only when this is non-null. */
  detail?: ReactNode;
  /** Invoked when the pane's close affordance is used. Omit to hide it. */
  onCloseDetail?: () => void;
  /** Accessible label for the detail pane region. Default "Details". */
  detailLabel?: string;
}

export function ListPageLayout({
  topBar,
  topBarProps,
  children,
  detail,
  onCloseDetail,
  detailLabel = 'Details',
}: ListPageLayoutProps) {
  return (
    <div className="alm-page">
      {topBar ?? (topBarProps && <PageTopBar {...topBarProps} />)}

      <div className="alm-listpage__body">
        <div className="alm-listpage__main">{children}</div>

        {detail != null && (
          <aside className="alm-listpage__detail" aria-label={detailLabel}>
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
          </aside>
        )}
      </div>
    </div>
  );
}
