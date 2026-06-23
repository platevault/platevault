/**
 * DetailPanel — tasks #100/#99/#101, spec 043 §4.
 *
 * Shared detail-panel container used by all list-page details (Sessions,
 * Calibration, Inbox, Projects). Enforces the bottom-panel layout contract:
 *
 *   HEADER (pinned, never scrolls):
 *     left  — title (item identity) + optional titleExtra (pills) +
 *              optional subtitle (one prose context line)
 *     right — actions (per-item buttons)
 *   BODY — up to 3 balanced zones when slots are provided:
 *     FACTS (left rail, BOUNDED): col `minmax(220px, 0.26fr)`.
 *       Dense identity KV. Does NOT scroll on its own.
 *       Omit to collapse to 2-zone or content-only.
 *     CONTENT (center, always present): `minmax(0, 1fr)`.
 *       The page's PRIMARY table/list. This is THE ONLY scroll region.
 *     AUX (right rail, BOUNDED, only when `aux` provided): col `minmax(240px, 0.30fr)`.
 *       Secondary blocks (review state, linked projects, usage stats).
 *
 * Grid template per slot combination:
 *   facts + children + aux  → 3-zone: [0.26fr]  [1fr]  [0.30fr]
 *   facts + children        → 2-zone: [0.26fr]  [1fr]
 *   children + aux          → 2-zone: [1fr]  [0.30fr]
 *   children only           → 1-zone: [1fr]   (no wrapper)
 *
 * Auto-expand behavior: the dock (.alm-listpage__detail) is height:fit-content
 * capped at clamp(220px, 40vh, 52vh). The dock DOES NOT scroll — only the
 * CONTENT column scrolls (overflow-y:auto, scrollbar-gutter:stable). Remove
 * any overflow on the outer detail-body to avoid double scrollbars.
 *
 * The close ✕ lives in ListPageLayout (onCloseDetail), NOT here.
 * Per-item contextual actions (Review / Assign / …) go in the `actions` slot.
 *
 * Row-data de-duplication contract (#100):
 *   Callers MUST NOT repeat data already visible in the selected table row in
 *   the `title` or `subtitle`. The title is the item IDENTITY; the subtitle is
 *   a concise acquisition/context summary that adds meaning beyond the row.
 *
 * CSS: components.css — search for "=== Canonical DetailPanel 3-zone".
 */

import type { ReactNode } from 'react';
import { DetailPane, DetailHeader } from '@/components';

// ── FactsKV helper ──────────────────────────────────────────────────────────

/**
 * FactsKV — a single label/value row for use inside the `facts` slot.
 * Renders a compact two-column grid cell pair so every page's left column
 * looks identical. Accepts an optional `provenance` label (e.g. "Inferred",
 * "FITS", "User") shown as a muted sub-label.
 */
export interface FactsKVProps {
  label: string;
  value: ReactNode;
  /** Optional origin label rendered muted below the label. */
  provenance?: string;
}

export function FactsKV({ label, value, provenance }: FactsKVProps) {
  return (
    <div className="alm-detailpanel__kv">
      <dt className="alm-detailpanel__kv-label">
        {label}
        {provenance && (
          <span className="alm-detailpanel__kv-prov">{provenance}</span>
        )}
      </dt>
      <dd className="alm-detailpanel__kv-value">{value}</dd>
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

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
  /**
   * Left rail — identity KV. When provided the body renders with a bounded
   * left column (minmax(220px, 0.26fr)). When omitted, content spans from left.
   * Typically a <dl> of <FactsKV> rows, or a RailCard wrapping them.
   */
  facts?: ReactNode;
  /**
   * Center column — the page's PRIMARY table/list. Always present when any
   * slot is provided. This is THE ONLY scroll region inside the panel body.
   */
  children?: ReactNode;
  /**
   * Right rail — secondary blocks (review state, linked projects, usage stats,
   * FileInspector). When provided the body gains a bounded right column
   * (minmax(240px, 0.30fr)). When omitted, content spans to the right edge.
   */
  aux?: ReactNode;
  /**
   * Modifier applied to the outer element. Used to scope density overrides
   * per feature (e.g. 'sessions', 'calibration', 'inbox').
   */
  variant?: 'sessions' | 'calibration' | 'inbox';
  /**
   * Pass-through to the underlying DetailPane: fills available height,
   * header stays pinned, primary column scrolls. Use with DetailGrid.
   */
  fill?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DetailPanel({
  title,
  titleExtra,
  subtitle,
  actions,
  facts,
  children,
  aux,
  variant,
  fill,
}: DetailPanelProps) {
  const hasFacts = facts != null;
  const hasAux = aux != null;
  // Only render the grid wrapper when at least one rail slot is provided.
  // content-only → no wrapper (children render directly, as before).
  const hasSlots = hasFacts || hasAux;

  // Build modifier classes for CSS grid-template selection.
  const modifiers = [
    variant ? `alm-detailpanel--${variant}` : '',
    hasFacts ? 'alm-detailpanel--has-facts' : '',
    hasAux ? 'alm-detailpanel--has-aux' : '',
  ].filter(Boolean).join(' ');

  const colsClass = modifiers
    ? `alm-detailpanel__cols ${modifiers}`
    : 'alm-detailpanel__cols';

  return (
    <DetailPane fill={fill}>
      <DetailHeader
        title={title}
        titleExtra={titleExtra}
        subtitle={subtitle}
        actions={actions}
      />
      {hasSlots ? (
        <div className={colsClass}>
          {hasFacts && (
            <aside className="alm-detailpanel__facts">{facts}</aside>
          )}
          <div className="alm-detailpanel__content">{children}</div>
          {hasAux && (
            <aside className="alm-detailpanel__aux">{aux}</aside>
          )}
        </div>
      ) : (
        children
      )}
    </DetailPane>
  );
}

// Re-export the variant type so feature files can type-check their usage.
export type DetailPanelVariant = NonNullable<DetailPanelProps['variant']>;
