# Harness v4 — Pipeline-first studio

Status: **partial, paused for the IA re-architecture** (2026-10-06). The tokens, primitives, app shell (source list, toolbar, status bar; no OS window chrome, since Tauri draws the native window), pipeline navigator, Next action, Pipeline board, Target finder, B's frame review and context menus are done. Structural work stops here: the Project → Plan → View workflow is being redesigned with the user. Branch `ui-harness-v4`; dev server `pv-harness-v4` at http://127.0.0.1:5504/.

## Premise

PlateVault is a native desktop studio. Direction C's numbered pipeline is the primary navigator, the way Xcode and Final Cut use their navigators. The seven stages are 1 Library, 2 Select, 3 Review, 4 Calibrate, 5 Prepare, 6 Results and 7 Store. Each stage has a readiness gate and the View has one Next action. The window is the layout:

- a full-height source list
- a unified toolbar over the content
- one scrolling content pane
- a status bar

The page never scrolls; only panes do.

## Start page and why

The start page is the **Pipeline** (`/` redirects to `/views`). It is neither Targets nor tonight's sky.

- PlateVault work moves through Views, and the question a user brings back to the app is "what is waiting on me, and what is next?". The pipeline answers that across every View. A Target list only answers "what do I own?", and the sky only answers "what could I shoot tonight?".
- Tonight-first planning stays one click away in **Plan**. Targets stay one click away in Library › Targets, so neither loses reach.
- The start page shows real state from day one: indexing, associations and saved Views. Sky planning depends on a configured site.

**Board** (`src/features/t3/views-pages.tsx`): one lane per View, the seven numbered stages as columns. Each cell shows the stage's gate glyph and short status; below a 58rem board the status folds into screen-reader text and the tooltip, so 1024 px shows a glyph lane. The cell of the stage that holds Next is lit, and lanes are grouped by that stage. A last group, *No View yet*, lists Targets with light sessions but no View, with Create View. The Next column runs the lane's Next action. Right-click, Shift+F10 or the Menu key opens the lane's context menu: Next, the seven stages, Open Target and Plan.

## Concise menu (source list)

The incumbent had 9 flat items in two groups. D had 4 sky rows plus 7 utilities. v4 has:

- **Primary:** **Pipeline** (start, `g v`) and **Plan** (`g l`).
- **Library** group: Targets, Sessions, Calibration, Projects, Storage.
- **Footer:** Getting started, Activity and Settings.

When a View is open, its seven numbered stages appear under Pipeline as an outline. Each stage row shows its gate glyph, its word (screen-reader text) and a short status such as "Saved r1" or "115 of 115". This outline is the navigator. The current area is the selected row, and the stage that holds Next carries an accent edge.

## What was taken from A–E

| Direction | Taken |
|---|---|
| A | Always-visible library state: the status bar shows locations online/offline, running work and interrupted work, and each item opens where it is resolved. Status always pairs a glyph with a word. |
| B | Status as glyph plus word. The frame preview is a dark plate on a matte mount with a caption (file name, zoom, stretch, pixel size). Measured values carry numbered source notes: method, basis, input SHA-256 and time for built-in values; method and the content-unverified flag for imported ones. Every ConfirmDialog reads as a preview: what changes beside what stays, and "nothing is written until you confirm". |
| C | The pipeline model (`src/app/pipeline.ts`) maps C onto the integrated areas: Select = Sessions, Review = Frames, Calibrate = Calibration, Prepare, Results, Store = Cleanup. It ports C's gate vocabulary (Done / Ready / Review / Blocked / Running / Partial / Not started, each with its own glyph shape). It also ports C's rule for the Next action: the first stage that blocks; otherwise the first stage that is not done; advisory items never capture Next. |
| D | Target-scoped IA: a View belongs to a Target, the Library stage opens its Target, and Plan is a primary destination. The Target finder (`src/features/t2/target-finder.tsx`) is a dense, searchable source list beside the Target detail on `/targets` and `/targets/$targetId`: name, first alias, Needs review and Planned glyphs, captured time; ↑/↓/Home/End move; the query stays in the URL; a context menu offers Open, Plan, Create View and New Project. D's night timeline is **not ported**. |
| E | Desktop regions: toolbar, panes and status bar. Desktop control density: 24 px small and 28 px regular controls, 26 px rows. |

## Desktop conventions used

- The window is the layout: `html` and `body` do not overflow. Measured: document scroll 800/800 at 1280×800 and 768/768 at 1024×768.
- **Source list** with a full-height sidebar (240 px, collapsible to 48 px with `[`), the app name in the sidebar's toolbar section, and selection drawn as the accent fill with white text.
- **Unified toolbar** (40 px, chrome surface): sidebar toggle, the Next action like a Run button (`⌘↩`), search (`⌘K`), Prototype, Theme.
- **Status bar** (24 px): locations online, offline volume, interrupted and running work.
- **Pane headers** replace web page headers: one bar with an inline path control (no kicker), a 15 px title, a one-line caption and actions on the right. Level 1 sticks to its pane.
- **Native density:** 13 px platform UI font (SF Pro / Segoe UI), an 11/13/15/17 px type scale, tabular numerals, 26 px rows (24 compact, 32 spacious), 5 px control radius, square panes.
- **Native tables:** a chrome-tinted sticky header in 11 px, zebra rows and hairline separators.
- **Menus, popovers and context menus** float with a real shadow. The highlighted item is the accent fill with white text, as in native menus. `src/components/ui/context-menu.tsx` wraps Base UI ContextMenu; `DataTable` takes a `contextMenu` prop (one menu per table, the row from the event).
- **Chrome is not text:** buttons, tabs, menu items, labels, table headers and `[data-chrome]` regions never select text, and controls keep the arrow cursor.
- Themed thin scrollbars, a themed selection colour, and a focus ring of 2 px accent with 1 px offset.
- **Keyboard:** `⌘↩` runs Next; `⌃1`–`⌃7` jump to a stage. Both are listed in the shortcuts sheet with the existing `g`-prefixed go-to keys.
- **Inline banners** (Notice): tinted by tone with a hairline edge, as in Xcode or Mail.

## Tokens

All tokens live in `src/index.css`.

- Dark (default): content `oklch(0.225 0.006 255)`, sidebar 0.25, chrome 0.27, popover 0.29.
- Fill accent: `oklch(0.54 0.17 255)` with white text, 5.1:1.
- Link accent: `oklch(0.76 0.12 250)`, at least 5.7:1 on every dark surface.
- Light theme mirrors these values.

Every status tone is a text colour with at least 4.5:1 on every surface (computed OKLCH→sRGB during design; the browser probe below covers dark only).

## Evidence

The private headless Chrome came from puppeteer-core with its own `--user-data-dir`. The run used the demo seed. Smoke script: `/Users/sjors/tmp/pv-harness-v4-walk/smoke.mjs`.

| width | doc scroll | console errors | observed |
|---|---|---|---|
| 1280 | 800/800 · 1280/1280 | 0 | View `M31 LRGB - PixInsight`: outline "1 Library Indexed … 6 Results Complete · 7 Store Cleanup available"; toolbar "Next: Clean up View" (24 px tall); status "6 of 7 locations online · Cold-1 captures offline · No work running" |
| 1024 | 768/768 · 1024/1024 | 0 | same outline, Next and status text |

Screenshots (`apps/prototype/design/harness-v4-shots/`): `1280-start.png`, `1280-views_view_m31_frames.png`, `1280-targets.png`, `1280-plans.png` and the `1024-` set. Board, finder and frame-review shots of 2026-10-06 are in the same folder (`board-1280.png`, `board-1280-menu.png`, `board-1024.png`, `finder-1280-overview.png`, `finder-1024-detail.png`, `finder-1280-menu.png`, `frames-1280.png`, `frames-1280-sources.png`).

Measured 2026-10-06 (demo seed): the board at 1280 and 1024 has doc scroll 800/800 and 768/768, a board frame of 983/983 and 742/742 px (no sideways scroll), 24 px buttons and 0 console errors. The finder rows are 26 px; ↓ then Enter opens M 31; typing "heart" keeps the query in the URL (`?q=heart`); 0 console errors. The mount has 8 px padding on `oklch(0.31 0.008 255)` with the plate on `oklch(0.13 0.006 255)`.

## Not done

Paused by the user's IA re-architecture; no further structural work in this round.

1. Results/artifacts restyle (rows with kind, SHA and lineage).
2. Plan area with D's night timeline (twilight bands, Moon band, altitude curve, window blocks).
3. Resizable sidebar split; a pipeline gate bar at the top of the View pane (the area tabs still duplicate the outline).
4. Journey spot-walks J19 S1–S7, J22 S12–S15a, J24, J27 S10 and J29 S1–S7a.
5. Light-theme contrast rendered and measured in the browser.
6. Critique (impeccable detect, design-critic, a11y-auditor).

No domain, store or action code was modified.
