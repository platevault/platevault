---
description: "Task list for 054-adaptive-detail-dock"
---

# Tasks: Adaptive Detail-Panel Dock

**Input**: Design documents from `specs/054-adaptive-detail-dock/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/README.md

**Tests**: Included. Placement determinism, persistence/clamp, container
containment, and the Inbox split geometry are correctness-critical, so
component/unit tests and the FR-016 mock-mode Playwright assertions are part of
the work — not an afterthought.

**Organization**: Grouped by user story (US1–US6). US1 is the foundational
shared mechanism (a single sequential lane); US2–US6 fan out per page. Each
later phase is an independently reviewable slice on top of the merged
foundation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency).
- Paths are repo-relative and reference real files from plan.md / the code map.
- All paths under `apps/desktop/` unless noted.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline on `feat/adaptive-detail-dock` (worktree off
  `origin/main`, spec commits layered). Run `pnpm typecheck`, `pnpm vitest run`,
  and the existing e2e suite to record the green baseline. Re-read at merged
  HEAD: `components/ListPageLayout.tsx`, `components/DetailPanel.tsx`,
  `features/inbox/InboxDetail.tsx` + `InboxPage.tsx` (PR #939 just landed here),
  `features/targets/TargetDetailV2.tsx`, `features/archive/ArchivePage.tsx`,
  `data/preferences.ts`. Note the exact current CSS containment rules in
  `styles/components/tables-lists.css` and `merges-2.css`.

---

## Phase 2: Foundational — US1 shared mechanism (Blocking Prerequisite) 🎯 MVP

**⚠️ No per-page (US2–US6) work begins until this phase is complete and merged.
This is a single sequential lane — do NOT fan out a fleet onto it.**

**Goal**: The shared mechanism exists — every detail consumer scrolls correctly
in every placement (regardless of its own markup), the width hook + persistence
drive `ListPageLayout` adaptively with a drag-resizable side panel, and no page
owns bespoke panel markup.
**Independent Test**: spec US1 Independent Test (#816 reproduction passes at
1100×720 in every placement).

### Tests (US1)
- [ ] T002 [P] [US1] Unit test `useDetailDock`: window width ≥ threshold ⇒
  `'side'`, below ⇒ `'bottom'`; a pinned `'side'` mode falls back to `'bottom'`
  when page-available width < min-side(320)+table-floor(640); Targets threshold
  = 1500, others = 1400; hysteresis: a 1px jitter across the boundary does not
  flip placement (FR-001/FR-002/FR-003, SC-001, research D1–D3).
- [ ] T003 [P] [US1] Unit test `preferences.detailDock`: set/get per-page
  mode+width round-trips through localStorage; absent key ⇒ `'adaptive'` at the
  page default width; width outside `[320, 0.5*window]` is clamped on restore;
  Inbox key ignores `mode` (always split) but honours `width` (FR-005, SC-002,
  data-model.md).
- [ ] T004 [P] [US1] Component test `DetailPanel`/`ListPageLayout` containment:
  a consumer that renders a plain overflowing block **with no special internal
  scroll structure** still scrolls within the panel and never extends past the
  container, in bottom, side, and split placements (FR-009, SC-007). This is the
  #816 regression pin.
- [ ] T005 [P] [US1] Component test `ListPageLayout` placement: given a mocked
  `useDetailDock` returning `'side'`/`'bottom'`/`'split'`, the layout mounts the
  detail in the correct region and always exposes `.alm-listpage__detail` so the
  existing e2e locators keep resolving (FR-001/FR-004).

### Implementation (US1)
- [ ] T006 [US1] Add `components/useDetailDock.ts`: a `ResizeObserver` on the
  `.alm-page` region for page-available width + a window-width source; return
  `{ effectivePlacement, windowWidth, pageWidth }` resolving the persisted
  per-page preference against the thresholds and the pin→bottom fallback.
  Debounce/round to prevent oscillation (research D2/D3). Export the threshold
  and floor constants from one module.
- [ ] T007 [US1] Extend `data/preferences.ts` + the `AppPreferences` type
  (`bindings/types`) with `detailDock: Record<DetailDockPageKey,
  DetailDockPreference>`; add `getDetailDock(page)` / `setDetailDockMode(page,
  mode)` / `setDetailDockWidth(page, width)` with restore-time clamp; mirror the
  `projectViewModes` keyed-map pattern (data-model.md, D4).
- [ ] T008 [US1] **Container-level scroll containment** in `DetailPanel.tsx` +
  `styles/components/tables-lists.css`: make the shared detail *container* the
  single guaranteed scroll boundary in every placement (bottom/side/split), so
  content scrolls within the panel and the panel never exceeds the window,
  **independent of consumer markup** — remove the reliance on each consumer
  providing `.alm-detailpanel__content` as the only scroller. Closes #816
  (FR-009). Verify against T004.
- [ ] T009 [US1] Drive placement adaptively in `components/ListPageLayout.tsx`
  from `useDetailDock` + the per-page override: render `'side'` (full-height
  bounded side panel), `'bottom'` (dock), or `'split'` (Inbox detail-dominant).
  Add an optional page-level **`forcedPlacement?: 'bottom'|'side'|'split'`**
  prop; precedence = **page forcedPlacement > user pin > adaptive**; the hook is
  `useDetailDock(page, pageRef, forcedPlacement?)` and returns `forcedPlacement`
  directly when set (research D6). Inbox expresses its split via
  `forcedPlacement='split'` — NOT a hook special-case; a bottom-only page passes
  `forcedPlacement='bottom'`. **Delete the dead `'side-and-bottom'` dual path**
  (`--dual`/`__panel-*` in `merges-3.css` + the component branch) — no page uses
  it and Projects unifies away from it (FR-004, D5, D6, plan.md risk note).
- [ ] T010 [US1] Drag-resize handle for the side panel / split in
  `ListPageLayout` + `styles/components/merges-2.css`: pointer-drag within
  `[320px, 50% window]`; persist width via `setDetailDockWidth` on release;
  restore clamped width on mount (FR-005). Handle is keyboard-focusable and
  ARIA-labelled but imposes no focus trap (FR-013).
- [ ] T011 [US1] Migrate `features/targets/TargetDetailV2.tsx` to render through
  the shared `DetailPanel` (title/subtitle/actions/facts/children/aux), removing
  its hand-rolled `.alm-planner__*` header/columns wrapper; keep the altitude
  graph + tonight panel as `children`/`aux` content. Update
  `TargetDetailV2.test.tsx` (FR-010, D5).
- [ ] T012 [US1] Migrate `features/archive/ArchiveDetail` from raw
  `DetailPane`+`DetailHeader` to the shared `DetailPanel` (data-only fill), so
  Archive is inside the container-containment guarantee like the others
  (D5, owner "completely shared" mandate).
- [ ] T012a [US1] **Shared-component guard** (owner mandate): add an automated
  check that EVERY list page's detail renders through the shared `DetailPanel`
  and every list page's layout through the shared `ListPageLayout` — no bespoke
  panel/layout markup survives. Prefer a Vitest assertion that renders each page
  and asserts a `DetailPanel` marker (e.g. a stable `data-shared-detail`
  attribute or the `.alm-detailpanel` root) is present, plus a static guard
  script (in the `scripts/css-dup-sniff.mjs` spirit) that greps for direct
  `DetailPane`/hand-rolled `.alm-planner__header` panel usage outside
  `DetailPanel.tsx` and fails if any list page reintroduces one. Wire it into
  the lint/test gate so regressions are caught in CI.

**Checkpoint**: #816 repro passes in every placement; the shared mechanism +
persistence + resize exist; no page owns bespoke panel markup (T012a guard is
green); dead dual path gone. Merge the foundation before starting the fan-out.

---

## Phase 3: User Story 2 — Adaptive side dock on the list-dominant pages (P1)

**Goal**: Sessions, Calibration, Archive, Targets dock side when wide / bottom
when narrow; Projects unifies onto the same mechanism and gains the narrow
fallback.
**Independent Test**: spec US2 Independent Test. **Depends on US1.** Pages are
independent files → parallelisable.

- [ ] T013 [P] [US2] `features/sessions/SessionsPage.tsx`: pass the `'sessions'`
  page key so `ListPageLayout` drives adaptive placement; verify data-only fill
  (no bespoke wrapper) (FR-004).
- [ ] T014 [P] [US2] `features/calibration/CalibrationPage.tsx`: same, key
  `'calibration'`; keep `MasterDetail` content (FR-004).
- [ ] T015 [P] [US2] `features/archive/ArchivePage.tsx`: same, key `'archive'`
  (detail already migrated in T012) (FR-004).
- [ ] T016 [P] [US2] `features/targets/TargetsPage.tsx`: same, key `'targets'`,
  threshold 1500px; detail already migrated in T011 (FR-002/FR-004).
- [ ] T017 [US2] `features/projects/ProjectsPage.tsx`: **unify** — drop the
  bespoke `alm-project-detail-stack` (`ProjectDetailContent` +
  `ProjectBottomDetail`) and fill the single shared `DetailPanel`; key
  `'projects'`. Verify full usability at 1100×720 in bottom mode (FR-004,
  SC-006).

**Checkpoint**: SC-001 (deterministic flip), SC-006 (Projects usable at
minimum) met; all five list-dominant pages share one mechanism.

---

## Phase 4: User Story 3 — Inbox detail-dominant permanent split (P1)

**Goal**: Inbox = narrow list left (~360px) / full-height detail right at every
width; never a bottom dock; file list scrolls within the pane.
**Independent Test**: spec US3 Independent Test. **Depends on US1; builds ON TOP
of PR #939** (do not redo #939's inbox detail scroll/mixed-split work).

- [ ] T018 [US3] `features/inbox/InboxPage.tsx`: render the permanent
  detail-dominant split (`'split'` shape, key `'inbox'`) — item list left,
  detail right — at every width, no bottom mode, no adaptive flip; resizable +
  persisted width like the other pages (FR-014). Reconcile with #939's current
  `InboxDetail` structure.
- [ ] T019 [US3] `features/inbox/InboxList.tsx`: narrowed presentation that
  works at ~360px — name column truncates with a full-name tooltip; show only
  essential status columns (replace the overly-wide name layout) (FR-015,
  SC-008).
- [ ] T020 [P] [US3] Component/unit test: Inbox renders list-left/detail-right
  at both 1100×720 and a wide window (never a bottom dock); at ~360px the item
  name truncates with a tooltip (FR-014/FR-015, SC-008).

**Checkpoint**: #553 repro passes (full file list reachable in the right pane);
SC-008 geometry (list ~360 + detail ~540 at minimum) met.

---

## Phase 5: User Story 4 — Per-page pin + persisted resize (P2)

**Goal**: A per-page pin (side/bottom) and a dragged width survive restart.
**Independent Test**: spec US4 Independent Test. **Depends on US1 (store +
resize) and US2 (side dock exists to pin).**

- [ ] T021 [US4] Surface the per-page placement control as an **easy
  auto/bottom/right toggle in the app configuration** (owner mandate): a
  first-class Settings control (per adopting page, or a clear per-page section)
  offering **Auto / Bottom / Right** — plus the same one shared control in the
  page top bar / detail header (not per-page clones). Both write
  `setDetailDockMode` (`'adaptive'`→Auto, `'bottom'`→Bottom, `'side'`→Right)
  (FR-003, data-model.md). Labels use "Right" (not "Side") per owner wording.
- [ ] T022 [US4] Enforce the pin→bottom safety fallback in the resolver path: a
  pinned `'side'` on a window too narrow for min-side + a usable table renders
  bottom instead of an unusable squeeze (FR-003 last clause, spec US4 scenario 4).
- [ ] T023 [P] [US4] Component test: pin Sessions→bottom on a wide window and
  Targets→side; drag Targets width; reload the store (simulate restart) ⇒ both
  pins and the width restore exactly, width clamped only if the window shrank
  (SC-002, spec US4 scenarios 1–3).

**Checkpoint**: SC-002 met across adopting pages.

---

## Phase 6: User Story 5 — Targets table readable beside the side dock (P2)

**Goal**: Pinned star + designation, permanent importance column order,
horizontal scroll of non-pinned columns only when space is insufficient; no
h-scrollbar at full width.
**Independent Test**: spec US5 Independent Test. **Depends on US1 + US2 (Targets
side dock).**

- [ ] T024 [US5] Targets table: pin the favorite-star + designation columns on
  the left (sticky), and enforce the permanent importance column order — star,
  designation, imaging time, opposition, type, filters, max alt, lunar dist,
  sessions — independent of placement (FR-006).
- [ ] T025 [US5] Conditional horizontal scroll: non-pinned columns scroll
  horizontally only when available width is below the column floor (e.g. beside
  the side dock); at full width no h-scrollbar and no clipped cells. Never
  auto-hide columns (FR-007/FR-008).
- [ ] T026 [P] [US5] E2E: keep `tests/e2e/targets_planner.spec.ts:531,536`
  (opposition + imaging-time `scrollWidth <= clientWidth` at 1100×720) passing
  unchanged; add an assertion that beside a side dock at 1500px the star +
  designation stay visible while the non-pinned region scrolls, and that
  h-scroll is absent at full width (SC-004, FR-007).

**Checkpoint**: SC-004 met; the existing full-width pin still green.

---

## Phase 7: User Story 6 — Placement-neutral keyboard flow (P3)

**Goal**: Arrow-key selection-follow and Escape-close behave identically in
every placement (side/bottom/split).
**Independent Test**: spec US6 Independent Test. **Depends on US2/US3.**

- [ ] T027 [US6] Verify/route the existing J16 arrow-follow + Escape-close
  through the shared layout so they are placement-neutral (no per-placement
  branch); the side dock and Inbox split are inline complementary regions with
  no focus trap and no overlay semantics (FR-012/FR-013).
- [ ] T028 [P] [US6] E2E: in side dock, bottom dock, and the Inbox split, arrow
  keys move the selection with the detail following, and Escape (no overlay
  open) closes/returns focus — overlay dismissal still wins while an overlay is
  open (#771/#906) (SC-005, spec US6 scenarios + edge case).

**Checkpoint**: SC-005 met (J16 S3/S4 identical in every placement).

---

## Phase 8: Validation — CI assertions (FR-016) + journey deltas (FR-017)

**Goal**: Every shipped behaviour has a mock-mode Playwright assertion running
in CI and a journey-catalog delta. **Depends on the shipped stories.**

- [ ] T029 [US-all] New `tests/e2e/adaptive_detail_dock.spec.ts` (mock mode, in
  the GitHub CI job) asserting the FR-016 set: side dock engages at threshold /
  disengages below (viewport resize; Targets at 1500); a per-page pin persists
  across a harness restart; dragging the handle changes + persists width; Inbox
  renders the permanent split (list ~360 left / full-height detail right, never
  bottom) at every tested width (FR-016, SC-009).
- [ ] T030 [US-all] Migrate the existing `.alm-listpage__detail` pins
  deliberately: keep `calibration_masters_matching.spec.ts:157`; move
  `inbox_ingest_confirm.spec.ts:69/135/183` to the detail-dominant split
  semantics (FR-014) with an in-diff rationale comment; never silent-delete
  (FR-016, SC-009).
- [ ] T031 [P] [US-all] Journey deltas in `docs/journeys/` (intent-gated, stable
  step ids): `J16` placement-neutral arrow-follow + Escape (S3/S4);
  `J02`+`J03` Inbox permanent split; `J09` Targets side dock + pinned columns +
  conditional h-scroll; `J04`+`J08` adaptive dock on Sessions/Calibration;
  `J05`+`J07` Projects unification + Archive dock change (FR-017, SC-010).
- [ ] T032 [US-all] `verify-on-windows` scenario + a tauri-driver Layer-2
  journey for the placement flip, resize, and Inbox split geometry (visual
  behaviour not fully provable from Linux unit tests); update the coverage
  matrix so manual + automated verification stay in sync.

---

## Phase 9: Polish & Verification

- [ ] T033 Constitution re-check against the built feature (no filesystem/image
  work; no contract change; preference state outside the durable record) — PASS
  per plan.md §Constitution Check.
- [ ] T034 Full local gates: `pnpm typecheck`, `pnpm build`, `pnpm vitest run`,
  `pnpm format:check`, `just check-generated` (must stay clean — no bindings
  changed), and the e2e suite green (including the kept/migrated pins).
- [ ] T035 `speckit-verify` (requirements) + `speckit-verify-tasks` (phantom-
  completion guard) — cross-check FR-001..FR-017 / SC-001..SC-010 against real
  implementation evidence before declaring the spec closed.

---

## Dependencies

- **Phase 1 (T001)** → baseline.
- **Phase 2 / US1 (T002–T012)** is the blocking foundation for everything; a
  single sequential lane. Merge before the fan-out.
- **US2 (T013–T017)** depends on US1. Pages are parallel `[P]` except Projects
  unification (T017) which restructures its own file.
- **US3 (T018–T020)** depends on US1; builds on PR #939.
- **US4 (T021–T023)** depends on US1 (store/resize) + US2 (a side dock to pin).
- **US5 (T024–T026)** depends on US1 + US2 (Targets side dock).
- **US6 (T027–T028)** depends on US2/US3.
- **Phase 8 (T029–T032)** depends on the shipped stories it asserts.
- **Phase 9 (T033–T035)** depends on all.

### Dependency graph

```
T001 ─▶ US1(T002–T012) ─┬─▶ US2(T013–T017) ─┬─▶ US4(T021–T023)
                        │                    ├─▶ US5(T024–T026)
                        ├─▶ US3(T018–T020) ──┤
                        │                    └─▶ US6(T027–T028)
                        └────────────────────────────────────▶ Phase 8(T029–T032) ─▶ Phase 9(T033–T035)
```

## Execution model (owner directive)

**One coding agent at a time (session-limit-safe).** Despite the `[P]` markers,
this feature is executed by a **single** coding lane, phase by phase, not a
parallel fleet. The orchestrator (main session) spawns one coder per phase in
its own worktree, reviews the pushed branch, merges, then spawns the next. The
`[P]` markers therefore indicate tasks that are *independent in principle*
(safe to reorder within a phase), not a licence to run concurrent agents. The
dependency graph still governs phase order.

## Parallelization notes

- **US1 is a single sequential node** — the shared mechanism; its tasks touch
  `ListPageLayout`/`DetailPanel`/`preferences.ts` and must be done in one lane.
- US2–US6 run as **successive single lanes** off the merged US1 foundation
  (not concurrently). Within a lane, `[P]` tasks may be reordered freely.
- `[P]` test tasks are independent of each other within a phase.
- Journey deltas (T031) reflect the shipped behaviour and are authored with the
  e2e work in the same validation lane.
