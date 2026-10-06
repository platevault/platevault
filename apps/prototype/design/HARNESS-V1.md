# HARNESS V1 — native macOS

Competing look for the PlateVault app harness, built on the integrated
prototype (`apps/prototype`, branch `ui-harness-v1`). Visual and interaction
design only: no domain, store or data-layer change; every route path in
HIGH-LEVEL-DESIGN.md §4 is unchanged except the new `/overview` start page.

## Premise

PlateVault should feel like a first-party Mac app (Photos, Finder, Xcode
organizer), not a web page in a window. The window is the layout: a
full-height translucent source list, a unified toolbar over the content, the
content pane as the only scroller, an inspector where a page has a current
item, a status bar at the bottom. System fonts at AppKit sizes,
native-density controls, light and dark from the system, the system accent
where the engine exposes it. The OS (Tauri) draws the window, its title bar
and its controls; the app draws none of them (user feedback 2026-10-06).

## Start page: Library overview (`/overview`)

The app opens on **Overview**, not on Targets and not on tonight's sky.
Reason: the user's first question when PlateVault starts is "what happened
since I last looked?" — captures were indexed overnight, a scan left frames
unreadable, sessions arrived without a Target, a preparation is still running.
Targets answer "what do I have", tonight's sky answers "what do I shoot next";
both are second questions and both are one click away (source list, Recent
Targets, Plan). Overview shows, in four group boxes plus a totals strip:

- **Since your last visit** — Activity entries after the previous visit
  (stored as a shell preference, `platevault.overview.lastVisit`, like the
  sidebar width; never in the catalog).
- **Needs review** — sessions without a Target, conflicting Target evidence,
  unreviewed light frames, partial scans, offline locations; each row links to
  where the decision is made.
- **Running work** — running, paused and interrupted operations with progress.
- **Latest captures** — the six newest light sessions with Target and
  integration.
- **Library** — Targets, light sessions, Views, with links to Plan and Targets.

Onboarding, "Set up later", demo load and "Replay orientation" now land on
Overview; the first-run orientation walk opens there.

## Structure: Direction D, concise

D's information architecture (Target-scoped work, planning as its own area)
in a compact source list:

| Group | Items |
|---|---|
| — | Overview (badge: sessions waiting for a Target decision) |
| Library | Targets, Sessions, Calibration |
| Work | Views, Projects, Plan, Storage |
| Recent Targets | the three most recently captured Targets with integration — D's "Targets are the navigation" in three rows instead of a full sky rail |
| Bottom bar | Getting started (T1), Activity and Settings as icon buttons |

Eight top-level items in two groups plus Overview (was nine plus a utilities
list), single-line 26 px rows, no sparklines or per-Target rows beyond the
three Recent Targets. A first cut moved Projects into Plan; the journey walk
showed J20/J21 and the orientation walk reach Projects from the source list,
so it stays there. The Target finder is the dense, searchable Targets table — one 26 px row
per Target with channels, captured / usable / Unreviewed integration — instead
of D's sky-first landing.

## Taken from A–E

- **A (instrument panel)**: the always-on status line — the status bar keeps
  running work, interrupted work and offline locations on screen everywhere.
- **B (calm archive)**: preview-then-confirm (unchanged ConfirmDialogs, kept
  as sheets) and **plates on mounts** (`components/app/plate.tsx`): an
  always-dark plate inside a paper mat (`--mount`, `--plate`) with a catalogue
  caption whose values sit beside their source (`120 s EXPTIME`, `L FILTER`,
  `8.78″ FWHM · built-in`). Frames review mounts the preview and offers a
  **Table | Plates** contact sheet (`features/t3/plates.tsx`, lazily drawn
  from the same synthetic star field). Results mounts the inspected product
  and offers **Table | Plates** for accepted Results; product plates are
  labelled "Illustration, not product pixels".
- **C (guided pipeline)**: the View areas are a pipeline rail — numbered
  stages Sessions → Frames → Calibration → Prepare → *you process* → Results →
  Cleanup, each with its readiness in a word and a shape (check, alert, number;
  never colour alone) derived from the real View (included lights, unreviewed
  frames, latest preparation state, accepted Results, Complete), and one
  **Next** action to the first stage that is not done. Link names stay the area
  names; the readiness is their `aria-describedby`.
- **D (sky-first)**: the IA above; Plan as its own area reached from the source
  list and each Target. **Night planner** (`features/t5/night-planner.tsx`)
  on a Target's Plan: tonight's timeline (Day / civil / nautical /
  astronomical twilight / Night bands, Moon strip, the Target's altitude
  curve against the minimum altitude, windows outlined, now) with a legend
  and a written summary, above a 14-night strip on one axis; picking a night
  redraws the timeline. The Plans page opens with a **Tonight** strip of
  planned Targets. `planning.ts` gained `nightProfile` (display sampling only).
- **E (command workspace)**: ⌘K search field in the toolbar's trailing slot,
  back/forward history buttons, the persistent split panes.

## Desktop conventions used

- **Window frame**: `h-dvh`, `body { overflow: hidden }`; only `[data-scroll-area]`
  scrolls. No hero blocks, no page headers in the content.
- **Unified toolbar**: a level-1 `PageHeader` portals its path (eyebrow), h1,
  status badges and subtitle (description) into the toolbar title slot and its
  actions into the trailing slot. The toolbar sits *inside* `<main>`, so the h1
  and every page action stay in the main landmark (route focus, skip link and
  the journey walkers' `main` scope unchanged). Below the needed width the
  actions wrap to a second toolbar row instead of crushing the title.
- **Source list**: translucent material (`material-sidebar`, backdrop blur;
  solid under `prefers-reduced-transparency`), accent-tinted icons, 26 px rows,
  Finder-style selection fill, section headers, count badge.
- **No drawn window chrome**: no traffic lights, title-bar stand-ins or window
  frame. In Tauri use the native title bar (or `titleBarStyle: "Overlay"`
  with the toolbar's `data-tauri-drag-region`); the toolbar and source-list
  header keep that attribute.
- **Resizable splits**: `SplitHandle` (role `separator`, arrow keys ±8 px,
  Shift ±32 px, Home/End, Enter or double-click resets) for the sidebar
  (176–320 px, persisted), every `ListDetail` (Settings, Calibration) and the
  inspector (240–420 px, persisted).
- **Inspector** (`components/app/inspector.tsx`): trailing pane, sticky under
  the toolbar, scrolls on its own, one shared width and shown/hidden
  preference; ⌥⌘0 or the page's toggle. Used by Frames review (current frame
  and measurement plot) and the Target finder (identity, integration by
  channel, tonight's window, Projects, Open/Plan); it follows the clicked or
  focused row.
- **Row context menus** (`components/app/row-menu.tsx`, `DataTable.rowMenu`):
  right-click, ⇧F10 or the Menu key; key equivalents right-aligned and in
  `aria-keyshortcuts` (Frames: X exclude/restore; Targets: ⌘↓ Open, ⌥⌘0
  inspector); Escape returns focus to the row. Every item repeats an action
  reachable elsewhere.
- **Status bar**: 24 px, library counts or the running operation, interrupted
  and offline links, Prototype, appearance menu.
- **Controls (AppKit metrics)**: push button 24 px / small 22 / mini 20, 5 px
  radius, regular-weight 13 px label, hairline bezel, accent prominent button;
  NSPopUpButton selects with the accent up/down well; segmented controls with
  an accent selected segment; 14 px check boxes; 24 px text fields; menus with
  22 px items, leading checkmarks, accent highlight with white text; tooltips as
  small bordered labels; sheets/alerts with a window shadow and light dimming.
- **Tables**: NSTableView look — content-white body, alternating rows, 11 px
  header with column separators, accent-tinted selection, current row bar.
- **Group boxes, not cards**: `Card` is a flat 8 px box with a hairline; a card
  nested in a card loses its box.
- **No text selection on chrome**: buttons, tabs, menu items, labels, table
  headers, badges and `[data-chrome]` regions do not select; content does.
- **Keyboard**: ⌘K, `[` sidebar, G-sequences (G H Overview added), ⌘1–⌘5
  source-list items (desktop app; the browser keeps them for tabs), ⌥⌘0
  inspector, ⇧F10 row menu, the existing table keys; focus ring is the macOS
  halo (3 px accent, follows the radius).

## Tokens (`src/index.css`)

System fonts (`-apple-system`/SF Pro, `ui-monospace`/SF Mono); type 11/13/14/15/17/22 px.
Surfaces: `window` (chrome), `background` (content), `card` (group box),
`control` (bezel), `row-alt`; accent split into `primary` (text/focus, AA on
every surface) and `key` (fill under white text). Light: primary/key `#0060cf`
(5.9:1 white text), secondary label `#5c5c5c` (5.4:1 on `#ececec`). Dark:
primary `#4ea2ff` (6.0:1 on `#1e1e1e`), key `#0a63cc` (5.8:1), secondary label
`#a3a3a3` (5.4:1 on `#2b2b2b`). Control boundaries `input` ≥ 3:1. With
`AccentColor` support the accent follows the system, lightness clamped so the
ratios hold. Theme default is now **Match system**.

## Screenshots (`design/harness-v1/`)

`hv1-overview-1280.png`, `hv1-overview-1024.png`, `hv1-targets-1280.png`,
`hv1-targets-1024.png`, `hv1-sessions-1280.png`, `hv1-hv1-sessions-1024.png`,
`hv1-hv1-frames-1280.png`, `hv1-hv1-frames-1024.png`, `hv1-hv1-prepare-1280.png`,
`hv1-hv1-results-1280.png`, `hv1-plans-1280.png`, `hv1-plans-1024.png`
(round 1); round 2: `hv1c-frames-table-1280.png`, `hv1c-frames-plates-1280.png`,
`hv1c-frames-menu-1280.png`, `hv1c-results-1280.png`, `hv1c-targets-1280.png`,
`hv1c-targets-menu-1280.png`, `hv1c-plan-1280.png` (demo library, dark system
appearance, private headless Chrome). Round-1 shots still show the drawn
traffic lights that round 2 removed.

## Gaps (this round)

- Structure is frozen for the coming IA rework (Project → Plan → View
  pipeline, one main workflow page): no further pages, navigation or
  start-page work was done in round 2.
- Journey spot-walks J22 S12–S15a, J24 prepare, J27 S10, J29 S1–S7a were
  not re-run. Round-1 walks broke at J20 S1 because the first-run
  orientation walk re-opened over Targets (`scope: dialog`, Skip tour/Next)
  after its trigger moved to `/overview`; that trigger is part of the
  start-page change and is left for the IA rework.
- Critique (design-critic, a11y-auditor, `impeccable detect`) not run; the
  band, mount and curve contrast values are design targets, not measured.
- Rendered checks this round were at 1280 only; 1024 not re-shot.
