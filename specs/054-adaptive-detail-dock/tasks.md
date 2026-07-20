---
description: "Task list for 054-adaptive-detail-dock (reconciled against shipped main, issue #1069)"
---

# Tasks: Adaptive Detail-Panel Dock

**Reconciled**: 2026-07-19 (#1069), against `main` source. This is the
original `feat/adaptive-detail-dock` branch's task list (PR #1007, closed as
superseded by #1003), with every task given an honest status: **delivered**
(names the PR), **open** (names the follow-up issue), or **superseded**
(designed but not built, no plan to build it as originally specified).

Do not treat `[ ]`/`[X]` checkboxes below as live SpecKit task state — this
feature was not implemented via `speckit-implement` against this task list.
Checkboxes reflect delivery status as verified in this reconciliation pass,
under this convention: **`[x]` = the disposition is settled and needs no
further action from a reader** (DELIVERED, WITHDRAWN, or SUPERSEDED with no
outstanding gap); **`[ ]` = the disposition is NOT settled** (OPEN with a
follow-up issue/PR still to land, an open product decision, or NOT CONFIRMED
pending verification).

## Legend

- **DELIVERED (#PR)** — confirmed present in `main` source, cites the PR.
- **OPEN (#issue)** — not on `main`; a tracked follow-up issue exists.
- **WITHDRAWN (#issue)** — designed, intentionally not built, and the product
  decision that would have authorized building it has since been decided
  against; do not build without a new product ask that reopens it.
- **SUPERSEDED** — designed but not built; no tracked follow-up as of this
  reconciliation (the shipped architecture solved the underlying need
  differently, or the need turned out not to exist).

---

## Phase 1: Setup

- [x] T001 Confirm baseline. **SUPERSEDED** — no baseline task was run
  against this task list; #1003 was developed independently of this plan.

---

## Phase 2: Foundational — US1 shared mechanism

- [x] T002 Unit test `useDetailDock` (threshold, pin fallback, hysteresis).
  **DELIVERED (renamed, minus hysteresis), #1195.** `useDetailDock` was never
  built — the shipped hook is `useAdaptiveDock`, a simpler design — and the
  previous pass correctly found no tests for it. #1195 added them: threshold
  resolution, pin-overrides-threshold, `setOverride(null)` restoring auto
  (the #1066 path), the `sideAvailable` narrow-window fallback, width clamping,
  and per-`dockId` isolation across remount.
  Two honest deviations. They live in `ListPageLayout.test.tsx` rather than a
  dedicated file — deliberate, since adding a React-rendering test file
  previously tipped the suite into load-induced timeouts in unrelated suites.
  And **hysteresis is not covered because it does not exist**: the hook
  resolves placement from a single threshold with no damping band.
  The assertions are mutation-checked, not merely green — forcing
  `sideAvailable` true fails the narrow-window test, and making
  `setOverride(null)` a no-op (re-introducing #1066) fails both the new hook
  test and the existing layout test.
- [x] T003 Unit test `preferences.detailDock` persistence.
  **DELIVERED, #1195.** No longer superseded: `AppPreferences.detailDock` now
  exists (see T007), and its persistence is covered by the per-`dockId`
  remount-restore assertion added in the same PR.
- [x] T004 Component test: containment for a plain overflowing block, no
  special internal scroll structure. **DELIVERED, PR #1076; REVISED, #1107.**
  Originally landed as tests 19–20 in `DetailPanel.test.tsx` ("content-only
  children stay direct children of `.alm-detail--fill`" / "the facts slot does
  NOT satisfy that selector"), pinning the #816 fix mechanism — a direct-child
  CSS selector in `redesign-detail.css`, from #1035. An earlier draft of this
  file existed as an untracked, uncommitted stray in this worktree before
  #1076 merged it under the `DetailPanel.test.tsx` name instead of its own
  file — that history is superseded by the committed version now on `main`.

  **#1107 moved the contract these pin.** The reason #816 needed a per-feature
  scroll wrapper at all is that `DetailPanel` rendered `children` as a bare
  sibling of the header with no scroll region — the region was gated on the
  facts/aux rails, which no page ever passed. Three features each worked
  around it locally (#553 Inbox, #816 Targets, #1107 Calibration) while
  Sessions and Projects stayed silently broken. The content region is now
  unconditional and owns scrolling for every page, so the per-feature rules
  were retired. Tests 19–20 now pin the relocated invariant: the shared region
  wraps the content, and there is exactly one of them (a second would mean
  nested scrollbars). The "facts slot does not satisfy the selector" pin goes
  away with the slots.

  Measured live in mock mode at a 390px side dock, 1280×860, before → after:
  Projects 1216px → 0, Sessions 522px → 0, Calibration 191px → 0 of
  unreachable content; Inbox and Targets unchanged at 0 (no regression).

- [ ] T004a **WITHDRAWN (#1107)** — `DetailPanel` facts/aux rail slots and the
  3-zone grid. Designed in spec 043 §4 and described in `plan.md`, but never
  adopted: the props were passed only by `DetailPanel`'s own tests, which gave
  false confidence in a code path the app never took. Withdrawn rather than
  left latent because the grid *gated the panel's only scroll region*, so
  keeping it dormant kept the clipping bug alive. Do not reintroduce a
  conditional content wrapper; if per-page rails are wanted later, they must
  not sit between the panel root and the scroll region.
- [x] T005 Component test `ListPageLayout` placement mount. **DELIVERED
  (partial), #1003** — `ListPageLayout.test.tsx` covers the `'side-and-bottom'`
  variant; general adaptive-placement mounting is exercised indirectly by
  consumer pages' own tests, not a dedicated placement-matrix test.
- [x] T006 Add `useDetailDock.ts` width hook. **SUPERSEDED** — shipped as
  `useAdaptiveDock.ts` instead: single `window.innerWidth` signal (not
  `ResizeObserver` page-width + window-width), no `pageWidth` return value.
  `apps/desktop/src/ui/useAdaptiveDock.ts`.
- [x] T007 Extend `preferences.ts` / `AppPreferences.detailDock`.
  **DELIVERED, #1195.** Previously recorded as superseded by raw `localStorage`
  keys; that gap was tracked from #1158 and has now been closed.
  `detail_dock: HashMap<String, DetailDockPref>` is on the Rust
  `AppPreferences` contract (the generated source of truth) with bindings
  regenerated, and `useAdaptiveDock` reads/writes through
  `getPreferences()`/`setPreference()` instead of raw keys.
  `placement` is deliberately three-state — `Some(Side)`/`Some(Bottom)` pin the
  dock, `None` means "auto, follow the width rule". Collapsing that to two
  states is precisely what #1066 was.
  No migration of the old `pv-dock-*` keys, per an explicit product decision:
  users take a one-time placement reset, as they already did in #1106.
- [x] T008 Container-level scroll containment in `DetailPanel.tsx` /
  `tables-lists.css`. **DELIVERED, #1035 + PR #1072.** #1035 closed #816 for
  the Target detail specifically, via a CSS direct-child selector contract
  (see T004 note). PR #1072 migrated Archive/Projects/Targets onto
  `DetailPanel` too, so the containment guarantee now applies uniformly
  across all six adopters, not just Sessions/Calibration/Inbox.
- [x] T009 Drive placement adaptively in `ListPageLayout.tsx`; delete the
  dead `'side-and-bottom'` dual path. **DELIVERED (partial), #1003** — the
  adaptive `'side'/'bottom'` wiring shipped
  (`ListPageLayout.tsx:269-336`). The `'side-and-bottom'` path was **not
  deleted** — it remains a live, tested capability
  (`ListPageLayout.tsx:207-267`, `ListPageLayout.test.tsx:102-176`), just
  unused by any current page. No `forcedPlacement` prop was added.
- [x] T010 Drag-resize handle, pointer-drag within `[320px, 50% window]`,
  persisted. **DELIVERED, #1003** — `useAdaptiveDock.ts:134-154`
  (`onResizeStart`), `ResizeHandle.tsx`, wired into
  `ListPageLayout.tsx:299-304`.
- [x] T011 Migrate `TargetDetailV2` to shared `DetailPanel`. **DELIVERED,
  #1067 (PR #1072).** Confirmed on `main`: `TargetDetailV2.tsx:941` renders
  `<DetailPanel fill title={titleContent} ...>`.
- [x] T012 Migrate `ArchiveDetail` to shared `DetailPanel`. **DELIVERED,
  #1067 (PR #1072).** Confirmed on `main`: `ArchiveDetail.tsx:63-127` renders
  `<DetailPanel>`.
- [x] T012a Shared-component guard (automated check + static grep script).
  **DELIVERED, #1067 (PR #1072).** `DetailPanel.shared-guard.test.ts`
  statically asserts all six detail files (`SessionDetail.tsx`,
  `MasterDetail.tsx`, `InboxDetail.tsx`, `ArchiveDetail.tsx`,
  `TargetDetailV2.tsx`, `ProjectDetail.tsx`) render through `<DetailPanel`
  and never render a raw `<DetailHeader` directly.

---

## Phase 3: User Story 2 — Adaptive side dock on the list-dominant pages

- [x] T013 `SessionsPage.tsx` adopts adaptive placement. **DELIVERED,
  #1003** — default `detailPlacement='adaptive'`, no page-key threshold
  differentiation (the original task's `'sessions'` key concept doesn't
  apply to the shipped `dockId` design, which defaults to `detailLabel`).
- [x] T014 `CalibrationPage.tsx` adopts adaptive placement. **DELIVERED,
  #1003** — same pattern as T013.
- [x] T015 `ArchivePage.tsx` adopts adaptive placement (detail migration
  assumed already done in T012). **DELIVERED, #1003 + #1067 (PR #1072).** —
  adaptive placement shipped, and the T012 `DetailPanel` migration this task
  assumed as a prerequisite has since shipped too, so Archive's detail panel
  is both adaptive-placed and routed through the shared container.
- [x] T016 `TargetsPage.tsx` adopts adaptive placement at threshold 1500px
  (detail migration assumed done in T011). **DELIVERED (partial), #1003 +
  #1067 (PR #1072)** — adaptive placement shipped, but at the shared
  **1400px default**, not a Targets-specific 1500px (no `adaptiveThreshold`
  override is passed in `TargetsPage.tsx`) — that gap is superseded, no
  tracked issue. T011's prerequisite `DetailPanel` migration has since
  shipped (#1067, PR #1072).
- [x] T017 `ProjectsPage.tsx` unifies onto the adaptive mechanism, dropping
  the bespoke `alm-project-detail-stack`. **DELIVERED, #1003 + #1067
  (PR #1072).** `ProjectsPage.tsx` does pass no `detailPlacement` (defaults
  to adaptive) and does render its detail content as a single fill
  (`ProjectDetailContent` + `ProjectBottomDetail` stacked in one `div`),
  which is a de-facto unification away from `'side-and-bottom'`. It now
  routes through `DetailPanel` too (`ProjectDetail.tsx:477-829`). Its module
  docstring still claims `detailPlacement="side-and-bottom"` — a stale
  comment, not matching the actual JSX; tracked as **#1108** (open PR), see
  plan.md's note.

---

## Phase 4: User Story 3 — Inbox detail-dominant permanent split

- [x] T018 `InboxPage.tsx` renders the permanent `'split'` shape.
  **WITHDRAWN, #1068.** Not built, and no longer planned — Inbox uses the
  same adaptive mechanism as every other page. #1068 existed to make the
  Inbox FILES list reachable (#553), but #553 was already fixed a different
  way by PR #939 (giving `InboxDetail`'s body its own scroll region), so the
  driver for this task is spent. The owner decided to keep the adaptive dock
  and the Format column instead of building the permanent split.
- [x] T019 `InboxList.tsx` narrowed presentation (name truncation, essential
  columns only, Format column dropped). **WITHDRAWN, #1068.** `main` took
  the opposite direction: it **added** a Format column
  (`InboxList.tsx:41,138,193-194,408-414,507`) rather than dropping one, and
  the owner ratified that direction when #1068 was decided.
- [x] T020 Component/unit test: Inbox list-left/detail-right at both extremes.
  **WITHDRAWN** — moot now that #1068 decided against building the split.

---

## Phase 5: User Story 4 — Per-page pin + persisted resize

- [x] T021 Surface an Auto/Bottom/Right 3-state placement control (Settings +
  in-page). **DELIVERED IN-PAGE ONLY, #1066 (PR #1070).**
  `ListPageLayout.tsx:313` renders
  `DetailDockPlacementControl` (`apps/desktop/src/components/
  DetailDockPlacementControl.tsx`), a real 3-state Auto/Bottom/Right control
  built on the shared `SegControl`, replacing the old 2-state
  `alm-listpage__detail-pin` toggle (that class no longer exists anywhere in
  the codebase). Selecting "Auto" calls `setOverride(null)`, which clears the
  pin — the exact path #1066 was filed for.
  The **"Settings" half of this task did NOT ship**: there is no placement
  control anywhere under `features/settings/`. The control is rendered
  per-page by `ListPageLayout` whenever placement is adaptive. Treated as a
  deliberate outcome rather than a gap — the control acts on the panel it
  sits beside, so a separate Settings surface would duplicate it. Journey J10
  briefly documented a Settings-based control that never existed; corrected
  in the same pass as this reconciliation. #1106 (open) makes the shipped
  control icon-only.
- [x] T022 Enforce a pin→bottom safety fallback when the window is too
  narrow. **DELIVERED (narrower than designed), #1003** — `useAdaptiveDock`
  has `sideAvailable = windowWidth >= minWidth * 2`
  (`useAdaptiveDock.ts:126`), a single-threshold check on window width, not
  the branch's two-term page-available-width-minus-table-floor calculation
  (D3 in research.md). Functionally similar outcome at the 1100px minimum
  width, unverified for intermediate cases.
- [ ] T023 Component test: pin two pages differently, drag one, reload,
  verify exact restore. **DELIVERED IN PART, #1195 — deliberately left open.**
  The "persists across remount, scoped per dockId" assertion covers the
  multi-page half: `page-a` is pinned and resized, unmounted, and restored with
  both values intact, while `page-b` is confirmed untouched by it.
  Two parts of this task are still NOT covered, which is why it stays open
  rather than being ticked: the restore is verified across a **remount**, not a
  real page **reload**, and the width is set via `setWidth` rather than by
  **dragging** the resize handle. Neither shortcut is free — a genuine reload
  is what would exercise the preference cache, and the drag path has its own
  pointer-event handling.

---

## Phase 6: User Story 5 — Targets table readable beside the side dock

- [x] T024 Pin favorite-star + designation columns; permanent importance
  column order. **DELIVERED (pinning only), #1158.** The previous pass recorded
  this as SUPERSEDED — correct at the time (zero `position: sticky` column code
  existed), but it was tracked from #1158 and has now been built. The star and
  designation columns are sticky-left in `merges-2.css`, so a row's identity
  survives horizontal scrolling.
  The **"permanent importance column order" half did NOT ship**: column order is
  unchanged. Treated as a deliberate outcome, not a gap — the shipped order
  already leads with identity, and reordering the rest is a separate design
  question with no reported complaint behind it.
- [x] T025 Conditional horizontal scroll of non-pinned columns only when
  space is insufficient. **DELIVERED, pre-existing.** Not new work for #1158:
  `.pv-targets-table__scroll` already carried `overflow-x: auto` against the
  table's 1000px `min-width` floor, so non-pinned columns scroll only when the
  space is actually insufficient. T024 is what made that scrolling non-lossy.
- [x] T026 E2E: keep the existing full-width unclipped pin passing; add a
  pinned-column + h-scroll assertion. **DELIVERED (#1257).**
  `targets_ui_identity_columns_stay_pinned_while_table_scrolls`
  (`crates/e2e-tests/tests/targets_journeys.rs`) automates what had only been
  measured by hand: 0px drift for star, designation and the designation
  header, against real h-scroll at 1400×900. A Layer-1 assertion cannot
  replace it — jsdom has no layout engine, so it reports 0 for every position
  and would pass against a completely unpinned table.

  The task as originally written understated the work. Two harness gaps had
  to be closed first, and both are shared surface rather than spec-054 scope:

  - Nothing could size the window. `tauri.conf.json` opens at 1280×820, below
    `useAdaptiveDock`'s 1400px threshold, so the docked layout this asserts
    did not occur at all. Added `E2eApp::set_viewport`, which corrects for
    window chrome by measurement instead of assuming outer == inner (they are
    equal under xvfb, which has no window manager, but not on Windows).
  - The Ubuntu shards' display was too narrow to hold the window: `e2e.yml`
    ran `xvfb-run -a`, whose built-in default screen is 1280 wide. Widened to
    1600×1200.

  **Not fully verified:** the Windows shards use the native display and its
  resolution has not been confirmed ≥1400. If it is smaller, `set_viewport`
  fails loudly naming the screen size rather than passing vacuously — the
  failure mode is safe, but the shard would need the same treatment.

  The journey asserts a non-pinned control column moves by the scroll
  distance, so it cannot pass vacuously against a table that never scrolled.

---

## Phase 7: User Story 6 — Placement-neutral keyboard flow

- [x] T027 Route J16 arrow-follow + Escape-close through the shared layout,
  placement-neutral. **DELIVERED, pre-existing (spec 043, #771/#906), not
  new work for this feature.** `ListPageLayout.tsx`'s Escape handler
  (`:175-193`) is one `document`-level listener regardless of
  `detailPlacement`; unaffected by which of `'side'`/`'bottom'` is active.
- [x] T028 E2E: keyboard flow identical across side/bottom/split. **DELIVERED
  for side/bottom (implied by T027's pre-existing mechanism); N/A for split
  (T018 withdrawn, #1068).** No dedicated new E2E assertion was authored for
  this feature specifically — existing J16 coverage predates #1003.

---

## Phase 8: Validation — CI assertions + journey deltas

- [x] T029 New `adaptive_detail_dock.spec.ts` mock-mode Playwright E2E.
  **DELIVERED (scoped to what shipped), #1003** —
  `tests/e2e/adaptive_detail_dock.spec.ts` (92 lines), two tests against
  Calibration: threshold flip side↔bottom at 1600×900 vs 1100×720, and
  pin-persists-across-reload. **Correction**: this task previously cited a
  `dock-placement-toggle` test id — that string does not exist anywhere in
  the codebase. The actual pin test selects the 3-state control via
  `page.getByRole("radio", { name: "Right" })`; the control's real test id is
  `data-testid="dock-placement-control"` (`DetailDockPlacementControl.tsx:48`).
  Does not (and cannot) cover
  Inbox-split or Targets-column assertions — those features don't exist.
- [ ] T030 Migrate existing `.alm-listpage__detail` E2E pins deliberately.
  **N/A** — the Inbox-split migration these pins targeted (T018, withdrawn
  #1068) was not built, so there was nothing to migrate them to. Confirmed
  the new spec's own docstring explicitly calls out non-interference with
  `calibration_masters_matching.spec.ts:157` and `inbox_ingest_confirm.spec.ts`.
  Doubly moot since: the design-system rename retired the `alm-` namespace
  entirely, so the pins this task names no longer exist under that name — the
  E2E suites now select `.pv-listpage__detail`. That rename is not cosmetic
  trivia here; a helper missed by it silently broke an Inbox journey on `main`
  (fixed in #1206), so any future task naming a CSS class should be read as
  possibly pre-rename.
- [x] T031 Journey deltas in `docs/journeys/` (J02/J03/J04/J05/J07/J08/J09/
  J16). **DELIVERED, but see [Known drift](./spec.md#known-drift-journey-deltas-overstate-delivery),
  PR #966 (`8f464e87`).** All eight journey files exist and are committed.
  J04/J05/J07/J08 accurately describe the shipped adaptive side/bottom
  mechanism. **J02, J03, J09, and J16 describe FR-006–FR-009 (Targets pinned
  columns) and FR-014/FR-015 (permanent Inbox split) as delivered.**
  FR-002/FR-006/FR-007/FR-008 and FR-014/FR-015 are still not on `main` (the
  latter now formally withdrawn, #1068); FR-009 itself (scroll containment)
  *is* now delivered (PR #1072), just not the pinned-column behavior J09
  pairs it with. This is a real, pre-existing doc/code drift discovered
  during this reconciliation, distinct from the `specs/` gap #1069 targets;
  flagging it here rather than silently fixing `docs/journeys/`, which is
  out of this task's scope.
- [x] T032 `verify-on-windows` scenario + Layer-2 journey. **DELIVERED
  (this reconciliation), #1069** —
  `docs/development/windows-validation/054-adaptive-detail-dock.md`,
  rewritten for the shipped two-placement mechanism. No Layer-2 tauri-driver
  journey was added as part of this documentation-only pass; only the manual
  validation script.

---

## Phase 9: Polish & Verification

- [x] T033 Constitution re-check. **DELIVERED (this reconciliation)** — see
  plan.md's Constitution Check table; PASS, no new violation from the
  plan/shipped gap.
- [ ] T034 Full local gates (`pnpm typecheck`, `pnpm build`, `pnpm vitest
  run`, `pnpm format:check`, `just check-generated`). **Partially run, #1107 /
  #1158 pass.** The earlier note stands for the original PRs (#1003, #1035,
  #1060), which were never independently re-verified. What WAS run locally for
  the work merged since: `tsc --noEmit` clean, `vitest run` green (199 files /
  1825 tests), `biome check` clean, `just check-generated` clean with no
  binding drift, `cargo test -p contracts_core` (71) and `clippy` clean, and
  `scripts/check-tokens.sh` clean including WCAG AA contrast across 6 themes.
  Stays open because that is not the same claim as the task: these gates cover
  the changes merged in this pass, not a re-verification of the whole feature's
  prior work.
- [x] T035 `speckit-verify` / `speckit-verify-tasks` against real
  implementation evidence. **This document is that verification pass**,
  performed manually against `main` source rather than via the
  `speckit-verify` tooling, per issue #1069's ask to close the SpecKit
  workflow gate.

---

## Summary by disposition

- **Delivered** (fully or partially, cites a PR): T002 (minus hysteresis,
  which was never built), T003, T004, T005, T007, T008, T009 (partial — dual
  path not deleted), T010, T011, T012, T012a, T013–T017, T021, T022, T024
  (partial — pinning shipped, column reorder did not), T025 (pre-existing),
  T027, T028, T029, T031 (partial — see drift note), T032, T033.
- **Withdrawn** (designed, decided against — do not build without a new
  product ask): T018, T019, T020 → **#1068**; T004a (`DetailPanel` facts/aux
  rails) → **#1107**.
- **Superseded** (no tracked follow-up as of this reconciliation): T001, T006,
  T030.
- **Open**: T023 (partial — remount covered, reload + drag not).
- **Not confirmed** (verify before relying on): T034.

**One task is Open as of the #1257 pass** (T023) — test coverage for
behaviour that ships, not unbuilt product. The count was two after #1158
(T023, T026); #1257 closed T026 by automating the pinned-column assertion,
which also required widening the Ubuntu E2E display and adding a viewport
helper to the shared harness. The earlier statement that no task remained
Open was true when written, before #1195 and #1158 delivered
T002/T003/T007/T024/T025 and thereby created a genuine gap between the
shipped behaviour and its regression cover.

T023's two uncovered halves (restore across a real reload, and width set by
dragging rather than `setWidth`) remain tracked in **#1257**.

Historically: #1066 (T021) and #1067 (T011/T012/T012a) both shipped (PR #1070,
PR #1072). Three
follow-up gaps found by real-app validation of the shipped mechanism are
tracked outside this task list entirely, not against any T0xx here: **#1106**
(icon-only placement control, detail-panel overflow, stable `dockId`s, open
PR), **#1107** (vertical clipping of `.alm-listpage__detail-body`, open
issue), **#1108** (stale `ProjectsPage.tsx` layout comments, open PR, see
T017).
