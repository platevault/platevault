/**
 * SortHeader — the single shared sortable column-header control (button-in-th).
 *
 * Every list table (Sessions / Calibration / Projects / Targets / Inbox) renders
 * the SAME header affordance: a borderless button carrying the column label and,
 * when it is the active sort column, a direction arrow. Layout, spacing, hover,
 * active color, and the arrow glyph live HERE and in the single `.alm-sorth` CSS
 * block — callers parameterise CONTENT only (`label`, `active`, `dir`, `onClick`,
 * `ariaLabel`, optional `title`). Do NOT re-implement per-feature `*-sorth`
 * classes; that is what previously drifted (and left Inbox unstyled).
 *
 * Accessibility: the active sort direction is shown visually via the arrow. NOTE
 * `aria-sort` is intentionally NOT set here — per ARIA it is only valid on the
 * `columnheader`/`th` element, not on a `button`, so setting it on this button
 * is a no-op (and was on every table before this was centralized). Announcing
 * sort state to assistive tech belongs on the enclosing `<th>` and is a future
 * enhancement to the shared Table column API.
 *
 * Non-sortable columns should render their plain label node directly rather than
 * using this component.
 */

import type { ReactNode } from 'react';

export interface SortHeaderProps {
  /** Column label content (string or rich node). */
  label: ReactNode;
  /** Whether this column is the active sort column. */
  active: boolean;
  /** Current sort direction (only meaningful when `active`). */
  dir: 'asc' | 'desc';
  /** Invoked when the header is activated (toggle/sort by this column). */
  onClick: () => void;
  /** Accessible label, e.g. "Sort by Night". */
  ariaLabel: string;
  /** Optional native tooltip (used by columns with abbreviated labels). */
  title?: string;
}

export function SortHeader({ label, active, dir, onClick, ariaLabel, title }: SortHeaderProps) {
  return (
    <button
      type="button"
      className={'alm-sorth' + (active ? ' alm-sorth--active' : '')}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
    >
      {label}
      {active && (
        <span className="alm-sorth__arrow" aria-hidden="true">
          {dir === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </button>
  );
}
