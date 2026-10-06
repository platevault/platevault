# HARNESS V1 — native macOS

Competing look for the PlateVault app harness, built on the integrated
prototype (`apps/prototype`, branch `ui-harness-v1`). Visual and interaction
design only: no domain, store or data-layer change; every route path in
HIGH-LEVEL-DESIGN.md §4 is unchanged except the new `/overview` start page.

## Premise

PlateVault should feel like a first-party Mac app (Photos, Finder, Xcode
organizer), not a web page in a window. The window is the layout: a
full-height translucent source list with the traffic-light inset, a unified
title-bar toolbar over the content, the content pane as the only scroller, a
status bar at the bottom. System fonts at AppKit sizes, native-density
controls, light and dark from the system, the system accent where the engine
exposes it.

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
| Work | Views, Plan (Plans + Projects), Storage |
| Recent Targets | the three most recently captured Targets with integration — D's "Targets are the navigation" in three rows instead of a full sky rail |
| Bottom bar | Getting started (T1), Activity and Settings as icon buttons |

Seven top-level items in two groups (was nine plus utilities). Projects live in
the Plan area beside the planner (the orientation walk's Projects stop points at
Plan). The Target finder is the dense, searchable Targets table — one 26 px row
per Target with channels, captured / usable / Unreviewed integration — instead
of D's sky-first landing.

## Taken from A–E

- **A (instrument panel)**: the always-on status line — the status bar keeps
  running work, interrupted work and offline locations on screen everywhere.
- **B (calm archive)**: preview-then-confirm (unchanged ConfirmDialogs, kept
  as sheets), values beside their source in session and frame detail (inherited
  tokens). The plate-on-mount frame presentation is **not done** (see Gaps).
- **C (guided pipeline)**: the View areas are a pipeline rail — numbered
  stages Sessions → Frames → Calibration → Prepare → *you process* → Results →
  Cleanup, each with its readiness in a word and a shape (check, alert, number;
  never colour alone) derived from the real View (included lights, unreviewed
  frames, latest preparation state, accepted Results, Complete), and one
  **Next** action to the first stage that is not done. Link names stay the area
  names; the readiness is their `aria-describedby`.
- **D (sky-first)**: the IA above; Plan as its own area reached from the source
  list and each Target. D's night timeline inside Plan is **not re-drawn** (see
  Gaps); the existing Plan/Plans windows and reminders surfaces carry over.
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
- **Traffic-light inset**: `--traffic-lights-w`; in Tauri use
  `titleBarStyle: "Overlay"`, `hiddenTitle: true`, `windowEffects: ["sidebar"]`
  with `transparent: true`; the browser preview draws decorative stand-ins
  (`aria-hidden`), hidden when `__TAURI_INTERNALS__` exists. Toolbar and source
  list header carry `data-tauri-drag-region`.
- **Resizable splits**: `SplitHandle` (role `separator`, arrow keys ±8 px,
  Shift ±32 px, Home/End, Enter or double-click resets) for the sidebar
  (176–320 px, persisted) and every `ListDetail` (Settings, Calibration).
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
- **Keyboard**: ⌘K, `[` sidebar, G-sequences (G H Overview added), the
  existing table keys; focus ring is the macOS halo (3 px accent, follows the
  radius).

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
(demo library, dark system appearance, private headless Chrome).

## Gaps (this round)

- Frames review: B's plate-on-mount preview and per-value source captions are
  not restyled beyond tokens.
- Results/artifacts: inherits tokens and toolbar; no plate presentation.
- Plan area: D's night timeline is not redrawn; no Plans/Projects segmented
  control yet (Projects is reached from Plan's own links, Targets and ⌘K).
- Right inspector: the layout tokens and `SplitHandle` exist, no page uses an
  inspector pane yet.
- Context menus with shortcuts on rows: not added.
- Critique (design-critic, a11y-auditor, `impeccable detect`) not run.
