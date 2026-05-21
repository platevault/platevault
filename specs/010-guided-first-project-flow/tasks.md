# Tasks: Guided First Project Flow

**Feature**: 010-guided-first-project-flow
**Status**: Draft (planning only)
**Convention**: `[P]` marks a task that can run in parallel with peers in the
same story. Tasks are grouped by user story priority so each story is
independently testable.

## Phase 0 - Shared Foundations

These must land before any user-story tasks begin.

- **T001** Add `guided_flow` module skeleton under `crates/app/core/` with
  state machine types and an event-bus subscription port (no transitions yet).
- **T002** [P] Add Rust DTOs under `crates/contracts/core/guided/` matching the
  three JSON Schemas in `contracts/`.
- **T003** [P] Add migration for `guided_flow_state` singleton row table in
  `crates/persistence/db`.
- **T004** [P] Define `data-guide-anchor` constants module in
  `apps/desktop/src/features/guided/anchors.ts` (no UI usage yet).
- **T005** Wire `guided.state.get`, `guided.step.complete`, `guided.dismiss`
  command handlers in `apps/desktop/src-tauri` as thin passthroughs to the
  `guided_flow` use case.

## Phase 1 - US1: First Inventory Confirm (P1)

Goal: a new user can complete the first Inbox → Inventory confirmation guided
by an overlay hint.

- **T010** Implement `GuidedFlowStep` registry with the `inbox.confirm_first`
  entry only.
- **T011** Implement state machine transitions for
  `setup_completed → Active(inbox.confirm_first)` and
  `inventory.confirmed → completed/Completed`.
- **T012** [P] Subscribe `guided_flow` to the `InventoryConfirmed` lifecycle
  event and translate to the completion transition.
- **T013** [P] Add overlay renderer in `apps/desktop/src/features/guided/` that
  resolves anchors by attribute and renders a single hint at a time.
- **T014** Anchor the Inbox confirm control with the `inbox.confirm-row`
  attribute (UI only; no logic change).
- **T015** [P] Add integration test in `tests/` that exercises spec 003
  setup completion followed by an `InventoryConfirmed` event and asserts the
  state row reflects step P1 complete.
- **T016** Add acceptance scenario coverage for FR-007 (anchor absent) by
  navigating away mid-step in a UI test.

## Phase 2 - US2: First Project Create (P2)

Goal: with at least one confirmed inventory item, the coach guides the user to
the Create project control and advances on `ProjectCreated`.

- **T020** Extend registry with `project.create_first`.
- **T021** Implement transition for `project.created` completion event.
- **T022** [P] Subscribe `guided_flow` to the `ProjectCreated` lifecycle event.
- **T023** Anchor the Create project control with the
  `projects.create-cta` attribute.
- **T024** [P] Add integration test asserting P2 advances only after a real
  `project.created` event, never on click.
- **T025** Add UI test for the "deferred hint" route-pointer behavior when the
  user is on `/inbox` but the active step is `project.create_first`.

## Phase 3 - US3: First Tool Open (P3)

Goal: after the first project exists, the coach guides the user to open it in
the configured processing tool and advances on `ToolOpened`.

- **T030** Extend registry with `tool.open_first`.
- **T031** Implement transition for `tool.opened` completion event and the
  terminal transition to `Completed`.
- **T032** [P] Subscribe `guided_flow` to the `ToolOpened` lifecycle event.
- **T033** Anchor the open-in-tool control with the
  `project.open-in-tool` attribute.
- **T034** [P] Add integration test for the full P1 → P2 → P3 sequence ending
  in `Completed` state.
- **T035** Add UI test confirming the non-blocking completion hint appears
  exactly once and disappears on dismiss or navigation.

## Phase 4 - US4: Dismiss And Restart (P4)

Goal: the coach can be dismissed and restarted without losing progress.

- **T040** Implement `dismiss` transition writing `dismissed_at` and clearing
  `current_step`.
- **T041** Implement `restart` action in Settings that resumes at the lowest
  uncompleted step and clears `dismissed_at`.
- **T042** [P] Add Settings UI entry "Restart guided flow" that invokes
  restart and is gated to disabled when the flow is `Completed`.
- **T043** [P] Add integration test: dismiss mid-P2, fire `project.created`,
  restart, confirm the coach resumes at P3.
- **T044** Add a11y test asserting Escape on a focused hint dismisses the
  coach and that overlay hints announce via `aria-live=polite`.

## Phase 5 - Closeout

- **T050** Verify artifact consistency across `spec.md`, `plan.md`,
  `research.md`, `data-model.md`, `contracts/`, and this file per
  `.claude/rules/76-astro-specs.md`.
- **T051** Re-run constitution check after design and before implementation
  approval.
