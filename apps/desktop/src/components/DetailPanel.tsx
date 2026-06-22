/**
 * DetailPanel — tasks #100/#99/#101, spec 043 §4.
 *
 * Shared detail-panel container used by Sessions detail and Calibration detail.
 * Wraps the established DetailPane + DetailHeader primitives into one unit that
 * enforces the bottom-panel layout contract:
 *   - header row: title (+ optional title-extra badges) + per-item action buttons
 *   - optional subtitle line (prose, not mono path)
 *   - body: children / sections
 *
 * The close ✕ lives in ListPageLayout (onCloseDetail), NOT in this component.
 * Per-item contextual actions (Review / Assign / …) go in the `actions` slot.
 *
 * Row-data de-duplication contract (#100):
 *   Callers MUST NOT repeat data already visible in the selected table row in
 *   the `title` or `subtitle`. The title is the item IDENTITY (target name,
 *   master kind+discriminator); the subtitle is a concise acquisition/context
 *   summary that adds meaning beyond what the row shows.
 *
 * CSS: see apps/desktop/.cssblocks/detail-panel.css (merged into components.css).
 */

import type { ReactNode } from 'react';
import { DetailPane, DetailHeader } from '@/components';

export interface DetailPanelProps {
  /**
   * Primary identity heading. Must NOT repeat data already shown in the
   * selected table row (the row-data duplication contract, task #100).
   */
  title: ReactNode;
  /** Optional badges / pills shown beside the title. */
  titleExtra?: ReactNode;
  /**
   * One-line context summary. Prose (not mono path). Should add information
   * beyond the table row — e.g. an acquisition summary or a fingerprint key.
   */
  subtitle?: string;
  /** Per-item contextual action buttons (act on THIS item, not the page). */
  actions?: ReactNode;
  /** Detail body (sections, grids, metric lines, etc.). */
  children?: ReactNode;
  /**
   * Modifier applied to the outer element. Used to scope density overrides
   * per feature (e.g. 'sessions', 'calibration').
   */
  variant?: 'sessions' | 'calibration';
  /**
   * Pass-through to the underlying DetailPane: fills available height,
   * header stays pinned, primary column scrolls. Use with DetailGrid.
   */
  fill?: boolean;
}

export function DetailPanel({
  title,
  titleExtra,
  subtitle,
  actions,
  children,
  // variant is a reserved prop for future CSS-block density scoping
  // (.alm-detail-panel--sessions / --calibration). Not yet wired into the
  // DOM because DetailPane does not accept a className prop; wire it once
  // DetailPane gains className support or the cssblocks are merged.
  variant: _variant,
  fill,
}: DetailPanelProps) {
  return (
    <DetailPane fill={fill}>
      <DetailHeader
        title={title}
        titleExtra={titleExtra}
        subtitle={subtitle}
        actions={actions}
      />
      {children}
    </DetailPane>
  );
}

// Re-export the variant type so feature files can type-check their usage.
export type DetailPanelVariant = NonNullable<DetailPanelProps['variant']>;
