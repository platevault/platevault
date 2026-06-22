/**
 * ListPageLayout — standard list-page scaffold (spec 043, tasks #62/#73/#86).
 *
 * The shared layout system generalized from the Sessions page. Composition:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ PageTopBar (pinned, never scrolls)           │  ← topBar
 *   ├──────────────────────────────────────────────┤
 *   │ primary content (FULL WIDTH)                 │  ← children
 *   │ table / list, scrolls                        │
 *   ├══════════════ draggable splitter ════════════┤  ← resize handle
 *   │ detail panel (full width, docked BELOW)      │  ← detail
 *   │ scrolls independently                        │
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
 * The split is resizable: drag the splitter to set the detail panel height,
 * which is persisted to localStorage (`alm.listpage.detailHeight`). A close (✕)
 * affordance hides the detail and returns the table to full height. The panel
 * mounts only when `detail` is non-null (so we never show an empty centered
 * dashboard).
 *
 * Pass the top bar either as a ready `topBar` node (e.g. `<PageTopBar .../>`)
 * or via the convenience `topBarProps` slots, which this component forwards to
 * an internal `PageTopBar`. ListPageLayout is itself the `.alm-page` root, so
 * it must be the page's outermost element (do not nest it inside PageShell).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
}

const HEIGHT_STORAGE_KEY = 'alm.listpage.detailHeight';
const DEFAULT_HEIGHT = 360;
const MIN_HEIGHT = 200;
/** Leave at least this much room for the primary content above the panel. */
const MIN_TOP_SPACE = 160;

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (raw != null) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= MIN_HEIGHT) return n;
    }
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default.
  }
  return DEFAULT_HEIGHT;
}

export function ListPageLayout({
  topBar,
  topBarProps,
  children,
  detail,
  onCloseDetail,
  detailLabel = 'Details',
}: ListPageLayoutProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [detailHeight, setDetailHeight] = useState<number>(readStoredHeight);
  const [dragging, setDragging] = useState(false);

  // Persist height across mounts/sessions.
  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(detailHeight));
    } catch {
      // Best-effort; ignore quota / unavailable storage.
    }
  }, [detailHeight]);

  // Begin a splitter drag. The actual pointer tracking lives in the effect
  // below, keyed on `dragging`, so the document-level listeners are added and
  // torn down together (no circular handler references).
  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  // While dragging, track the pointer on the document and convert its Y into a
  // panel height measured from the bottom of the body, clamped so the table
  // keeps a usable minimum. Listeners are removed when the drag ends or the
  // component unmounts.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const fromBottom = rect.bottom - e.clientY;
      const max = Math.max(MIN_HEIGHT, rect.height - MIN_TOP_SPACE);
      setDetailHeight(Math.min(Math.max(fromBottom, MIN_HEIGHT), max));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  const hasDetail = detail != null;

  return (
    <div className="alm-page">
      {topBar ?? (topBarProps && <PageTopBar {...topBarProps} />)}

      <div
        ref={bodyRef}
        className="alm-listpage__body"
        // eslint-disable-next-line no-restricted-syntax -- dynamic: resizable splitter sets the bottom panel height via a CSS custom property
        style={{ '--alm-listpage-detail-h': `${detailHeight}px` } as React.CSSProperties}
        data-dragging={dragging ? 'true' : undefined}
      >
        <div className="alm-listpage__main">{children}</div>

        {hasDetail && (
          <>
            <div
              className="alm-listpage__splitter"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize detail panel"
              onPointerDown={startDrag}
            />
            <section className="alm-listpage__detail" aria-label={detailLabel}>
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
          </>
        )}
      </div>
    </div>
  );
}
