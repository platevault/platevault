// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
 *   BODY — a single CONTENT region (`.pv-detailpanel__content`), ALWAYS
 *     rendered. It is THE ONLY scroll region in the panel: the header stays
 *     pinned and everything below it scrolls as one.
 *
 * Auto-expand behavior: the dock (.pv-listpage__detail) is height:fit-content
 * capped at clamp(220px, 40vh, 52vh). The dock DOES NOT scroll — only the
 * CONTENT region scrolls (overflow-y:auto, scrollbar-gutter:stable). Remove
 * any overflow on the outer detail-body to avoid double scrollbars.
 *
 * #1107 — why CONTENT is unconditional. This component used to render the
 * content wrapper only when a `facts` or `aux` rail slot was passed. NO caller
 * ever passed one — they existed solely in this component's own tests — so in
 * production the wrapper was NEVER rendered and the "only scroll region" did
 * not exist. Details fell back to the ancestor `.pv-listpage__detail-body`,
 * which is `overflow:hidden`, making overflowing content unreachable rather
 * than merely unscrolled. Three features hit this and each patched it locally
 * (#553 Inbox, #816 Targets, #1107 Calibration) while Sessions (522px) and
 * Projects (1216px) stayed silently broken at a 390px side dock. The rails are
 * withdrawn (spec 054); this single region replaces all three local fixes.
 * Do NOT make the wrapper conditional again.
 *
 * The close ✕ lives in ListPageLayout (onCloseDetail), NOT here — as does
 * Escape-to-close (#771/#906): ListPageLayout owns a document-level Escape
 * listener that calls onCloseDetail/onCloseBottomDetail, and explicitly
 * checks the DOM for an open Base UI overlay (Dialog/Select/Combobox/Menu)
 * before firing — `stopPropagation()` on a same-target sibling `document`
 * listener does NOT block this one, so Base UI's own Escape dismissal can't
 * be relied on alone to keep this listener from also closing the panel.
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
    <div className="pv-detailpanel__kv">
      <dt className="pv-detailpanel__kv-label">
        {label}
        {provenance && (
          <span className="pv-detailpanel__kv-prov">{provenance}</span>
        )}
      </dt>
      <dd className="pv-detailpanel__kv-value">{value}</dd>
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
   * Panel body — the page's PRIMARY table/list. Rendered inside
   * `.pv-detailpanel__content`, THE ONLY scroll region inside the panel.
   */
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
  children,
  variant,
  fill,
}: DetailPanelProps) {
  const contentClass = variant
    ? `pv-detailpanel__content pv-detailpanel--${variant}`
    : 'pv-detailpanel__content';

  return (
    <DetailPane fill={fill}>
      <DetailHeader
        title={title}
        titleExtra={titleExtra}
        subtitle={subtitle}
        actions={actions}
      />
      <div className={contentClass} data-testid="detailpanel-content">
        {children}
      </div>
    </DetailPane>
  );
}

// Re-export the variant type so feature files can type-check their usage.
export type DetailPanelVariant = NonNullable<DetailPanelProps['variant']>;
