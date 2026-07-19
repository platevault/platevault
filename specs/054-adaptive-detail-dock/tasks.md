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
Checkboxes reflect delivery status as verified in this reconciliation pass.

## Legend

- **DELIVERED (#PR)** — confirmed present in `main` source, cites the PR.
- **OPEN (#issue)** — not on `main`; a tracked follow-up issue exists.
- **SUPERSEDED** — designed but not built; no tracked follow-up as of this
  reconciliation (the shipped architecture solved the underlying need
  differently, or the need turned out not to exist).

---

## Phase 1: Setup

- [x] T001 Confirm baseline. **SUPERSEDED** — no baseline task was run
  against this task list; #1003 was developed independently of this plan.

---

## Phase 2: Foundational — US1 shared mechanism

- [ ] T002 Unit test `useDetailDock` (threshold, pin fallback, hysteresis).
  **SUPERSEDED** — `useDetailDock` was never built (shipped hook is
  `useAdaptiveDock`, a different, simpler design). No dedicated unit-test
  file for `useAdaptiveDock` was found in this reconciliation pass — flag as
  a test-coverage gap if precision here matters for future work.
- [ ] T003 Unit test `preferences.detailDock` persistence. **SUPERSEDED** —
  `AppPreferences.detailDock` was never built; persistence is raw
  `localStorage`, untested by a dedicated unit-test file as of this
  reconciliation.
- [x] T004 Component test: containment for a plain overflowing block, no
  special internal scroll structure. **Note**: an untracked, uncommitted file
  `apps/desktop/src/components/DetailPanel.containment.test.tsx` exists in
  this worktree, explicitly referencing "spec 054 T004, issue #1069" in its
  docstring, and documents the actual #816 fix mechanism (a direct-child CSS
  selector in `redesign-detail.css`, from #1035). It predates this
  documentation session, is not on `main` or any branch/commit, and was not
  authored by this task — flagging its existence rather than claiming its
  status either way; it is not yet shipped.
- [x] T005 Component test `ListPageLayout` placement mount. **DELIVERED
  (partial), #1003** — `ListPageLayout.test.tsx` covers the `'side-and-bottom'`
  variant; general adaptive-placement mounting is exercised indirectly by
  consumer pages' own tests, not a dedicated placement-matrix test.
- [x] T006 Add `useDetailDock.ts` width hook. **SUPERSEDED** — shipped as
  `useAdaptiveDock.ts` instead: single `window.innerWidth` signal (not
  `ResizeObserver` page-width + window-width), no `pageWidth` return value.
  `apps/desktop/src/ui/useAdaptiveDock.ts`.
- [ ] T007 Extend `preferences.ts` / `AppPreferences.detailDock`.
  **SUPERSEDED** — shipped as raw `localStorage` keys instead
  (`useAdaptiveDock.ts:58-71`). No tracked issue for adding typed persistence.
- [x] T008 Container-level scroll containment in `DetailPanel.tsx` /
  `tables-lists.css`. **DELIVERED (partial), #1035** — closes #816 for the
  Target detail specifically, via a CSS direct-child selector contract (see
  T004 note). The containment guarantee is proven for `DetailPanel`'s three
  current adopters (Sessions/Calibration/Inbox); Archive/Projects/Targets
  don't route through `DetailPanel` at all, so the guarantee doesn't apply to
  them yet (#1067).
- [x] T009 Drive placement adaptively in `ListPageLayout.tsx`; delete the
  dead `'side-and-bottom'` dual path. **DELIVERED (partial), #1003** — the
  adaptive `'side'/'bottom'` wiring shipped
  (`ListPageLayout.tsx:268-343`). The `'side-and-bottom'` path was **not
  deleted** — it remains a live, tested capability
  (`ListPageLayout.tsx:207-266`, `ListPageLayout.test.tsx:102-176`), just
  unused by any current page. No `forcedPlacement` prop was added.
- [x] T010 Drag-resize handle, pointer-drag within `[320px, 50% window]`,
  persisted. **DELIVERED, #1003** — `useAdaptiveDock.ts:134-154`
  (`onResizeStart`), `ResizeHandle.tsx`, wired into
  `ListPageLayout.tsx:299-304`.
- [ ] T011 Migrate `TargetDetailV2` to shared `DetailPanel`. **OPEN, #1067**
  (PR #1072). Confirmed not on `main`: `TargetDetailV2`/`TargetsTable` do not
  import `DetailPanel`.
- [ ] T012 Migrate `ArchiveDetail` to shared `DetailPanel`. **OPEN, #1067**
  (PR #1072). Confirmed not on `main`: `ArchiveDetail.tsx` does not import
  `DetailPanel`.
- [ ] T012a Shared-component guard (automated check + static grep script).
  **OPEN, #1067** (PR #1072). Not found in `main`'s lint/test gate.

---

## Phase 3: User Story 2 — Adaptive side dock on the list-dominant pages

- [x] T013 `SessionsPage.tsx` adopts adaptive placement. **DELIVERED,
  #1003** — default `detailPlacement='adaptive'`, no page-key threshold
  differentiation (the original task's `'sessions'` key concept doesn't
  apply to the shipped `dockId` design, which defaults to `detailLabel`).
- [x] T014 `CalibrationPage.tsx` adopts adaptive placement. **DELIVERED,
  #1003** — same pattern as T013.
- [x] T015 `ArchivePage.tsx` adopts adaptive placement (detail migration
  assumed already done in T012). **DELIVERED (placement only), #1003** —
  adaptive placement shipped; the T012 `DetailPanel` migration this task
  assumed as a prerequisite did **not** ship (#1067 still open), so Archive's
  detail panel is adaptive-placed but not routed through the shared
  container.
- [x] T016 `TargetsPage.tsx` adopts adaptive placement at threshold 1500px
  (detail migration assumed done in T011). **DELIVERED (partial), #1003** —
  adaptive placement shipped, but at the shared **1400px default**, not a
  Targets-specific 1500px (no `adaptiveThreshold` override is passed in
  `TargetsPage.tsx`). T011's prerequisite `DetailPanel` migration did not
  ship (#1067).
- [ ] T017 `ProjectsPage.tsx` unifies onto the adaptive mechanism, dropping
  the bespoke `alm-project-detail-stack`. **DELIVERED for placement,
  OPEN for the DetailPanel part (#1067).** `ProjectsPage.tsx` does pass no
  `detailPlacement` (defaults to adaptive) and does render its detail
  content as a single fill (`ProjectDetailContent` + `ProjectBottomDetail`
  stacked in one `div`), which is a de-facto unification away from
  `'side-and-bottom'`. However its own module docstring still claims
  `detailPlacement="side-and-bottom"` — a stale comment, not matching the
  actual JSX; see plan.md's note. It does not route through `DetailPanel`
  (#1067).

---

## Phase 4: User Story 3 — Inbox detail-dominant permanent split

- [ ] T018 `InboxPage.tsx` renders the permanent `'split'` shape.
  **SUPERSEDED / OPEN PRODUCT DECISION, #1068.** Not built — Inbox uses the
  same adaptive mechanism as every other page. #1068 is the open decision
  between building this vs. keeping the Format column `main` shipped
  instead. Do not build without a recorded decision there.
- [ ] T019 `InboxList.tsx` narrowed presentation (name truncation, essential
  columns only, Format column dropped). **SUPERSEDED / OPEN PRODUCT
  DECISION, #1068.** `main` took the opposite direction: it **added** a
  Format column (`InboxList.tsx:41,138,193-194,408-414,507`) rather than
  dropping one. #1068 frames this as the explicit contradiction to resolve.
- [ ] T020 Component/unit test: Inbox list-left/detail-right at both extremes.
  **SUPERSEDED** — moot until/unless #1068 is decided in favor of building
  the split.

---

## Phase 5: User Story 4 — Per-page pin + persisted resize

- [ ] T021 Surface an Auto/Bottom/Right 3-state placement control (Settings +
  in-page). **OPEN, #1066** (PR #1070). `main` ships only a 2-state pin
  toggle (`ListPageLayout.tsx:307-325`, `alm-listpage__detail-pin`) that
  flips `'side'`⇄`'bottom'` and has no path back to auto placement without
  clearing `localStorage` — the exact bug #1066 describes.
- [x] T022 Enforce a pin→bottom safety fallback when the window is too
  narrow. **DELIVERED (narrower than designed), #1003** — `useAdaptiveDock`
  has `sideAvailable = windowWidth >= minWidth * 2`
  (`useAdaptiveDock.ts:126`), a single-threshold check on window width, not
  the branch's two-term page-available-width-minus-table-floor calculation
  (D3 in research.md). Functionally similar outcome at the 1100px minimum
  width, unverified for intermediate cases.
- [ ] T023 Component test: pin two pages differently, drag one, reload,
  verify exact restore. **Not confirmed** — no dedicated multi-page
  persistence-restore test was found in this reconciliation pass.

---

## Phase 6: User Story 5 — Targets table readable beside the side dock

- [ ] T024 Pin favorite-star + designation columns; permanent importance
  column order. **SUPERSEDED** — no evidence of pinned-column or
  column-reorder work found in `TargetsTable.tsx`/`TargetsPage.tsx`. No
  tracked follow-up issue.
- [ ] T025 Conditional horizontal scroll of non-pinned columns only when
  space is insufficient. **SUPERSEDED** — same, no evidence found, no
  tracked issue.
- [ ] T026 E2E: keep the existing full-width unclipped pin passing; add a
  pinned-column + h-scroll assertion. **SUPERSEDED** — moot without T024/T025.

---

## Phase 7: User Story 6 — Placement-neutral keyboard flow

- [x] T027 Route J16 arrow-follow + Escape-close through the shared layout,
  placement-neutral. **DELIVERED, pre-existing (spec 043, #771/#906), not
  new work for this feature.** `ListPageLayout.tsx`'s Escape handler
  (`:175-193`) is one `document`-level listener regardless of
  `detailPlacement`; unaffected by which of `'side'`/`'bottom'` is active.
- [ ] T028 E2E: keyboard flow identical across side/bottom/split. **DELIVERED
  for side/bottom (implied by T027's pre-existing mechanism); N/A for split
  (T018 not built).** No dedicated new E2E assertion was authored for this
  feature specifically — existing J16 coverage predates #1003.

---

## Phase 8: Validation — CI assertions + journey deltas

- [x] T029 New `adaptive_detail_dock.spec.ts` mock-mode Playwright E2E.
  **DELIVERED (scoped to what shipped), #1003** —
  `tests/e2e/adaptive_detail_dock.spec.ts` (92 lines), two tests against
  Calibration: threshold flip side↔bottom at 1600×900 vs 1100×720, and
  pin-persists-across-reload via `dock-placement-toggle`. Does not (and
  cannot) cover Inbox-split or Targets-column assertions — those features
  don't exist.
- [ ] T030 Migrate existing `.alm-listpage__detail` E2E pins deliberately.
  **N/A** — the Inbox-split migration these pins targeted (T018) was not
  built, so there was nothing to migrate them to. Confirmed the new spec's
  own docstring explicitly calls out non-interference with
  `calibration_masters_matching.spec.ts:157` and `inbox_ingest_confirm.spec.ts`.
- [x] T031 Journey deltas in `docs/journeys/` (J02/J03/J04/J05/J07/J08/J09/
  J16). **DELIVERED, but see [Known drift](./spec.md#known-drift-journey-deltas-overstate-delivery),
  PR #966 (`8f464e87`).** All eight journey files exist and are committed.
  J04/J05/J07/J08 accurately describe the shipped adaptive side/bottom
  mechanism. **J02, J03, J09, and J16 describe FR-006–FR-009 (Targets pinned
  columns) and FR-014/FR-015 (permanent Inbox split) as delivered — neither
  is on `main`.** This is a real, pre-existing doc/code drift discovered
  during this reconciliation, distinct from the `specs/` gap #1069 targets;
  flagging it here rather than silently fixing `docs/journeys/`, which is
  out of this task's scope.
- [ ] T032 `verify-on-windows` scenario + Layer-2 journey. **DELIVERED
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
  run`, `pnpm format:check`, `just check-generated`). **Not run as part of
  this reconciliation** — this task is documentation-only per its brief; the
  shipped PRs (#1003, #1035, #1060) presumably passed CI gates at merge time,
  but that was not independently re-verified here.
- [x] T035 `speckit-verify` / `speckit-verify-tasks` against real
  implementation evidence. **This document is that verification pass**,
  performed manually against `main` source rather than via the
  `speckit-verify` tooling, per issue #1069's ask to close the SpecKit
  workflow gate.

---

## Summary by disposition

- **Delivered** (fully or partially, cites a PR): T004 (partial, uncommitted
  local test only), T005, T008, T009, T010, T013–T017 (placement only),
  T022, T027, T028 (partial), T029, T031 (partial — see drift note), T032,
  T033.
- **Open** (tracked follow-up issue): T011, T012, T012a → **#1067**; T021 →
  **#1066**.
- **Open product decision** (no implementation should proceed without it):
  T018, T019, T020 → **#1068**.
- **Superseded** (no tracked follow-up as of this reconciliation): T001,
  T002, T003, T006, T007, T024, T025, T026, T030.
- **Not confirmed** (verify before relying on): T023, T034.
