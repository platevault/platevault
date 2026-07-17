# Feature Specification: Adaptive Detail-Panel Dock

**Feature Branch**: `054-adaptive-detail-dock`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Adaptive detail-panel dock — the list-page detail
panel docks to the side when the window is wide enough and to the bottom when
it is narrow, with a persisted per-page override and a drag-resizable side
panel; Inbox instead gets a permanent detail-dominant right split. Formalizes
'Viewport strategy Phase 1 — adaptive dock' from the design review of
2026-07-11 and absorbs the broken detail-panel scroll containment (#816) and
the Inbox detail overflow (#553)."

## Overview

Every list page (Sessions, Calibration, Archive, Projects, Inbox, Targets)
pairs a primary table with a detail panel. Today the panel's placement is
hardcoded per page: bottom everywhere except Projects, which uses a fixed
side-and-bottom dual layout with no narrow fallback. The design review of
2026-07-11 established the ground truth that PlateVault typically runs in a
1200–1600px window beside a processing tool, and prescribed **Phase 1 —
adaptive dock**: the detail panel docks to the right when the window is wide
(≥ ~1500px logical), to the bottom below that, user-overridable per page,
persisted, with a drag-resizable split
(`docs/development/design-review-2026-07-11.md`, "Viewport strategy").

Two shipped bugs make the current panel actively lossy: the Target detail's
content below the altitude graph is silently clipped and unreachable — aliases,
display label, notes, coverage, links, and the panel's own back button (#816) —
and the Inbox detail pane overflows below the viewport, cutting off the FILES
list (#553). The first is a containment failure: the panel's scroll
containment is a per-consumer convention (an internal structure each detail
is expected to provide) rather than a container guarantee, so any consumer
that deviates clips instead of scrolling. This spec fixes containment at the
**container** level so every consumer scrolls correctly in **every**
placement, closing #816 as part of that foundational work.

The second is a layout-shape failure: the Inbox detail — the per-file
metadata table, inspector, and plan surface — is the **primary workspace** of
the metadata-confirm gate, and a short bottom strip is the wrong shape for it
at any window size. Inbox therefore leaves the adaptive scheme entirely and
adopts a **permanent detail-dominant right split** (email-client pattern:
narrow item list on the left as navigation, full-height detail on the right
as the workspace), which absorbs and closes #553.

The spec thus defines **two side-layout shapes** sharing one mechanism:

- **List-dominant side dock** — the table keeps most of the width; the detail
  is a bounded side panel. Adaptive (bottom fallback when narrow). Used by
  Sessions, Calibration, Archive, Projects, and Targets.
- **Detail-dominant split** — the detail takes the remaining width; the item
  list is a narrow left column. Permanent (no bottom mode at any width).
  Used by Inbox only.

The Targets page gets special treatment: its table is the widest in the app
and was recently tuned to fit a 1100×720 window without horizontal scroll.
When a side dock narrows it below its column floor, the table keeps the user's
orientation anchors pinned (favorite star + designation) and lets the
remaining columns scroll horizontally — never hiding columns, and never
showing a horizontal scrollbar when the full width is available.

## Clarifications

### Session 2026-07-17 (owner decisions)

Decisions approved by the owner on 2026-07-17; recorded here so the spec is
self-contained. These are settled — do not relitigate.

- Q: How does the panel choose its placement? → A: **Adaptive in the shared
  layout**: side dock when the window is wide enough (automatic, from measured
  available width), bottom dock when narrow. A **per-page user override**
  (pin side / pin bottom) persists across restarts. Bottom remains the
  universal narrow fallback.
- Q: Which pages adopt the adaptive side dock? → A: **Sessions, Calibration,
  Archive, Targets.** **Projects unifies onto the same mechanism**, replacing
  its hardcoded side-and-bottom dual layout — and thereby gains the narrow
  fallback it never had.
- Q: What about Inbox? → A: **Inbox is in scope with a distinct, permanent
  detail-dominant right split** (amendment, owner 2026-07-17): narrow item
  list on the LEFT (~360px default), detail panel taking the remaining width
  on the RIGHT, at **every** window width — no bottom mode for Inbox, ever.
  The resizable split and persisted width still apply. Rationale: the Inbox
  bottom dock reads as chaotic — the detail (per-file metadata table +
  inspector + plan surface) is the PRIMARY workspace of the metadata-confirm
  gate, and a ~288px-tall dock at 720 window height is inadequate for it. A
  full-height right pane is the correct shape (email-client pattern: list =
  navigation, detail = workspace). **#553 is absorbed by this variant**, not
  by the bottom-dock scroll fix. **Rejected alternative recorded**: keeping
  the Inbox bottom dock (rejected: detail is the primary confirm workspace;
  bottom-dock height is inadequate and reads as chaotic).
- Q: Does the Inbox item list fit a narrow column? → A: Not today — the name
  column is overly wide. The list gets a **narrowed presentation** that works
  at ~360px: name truncation with a full-name tooltip, essential status
  columns only. Geometry at the 1100×720 minimum: ~900px usable after the
  sidebar → list ~360px + detail ~540px.
- Q: When does Targets engage the side dock? → A: At **≥ 1500px logical window
  width**. When the side panel narrows the table below its column floor:
  **pinned-left identity columns** (favorite star + designation), a
  **permanent importance-based column order** (star, designation, imaging
  time, opposition, type, filters, max alt, lunar dist, sessions), and
  **horizontal scroll of the non-pinned columns only when space is
  insufficient** — no horizontal scrollbar at full width (the existing
  end-to-end pin asserting no cell overflow at 1100×720 must keep passing).
- Q: What about hiding low-priority columns instead? → A: **Rejected**:
  automatic column hiding via a priority ladder. Silent disappearance of data
  is disorienting, and the ladder is a permanent maintenance burden every
  time a column is added or resized.
- Q: Is the side panel resizable? → A: **Yes, drag-resizable**, bounded
  (~320px minimum to ~50% of the window maximum), with the width persisted
  alongside the placement override.
- Q: Prerequisite work? → A: **Migrate the Target detail (TargetDetailV2)** —
  the only remaining hand-rolled detail panel — **to the shared DetailPanel**,
  per the one-shared-component mandate.
- Q: Foundational work? → A: **Fix the broken scroll containment at the
  container level** (the dead fill contract / unbounded content column) so
  every consumer scrolls correctly in both placements. This **absorbs #816
  and #553**; both issues are closed by this work.
- Q: Minimum window? → A: **1100×720 is already enforced by the desktop
  shell's window configuration** (invariant, not new work). The layout must be
  fully workable at exactly that size, which is always bottom-dock mode.
- Q: Keyboard/accessibility? → A: The J16 journey behaviors — arrow-key row
  selection with the detail following, Escape closes the panel — are
  **placement-neutral requirements**: identical in side and bottom dock.
  **No overlay variant** — focus-trap obligations are deliberately avoided.
- Q: How is this validated? → A: (second amendment, owner 2026-07-17)
  Every behavior this spec ships MUST have **(1) UI validation tests that
  run in GitHub CI** (mock-mode Playwright) and **(2) journey-catalog
  coverage** (intent-gated deltas with stable step ids in `docs/journeys/`,
  the canonical catalog). Encoded as FR-016/FR-017, SC-009/SC-010, and the
  "Testing & Journey Coverage" section.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detail content is always reachable (Priority: P1)

As a user opening any item's detail panel, I want every section of the detail
to be reachable — scrolled within the panel when it doesn't fit — so that no
functionality is silently hidden from me.

**Why this priority**: This is the foundational fix. Today the Target detail
silently clips alias editing, display label, notes, coverage, links, and its
own back button (#816). That is a shipped loss of core functionality; every
other story builds on a panel that contains its content correctly.

**Independent Test**: At 1100×720, open a Target with long content (aliases,
notes, links). Verify every section — including the last one — can be reached
by scrolling within the panel, in every placement the page offers, and that
the panel never extends past the window edge.

**Acceptance Scenarios**:

1. **Given** a Target detail whose content exceeds the panel height, **When**
   the panel is open in either placement, **Then** the content scrolls within
   the panel and the alias list, display label, notes, coverage, links, and
   back button are all reachable and usable (#816).
2. **Given** any detail consumer, **When** its content structure varies (no
   special internal scroll structure provided), **Then** the container still
   scrolls the content — containment never depends on per-consumer markup.
3. **Given** any placement (bottom dock, side dock, or the Inbox split),
   **When** detail content exceeds the panel, **Then** the panel stays fully
   within the window and scrolls internally — it never extends off-screen.

---

### User Story 2 - Detail docks to the side on a wide window (Priority: P1)

As a user running PlateVault on a wide window, I want the detail panel to dock
to the right of the table instead of eating its height, so I can see many rows
and the full detail at the same time.

**Why this priority**: This is the core value of the feature — the design
review's Phase 1 prescription. It makes the list+detail pattern work at every
size the app actually runs at.

**Independent Test**: On Sessions, Calibration, Archive, Targets, and
Projects, resize the window across the wide/narrow threshold with a detail
open. Verify the panel docks side when wide, bottom when narrow, with no
content loss in either mode.

**Acceptance Scenarios**:

1. **Given** a window at or above the wide threshold with no override set,
   **When** a detail opens on Sessions, Calibration, Archive, or Targets
   (Targets threshold: 1500px logical width), **Then** it docks as a
   full-height side panel beside the table.
2. **Given** a window below the threshold, **When** a detail opens, **Then**
   it docks to the bottom — the universal narrow fallback.
3. **Given** an open side-docked detail, **When** the window is resized below
   the threshold, **Then** the panel re-docks to the bottom without losing
   the selection or the panel's scroll usability (and vice versa when
   resized back up).
4. **Given** the Projects page, **When** a project is selected, **Then** its
   detail uses the same adaptive mechanism as the other pages (the hardcoded
   side-and-bottom dual layout is replaced) and Projects becomes fully usable
   at 1100×720 in bottom mode.

---

### User Story 3 - Inbox becomes a detail-dominant confirm workspace (Priority: P1)

As a user working the metadata-confirm gate in the Inbox, I want the item
list as a narrow left column and the detail — the per-file metadata table,
inspector, and plan surface — filling the rest of the window at full height,
so my primary workspace is never squeezed into a short bottom strip.

**Why this priority**: The Inbox detail is the primary workspace of the
metadata-confirm gate, and the current bottom dock (~288px tall at 720 window
height) is inadequate for it and reads as chaotic (owner decision,
2026-07-17). This variant is also what absorbs #553 — the detail pane
overflowing the FILES list off-screen.

**Independent Test**: At 1100×720 and at a wide window, open Inbox items with
long file lists. Verify the layout is always list-left / detail-right (never
a bottom dock), the full confirm workflow — review, reclassify, resolve
mandatory fields, plan — is operable, and the file list scrolls within the
full-height detail pane.

**Acceptance Scenarios**:

1. **Given** the Inbox page at any window width, **When** an item is
   selected, **Then** the detail renders as a permanent full-height RIGHT
   pane taking the remaining width, with the item list as a narrow LEFT
   column (~360px default) — never a bottom dock.
2. **Given** an Inbox item with a file list taller than the window, **When**
   its detail opens, **Then** the pane stays fully within the window and the
   file list scrolls within it (#553).
3. **Given** the narrow item list, **When** an item name exceeds the column
   width, **Then** the name truncates with a full-name tooltip, and only the
   essential status columns are shown — the list stays usable at ~360px.
4. **Given** the split between list and detail, **When** the user drags it,
   **Then** the split resizes within bounds that keep both list and detail
   usable, and the chosen width persists across restarts.

---

### User Story 4 - Pin and resize the panel per page (Priority: P2)

As a user with a preferred layout for a specific page, I want to pin the
detail to the side or bottom on that page and drag the side split to the
width I like, and have both choices remembered.

**Why this priority**: The automatic behavior is a heuristic; per-page
override and resize make it trustworthy. Depends on US2's mechanism existing.

**Independent Test**: Pin Sessions to bottom on a wide window and Targets to
side; drag the Targets side split wider; restart the app; verify both pins
and the width are restored exactly.

**Acceptance Scenarios**:

1. **Given** a wide window, **When** the user pins a page to bottom, **Then**
   that page keeps the bottom dock at every width until the pin is changed,
   while other pages remain adaptive.
2. **Given** a side-docked panel, **When** the user drags its split, **Then**
   the width tracks the drag within bounds (~320px minimum to ~50% of the
   window maximum) and is persisted with the page's placement preference.
3. **Given** persisted pins and a persisted width, **When** the app restarts,
   **Then** each page restores its pinned placement and side width.
4. **Given** a pinned side placement on a window too narrow for the bounded
   minimum width to leave the table usable, **When** the window shrinks to
   the minimum window size, **Then** the panel falls back to bottom rather
   than rendering an unusable squeeze.

---

### User Story 5 - Targets table stays readable beside the side dock (Priority: P2)

As a user browsing the Targets planner with the detail open on a wide window,
I want the table to keep my orientation anchors visible when the side panel
narrows it, so I always know which row I'm on.

**Why this priority**: Targets is the widest table and was recently tuned to
fit 1100×720 exactly; without this story the side dock would clip or squeeze
its columns. Depends on US2.

**Independent Test**: At 1500px window width, open a target's detail (side
dock engages). Verify the favorite star + designation columns stay pinned
left while the remaining columns scroll horizontally; close the detail or
widen the window and verify the horizontal scrollbar disappears entirely.

**Acceptance Scenarios**:

1. **Given** the Targets table at full width (no side panel), **When**
   rendered at any supported window size, **Then** there is no horizontal
   scrollbar and no cell content overflows (the existing end-to-end pin at
   1100×720 keeps passing).
2. **Given** a side-docked detail narrowing the table below its column floor,
   **When** the user scrolls the table horizontally, **Then** the favorite
   star and designation columns stay pinned on the left and only the
   remaining columns scroll.
3. **Given** any window width, **When** the Targets table renders, **Then**
   its columns appear in the permanent importance order — star, designation,
   imaging time, opposition, type, filters, max alt, lunar dist, sessions —
   regardless of placement (the reorder is not conditional on the dock).
4. **Given** the rejected alternative, **Then** no column is ever
   automatically hidden as space narrows — columns scroll, they don't vanish.

---

### User Story 6 - Keyboard flow is identical in every placement (Priority: P3)

As a keyboard-first user, I want row navigation with the detail following and
Escape-to-close to behave identically whether the panel is docked side or
bottom (or is the Inbox split), so the layout shape is purely visual.

**Why this priority**: These behaviors already exist (J16 journey, S3/S4);
this story pins them as placement-neutral so the new side dock and the Inbox
split don't regress them. Depends on US2/US3.

**Independent Test**: In every placement, move the row focus with the arrow
keys and confirm the open detail follows the selection; press Escape and
confirm the panel closes without mutating the record.

**Acceptance Scenarios**:

1. **Given** an open detail in any placement, **When** the user moves the
   selected row with the arrow keys, **Then** the detail updates to follow
   the selection identically in every layout shape.
2. **Given** an open detail in any placement, **When** the user presses
   Escape (with no overlay open), **Then** the panel closes and focus
   returns to the list, exactly as the bottom dock behaves today.
3. **Given** the side dock or the Inbox split, **Then** it imposes no focus
   trap and no overlay semantics — it is an inline complementary region,
   same as the bottom dock.

### Edge Cases

- **Window exactly at the threshold**: placement must be deterministic (a
  defined side of the boundary), with no flicker or oscillation while
  resizing across it.
- **Persisted side width larger than the current window allows**: clamp to
  the ~50%-of-window bound on restore; never restore an unusable layout.
- **Minimum window (1100×720)**: always bottom-dock mode; every page,
  including Projects after unification, must be fully workable there.
- **Escape while a dialog/select/menu overlay is open**: the overlay's own
  dismissal wins; the panel stays open (existing behavior, #771/#906 — must
  hold in both placements).
- **Detail open during placement flip**: selection, scroll usability, and
  unsaved in-panel edit state (e.g. a notes draft) must survive the re-dock.
- **Targets side dock + horizontal scroll + row selection**: pinned columns
  must remain aligned with their rows while the non-pinned region scrolls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The shared list-page layout MUST choose the detail placement
  adaptively: a full-height side dock when the measured window width is at or
  above the page's wide threshold, and a bottom dock below it. Bottom is the
  universal narrow fallback for every page.
- **FR-002**: The Targets page's side dock MUST engage at ≥ 1500px logical
  window width. Other adopting pages MUST use a threshold consistent with the
  design-review prescription (~1500px logical; exact per-page value is a plan
  decision, not a spec commitment).
- **FR-003**: The user MUST be able to override the placement per page (pin
  side / pin bottom); the override MUST persist across app restarts and MUST
  take precedence over the adaptive choice, except that a pinned side
  placement MUST still fall back to bottom when the window cannot fit the
  bounded minimum side width alongside a usable table.
- **FR-004**: Sessions, Calibration, Archive, and Targets MUST adopt the
  adaptive **list-dominant side dock**. Projects MUST be unified onto the
  same mechanism, replacing its hardcoded side-and-bottom dual layout and
  gaining the narrow (bottom) fallback. Inbox MUST use the **detail-dominant
  split** (FR-014) instead of the adaptive scheme.
- **FR-005**: The side panel MUST be drag-resizable, bounded between ~320px
  minimum and ~50% of the window width maximum; the chosen width MUST be
  persisted together with the page's placement preference and restored on
  restart (clamped to the bounds of the current window).
- **FR-006**: The Targets table MUST keep the favorite star and designation
  columns pinned on the left, and MUST use a permanent importance-based
  column order — star, designation, imaging time, opposition, type, filters,
  max alt, lunar dist, sessions — independent of placement.
- **FR-007**: When available width is insufficient for the Targets table's
  column floor (e.g. beside a side dock), the non-pinned columns MUST scroll
  horizontally. At full width there MUST be no horizontal scrollbar and no
  clipped cell content — the existing end-to-end pin asserting no cell
  overflow at 1100×720 MUST keep passing unchanged.
- **FR-008**: The system MUST NOT hide columns automatically as space
  narrows. (Rejected alternative, recorded: automatic column hiding via a
  priority ladder — rejected for silent data disappearance and the
  per-column ladder maintenance burden.)
- **FR-009**: Scroll containment MUST be guaranteed by the detail panel
  container in EVERY placement (bottom dock, side dock, Inbox split): when
  detail content exceeds the panel, the content scrolls within the panel;
  the panel never extends past the window and never clips content
  unreachably, regardless of the consumer's internal markup. This
  foundational fix absorbs **#816** (Target detail clipping), which MUST be
  closed by this work. (**#553**, the Inbox detail overflow, is absorbed by
  the detail-dominant split of FR-014 rather than by this fix, and MUST be
  closed by that work.)
- **FR-010**: As a prerequisite, the Target detail (TargetDetailV2) — the
  only remaining hand-rolled detail panel — MUST be migrated to the shared
  DetailPanel component, per the one-shared-component mandate.
- **FR-011**: The layout MUST be fully workable at exactly the enforced
  minimum window size of 1100×720 on every list page — bottom-dock mode for
  the adaptive pages (including Projects after unification), the
  detail-dominant split for Inbox. (The minimum itself is an existing shell
  invariant, not new work.)
- **FR-012**: Keyboard behaviors MUST be placement-neutral: arrow-key row
  selection with the detail following, and Escape closing the panel (with
  overlay dismissal taking precedence while an overlay is open), identical
  in side dock, bottom dock, and the Inbox split (J16 S3/S4).
- **FR-013**: There MUST be no overlay/modal variant of the detail panel; the
  side dock and the Inbox split are inline complementary regions with no
  focus trap (deliberately avoided obligation).
- **FR-014**: Inbox MUST use a **permanent detail-dominant right split**:
  the item list as a narrow LEFT column (~360px default) and the detail
  panel taking the remaining width on the RIGHT, at every window width —
  no bottom mode for Inbox, and no adaptive flip. The split MUST be
  drag-resizable within bounds that keep both list and detail usable, and
  the chosen width MUST be persisted and restored like the other pages'
  placement preferences. This variant absorbs **#553**.
- **FR-015**: The Inbox item list MUST get a narrowed presentation that
  works at ~360px: the name column truncates with a full-name tooltip, and
  only the essential status columns are shown (the current overly-wide name
  column layout is replaced).
- **FR-016**: Every behavior this spec ships MUST be covered by UI
  validation tests that run in the GitHub CI job (mock-mode Playwright
  end-to-end assertions). At minimum the assertion set in "Testing &
  Journey Coverage" below MUST exist and pass in CI. Existing end-to-end
  pins that assert the current detail dock MUST be kept passing or migrated
  deliberately as part of the implementation — never silently broken or
  deleted (the affected pins are enumerated below).
- **FR-017**: Every behavior this spec ships MUST be reflected in the
  canonical journey catalog (`docs/journeys/`) via journey deltas for each
  affected journey, following the catalog's intent-gated delta format with
  stable step ids (the affected journey set is enumerated in "Testing &
  Journey Coverage" below).

### Testing & Journey Coverage

**CI-run UI validation (FR-016).** The GitHub CI end-to-end job (mock-mode
Playwright) MUST assert at least:

- Side dock engages at the page's threshold and disengages below it
  (viewport resize across the boundary; Targets at 1500px logical width).
- A per-page placement override (pin side / pin bottom) persists across an
  app restart (persisted-state reload in the test harness).
- Dragging the resize handle changes the side panel/split width, and the
  width persists across restart.
- Inbox renders the permanent detail-dominant layout at every tested width:
  item list ~360px on the left, full-height detail on the right, never a
  bottom dock.
- Targets beside a side dock: the pinned identity columns (star +
  designation) stay visible while the non-pinned columns scroll
  horizontally — and horizontal scroll appears ONLY when space is
  insufficient. The existing full-width unclipped pin
  (`tests/e2e/targets_planner.spec.ts:531` and `:536`, asserting
  `scrollWidth <= clientWidth` at 1100×720) MUST keep passing.

**Existing pins on the current dock (FR-016).** These assertions target
`.alm-listpage__detail` and will be affected by the new placement logic;
each MUST be kept passing or migrated deliberately (never silently
deleted):

- `tests/e2e/calibration_masters_matching.spec.ts:157` (master detail pane
  mounts on selection).
- `tests/e2e/inbox_ingest_confirm.spec.ts:69` (no detail dock before
  selection), `:135` and `:183` (detail mounts with expected content) —
  these move to the detail-dominant split semantics (FR-014).

**Journey-catalog deltas (FR-017).** `docs/journeys/` is the canonical
catalog; the implementation MUST ship intent-gated deltas with stable step
ids for the affected journeys:

- `J16-keyboard-first-navigation` — placement-neutral arrow-follow and
  Escape-close (S3/S4) across side dock, bottom dock, and the Inbox split.
- `J02-ingest-review-reclassify-confirm-move` and
  `J03-ingest-confirm-catalogue-in-place` — the Inbox permanent
  detail-dominant split (FR-014/FR-015).
- `J09-targets-planning` — Targets side dock, pinned columns, column
  order, conditional horizontal scroll.
- `J04-sessions-review-derived` and
  `J08-calibration-ingest-masters-matching` — the adaptive dock on
  Sessions and Calibration.
- `J05-project-lifecycle` and `J07-archive-delete` — Projects unification
  and the Archive dock change (same adaptive mechanism).

### Key Entities *(include if feature involves data)*

- **Detail placement preference**: per page — mode (adaptive | pinned side |
  pinned bottom; fixed for Inbox) and side-panel/split width; user-owned UI
  state persisted across restarts; no relationship to library data.
- **Side-layout shape**: the two named shapes sharing the mechanism —
  **list-dominant side dock** (adaptive, bounded side panel, bottom
  fallback) and **detail-dominant split** (permanent, narrow list left,
  full-height detail right; Inbox only).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With no override set, resizing the window across the wide
  threshold flips the open detail between side and bottom dock in 100% of
  crossings, deterministically, with the selection preserved; Targets
  engages side at exactly ≥ 1500px logical width.
- **SC-002**: A per-page placement pin and a dragged side width survive an
  app restart and are restored exactly (width clamped only if the window
  shrank), for every adopting page.
- **SC-003**: At 1100×720, every section of the Target detail (aliases,
  display label, notes, coverage, links, back button) is reachable and
  operable by scrolling within the panel — the #816 reproduction passes —
  in bottom dock; the same content is reachable in side dock on a wide
  window. The Inbox detail's full file list is reachable within its
  full-height right pane — the #553 reproduction passes.
- **SC-004**: The Targets table shows no horizontal scrollbar and no clipped
  cells at full width (the existing 1100×720 end-to-end pin passes
  unchanged); beside a side dock at 1500px, the star + designation columns
  remain visible while the remaining columns scroll horizontally.
- **SC-005**: Arrow-key selection-follow and Escape-to-close behave
  identically in every placement on every adopting page (J16 S3/S4 pass in
  side dock and the Inbox split exactly as in bottom dock).
- **SC-006**: The Projects page is fully usable at 1100×720 (bottom mode) —
  a size at which its previous hardcoded dual layout had no fallback.
- **SC-007**: No detail panel consumer requires placement- or
  containment-specific internal markup to scroll correctly: a plain block of
  overflowing content placed in any list page's detail scrolls within the
  panel in every placement.
- **SC-008**: At the 1100×720 minimum window (~900px usable after the
  sidebar), Inbox renders list ~360px + detail ~540px and the full
  metadata-confirm workflow — review, reclassify, resolve mandatory fields,
  plan — is fully usable, with item names truncated to a tooltip rather
  than clipped silently.
- **SC-009**: Every FR of this spec traces to at least one mock-mode
  Playwright assertion that runs (and passes) in the GitHub CI job, covering
  at minimum the assertion set in "Testing & Journey Coverage"; the
  pre-existing pins enumerated there (targets full-width unclipped;
  `.alm-listpage__detail` in the calibration and inbox specs) pass or are
  migrated with an explicit rationale in the change that migrates them.
- **SC-010**: Journey deltas exist in `docs/journeys/` for every affected
  journey listed in "Testing & Journey Coverage" (J02, J03, J04, J05, J07,
  J08, J09, J16), each following the intent-gated delta format with stable
  step ids, before the feature is declared complete.

## Out of Scope

- **Inbox bottom dock** — rejected alternative (owner, 2026-07-17): the
  detail is the primary confirm workspace; bottom-dock height is inadequate
  and reads as chaotic. Inbox is IN scope via the permanent detail-dominant
  split (FR-014); only the bottom-dock shape is rejected for it.
- **Automatic column hiding** (priority-ladder responsive hiding) — rejected
  alternative, recorded in FR-008.
- **Overlay/modal detail variant** — no focus-trap obligations; deliberately
  avoided (FR-013).
- **Pop-out windows** for monitoring surfaces — design-review Phase 2, a
  separate effort.
- **Density/vertical-economy work** — design-review Phase 0, already
  issue-tracked separately.

## Assumptions

- The 1100×720 minimum window is enforced by the desktop shell's window
  configuration and remains in force; this spec treats it as an invariant.
- The existing Escape-close semantics (document-level, overlay-aware,
  #771/#906) are the baseline the side dock inherits; no new keyboard
  surface is introduced.
- The importance-based Targets column order is permanent (applies at all
  widths), so users see one stable order rather than a placement-dependent
  one; the recent 1100×720 column-fit tuning (FR-032/SC-016 of the targets
  planner iteration) remains the full-width baseline.
- Persisted placement/width is local UI preference state, not part of the
  library's durable relationship/audit record.
- Lineage: this spec formalizes "Viewport strategy Phase 1 — adaptive dock"
  from `docs/development/design-review-2026-07-11.md` (epic #632).
