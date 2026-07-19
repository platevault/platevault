// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

export interface TwoColDetailLayoutProps {
  /** Left property column (typically a `PropertyTable` half). */
  colA: ReactNode;
  /** Right property column (typically a `PropertyTable` half). */
  colB: ReactNode;
  /**
   * Third slot — a linked-entity list, a stacked pair of popovers, or any
   * other right-aligned block. Omitted entirely when there is nothing to show.
   */
  linked?: ReactNode;
  /** Extra class appended to the linked slot (e.g. the `--stack` modifier
   * used when it holds more than one stacked block). */
  linkedClassName?: string;
}

/**
 * The two-column-properties + third-slot detail layout (`.alm-session-detail2`,
 * #813) shared by Sessions/Calibration/Inbox detail panes. Wraps the CSS
 * convention in one component so a future layout change (spacing, a11y
 * attribute, responsive behavior) is applied once instead of hand-copied.
 */
export function TwoColDetailLayout({
  colA,
  colB,
  linked,
  linkedClassName,
}: TwoColDetailLayoutProps) {
  const linkedCls = ['alm-session-detail2__linked', linkedClassName]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="alm-session-detail2">
      <div className="alm-session-detail2__col">{colA}</div>
      <div className="alm-session-detail2__col">{colB}</div>
      {linked != null && <div className={linkedCls}>{linked}</div>}
    </div>
  );
}

export interface DetailLinkedGroupProps {
  /** Heading rendered above the content (`alm-session-detail2__head`). */
  label: ReactNode;
  /** Renders `emptyLabel` instead of `children` — e.g. a zero-count list. */
  empty?: boolean;
  /** Muted placeholder shown when `empty` (`alm-session-detail2__muted`). */
  emptyLabel?: ReactNode;
  children?: ReactNode;
}

/**
 * A single labeled block inside a `linked` slot (#813): heading + either
 * content or a muted empty placeholder. Same `__head`/`__muted` convention
 * `SessionDetail`'s linked-projects block and `InboxDetail`'s Files column
 * apply inline; extracted here so `SessionListPopover` doesn't hand-roll the
 * two class names itself.
 */
export function DetailLinkedGroup({
  label,
  empty,
  emptyLabel,
  children,
}: DetailLinkedGroupProps) {
  return (
    <div>
      <div className="alm-session-detail2__head">{label}</div>
      {empty ? (
        <span className="alm-session-detail2__muted">{emptyLabel}</span>
      ) : (
        children
      )}
    </div>
  );
}
