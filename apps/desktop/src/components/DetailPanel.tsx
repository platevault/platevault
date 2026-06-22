/**
 * DetailPanel — tasks #100/#99/#101, spec 043 §4.
 *
 * Shared detail-panel container used by all list-page details (Sessions,
 * Calibration, Inbox). Enforces the bottom-panel layout contract:
 *
 *   HEADER (pinned, never scrolls):
 *     left  — title (item identity) + optional titleExtra (pills) +
 *              optional subtitle (one prose context line)
 *     right — actions (per-item buttons)
 *   BODY (two-column when `facts` is provided):
 *     FACTS column (left, fixed var(--alm-rail-width) ≈ 280px):
 *       dense identity KV block; does NOT scroll.
 *       Omit to let CONTENT span full width.
 *     CONTENT column (right, flex:1):
 *       the page-specific rich content.
 *       This is THE ONLY scroll region: overflow-y:auto; scrollbar-gutter:stable.
 *
 * The panel as a whole has a fixed max-height (set on the ListPageLayout
 * dock) and never scrolls itself — only CONTENT scrolls.
 *
 * The close ✕ lives in ListPageLayout (onCloseDetail), NOT here.
 * Per-item contextual actions (Review / Assign / …) go in the `actions` slot.
 *
 * Row-data de-duplication contract (#100):
 *   Callers MUST NOT repeat data already visible in the selected table row in
 *   the `title` or `subtitle`. The title is the item IDENTITY; the subtitle is
 *   a concise acquisition/context summary that adds meaning beyond the row.
 *
 * CSS: see apps/desktop/.cssblocks/detail-panel.css (merged into components.css).
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
   * Left-column facts content. When provided the body renders two columns:
   *   facts (fixed var(--alm-rail-width), no scroll) | children (flex:1, scrolls).
   * When omitted, children span the full body width.
   * Typically a <dl> of <FactsKV> rows, or a RailCard wrapping them.
   */
  facts?: ReactNode;
  /** Detail body (right column, or full width when `facts` is omitted). */
  children?: ReactNode;
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
  variant,
  fill,
}: DetailPanelProps) {
  const variantClass = variant ? ` alm-detailpanel--${variant}` : '';

  return (
    <DetailPane fill={fill}>
      <DetailHeader
        title={title}
        titleExtra={titleExtra}
        subtitle={subtitle}
        actions={actions}
      />
      {facts != null ? (
        <div className={`alm-detailpanel__cols${variantClass}`}>
          <aside className="alm-detailpanel__facts">{facts}</aside>
          <div className="alm-detailpanel__content">{children}</div>
        </div>
      ) : (
        children
      )}
    </DetailPane>
  );
}

// Re-export the variant type so feature files can type-check their usage.
export type DetailPanelVariant = NonNullable<DetailPanelProps['variant']>;
