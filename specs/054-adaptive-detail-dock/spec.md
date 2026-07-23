# Feature Specification: Adaptive Detail-Panel Dock

**Feature Branch**: `054-adaptive-detail-dock` (implemented directly on `main`
via #1003, #1035, #1060, #1070, #1072 — see [Reconciliation note](#reconciliation-note))

**Created**: 2026-07-17 (original design, `feat/adaptive-detail-dock`)

**Reconciled**: 2026-07-19 (issue #1069)

**Status**: Delivered (partial — the adaptive placement mechanism, drag-resize,
3-state placement control, and full `DetailPanel` adoption are all shipped;
still missing: Targets pinned columns/conditional h-scroll (T024/T025, no
tracked issue) and typed `AppPreferences` persistence (no tracked issue). See
[Reconciliation note](#reconciliation-note))

**Input**: User description: "Adaptive detail-panel dock — the list-page detail
panel docks to the side when the window is wide enough and to the bottom when
it is narrow, with a persisted per-page override and a drag-resizable side
panel. Formalizes 'Viewport strategy Phase 1 — adaptive dock' from the design
review of 2026-07-11 and absorbs the broken detail-panel scroll containment
(#816)."

## Reconciliation note

This spec record is written **after** the feature shipped, to close a
SpecKit-workflow gap (issue #1069): PR #1007 (branch `feat/adaptive-detail-dock`,
the original design for this spec) was **closed as superseded** by PR #1003,
which shipped a **simpler architecture** directly to `main`. No spec artifact
existed for #1003 at merge time. This document describes what **actually
shipped**, verified against `main` source, not the original branch design.

Two designs exist in this repo's history. Where they differ, **main's shipped
code is authoritative**:

| | Branch design (`feat/adaptive-detail-dock`, NOT shipped) | Shipped (`main`, via #1003) |
|---|---|---|
| Width signal | Two measurements: window width (threshold) + `ResizeObserver` page-available width (fallback/clamp) | One measurement: `window.innerWidth` only |
| Placements | Three: `'side' \| 'bottom' \| 'split'` | Two: `'side' \| 'bottom'` |
| Inbox | Permanent detail-dominant `'split'` shape, no bottom mode ever | Same adaptive side/bottom mechanism as every other page |
| Placement override UI | Auto/Bottom/Right 3-state Settings control (T021) | Same: a 3-state `DetailDockPlacementControl` (Auto/Bottom/Right) — shipped via **PR #1070**, closing #1066 |
| Persistence | `AppPreferences.detailDock` (typed field in the existing `preferences.ts` / IPC-synced store) | Raw `localStorage` keys under an `alm-dock-*` prefix, scoped by `dockId` — no `AppPreferences` integration |
| Page-level force | `forcedPlacement?: 'bottom' \| 'side' \| 'split'` prop, precedence over the user pin | No forced-placement prop; every adopting page uses the same adaptive default |
| `DetailPanel` adoption | All six pages migrate (Target, Archive included) | Six of six — Sessions, Calibration, Inbox, Archive, Projects, Targets all route through `DetailPanel`, shipped via **PR #1072**, closing #1067 |

The branch's `useDetailDock` hook, `'split'` placement, and
`preferences.detailDock` integration were **never built**. Where this document
describes them below, they are marked **superseded** or **deferred**, not
delivered — see `tasks.md` for the per-task disposition and `data-model.md`
for the persistence-shape gap.

## Overview

Every list page (Sessions, Calibration, Archive, Projects, Inbox, Targets)
pairs a primary table with a detail panel. Before this feature the panel's
placement was hardcoded per page: a bottom dock everywhere except Projects,
which used a fixed side-and-bottom dual layout with no narrow fallback. The
design review of 2026-07-11 established that PlateVault typically runs in a
1200–1600px window beside a processing tool, and prescribed an adaptive dock:
the detail panel docks to the side when the window is wide, to the bottom
below that, user-overridable, persisted, with a drag-resizable split
(`docs/development/design-review-2026-07-11.md`, "Viewport strategy").

**What shipped** (`apps/desktop/src/ui/useAdaptiveDock.ts`, PR #1003): a hook
that resolves placement from a single **window-width** measurement against a
per-page `threshold` (default 1400px), with an explicit per-page override
(`override: 'side' | 'bottom' | null`) and a drag-resizable, persisted side
width. `ListPageLayout` (`apps/desktop/src/components/ListPageLayout.tsx`)
wires this into a `detailPlacement` prop (default `'adaptive'`), so pages opt
in by doing nothing — the shared layout handles placement.

Two follow-up PRs closed related bugs against this same mechanism:

- **#1035** fixed the Target detail's silent content clipping below the
  altitude graph (closes #816) — a scroll-containment bug in the shared detail
  container, not a placement bug, but reported against the same feature area.
- **#1060** shipped SegControl accessibility fixes (Refs #1010) used elsewhere
  in the chrome; relevant here because the later 3-state placement control
  (#1066, PR #1070) reuses `SegControl` — confirmed via
  `DetailDockPlacementControl.tsx`.

**What did not ship**: the branch's page-width `ResizeObserver` architecture,
the third `'split'` placement, and the permanent narrow Inbox split it implied.
Inbox instead adopted the **same** adaptive side/bottom mechanism as every
other page — its list simply gained a Format column instead. That direction is
now **settled, not open**: #1068 was decided in favor of keeping the adaptive
dock and the Format column (see [Deferred / superseded](#deferred--superseded-not-on-main)
below for the rationale). Also unshipped: `AppPreferences.detailDock`
integration — the 3-state Auto/Bottom/Right placement control shipped via
PR #1070, closing #1066.

## Clarifications

### Session 2026-07-17 (owner decisions, original design)

Recorded for history — these decisions were **approved for the branch design**
that was later superseded. Kept here so the reconciliation table above is
legible against the original ask; do not treat as binding on the shipped
mechanism except where the shipped code independently matches them.

- Q: How does the panel choose its placement? → A (original): adaptive in the
  shared layout, side when wide (from measured *page-available* width), bottom
  when narrow, per-page pin. → **Shipped differently**: side/bottom from
  *window* width only (`window.innerWidth`), no separate page-available-width
  measurement (`useAdaptiveDock.ts:80`).
- Q: What about Inbox? → A (original): permanent detail-dominant right split,
  no bottom mode ever. → **Not shipped, and now withdrawn**: Inbox uses the
  same adaptive mechanism as other pages. #1068 decided against building the
  permanent split — see [Deferred / superseded](#deferred--superseded-not-on-main)
  for the rationale.
- Q: Is the side panel resizable? → A: yes, drag-resizable, bounded (~320px
  min to ~50% of window max), width persisted. → **Shipped as designed**
  (`useAdaptiveDock.ts` `clampWidth`, `ResizeHandle.tsx`).
- Q: Prerequisite work — migrate all hand-rolled detail panels to the shared
  `DetailPanel`? → A: yes, all six. → **Shipped**: all six pages (Sessions,
  Calibration, Inbox, Archive, Projects, Targets) now route through
  `DetailPanel`, via PR #1072, closing #1067.
- Q: Placement override surface? → A: an Auto/Bottom/Right Settings control
  plus an in-page toggle. → **Shipped**, via PR #1070 closing #1066:
  `ListPageLayout.tsx` renders a `DetailDockPlacementControl` (Auto/Bottom/
  Right); the old two-state `alm-listpage__detail-pin` button that could not
  return to `'adaptive'` no longer exists in the codebase.

### Session 2026-07-19 (reconciliation, issue #1069)

- Q: Should this document describe the branch's page-width/`'split'`
  architecture as delivered? → A: **No.** Every architectural claim below is
  checked against `main` source. Undelivered branch design is marked
  superseded/deferred, not silently dropped from the record.
- Q: Inbox permanent split vs the Format column `main` shipped instead? → A
  (as recorded at #1069's original reconciliation pass): genuinely undecided,
  tracked as #1068, this document takes no side. **Superseded within hours**:
  the owner decided #1068 — keep the adaptive dock and the Format column,
  withdraw the permanent-split design. #553, the bug the permanent split was
  meant to solve, was already fixed a different way by PR #939 (giving
  `InboxDetail`'s body its own scroll region), so the split's driving need no
  longer exists. See [Deferred / superseded](#deferred--superseded-not-on-main)
  below.

## User Scenarios & Testing *(mandatory)*

Scenarios below describe **what the shipped mechanism does**, adapted from the
original branch design's User Stories 1, 2, 4, and 6 (US1/US2/US4/US6 in the
branch numbering). US3 (Inbox detail-dominant split) and US5 (Targets pinned
columns / conditional horizontal scroll) were **not built** — see
[Deferred / superseded](#deferred--superseded-not-on-main) below.

### User Story 1 - Detail docks to the side on a wide window (Priority: P1)

As a user running PlateVault on a wide window, I want the detail panel to dock
to the side of the table instead of eating its height, so I can see many rows
and the full detail at the same time.

**Independent Test**: On Sessions, Calibration, Inbox, Archive, Targets, and
Projects, resize the window across 1400px logical width with a detail open.
Verify the panel docks side when at/above the threshold, bottom below it.

**Acceptance Scenarios**:

1. **Given** a window at or above 1400px logical width with no override set,
   **When** a detail opens on any of the six list pages, **Then** it docks as
   a full-height side panel beside the table (`useAdaptiveDock.ts:127-132`).
2. **Given** a window below 1400px, **When** a detail opens, **Then** it docks
   to the bottom.
3. **Given** an open side-docked detail, **When** the window is resized below
   the threshold, **Then** the panel re-docks to the bottom without losing the
   selection (and vice versa when resized back up).

**Status**: Delivered — #1003.

---

### User Story 2 - Pin and resize the panel per page (Priority: P2)

As a user with a preferred layout for a specific page, I want to pin the
detail to the side or bottom on that page and drag the side split to the
width I like, and have both choices remembered.

**Acceptance Scenarios**:

1. **Given** any window width, **When** the user picks a placement in the
   `DetailDockPlacementControl` (Auto/Bottom/Right) in the detail panel's
   header, **Then** the page's placement is set accordingly and that pin
   persists across restarts, scoped by the page's `dockId`
   (`localStorage['alm-dock-placement-<dockId>']`).
2. **Given** a side-docked panel, **When** the user drags its resize handle,
   **Then** the width tracks the drag within bounds (320px minimum, 50% of
   window maximum) and persists (`localStorage['alm-dock-width-<dockId>']`).
3. **Given** a pinned placement, **When** the user wants to return to
   automatic width-based placement, **Then** selecting "Auto" in the control
   clears the pin (`setOverride(null)`) and the panel resumes following the
   width heuristic. **Fixed by PR #1070, closing #1066.**

**Status**: Delivered — #1003 shipped pin + resize; the "return to Auto" gap
is closed by PR #1070 (#1066).

---

### User Story 3 - Keyboard flow is identical in every placement (Priority: P3)

As a keyboard-first user, I want row navigation and Escape-to-close to behave
identically whether the panel is docked side or bottom, so the layout shape
is purely visual.

**Status**: Delivered as a general `ListPageLayout` behavior — the Escape
handler and overlay-awareness in `ListPageLayout.tsx` are placement-neutral by
construction (one `document`-level listener regardless of `detailPlacement`).
Not a dedicated deliverable of this feature; pre-existing from spec 043 (#771,
#906) and unaffected by the dock mechanism.

## Requirements *(mandatory)*

FR numbering is preserved from the original branch design (not renumbered)
because `docs/journeys/` already contains committed deltas (PR #966,
`8f464e87`) that cite these exact FR numbers against journeys J02, J03, J04,
J05, J07, J08, J09, and J16. Renumbering here would break that
cross-reference. **Each FR below is marked with its real delivery status —
several of the journey deltas currently cite an FR as if delivered when it is
not; see [Known drift](#known-drift-journey-deltas-overstate-delivery)
below.**

- **FR-001** (**DELIVERED**, #1003): The shared list-page layout MUST choose
  the detail placement adaptively: a full-height side dock when
  `window.innerWidth` is at or above the page's threshold, and a bottom dock
  below it. `useAdaptiveDock.ts:127-132`.
- **FR-002** (**NOT DELIVERED** — superseded, no tracked issue): Targets was
  to engage the side dock at ≥1500px logical width, distinct from other
  pages' threshold. Shipped: every adopting page uses the same 1400px
  default; no page passes a non-default `adaptiveThreshold`.
- **FR-003** (**DELIVERED, narrower than designed** — #1003): The user MUST
  be able to override placement per page, persisted, taking precedence over
  the adaptive choice, with a pin→bottom fallback when the window can't fit
  a usable side layout. Shipped: `setOverride` persists the pin
  (`useAdaptiveDock.ts` `setOverride`); the fallback is a single
  `windowWidth >= minWidth * 2` check (`useAdaptiveDock.ts:126`), not the
  originally designed two-term page-available-width-minus-table-floor
  calculation.
- **FR-004** (**PARTIALLY DELIVERED**): Sessions, Calibration, Archive, and
  Targets MUST adopt the adaptive side dock (**delivered**, #1003 — all four
  default to `detailPlacement='adaptive'`); Projects MUST unify onto the same
  mechanism (**delivered** — no `detailPlacement` passed, defaults to
  adaptive, though its own module docstring is stale and still claims
  `'side-and-bottom'`, tracked as **#1108**, open PR — see plan.md); Inbox
  MUST use the detail-dominant split instead (**WITHDRAWN**, #1068 — the
  owner decided to keep the adaptive dock and the Format column; see
  [Deferred / superseded](#deferred--superseded-not-on-main)).
- **FR-005** (**DELIVERED**, #1003): The side panel MUST be drag-resizable,
  bounded 320px min to 50% window max, width persisted and restored.
  `useAdaptiveDock.ts` `clampWidth`/`setWidth`, `ResizeHandle.tsx`.
- **FR-006** (**DELIVERED in part**, #1158): Targets table MUST keep the
  favorite-star + designation columns pinned left with a permanent importance
  column order. The **pinning** is built — sticky-left columns in
  `merges-2.css`. The **column reordering** is not, and is treated as a
  deliberate outcome rather than a gap: the shipped order already leads with
  identity, and reordering the rest is a separate design question with no
  reported complaint behind it.
- **FR-007** (**DELIVERED**, pre-existing): non-pinned Targets columns MUST
  scroll horizontally only when space is insufficient.
  `.pv-targets-table__scroll` carries `overflow-x: auto` against the table's
  1000px `min-width` floor, so scrolling engages only when space genuinely
  falls short. FR-006's pinning is what makes that scrolling non-lossy: before
  it, the 20%-wide designation column was itself what scrolled out of view.
- **FR-008** (**NOT DELIVERED** — superseded, moot): no automatic column
  hiding. Trivially true only because no column-priority work was built at
  all, not because this constraint was actively honored.
- **FR-009** (**DELIVERED**, #1035 + PR #1072): scroll containment MUST be
  guaranteed by the detail panel container in EVERY placement, absorbing
  #816. All six pages now route through `DetailPanel` (PR #1072, closing
  #1067), so the direct-child scroll-containment contract applies uniformly;
  pinned by `DetailPanel.test.tsx:327-346`.
- **FR-010** (**DELIVERED**, #1067 / PR #1072): migrate `TargetDetailV2` to
  the shared `DetailPanel`. Confirmed: `TargetDetailV2.tsx:941` renders
  `<DetailPanel fill ...>`.
- **FR-011** (**not independently verified** in this reconciliation): the
  layout MUST be fully workable at exactly 1100×720 on every page. Plausible
  given the e2e test asserts bottom-fallback content integrity at 1100×720
  for Calibration (`tests/e2e/adaptive_detail_dock.spec.ts:52-56`), but not
  checked page-by-page here.
- **FR-012** (**DELIVERED**, pre-existing — spec 043, #771/#906, not new work
  for this feature): keyboard behaviors MUST be placement-neutral.
  `ListPageLayout.tsx`'s Escape handler is one listener regardless of
  `detailPlacement`.
- **FR-013** (**DELIVERED**, pre-existing, same as FR-012): no
  overlay/focus-trap variant. True by construction — the side/bottom dock is
  always an inline complementary region.
- **FR-014** (**WITHDRAWN**, #1068): Inbox MUST use a permanent
  detail-dominant right split, absorbing #553. #553 (the FILES-list
  reachability bug this FR existed to solve) was already fixed a different
  way by PR #939, which gave `InboxDetail`'s body its own scroll region — the
  driver for the permanent split is spent, so the owner withdrew this
  requirement rather than leaving it open.
- **FR-015** (**WITHDRAWN**, #1068): the Inbox item list MUST get a narrowed
  presentation (name truncation, essential columns only, Format column
  dropped). `main` took the **opposite** direction and the owner ratified
  it: it added a Format column (`InboxList.tsx:41,138,193-194,
  408-414,507`) rather than dropping one.
- **FR-016** (**PARTIALLY DELIVERED**, #1003): every shipped behavior MUST be
  covered by a mock-mode Playwright CI assertion. `tests/e2e/
  adaptive_detail_dock.spec.ts` covers the threshold flip and pin-persists-
  across-reload for the two placements that did ship; it does not (and
  cannot) cover the Inbox-split or Targets-column assertions the original FR
  text specified, since those features don't exist.
- **FR-017** (**DELIVERED, but see drift below**, PR #966 / `8f464e87`):
  journey-catalog deltas MUST exist for J02, J03, J04, J05, J07, J08, J09,
  J16. All eight exist and are committed. **However**, several describe
  FR-006–FR-009 and FR-014/FR-015 as delivered — they are not. See next
  section.

## Known drift: journey deltas overstate delivery

Discovered during this reconciliation (#1069), **not previously tracked by
any issue found in this pass** — flagging rather than silently fixing, since
fixing `docs/journeys/` content is out of this task's scope
(documentation-only, `specs/` + `docs/development/windows-validation/`).

`docs/journeys/` deltas for this feature landed via PR #966 (`8f464e87`,
"docs(journeys): spec-054 adaptive detail-panel dock deltas"), evidently
written against the original branch design's full FR set rather than what
`#1003` actually shipped. Confirmed by direct grep against `main`:

- **`J09-targets-planning/journey.md`** cites FR-002 (Targets 1500px
  threshold), FR-006–FR-009 (pinned columns, conditional h-scroll, no
  auto-hide) as delivered, and describes "the side dock narrows the table
  below its column floor... pinned columns... no auto-hide." **Still not on
  `main`** for FR-002/FR-006/FR-007/FR-008 — no pinned-column or h-scroll code
  exists in `TargetsTable.tsx`. One correction as of this reconciliation:
  FR-009 itself (scroll containment) *is* now delivered (PR #1072) — just not
  the pinned-column/no-auto-hide behavior the journey pairs it with, which is
  really FR-006–FR-008's territory. Fixing the journey's FR grouping is out of
  this spec's scope (`docs/journeys/`).
- **`J02-ingest-review-reclassify-confirm-move/journey.md`** and
  **`J03-ingest-confirm-catalogue-in-place/journey.md`** cite FR-014/FR-015
  (permanent Inbox split) and describe "a fixed left/right split, never a
  bottom dock." **Still not on `main`**, and now formally **withdrawn**:
  Inbox uses the same adaptive side/bottom mechanism as every other page, and
  #1068 was decided against building the permanent split (see
  [Deferred / superseded](#deferred--superseded-not-on-main)).
- **`J16-keyboard-first-navigation/journey.md`** references "(Inbox
  [split])" placement as an existing option alongside side/bottom dock,
  which doesn't exist.
- **`J04-sessions-review-derived/journey.md`**, **`J05-project-lifecycle/
  journey.md`**, **`J07-archive-delete/journey.md`**,
  **`J08-calibration-ingest-masters-matching/journey.md`** cite FR-001/
  FR-004/FR-005/FR-011, which **are** accurately delivered — these four
  journeys appear consistent with `main`.

**Recommendation** (not actioned here): a follow-up documentation task should
amend J02, J03, J09, and J16 to match what actually shipped — including that
#1068 is now decided (permanent Inbox split withdrawn, Format column kept)
and the Targets-column work remains unbuilt with no tracked issue — the way
this spec now does. Filing that follow-up is outside this task's scope.

## Deferred / superseded (not on main)

This section makes explicit what the original branch designed but `main` does
not have, per issue #1069's instruction not to silently delete undelivered
design:

- **`useDetailDock`** — the branch's page-width (`ResizeObserver`-based) hook
  with `TABLE_FLOOR = 640`, `MIN_SIDE_WIDTH = 320` constants and a
  `forcedPlacement` prop. Superseded by the simpler, shipped
  `useAdaptiveDock` (window-width only, two placements). If a future need
  arises for page-available-width-aware placement (e.g. a Targets-specific
  threshold), re-derive it from the shipped hook rather than reviving the
  branch code verbatim — the branch's `preferences.detailDock` and `'split'`
  coupling do not apply to the shipped architecture.
- **`'split'` placement and the permanent narrow Inbox split** — branch tasks
  T018/T019. **WITHDRAWN**, #1068: these existed to make the Inbox FILES list
  reachable (#553), but #553 was already fixed a different way by PR #939
  (giving `InboxDetail`'s body its own scroll region), so the driver for the
  permanent split is spent. The owner decided to keep the adaptive dock and
  keep the Format column `main` shipped instead — do not build either the
  `'split'` placement or the narrowed Inbox list without a new product ask
  that reopens this.
- **`preferences.detailDock` / `AppPreferences` integration** — branch task
  T007. `main` persists dock state in raw `localStorage` instead
  (`useAdaptiveDock.ts` `STORAGE_PREFIX = 'alm-dock'`). No tracked issue;
  note if a future feature needs this state to be IPC-synced or exportable.
  This remains the one item from the original branch design with no shipped
  equivalent and no tracked follow-up.

Two items that were deferred as of #1069's original reconciliation pass have
since shipped and are no longer deferred:

- **Three-state Auto/Bottom/Right placement control** — branch task T021.
  **Delivered** via PR #1070, closing #1066.
- **Full `DetailPanel` migration (Archive/Projects/Targets) + shared-component
  guard** — branch tasks T011/T012/T017/T012a. **Delivered** via PR #1072,
  closing #1067.

Two follow-up gaps found by real-app validation of this mechanism remain
open, tracked outside this spec's original task list:

- **#1106** — icon-only placement control, detail-panel overflow fixes, and
  stable `dockId`s. Open PR.
- **#1107** — vertical clipping of `.alm-listpage__detail-body`. Open issue.

## Out of Scope

- Everything under [Deferred / superseded](#deferred--superseded-not-on-main)
  above is explicitly out of scope for the mechanism this spec now describes
  as delivered. They are tracked by their own issues, not folded back into
  this spec's requirements.
- Pop-out windows for monitoring surfaces, and density/vertical-economy work
  — out of scope in the original design review and still out of scope.

## Assumptions

- The 1100×720 minimum window is enforced by the desktop shell's window
  configuration; this document treats it as an invariant (unverified against
  a live resize test as part of this reconciliation — carried over from the
  original spec's assumption).
- Persisted placement/width is local UI-preference state (`localStorage`), not
  part of the library's durable relationship/audit record — consistent with
  Constitution §V regardless of which persistence mechanism (typed
  `AppPreferences` vs raw `localStorage`) is used.
- Lineage: this spec formalizes "Viewport strategy Phase 1 — adaptive dock"
  from `docs/development/design-review-2026-07-11.md` (epic #632), delivered
  via a different, simpler implementation path than originally planned.
