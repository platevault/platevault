// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ListPageLayout — standard list-page scaffold (spec 043, tasks #62/#73/#86/#89;
 * spec 054 T009/T010 adaptive dock).
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
 * The bottom panel is NON-resizable (task #89): it AUTO-SIZES to its content
 * (`height: fit-content`) with a `max-height` cap so large content scrolls
 * WITHIN the panel rather than pushing the table off-screen. There is no
 * splitter, no drag, and no persisted height in this placement. A close (✕)
 * affordance hides the detail and returns the table to full height. The panel
 * mounts only when `detail` is non-null (so we never show an empty centered
 * dashboard).
 *
 * `detailPlacement` (DEFAULT `'bottom'`) chooses the STATIC dock when `dockPage`
 * is NOT provided: `'bottom'` is the Sessions/Calibration/Targets reference
 * above; `'side'` docks the detail as a full-height RIGHT side panel (fixed
 * ~420px width, own scroll, keeps the close ✕) BESIDE the full-width primary
 * content — suited to detail that reads as a tall narrow column (Projects).
 * This static mode is UNCHANGED behaviour — existing pages that don't pass
 * `dockPage` keep their exact current layout (backward compatibility, spec 054
 * "no per-page work begins until this phase is merged").
 *
 * `dockPage` (spec 054, US1 foundation) opts a page into the ADAPTIVE shared
 * mechanism: `useDetailDock` resolves `'side' | 'bottom' | 'split'` from the
 * measured window/page width + the persisted per-page pin (`data/preferences`),
 * and a pointer-drag resize handle appears between the main content and the
 * detail region whenever the resolved placement isn't `'bottom'`, persisting
 * the dragged width via `setDetailDockWidth`. `'split'` is the Inbox
 * detail-dominant shape (permanent, list-narrow/detail-wide) — its full page
 * wiring lands in a later phase (US3); this component only needs to be able to
 * RENDER it today so the shared mechanism is complete.
 *
 * Pass the top bar either as a ready `topBar` node (e.g. `<PageTopBar .../>`)
 * or via the convenience `topBarProps` slots, which this component forwards to
 * an internal `PageTopBar`. ListPageLayout is itself the `.alm-page` root, so
 * it must be the page's outermost element (do not nest it inside PageShell).
 */

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { PageTopBar, type PageTopBarProps } from './PageTopBar';
import { DetailDockPlacementControl } from './DetailDockPlacementControl';
import { m } from '@/lib/i18n';
import {
  useDetailDock,
  MIN_SIDE_WIDTH,
  type EffectivePlacement,
} from './useDetailDock';
import {
  setDetailDockWidth,
  useDetailDockPref,
  type DetailDockPageKey,
} from '@/data/preferences';

export interface ListPageLayoutProps {
  /** A ready top-bar node. Mutually exclusive with `topBarProps`. */
  topBar?: ReactNode;
  /** Convenience: build the PageTopBar from slot props instead of a node. */
  topBarProps?: PageTopBarProps;
  /** Primary full-width content (table / list). */
  children: ReactNode;
  /** Detail content. The panel is shown only when this is non-null. */
  detail?: ReactNode;
  /** Invoked when the panel's close affordance is used. Omit to hide it. */
  onCloseDetail?: () => void;
  /** Accessible label for the detail panel region. Default "Details". */
  detailLabel?: string;
  /**
   * STATIC placement, used only when `dockPage` is omitted. DEFAULT `'bottom'`
   * (the Sessions/Calibration/Targets reference: a horizontal split BELOW the
   * full-width primary content; see the module header). `'side'` docks the
   * detail as a full-height RIGHT side panel (fixed width, own scroll) BESIDE
   * the full-width primary content instead.
   */
  detailPlacement?: 'bottom' | 'side';
  /**
   * Adopts the spec 054 shared adaptive mechanism: `useDetailDock` resolves
   * the effective placement from the measured widths + the page's persisted
   * pin, and a drag-resize handle + width persistence become active whenever
   * the resolved placement is `'side'` or `'split'`. Omit to keep the exact
   * legacy `detailPlacement`-only behaviour (no adaptive resolution, no
   * resize handle) — existing pages are unaffected until they opt in.
   */
  dockPage?: DetailDockPageKey;
  /**
   * Page-level HARD override of the resolved placement — wins over both the
   * user's persisted pin and the adaptive heuristic (precedence: forced >
   * user pin > adaptive; see `useDetailDock`). Only meaningful together with
   * `dockPage`. Use for a page whose shape is never user-adjustable — e.g.
   * Inbox's permanent detail-dominant split (`forcedPlacement="split"`,
   * spec S3/FR-014) — rather than special-casing the page key inside the
   * shared hook. A page that simply always wants the bottom dock and never
   * needs adaptive/resize behaviour can instead omit `dockPage` entirely and
   * keep the static `detailPlacement="bottom"` (the default).
   */
  forcedPlacement?: EffectivePlacement;
}

/**
 * True when a Base UI overlay (Dialog, Select, Combobox, Menu, …) is open
 * anywhere in the document. Base UI stamps the OPEN popup's outer node
 * (Positioner/Popup) with `data-open` (its documented styling-state hook),
 * but the ARIA overlay role doesn't always land on that same node: Dialog and
 * Menu put `role` and `data-open` together on Popup, while Select/Combobox
 * split them — `role="listbox"`/`"grid"` sits on an inner List that has no
 * `data-open` of its own, only a `data-open` ANCESTOR (Positioner/Popup).
 * Walking up from every overlay-role element to the nearest `data-open`
 * ancestor (`closest`, which also matches the element itself) covers both
 * shapes without hardcoding which library variant is in use (#906).
 */
function hasOpenOverlay(): boolean {
  const overlayRoles = document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="grid"], [role="menu"]',
  );
  for (const el of overlayRoles) {
    if (el.closest('[data-open]')) return true;
  }
  return false;
}

/** The stable placeholder page key used when `dockPage` is omitted, purely
 * to satisfy the Rules of Hooks (useDetailDock/useDetailDockPref must always
 * be called) — its result is discarded in the static-placement branch. */
const NO_DOCK_PAGE: DetailDockPageKey = 'sessions';

/**
 * Pointer-drag resize handle between the main content and the detail region
 * (spec 054 T010). `grow` says which direction dragging increases the
 * persisted width: `'left'` for a side panel anchored to the right edge
 * (dragging the handle left grows it), `'right'` for a split's narrow list
 * anchored to the left edge (dragging right grows it).
 */
function DockResizeHandle({
  page,
  grow,
  width,
  onLiveWidth,
}: {
  page: DetailDockPageKey;
  grow: 'left' | 'right';
  width: number;
  onLiveWidth: (width: number | null) => void;
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    function resolveWidth(clientX: number): number {
      const drag = dragRef.current;
      if (!drag) return width;
      const delta = clientX - drag.startX;
      const signed = grow === 'right' ? delta : -delta;
      const max = Math.max(window.innerWidth * 0.5, MIN_SIDE_WIDTH);
      return Math.min(Math.max(drag.startWidth + signed, MIN_SIDE_WIDTH), max);
    }
    function handleMove(event: PointerEvent): void {
      if (!dragRef.current) return;
      onLiveWidth(resolveWidth(event.clientX));
    }
    function handleUp(event: PointerEvent): void {
      if (!dragRef.current) return;
      setDetailDockWidth(page, resolveWidth(event.clientX));
      dragRef.current = null;
      onLiveWidth(null);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // `width` intentionally excluded — it's read fresh via `dragRef` at drag
    // start (`onPointerDown`), not on every render while dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grow, page, onLiveWidth]);

  return (
    <div
      className="alm-listpage__resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={m.list_page_layout_resize_handle_aria()}
      tabIndex={0}
      onPointerDown={(event) => {
        dragRef.current = { startX: event.clientX, startWidth: width };
      }}
    />
  );
}

export function ListPageLayout({
  topBar,
  topBarProps,
  children,
  detail,
  onCloseDetail,
  detailLabel = m.common_details(),
  detailPlacement = 'bottom',
  dockPage,
  forcedPlacement,
}: ListPageLayoutProps) {
  const hasDetail = detail != null;
  const pageRef = useRef<HTMLDivElement>(null);

  // Hooks are always called (Rules of Hooks) — when `dockPage` is omitted we
  // pass a stable placeholder key and ignore both results below.
  const dock = useDetailDock(
    dockPage ?? NO_DOCK_PAGE,
    pageRef,
    forcedPlacement,
  );
  const dockPref = useDetailDockPref(dockPage ?? NO_DOCK_PAGE);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);

  const placement: EffectivePlacement = dockPage
    ? dock.effectivePlacement
    : detailPlacement === 'side'
      ? 'side'
      : 'bottom';
  const width = liveWidth ?? dockPref.width;
  const resizable = dockPage != null && placement !== 'bottom';

  // Escape closes the open detail panel, matching the ✕ affordance (#771).
  // A `document`-level listener also catches the common case where nothing
  // inside the panel has focus (e.g. focus stayed on the row that opened it,
  // or on <body>). `stopPropagation()` does NOT stop a sibling listener
  // registered on the SAME target — Base UI's own Escape dismissal
  // (`useDismiss`) is also a `document`-level `keydown` listener, and by
  // default (`escapeKeyBubbles: false`) it calls `stopPropagation()` but
  // never `preventDefault()`, so neither mechanism reaches across to block
  // this listener. We therefore check explicitly for an open Base UI overlay
  // (Dialog/Select/Combobox/Menu — anything carrying Base UI's `data-open`
  // styling-hook attribute plus an overlay ARIA role) and skip closing the
  // panel while one is open, deferring to its own dismissal.
  useEffect(() => {
    if (!hasDetail) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (hasOpenOverlay()) return;
      onCloseDetail?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasDetail, onCloseDetail]);

  // The in-page Auto/Bottom/Right control (spec 054 T021, US4) surfaces only
  // for pages that adopted the adaptive mechanism (`dockPage`) AND whose shape
  // isn't hard-forced (Inbox's permanent split has no user-adjustable
  // placement — FR-014). Built once and reused by both placement branches
  // below so there is a single render site, not per-branch duplicates.
  const showPlacementControl = dockPage != null && forcedPlacement == null;
  const detailBar =
    showPlacementControl || onCloseDetail ? (
      <div className="alm-listpage__detail-bar">
        {showPlacementControl && (
          <DetailDockPlacementControl
            page={dockPage as DetailDockPageKey}
            className="alm-listpage__detail-placement"
          />
        )}
        {onCloseDetail && (
          <button
            type="button"
            className="alm-listpage__detail-close"
            onClick={onCloseDetail}
            aria-label={m.inbox_close_details_aria()}
          >
            ✕
          </button>
        )}
      </div>
    ) : null;

  if (placement === 'side' || placement === 'split') {
    const isSplit = placement === 'split';
    const bodyClass = `alm-listpage__body ${isSplit ? 'alm-listpage__body--split' : 'alm-listpage__body--side'}`;
    const mainClass = isSplit
      ? 'alm-listpage__main alm-listpage__main--split'
      : 'alm-listpage__main';
    const detailClass = `alm-listpage__detail ${isSplit ? 'alm-listpage__detail--split' : 'alm-listpage__detail--side'}`;
    // Split's narrow region is the LIST (left); side's narrow region is the
    // DETAIL (right) — each variant sizes the region it pins via its own CSS
    // custom property (tables-lists.css / merges-2.css), defaulting to the
    // static ~420px/~360px when the page hasn't adopted resizing (`dockPage`
    // omitted or `resizable` false).
    const bodyStyle: CSSProperties | undefined = resizable
      ? {
          [isSplit ? '--alm-split-list-w' : '--alm-side-detail-w']:
            `${width}px`,
        }
      : undefined;

    return (
      <div className="alm-page" ref={pageRef}>
        {topBar ?? (topBarProps && <PageTopBar {...topBarProps} />)}

        <div className={bodyClass} style={bodyStyle}>
          <div className={mainClass}>{children}</div>

          {resizable && (
            <DockResizeHandle
              page={dockPage as DetailDockPageKey}
              grow={isSplit ? 'right' : 'left'}
              width={width}
              onLiveWidth={setLiveWidth}
            />
          )}

          {hasDetail && (
            <section
              className={detailClass}
              role="complementary"
              aria-label={detailLabel}
            >
              {detailBar}
              <div className="alm-listpage__detail-body">{detail}</div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // ── Bottom dock (default) ────────────────────────────────────────────────
  return (
    <div className="alm-page" ref={pageRef}>
      {topBar ?? (topBarProps && <PageTopBar {...topBarProps} />)}

      <div className="alm-listpage__body">
        <div className="alm-listpage__main">{children}</div>

        {hasDetail && (
          <section
            className="alm-listpage__detail"
            role="complementary"
            aria-label={detailLabel}
          >
            {detailBar}
            <div className="alm-listpage__detail-body">{detail}</div>
          </section>
        )}
      </div>
    </div>
  );
}
