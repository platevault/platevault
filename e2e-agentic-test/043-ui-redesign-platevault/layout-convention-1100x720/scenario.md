# Verification — Layout convention at 1100×720: pinned action bars, only content scrolls, across themes

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human visual
> pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Scope and spec references

- Project-wide page layout convention (project memory `page-layout-convention`
  + spec 043 §3): action bars / page headers are ALWAYS visible; only the
  content area scrolls. Canonical classes: `.alm-page`, `.alm-page__bar`
  (never scrolls), `.alm-page__scroll` (the only scroll container).
  `PageTopBar.tsx` renders `.alm-page__bar.alm-topbar`; `ListDetailLayout.tsx`
  wraps its top bar in `.alm-page__bar`.
- Window floor (from `apps/desktop/src-tauri/tauri.conf.json`): default
  1280×820, minimum **1100×720** — the convention is verified AT the minimum.
- Verified across 2+ themes (one light, one dark) per the task's cross-cutting
  bar.

## Preconditions (both stages)

1. Branch deployed + app launched with bridge overlay per AGENT-RUNNER.md;
   `VITE_USE_MOCKS=false`; setup completed.
2. Enough data that main lists overflow vertically at 720 px height (≥ ~25
   sessions/inbox rows via the shared fixture ingest — see AGENT-RUNNER.md).
   Without overflow the scroll assertions are vacuous: record affected pages
   as PASS-with-note "no overflow available".

## Stage 1 — Agent validation via Tauri MCP

### 1.0 Window setup

1. Set the window to exactly 1100×720 via `mcp__tauri__manage_window`
   (resize). Confirm via `webview_execute_js`:
   `[window.innerWidth, window.innerHeight]` (inner size will be slightly
   smaller than outer; record both).
2. Also attempt to resize BELOW the minimum (e.g. 900×600) and read the
   resulting size.
   - Expected: the OS clamps to ≥ 1100×720 (minWidth/minHeight enforced).
   - FAIL if the window shrinks below the floor.
3. Select theme **Warm Slate** (light) for the first pass.

### 1.1 Per-page convention audit (run on EVERY route)

Routes: `/inbox`, `/sessions`, `/calibration`, `/targets`, `/projects`,
`/archive`, `/plans`, `/audit`, `/review`, `/settings` (any pane with long
content, e.g. Equipment or Naming).

On EACH route run this audit via `webview_execute_js`:

```js
(() => {
  const bars = [...document.querySelectorAll('.alm-page__bar')];
  const scrolls = [...document.querySelectorAll('.alm-page__scroll')]
    .filter((el) => el.scrollHeight > el.clientHeight);
  const doc = document.documentElement;
  const bodyScrolls = doc.scrollHeight > doc.clientHeight ||
    document.body.scrollHeight > document.body.clientHeight;
  // any scrollable ancestor OTHER than .alm-page__scroll (and known panels)?
  const rogue = [...document.querySelectorAll('*')].filter((el) =>
    el.scrollHeight > el.clientHeight + 1 &&
    ['auto','scroll'].includes(getComputedStyle(el).overflowY) &&
    !el.closest('.alm-page__scroll') &&
    !el.classList.contains('alm-page__scroll') &&
    !el.closest('.alm-logpanel') && !el.closest('.alm-sidebar') &&
    !el.closest('[role="dialog"]') && !el.closest('.alm-palette'),
  ).map((el) => el.className);
  return { barCount: bars.length,
           barRects: bars.map((b) => b.getBoundingClientRect().top),
           scrollables: scrolls.length, bodyScrolls, rogue };
})()
```

Assertions per route:

1. `barCount >= 1` — the page renders its bar via the convention classes.
   - FAIL if a page header exists but is NOT inside `.alm-page__bar`
     (cross-check visually via screenshot if barCount is 0).
2. `bodyScrolls === false` — the document/window NEVER scrolls; no
   window-level scrollbar at 1100×720.
3. Scroll test: pick the primary `.alm-page__scroll` (largest one), set
   `el.scrollTop = el.scrollHeight`, then re-read every `.alm-page__bar`'s
   `getBoundingClientRect().top`.
   - Expected: bar positions UNCHANGED (bars pinned; only content moved).
   - Also assert the status bar and the collapsed log strip at the bottom are
     still fully inside the viewport (`rect.bottom <= innerHeight`).
4. `rogue` list: record it. A nested legitimate panel (virtualized list body,
   textarea, code block) is acceptable — judgment note; a second full-page
   scroller stacking scrollbars is a FAIL.
5. Horizontal: assert no `overflow-x` scrolling of the document
   (`doc.scrollWidth <= doc.clientWidth + 1`).
6. Screenshot checkpoints (scrolled-to-bottom state):
   `layout-<route>-warm-slate.png`.

### 1.2 Repeat in a dark theme

1. Switch theme to **Observatory** (Settings → General).
2. Re-run the 1.1 audit on at least FIVE routes (`/inbox`, `/sessions`,
   `/targets`, `/archive`, `/settings`) — theme switches must not change
   layout metrics.
   - Expected: identical assertion outcomes; screenshots
     `layout-<route>-observatory-dark.png`.
3. FAIL if any assertion result differs between themes (layout must be
   theme-invariant).

### 1.3 Log panel interaction with the convention

1. On `/sessions` (overflowing list), expand the bottom log panel.
   - Expected: the page's `.alm-page__bar` stays visible; the
     `.alm-page__scroll` viewport shrinks (its clientHeight decreases); the
     window still does not scroll.
2. Collapse the panel; metrics restore.

### 1.4 Log check

`mcp__tauri__read_logs`: no error-level entries from the resize/navigation
sweep.

Stage 1 verdict: PASS only if 1.0–1.4 pass on every audited route (notes
allowed where stated). Any FAIL blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. At exactly 1100×720, walk every route in BOTH themes used above and judge
   by eye: action bars and their buttons never leave the viewport while
   scrolling; no double scrollbars; no content hidden under the status bar or
   log strip; tables degrade gracefully (column truncation/ellipsis rather
   than horizontal window scroll).
2. Maximize the window and re-check two pages: content widens sensibly (no
   absurd full-width text lines in settings panes; lists use the space).
3. Resize slowly from maximized down to the 1100×720 floor on `/sessions`:
   no layout jumps, overlaps, or flicker during the drag.
4. Judgment on the `rogue` scrollers recorded in Stage 1: each must be a
   deliberate inner panel, not an accidental nested page scroller.
5. Sign-off with before/after-scroll screenshot pairs for two routes per
   theme.

Final verdict: PASS when both stages pass.
