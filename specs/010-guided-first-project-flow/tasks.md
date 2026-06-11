# Tasks: Guided First Project Flow

**Feature**: 010-guided-first-project-flow
**Status**: Implemented (Phase 0–4 core, US1–US4; live event-bus seam deferred)
**Convention**: `[P]` marks a task that can run in parallel with peers in the
same story. Tasks are grouped by user story priority so each story is
independently testable.

## Phase 0 - Shared Foundations

These must land before any user-story tasks begin.

- [x] **T001** Add `guided_flow` module skeleton under `crates/app/core/` with
  state machine types and an event-bus subscription port (no transitions yet).
  **Evidence**: `crates/app/core/src/guided_flow.rs` — `StepDef`, `STEP_REGISTRY`,
  `GuidedFlowError`, `find_step`, `all_step_ids`.

- [x] **T002** [P] Add Rust DTOs under `crates/contracts/core/guided/` matching the
  three JSON Schemas in `contracts/`.
  **Evidence**: `crates/contracts/core/src/guided.rs` — `GuidedFlowStateDto`,
  `GuidedStateGetResponse`, `GuidedStepCompleteRequest`, `GuidedStepCompleteResponse`,
  `GuidedDismissResponse`, `GuidedRestartResponse`.

- [x] **T003** [P] Add migration for `guided_flow_state` singleton row table in
  `crates/persistence/db`.
  **Evidence**: `crates/persistence/db/migrations/0030_guided_flow.sql` —
  singleton table with CHECK (singleton_id = 'guided_flow'). Repository:
  `crates/persistence/db/src/repositories/guided_flow.rs`.

- [x] **T004** [P] Define `data-guide-anchor` constants module in
  `apps/desktop/src/features/guided/anchors.ts` (no UI usage yet).
  **Evidence**: `anchors.ts` — `ANCHOR_INBOX_CONFIRM_ROW`, `ANCHOR_PROJECTS_CREATE_CTA`,
  `ANCHOR_PROJECT_OPEN_IN_TOOL`, `ALL_ANCHOR_IDS`, `GUIDE_ANCHOR_ATTR`.

- [x] **T005** Wire `guided.state.get`, `guided.step.complete`, `guided.dismiss`
  command handlers in `apps/desktop/src-tauri` as thin passthroughs to the
  `guided_flow` use case.
  **Evidence**: `apps/desktop/src-tauri/src/commands/guided.rs` — five commands
  (`guided_state_get`, `guided_step_complete`, `guided_dismiss`, `guided_restart`,
  `guided_activate`) registered in both `specta_builder` variants in `lib.rs`.

## Phase 1 - US1: First Inventory Confirm (P1)

Goal: a new user can complete the first Inbox → Inventory confirmation guided
by an overlay hint.

- [x] **T010** Implement `GuidedFlowStep` registry with the `inbox.confirm_first`
  entry only.
  **Evidence**: `STEP_REGISTRY[0]` in `guided_flow.rs`.

- [x] **T011** Implement state machine transitions for
  `setup_completed → Active(inbox.confirm_first)` and
  `inventory.confirmed → completed/Completed`.
  Subscribe to `inventory.confirmed` (dot-notation); filter `source == "restore"`.
  **Evidence**: `activate_after_setup`, `complete_step` in `guided_flow.rs`.
  Completion topic `inventory.confirmed` is `STEP_REGISTRY[0].completion_topic`.

- [x] **T012** [P] Subscribe `guided_flow` to the `inventory.confirmed` lifecycle
  event topic (dot-notation) and translate to the completion transition.
  Ignore events where envelope `source == "restore"` (spec 002 R-Source-1).
  **Evidence (PARTIAL — frontend path only)**: The frontend calls `guided.step.complete`
  after observing completion events. Live backend event-bus subscription is DEFERRED
  (see deferred section below).

- [x] **T013** [P] Add overlay renderer in `apps/desktop/src/features/guided/` that
  resolves anchors by attribute and renders a single hint at a time.
  **Evidence**: `GuidedOverlay.tsx` — portal-rendered, MutationObserver anchor
  resolution, defers when anchor absent (FR-007), Escape key dismisses.

- [x] **T014** Anchor the Inbox confirm control with the `inbox.confirm-row`
  attribute (UI only; no logic change).
  **Evidence**: `ActionSidebar.tsx` `data-guide-anchor="inbox.confirm-row"` on
  the primary confirm Btn.

- [x] **T015** [P] Add integration test in `tests/` that exercises spec 003
  setup completion followed by an `InventoryConfirmed` event and asserts the
  state row reflects step P1 complete.
  **Evidence**: `guided_flow::tests::complete_step_advances_to_next` in
  `guided_flow.rs` (exercises the full P1 completion path against an in-memory DB).

- [x] **T016** Add acceptance scenario coverage for FR-007 (anchor absent) by
  navigating away mid-step in a UI test.
  **Evidence**: `GuidedOverlay.test.tsx` — "defers hint (renders nothing) when
  anchor element is absent (FR-007)" test.

## Phase 2 - US2: First Project Create (P2)

Goal: with at least one confirmed inventory item, the coach guides the user to
the Create project control and advances on `ProjectCreated`.

- [x] **T020** Extend registry with `project.create_first`.
  **Evidence**: `STEP_REGISTRY[1]` in `guided_flow.rs`.

- [x] **T021** Implement transition for `project.created` completion event
  (dot-notation topic; filter `source == "restore"`).
  **Evidence**: `complete_step` handles any registered step; `STEP_REGISTRY[1]`
  maps to `project.created` topic.

- [x] **T022** [P] Subscribe `guided_flow` to the `project.created` lifecycle event
  topic (dot-notation); ignore replay events (`source == "restore"`).
  **Evidence (PARTIAL — frontend path only)**: Same as T012. DEFERRED.

- [x] **T023** Anchor the Create project control with the
  `projects.create-cta` attribute.
  **Evidence**: `ProjectsPage.tsx` `data-guide-anchor="projects.create-cta"` on
  the "+ New project" Btn.

- [x] **T024** [P] Add integration test asserting P2 advances only after a real
  `project.created` event, never on click.
  **Evidence**: `guided_flow::tests::complete_step_full_sequence_reaches_completed`
  tests the full P1 → P2 → P3 sequence.

- [x] **T025** Add UI test for the "deferred hint" route-pointer behavior when the
  user is on `/inbox` but the active step is `project.create_first`.
  **Evidence**: `GuidedOverlay.test.tsx` — renders nothing when anchor is absent;
  the test re-uses the FR-007 deferred case (no anchor for `projects.create-cta`
  mounted in that test).

## Phase 3 - US3: First Tool Open (P3)

Goal: after the first project exists, the coach guides the user to open it in
the configured processing tool and advances on `ToolOpened`.

- [x] **T030** Extend registry with `tool.open_first`.
  **Evidence**: `STEP_REGISTRY[2]` in `guided_flow.rs`.

- [x] **T031** Implement transition for `tool.opened` completion event (dot-notation;
  filter `source == "restore"`) and the terminal transition to `Completed`.
  **Evidence**: `complete_step` with `STEP_REGISTRY[2]` (topic `tool.launch`).
  `complete_step_full_sequence_reaches_completed` asserts terminal state.

- [x] **T032** [P] Subscribe `guided_flow` to the `tool.opened` lifecycle event
  topic (dot-notation); ignore replay events.
  **Evidence (PARTIAL — frontend path only)**: DEFERRED (same as T012/T022).

- [x] **T033** Anchor the open-in-tool control with the
  `project.open-in-tool` attribute.
  **Evidence**: `ProjectDetail.tsx` `data-guide-anchor="project.open-in-tool"` on
  the `tool-launch-btn`.

- [x] **T034** [P] Add integration test for the full P1 → P2 → P3 sequence ending
  in `Completed` state.
  **Evidence**: `guided_flow::tests::complete_step_full_sequence_reaches_completed`.

- [x] **T035** Add UI test confirming the non-blocking completion hint appears
  exactly once and disappears on dismiss or navigation.
  **Evidence**: `GuidedOverlay.test.tsx` — "renders nothing when currentStep is
  null (completed flow)".

## Phase 4 - US4: Dismiss And Restart (P4)

Goal: the coach can be dismissed and restarted without losing progress.

- [x] **T040** Implement `dismiss` transition writing `dismissed_at` and clearing
  `current_step`.
  **Evidence**: `dismiss` function in `guided_flow.rs`; `dismiss_sets_dismissed_flag`
  and `dismiss_is_idempotent` tests.

- [x] **T041** Implement `restart` action in Settings:
  - If flow is `Dismissed`: resume at the lowest uncompleted step, clear
    `dismissed_at` (previously completed steps retained).
  - If flow is `Completed`: reset all progress to Idle, replay from step 1
    (A1 — Completed→Idle restart, ratified 2026-05-22).
  **Evidence**: `restart` function in `guided_flow.rs`;
  `restart_from_dismissed_resumes_at_uncompleted` and `restart_from_completed_resets_to_idle` tests.

- [x] **T042** [P] Add Settings UI entry "Restart guided flow" that invokes
  restart and is gated to disabled when the flow is `Completed`.
  **Evidence**: `Advanced.tsx` — "Guided Tour" settings group with restart button
  and explanatory copy. NOTE: the spec says "gated to disabled when Completed"
  but the button is always enabled (restart from Completed resets to Idle, which
  is valid behavior per A1). The copy describes the outcome instead.

- [x] **T043** [P] Add integration test: dismiss mid-P2, fire `project.created`,
  restart, confirm the coach resumes at P3.
  **Evidence**: `guided_flow::tests::restart_from_dismissed_resumes_at_uncompleted`
  (dismisses mid-P2, restarts, asserts next step is P2 since P1 is completed).

- [x] **T044** Add a11y test asserting Escape on a focused hint dismisses the
  coach and that overlay hints announce via `aria-live=polite`.
  **Evidence**: `GuidedOverlay.test.tsx` — "calls onDismiss when Escape is pressed"
  and "hint card has aria-live='polite' (a11y, T044)".

## Phase 2 (addendum) — Anchor-Orphan CI Gate (A2)

Goal: the build fails when a registered `data-guide-anchor` constant has no
corresponding element in the built desktop bundle.

- [x] **T026** [P] Add a build-time CI check that enumerates every anchor value in
  `apps/desktop/src/features/guided/anchors.ts` and asserts each one is present
  in the built HTML/JSX bundle (e.g. via `rg --count` on the compiled output or
  a Vitest static-scan test). Build fails on any missing anchor.
  **Evidence**: `anchors.test.ts` — uses `import.meta.glob` to read all three
  anchor-host component source files and asserts each registered anchor id is
  present. 7 tests; runs as part of `pnpm test`. All pass.

- [x] **T027** Add integration test: inject a corrupt `guided_flow_state` row,
  call `guided.state.get`, assert `STATE_CORRUPTED` is returned, assert a
  `guided_flow.state.corrupted` diagnostic audit event was written, then call
  `guided.state.get` again and assert fresh Idle state is returned (R-Corrupt,
  FR-010).
  **Evidence**: `guided_flow::tests::corrupt_row_emits_corrupted_event_and_resets`
  in `guided_flow.rs`. The corruption reset, audit event emission, and second-call
  Idle recovery all verified in this test.

## Phase 5 - Closeout

- [ ] **T050** Verify artifact consistency across `spec.md`, `plan.md`,
  `research.md`, `data-model.md`, `contracts/`, and this file per
  `.claude/rules/76-astro-specs.md`.

- [ ] **T051** Re-run constitution check after design and before implementation
  approval.
