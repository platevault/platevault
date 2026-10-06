# Harness v2 · Pro imaging studio

Branch `ui-harness-v2` · app `apps/prototype` · served at `http://127.0.0.1:5502/` (service `pv-harness-v2`).
Status: shell, tokens, primitives, start page, menu, Target finder, the View pipeline rail, Frames
review (loupe), the Results inspector and the Plan area's night timeline landed (see Known gaps).
Tauri draws the native window: the harness draws no OS window chrome (no traffic lights or title bar).

## Premise

PlateVault as a **pro imaging studio**, in the family of Lightroom Classic, Capture One and
PixInsight. A dark neutral-grey workspace that puts pixels first: panes are steps of one grey
ramp separated by dark seams, images sit in a darker well, chrome is small and quiet, and
colour appears only to mark **state** (selection, focus, the current pipeline stage, the one
Next action, and muted status tones that always travel with a glyph and a word).

Structure is **Direction D's** information architecture: Targets are the subject everything
hangs off (Target-scoped Views and planning), but the window does not *open* on Targets or on
tonight's sky.

## Start page: Recent sessions (`/`)

The window opens on **Recent sessions**: every current light session as a plate on its mount,
newest night first, rendered from the first readable frame (Auto stretch, display only), with
an inspector that lists the session's facts *and where each came from*.

Why this and not Targets or tonight's sky:

- **It answers the first question after a night**: "what came in, and does it look right?"
  Lightroom opens on the last import for the same reason.
- **It needs no decision to be useful.** Sessions without a Target yet ("Unresolved sky"),
  provisional sessions while a scan runs (J19 S6), and offline sessions (faded print, Offline
  glyph) all appear. A Target-first page hides exactly the sessions that need attention; a
  sky-first page is empty without a planning site (D's own known weakness).
- **It is image-first**, which is the premise: the library is pixels, not rows.
- Targets stay one keystroke away (**F** focuses the Target finder) and planning has its own
  area (Plan), reached from the menu and from every Target.

Interaction: the grid is one tab stop (listbox). Arrow keys move the selection (↑/↓ go to the
nearest plate in the next row), Enter or a double-click opens the session, and the context menu
(right-click, or the context-menu key) offers Open session ↵, Open Target, Plan this Target and
Show night in Sessions. The inspector (resizable) holds Navigator, Session (value · source) and
Quality panels.

## Menu: concise source list

Nine sidebar items became **seven destinations in two collapsible groups**, plus the Target
finder between them:

| Group | Items |
|---|---|
| Library | Recent · Sessions · Calibration |
| Targets (finder panel) | filter field + dense rows; header link *All Targets* |
| Work | Views · Projects · Plan · Storage |

Activity moved to the status bar (always visible, with running and interrupted work beside
it); Settings moved to the toolbar gear. Every destination keeps its `g` go-to key (`g r`
Recent, `g t` Targets, `g a` Activity, `g ,` Settings) and stays in ⌘K. The source list is
resizable (drag or ←/→ on the splitter), collapses to an icon rail with `[`, and becomes a
drawer below 768 px.

## Target finder

The source list's Targets panel: a 24 px filter field and one 24 px row per Target (name,
channels, captured integration, a review glyph when sessions need review). **F** focuses it,
↓/↑ walk the rows, Esc clears the filter, Enter opens the Target. It never becomes a landing
page; the full sortable table stays at *All Targets* (`/targets`).

## Tokens (`src/index.css`)

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `seam` `canvas` `background` `panel` `panel-header` `toolbar` `raised` `hover` `selected` | one neutral ramp (dark: #0e→#3d); seams are the darkest step |
| Text | `foreground` `muted-foreground` | ≥ 4.5:1 on every surface up to `hover` and `selected` (dark muted on selected 4.89) |
| Accent | `primary` (= `ring`, `info`) | state only: selection edge, focus ring, current stage, Next action, selected window. Links are neutral text with an underline (`Button` `link` variant) |
| Status | `success` `warning` `destructive` | muted studio tones, text-only tags with a hairline edge |
| Plates | `mount` `mount-edge` | the matte around an image (B) |
| Channels | `ch-l/r/g/b/ha/oiii/sii` | histogram traces and channel chips, always beside the channel name |
| Type | `text-2xs` 10.5 · `xs` 11.5 · `sm` 13 · `base` 14 · `lg` 15 px | system UI face (SF Pro), tabular numerals via `num` |
| Radius | `--radius` 4 px | buttons and fields 4 px, chips 2 px, no large rounded cards |
| Metrics | `--toolbar-h` 38 · `--statusbar-h` 24 · `--pane-header-h` 32 · `--row-h` 28 px | compact 24, spacious 34 |
| Sky | `band-day` `band-civil` `band-nautical` `band-astro` `band-dark` `band-moon` `curve` | night timeline only; one cool ramp, the curve warm |

Utilities: `chrome` (no text selection, arrow cursor), `panel-title` (small-caps panel headers),
`num` (tabular figures).

## Primitives

- `components/ui/*`: 28 / 24 px controls; `Button` variants `default` (strong neutral),
  `accent` (the one Next action), `outline`/`secondary` (raised grey), `ghost`; fields sit in
  the dark well; tabs underline in the accent; table headers are sticky panel-header strips.
- `components/ui/context-menu.tsx`: right-click menus that reuse the dropdown item parts and
  show shortcuts.
- `components/app/studio.tsx`: `SplitHandle` (WAI-ARIA window splitter), `Inspector`,
  `PanelSection` (collapsible, remembered), `PaneToolbar`, `ValueList` (value · source),
  `Readout`, `Plate` (image on its mount), `Filmstrip` (one tab stop, ←/→).
- `PageHeader` is a pane header strip; `PageBody` and `Section` use studio rhythm.

## Desktop conventions used

- The window is the layout: `h-dvh`, no document scroll; toolbar, source list, content pane
  and status bar; every pane scrolls on its own.
- Unified toolbar: source-list toggle, Back/Forward, app name, a search field that opens ⌘K,
  Prototype, theme, Settings.
- Source list with collapsible groups and an icon-rail mode; inspector on the right with
  collapsible panel sections; resizable splits with keyboard support.
- Status bar: running work with progress, interrupted work, offline locations, library totals,
  Shortcuts and Activity.
- Context menus with shortcuts; listbox grids with arrow keys and Enter to open.
- Chrome never takes a text selection (`chrome`), arrow cursor everywhere except fields.

## View workspace: C's pipeline

The View areas tab strip became a **pipeline rail** in the toolbar tone under the selection
summary: six numbered stages (Sessions, Frames, Calibration, Prepare, Results, Cleanup), each
with a readiness glyph and word (`✓ 115 lights`, `⚠ 3 unreviewed`, `◌ not checked here`), the
dashed **"in your app"** gap between Prepare and Results where processing happens outside
PlateVault, and exactly **one Next action** (accent button) derived from the selection summary:
Select sessions → Review frames → Prepare View. Readiness is shown only where the summary
proves it; stages owned by other areas say "not checked here" instead of guessing.
The View header is one strip at 1024: the routine actions (Edit details, Refresh selection) show
only their glyphs below 1280 px and keep their names; the save cluster is one row (state, then
Save View, the blocked reason as its description). Complete, recovered, stale and "added since
prepared" messages are full-width **message bars** (`Notice layout="strip"`), not boxes. A
Complete View's one Next action is **Clean up View**.

## Frames review: the loupe (B)

`/views/$viewId/frames` is Lightroom's Library loupe: one pane toolbar (file filter, Session,
Show excluded, Import measurements, the inspector toggle), the frames table filling the pane, and
the **Frame inspector** on the right: the loupe header (name, position, Previous K / Next J), the
display toolbar (Fit/1:1/2:1, stretch, region, Stars), the frame as a **plate on its mount**
(pixels in the dark well, `FILTER · exposure · DATE-OBS` and `W × H · stretch` printed on the
matte), the View-scope Exclude, then panels: **Measurements** (each value with its source:
`built-in`, `imported · content unverified`, `imported for earlier content`), **Histogram** (the
preview's own pixels at the current stretch, labelled display only), Detected stars, Provenance
and copies, Header metadata, and **Trend** (the plot). A **filmstrip** of the shown frames runs
along the bottom with the shown-of and per-session counts above it; it is one tab stop, ←/→ walk
and select, excluded prints fade with a ⃠ glyph. Preview-then-confirm is the existing scoped
confirmation for Mark usable / Mark unusable / Reject for Project (what changes, what does not).
Measured: frames table 14 rows visible at 1280 × 800 and 12 at 1024 × 768 (was about 4).

## Results: the file on its mount (B)

Message bars carry the recorded output location and refusals; the candidate and accepted tables
fill the pane; **Inspect** opens the **Result inspector**: the file as a print on its mount (the
well shows the file type, because PlateVault reads no product pixels and never invents an image),
its kind and size on the matte, then File, Lineage and Identity-and-acceptance panels with each
value's source (`file system`, `hashed now`, `recorded at inspection`, `recorded at acceptance`,
`No input-frame record was read`). Accept Result keeps its preview-then-confirm dialog.

## Plan: D's night timeline

The Target Plan's inputs (Planning site, Criteria, Planned, Reminders) moved into the **Plan
settings** inspector; the pane holds the nights. The chosen night is drawn large on a mount:
noon to noon, sky bands from the Sun's altitude (day, civil, nautical, astronomical twilight,
astronomical dark), a strip while the Moon is up, the Target's altitude curve and its windows
(the selected one in the accent), hour ticks in the site's zone and a legend. Every window row
carries its night's sky in miniature; its Night button draws that night above. The timeline's
label writes out the dark interval and window times. Samples come from `nightProfile` in
`lib/planning.ts`, on the same grid and positions as `computeWindows`; it decides nothing.


## Taken from A–E

- **A (Instrument panel)**: the always-on status bar (lamps for running, interrupted,
  offline, totals) and single-key station keys.
- **B (Calm archive)**: plates on mounts for sessions (Recent, Navigator), values shown with
  their source (Session inspector), faded prints for offline sessions.
- **C (Guided pipeline)**: the stage rail with readiness words, the dashed external-processing
  gap, and the single accent Next action.
- **D (Sky-first)**: Target-scoped IA, the Target finder (made concise, moved into the source
  list), planning reached from each Target and from the Plan area.
- **E (Command workspace)**: the IDE-style inspector that follows the selection and ⌘K for
  everything.

## Screenshots

Under `design/harness-v2-shots/`. `v2-<surface>-1280.png` (1280 × 800) and `-1024.png`
(1024 × 768) for: `recent`, `sessions`, `target` (NGC 7000), `view-frames`, `view-prepare`,
`view-results`, `view-cleanup`, `plans`, `target-plan`. This round: `c-frames-{1280,1024}` (loupe;
`c-frames-before-*` are the earlier layout), `c-results-{1280,1024}` (Result inspector) and
`c-plan-backyard-{1280,1024}` (night timeline). Walk evidence: `walk-j19-s1-locations-1280`,
`walk-j19-s2-picker-1280`. Measured at both widths: document scroll height − viewport = 0 and
scroll width − viewport = 0 (the window never scrolls; panes do).

## Walks (private headless Chrome, observed text)

| Step | Result | Observed |
|---|---|---|
| J19 S1 | pass | "Captures Required … Add capture location · Not set · Add at least one folder with light frames to continue. Calibration Optional … Set up later … Results Optional"; buttons: Add capture location, Set up later, Add calibration location, Set up later, Add results location, Continue |
| J19 S2 | pass | picker "Choose a capture folder … Archive Astro-T7 Cold-1 Scratch Spare" → Choose Captures → "Folder /Volumes/Astro-T7/Captures … Add capture location" → row "/Volumes/Astro-T7/Captures Captures Not checked Not indexed Online" (driver appended the name to the prefilled one) |
| J19 S3 | pass | second row "Cold-1 captures /Volumes/Cold-1/Captures Captures Not checked Not indexed Online"; first row unchanged |
| J19 S4 | not completed | picker lists "Calibration Access denied" under Astro-T7 (the S5 fixture); the driver chose the volume root instead, so Calibration stayed "Not set" |
| J19 S5–S7 | not reached | request budget; setup now ends on Recent (`/`), Sessions is one source-list click away |
| J22 S12–S15a | surface reached | `/views/view_m31/frames`: rail "1 Sessions 115 lights, ready · 2 Frames reviewed, ready · 3 Calibration matches, not checked here · 4 Prepare inputs · in your app · 5 Results products · 6 Cleanup records"; "Import measurements", "Show excluded (5)", Library quality column; steps not driven |
| J24 prepare | surface reached | `/views/view_m31/prepare`: "Prepare and open · M31 LRGB - PixInsight"; steps not driven |
| J27 S10 | surface reached | `/views/view_m31/cleanup`: "Clean up View · M31 LRGB - PixInsight"; step not driven |
| J29 S1 | pass | `/plans`: "Plans · Planned Targets, reminder status and calendar exports … Notifications off … Default site Not set: Set a default site in Settings › Observing sites" |
| J29 S1 | pass (timeline) | `/targets/tgt_y2bxfy/plan`, Backyard chosen: "Night of 6 Oct 2026 · Astronomical dark 21:00–05:50 · 1 window · Backyard, Europe/Amsterdam"; timeline label "6 Oct 2026 at Backyard: astronomical dark 21:00–05:50; window 21:00–04:10 CEST"; "Notifications off" |
| J29 S2–S7a | surface reached | criteria, Planned and reminders in the Plan settings inspector; steps not driven |

## Critique (design-critic + a11y-auditor, 1280 and 1024)

- Fixed and re-measured: the selected Recent plate now paints `selected` with a 2 px accent
  inset edge (`oklch(0.35 0.06 252)` vs unselected `oklch(0.29 0 0)`); the offline thumbnail
  text is no longer faded (`oklch(0.74 0 0)` at opacity 1 on the canvas, 7.9:1).
- Rejected: impeccable `broken-image` at `studio.tsx` (a doc comment containing "<img>").
- Open (major): at 1024 the View workspace header, summary, rail, Complete notice and filters
  leave the frames table about four rows; the Save View / Saved / "cannot be saved" group
  stacks on three lines; the Target page is stacked bordered boxes with no inspector.
- Open (minor): source-list "All Targets" link and breadcrumb links under 24 px high (2.5.8);
  splitters 8 px wide; "Show excluded" switch 18 px high; Sessions cells wrap at 1024; accent
  also used by links; card-in-card on Prepare's Complete notice.

## Known gaps

- **Frames review**: the loupe, filmstrip, histogram and values-with-source panels landed; no
  B-style draft review marks (decisions still go straight to the scoped confirmations).
- **Results**: no product pixels are shown (none are read); the tables keep the web Section heads.
- **Plan**: the Plans overview (`/plans`) keeps its layout; nights with no window are not listed.
- Remaining spot-walks (J22 S12–S15a, J24 prepare, J27 S10, J29 S2–S7a) not driven this round.
- Inline links outside `Button` still use the accent in about 15 call sites (`text-primary` on
  `Link`); the `Button` link variant is neutral.
- The IA is about to be re-architected (Project → Plan → View pipeline, one workflow page), so
  the Target page tabs and other structural work were stopped, not built.
- **Target page** does not yet carry D's Target-scoped tabs (Overview · Sessions · Views ·
  Plan · Results); Plan is reached from the Recent inspector, its context menu and the page.
- The Next action is derived from the selection summary only, so a Complete View still offers
  "Next: Prepare View".
- The Sessions table has no row-following inspector; Recent has one.
- Light theme is defined and contrast-checked by calculation, not walked.
- Journey steps beyond those listed were not driven.
