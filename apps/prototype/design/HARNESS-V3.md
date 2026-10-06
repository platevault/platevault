# Harness V3: Workspace with panes

Competing look for the PlateVault prototype harness (branch `ui-harness-v3`,
base `99a625b4`). Visual and interaction design only: no domain or
data-layer change; every route path is unchanged except that `/` now renders
the Work queue instead of redirecting to `/targets`.

## 1. Premise

Direction E's strongest idea, made robust: the app is one desktop **window**
with **panes**, not a scrolling web page.

- A unified **toolbar** (40 px): sidebar toggle, Back/Forward, the app mark,
  the centred **command field** ("Search or run a command… ⌘K", the main verb
  surface), Prototype, theme, and the inspector toggle (⌥⌘I).
- A resizable **source list** on the leading edge (168–300 px, keyboard
  resizable, Enter/double-click collapses to a 48 px icon rail).
- **Document tabs** over the main pane: each opened record (Target, Session,
  View, Project) gets a tab; a single click from a list opens the italic
  *preview* tab that the next record replaces; double-click or the tab's
  context menu "Keep open" keeps it. A View keeps one tab and returns to the
  area you left it in.
- A resizable **inspector** on the trailing edge (240–440 px) that shows what
  the page's **cursor** points at. The cursor (accent-tinted row with a 2 px
  bar) is never the checked set (checkboxes): three separate signals, with
  zebra striping as the resting state.
- A **status bar** (26 px): Activity, running work with percent, interrupted
  work, offline locations. Activity left the menu for here: it is running
  work, not a place.

The default layout never breaks a core screen: the document never scrolls
(measured `scrollHeight − clientHeight = 0` on every surface at 1280 and
1024), panes scroll on their own, and at widths below 1200 px the inspector
starts hidden and floats over the main pane when opened, so 1024 keeps the
full main pane. Below 768 px the source list becomes a drawer (WCAG 1.4.10).

## 2. Start page: the Work queue (`/`)

The app opens on **Views in progress**, each with its pipeline stage strip,
the stage it stands in, and its **one Next action**; Complete Views follow
for their optional cleanup. The cursor row fills the inspector with that
View's six gates.

Why not Targets or tonight's sky:

- A returning user's question is "what was I doing?", not "what do I own?".
  Work in PlateVault is View-shaped (select → review frames → calibrate →
  prepare → process outside → results → clean up) and spans days; the queue
  answers it in one glance and one click.
- Targets is a reference catalogue: it changes only when captures arrive.
  Opening on it (the old home, and direction D's critique) makes every
  session start with a lookup.
- Tonight's sky is time-boxed and site-dependent: useless by day, misleading
  without a default site. It is D's best idea, so it gets its own **Plan**
  area (`Plans` in the source list, and each Target's Plan), not the front door.
- An empty queue is a useful first-run state: it says what a View is and
  offers **Select sessions**.

## 3. Concise menu (source list)

Eight rows in two groups plus the start item, at 26 px (the old menu had ten
items at 32 px; D's rail listed every Target with sparklines):

| Group | Rows |
|---|---|
| (start) | Work queue — badge: Views in progress |
| Library | Targets, Sessions, Calibration, Storage |
| Work | Views, Projects, Plans |
| Footer | Getting started (T1 slot), Settings |

`g w` goes to the Work queue; the other go-to keys are unchanged.

## 4. What was taken from each direction

| Direction | Taken | Where |
|---|---|---|
| A (mission control) | The always-visible status bus: running, interrupted and offline state live in a status bar, never in toasts | `StatusBar` in `src/app/shell.tsx` |
| B (plates and provenance) | Values next to their source (`PropertyList`: value + source label); preview-then-confirm kept in the areas that own each write — the pipeline only routes, never acts | `src/components/app/panes.tsx`; areas unchanged |
| C (pipeline) | Stages = the View areas in order, a readiness gate per stage (Done / Ready / Blocked / Running / Advisory / Waiting, icon + word), and one Next action docked under the area | `src/app/pipeline.ts`, `src/components/app/pipeline.tsx`, `features/t3/workspace.tsx` |
| D (target-scoped, planner) | The IA: Views and plans hang from Targets; the Plan area reached from the menu and each Target | `navigation.ts`; Plans/Target Plan routes unchanged |
| E (workspace) | Resizable panes with keyboard splitters, document tabs with a preview tab, a cursor-following inspector, the command field as the verb surface | `shell.tsx`, `doc-tabs.tsx`, `panes.tsx` |

## 5. Desktop conventions used

- System font (SF Pro via `-apple-system`) at native sizes: 11 / 13 / 14 / 15 px
  (`--text-xs/sm/base/lg` overridden, so every inherited screen lands on it).
- Controls 26 px (small 24 px, the WCAG 2.5.8 floor), 4–5 px radii, a hairline
  bezel and 1 px drop instead of lift-on-press; no `translate-y` press.
- Chrome does not select text and keeps the arrow cursor (buttons, tabs, menu
  items, labels, headers, `[data-chrome]` regions); fields inside chrome stay
  editable. Content values (paths, hashes) stay selectable.
- Tables: zebra rows, 26 px rows (`--row-h`, 24 compact / 32 spacious),
  sticky header, cursor separate from checked rows.
- Splitters: `role="separator"` with value, ←/→ 16 px, Shift 64 px, Home/End,
  Enter collapses (WAI-ARIA window splitter).
- Context menus (Base UI ContextMenu sharing the dropdown's items) on
  document tabs: Keep open, Close tab, Close other tabs.
- Toolbar Back/Forward, sidebar toggle (`[`), inspector toggle (⌥⌘I), palette ⌘K.
- Pane headers are one compact row: parent path inline before the title
  (Finder path bar), not an eyebrow stacked above it; no hero blocks.
- Dark default for night use; light theme kept; themed scrollbars and
  `::selection`.

## 6. Screenshots

`design/screenshots/harness-v3/` (restored J24-end state, dark theme):

- `v3-work-queue-1280.png`, `v3-work-queue-1024.png`
- `v3-view-frames-1280.png`, `v3-view-frames-1024.png`
- `v3-view-prepare-1280.png`, `v3-view-prepare-1024.png`
- `v3-targets-1280.png`, `v3-targets-1024.png`
- `v3-sessions-1280.png`, `v3-sessions-1024.png`
- `v3-plans-1280.png`, `v3-plans-1024.png`

## 7. Known gaps (not reached in this pass)

The shell, tokens, primitives, start page, menu and the View workspace
pipeline are restyled end to end; these surfaces inherit the tokens and
primitives but did not get their bespoke treatment yet:

- Target finder: still the inherited table; the planned compact searchable
  list with the cursor target in the inspector is not built.
- Target page: D's target-scoped tabs (Overview, Sessions, Views, Plan,
  Results) are not built; the page keeps its sections.
- Frames review: B's plates-on-mounts preview and value-with-source rows are
  not applied to the frame preview (only the `PropertyList` primitive exists);
  the imported-measurements block still nests bordered boxes.
- Results/artifacts: inherited only.
- Plan area: D's night timeline (sky bands, Moon, windows) is not drawn; the
  windows table is inherited.
- Command palette: restyle and context verbs (Next action, stage jumps) not added.
- The J18 tour copy still says "Your library starts here" on its Targets stop.
