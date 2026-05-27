/**
 * ListDetailLayout -- shared layout wrapper for all list-detail screens.
 *
 * Renders a two-pane layout (list + detail) when `sidebar` is omitted,
 * or a three-pane layout (list + content + sidebar) when `sidebar` is provided.
 *
 * Two-pane: uses `.alm-layout-two-pane` with an optional `topBar` above the split.
 * Three-pane: uses `.alm-layout-three-pane` with no top bar.
 *
 * Used by: Sessions, Calibration, Targets, Archive (two-pane),
 *          Inbox, Projects (three-pane).
 */

import type { ReactNode } from 'react';

export interface ListDetailLayoutProps {
  /** TopActionBar or toolbar above the panel split (two-pane only) */
  topBar?: ReactNode;
  /** Left list panel content (always a ListSidebar) */
  list: ReactNode;
  /** Center detail panel content */
  detail: ReactNode;
  /** Optional right sidebar (ActionSidebar or LifecycleSidebar) */
  sidebar?: ReactNode;
}

export function ListDetailLayout({
  topBar,
  list,
  detail,
  sidebar,
}: ListDetailLayoutProps) {
  if (sidebar) {
    // Three-pane layout
    return (
      <div className="alm-layout-three-pane">
        <div className="alm-layout-three-pane__list">{list}</div>
        <div className="alm-layout-three-pane__content">{detail}</div>
        <div className="alm-layout-three-pane__sidebar">{sidebar}</div>
      </div>
    );
  }

  // Two-pane layout
  return (
    <div className="alm-layout-two-pane">
      {topBar && <div className="alm-layout-two-pane__bar">{topBar}</div>}
      <div className="alm-layout-two-pane__body">
        <div className="alm-layout-two-pane__list">{list}</div>
        <div className="alm-layout-two-pane__detail">{detail}</div>
      </div>
    </div>
  );
}
