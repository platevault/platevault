---
description: "Task list for First-Run Source Setup (spec 003)"
---

# Tasks: First-Run Source Setup

**Input**: Design documents from `/specs/003-first-run-source-setup/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/source.register.json`, `contracts/firstrun.complete.json`

**Tests**: Tests are included because spec acceptance scenarios are
testable end-to-end and the contract surface needs schema conformance
coverage.

**Organization**: Tasks are grouped by user story so each can be
implemented and validated independently. Mockup-only tasks already wired
in `apps/desktop/src/features/welcome/WelcomePage.tsx` are marked
`[mockup ✓, needs Tauri impl]`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Add `@tauri-apps/plugin-dialog` to `apps/desktop/package.json` and
      the corresponding Rust capability entry under
      `apps/desktop/src-tauri/capabilities/`.
- [ ] T002 [P] Add JSON Schema validator dev dependency (Ajv 2020 or
      equivalent) and a contract-test harness under `tests/contract/`.
- [ ] T003 [P] Wire the JSON Schemas in `specs/003-first-run-source-setup/contracts/`
      into the contracts index in `packages/contracts/` so generated TS
      types are produced.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 Define `RegisteredSource` and `FirstRunState` schema and
      migration in `crates/persistence/db/migrations/` per
      `data-model.md`.
- [ ] T005 [P] Add Rust DTOs mirroring the JSON contracts in
      `crates/contracts/core/src/first_run.rs`.
- [ ] T006 [P] Implement repository methods
      `register_source`, `list_sources`, `remove_source`,
      `get_first_run_state`, `set_first_run_state`, and
      `complete_first_run` in `crates/persistence/db/src/first_run.rs`.
- [ ] T007 Implement the `register_source` and `complete_first_run` use
      cases in `crates/app/core/src/first_run.rs`, including path
      validation (exists, is_dir, readable) and error mapping to the
      contract's error enum.
- [ ] T008 Expose Tauri commands `source_register` and `firstrun_complete`
      in `apps/desktop/src-tauri/src/commands/firstrun.rs`, delegating to
      `crates/app/core/`.

**Checkpoint**: Domain + persistence + contract surface are live; user
stories can begin.

---

## Phase 3: User Story 1 — Land On The Wizard On First Launch (P1) MVP

**Goal**: Index route correctly gates between `/welcome` and `/inventory`
based on durable first-run state.

**Independent Test**: With the DB reset, open the app and confirm the
gate sends the user to `/welcome`. Complete the wizard and confirm the
gate sends to `/inventory` on next launch.

### Tests for User Story 1

- [ ] T009 [P] [US1] Integration test for the gate behavior in
      `tests/integration/first_run_gate.spec.ts` (Playwright MCP).

### Implementation for User Story 1

- [ ] T010 [US1] [mockup ✓, needs Tauri impl] `apps/desktop/src/app/router.tsx`:
      replace the synchronous `localStorage` read with a DB-backed
      lookup via `firstrun_state` Tauri command, falling back to the
      cached `alm.first-run.completed` flag for optimistic render
      (research §6).
- [ ] T011 [US1] [mockup ✓] Confirm the `/welcome` route stays outside
      the main navigation chrome and the index route uses `<Navigate
      replace />` to avoid history pollution.
- [ ] T012 [US1] Stepper and step counter copy in
      `apps/desktop/src/features/welcome/WelcomePage.tsx` already render
      `Step N of M`; verify against Playwright snapshot.

**Checkpoint**: First-launch gating is durable and tested end-to-end.

---

## Phase 4: User Story 2 — Register Source Roots By Category (P2)

**Goal**: User can add, remove, and finalize source roots across the
four categories with native picker + durable DB writes.

**Independent Test**: Walk the wizard end-to-end against a fresh DB.
Confirm Raw blocks advance when empty, the other three advance freely,
and Finish writes `RegisteredSource` rows plus `FirstRunState.completed_at`.

### Tests for User Story 2

- [ ] T013 [P] [US2] Contract conformance test for
      `contracts/source.register.json` in
      `tests/contract/source_register_test.rs`.
- [ ] T014 [P] [US2] Contract conformance test for
      `contracts/firstrun.complete.json` in
      `tests/contract/firstrun_complete_test.rs`.
- [ ] T015 [P] [US2] Component test for the wizard's Raw-required gating
      and category copy in
      `apps/desktop/src/features/welcome/WelcomePage.test.tsx`.
- [ ] T016 [P] [US2] Playwright end-to-end test for the full wizard
      happy path in `tests/integration/first_run_happy_path.spec.ts`.

### Implementation for User Story 2

- [ ] T017 [US2] [mockup ✓, needs Tauri impl] Extract `pickFolderStub`
      into `apps/desktop/src/features/welcome/picker.ts` and replace
      with a call to `@tauri-apps/plugin-dialog` `open({ directory:
      true, multiple: false })`. Preserve the stub behind a build flag
      for non-Tauri test runs.
- [ ] T018 [US2] [mockup ✓, needs Tauri impl] Add
      `apps/desktop/src/features/welcome/sources-store.ts` to centralize
      the `localStorage` buffer and the DB-promotion flow. WelcomePage
      should call into the store, not write `localStorage` directly.
- [ ] T019 [US2] Wire the wizard's "Add source" action to invoke
      `source_register` via Tauri and render the contract's error set
      (`path.not.exists`, `path.not.directory`,
      `path.permission.denied`, `path.already.registered`) inline next
      to the offending row.
- [ ] T020 [US2] [mockup ✓, needs Tauri impl] On Finish, iterate the
      working buffer and invoke `firstrun_complete`. On
      `required.step.incomplete`, return the user to the Raw step with a
      banner. On `wizard.not.in.progress`, treat the wizard as already
      complete and redirect.
- [ ] T021 [US2] Replace the direct `navigate({ to: "/inventory" })`
      call with a successful-completion handler that also clears the
      `localStorage` buffer.

**Checkpoint**: Wizard performs durable writes and surfaces contract
errors.

---

## Phase 5: User Story 3 — Restart Setup From Settings (P3)

**Goal**: Settings provides an obvious restart entry, and restart uses
the prefill behavior chosen in research §5.

**Independent Test**: Complete setup, restart from Settings, confirm the
wizard opens at Welcome with previously registered sources prefilled
into the working buffer.

### Tests for User Story 3

- [ ] T022 [P] [US3] Playwright test for the restart flow in
      `tests/integration/first_run_restart.spec.ts`, asserting prefilled
      sources and a cleared completion flag.

### Implementation for User Story 3

- [ ] T023 [US3] [mockup ✓, needs Tauri impl] Update
      `apps/desktop/src/features/settings/SettingsPage.tsx`: instead of
      removing `alm.first-run.sources`, only clear the completion flag
      (both DB and `localStorage`) and hydrate the wizard's working
      buffer from `RegisteredSource` rows via a new
      `firstrun_restart` Tauri command (research §5, prefill default).
- [ ] T024 [US3] Add `firstrun_restart` use case in
      `crates/app/core/src/first_run.rs` that clears
      `FirstRunState.completed_at`, snapshots `RegisteredSource` rows
      into `FirstRunState.sources_buffer`, and updates `updated_at`.
- [ ] T025 [US3] Add a confirm-before-restart dialog so users do not
      lose the completion flag accidentally.

**Checkpoint**: Restart is durable, non-destructive, and discoverable.

---

## Phase 6: User Story 4 — Understand Each Source Category (P4)

**Goal**: Each step explains its category, gives concrete example paths,
and signals whether the step is required.

**Independent Test**: Open each step and verify the rendered copy
matches the spec's acceptance scenarios (US4-1 through US4-4).

### Implementation for User Story 4

- [ ] T026 [US4] [mockup ✓] Audit the `STEPS` copy in
      `WelcomePage.tsx` against the spec's US4 acceptance scenarios.
      Mockup copy is close but does not yet include example paths
      (research §2).
- [ ] T027 [US4] Add an optional "Show example paths" affordance per
      source step that reveals 2-3 example paths in the surrounding
      copy without forcing them on every viewer.
- [ ] T028 [US4] Add a "Required" / "Optional" badge per step header so
      gating is visible before the user clicks Next.

**Checkpoint**: All four stories are independently functional and
discoverable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Update `docs/research/` with a short note linking back to
      `specs/003-first-run-source-setup/research.md` for future reference.
- [ ] T030 [P] Add an audit event `first_run.completed` emitted by
      `firstrun_complete` and routed through `crates/audit/`.
- [ ] T031 Run `just lint`, `just typecheck`, `just test`, and verify
      Playwright MCP coverage of the gate, happy path, and restart.
- [ ] T032 Resolve all `[NEEDS DECISION]` markers in `spec.md` before
      this feature exits Draft status.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = [] }

T004 = { blocked_by = ["T001"] }
T005 = { blocked_by = ["T003"] }
T006 = { blocked_by = ["T004"] }
T007 = { blocked_by = ["T005", "T006"] }
T008 = { blocked_by = ["T007"] }

T009 = { blocked_by = ["T008"] }
T010 = { blocked_by = ["T008"] }
T011 = { blocked_by = ["T010"] }
T012 = { blocked_by = ["T010"] }

T013 = { blocked_by = ["T003"] }
T014 = { blocked_by = ["T003"] }
T015 = { blocked_by = ["T008"] }
T016 = { blocked_by = ["T020", "T021"] }
T017 = { blocked_by = ["T001"] }
T018 = { blocked_by = ["T008"] }
T019 = { blocked_by = ["T018"] }
T020 = { blocked_by = ["T018"] }
T021 = { blocked_by = ["T020"] }

T022 = { blocked_by = ["T023", "T024"] }
T023 = { blocked_by = ["T024"] }
T024 = { blocked_by = ["T007"] }
T025 = { blocked_by = ["T023"] }

T026 = { blocked_by = [] }
T027 = { blocked_by = ["T026"] }
T028 = { blocked_by = ["T026"] }

T029 = { blocked_by = [] }
T030 = { blocked_by = ["T008"] }
T031 = { blocked_by = ["T021", "T023", "T028"] }
T032 = { blocked_by = ["T031"] }
```

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1. Blocks all user
  stories that require Tauri command or DB access.
- **User Stories (Phase 3+)**: Depend on Phase 2 except for US4 copy
  tasks (T026–T028), which can begin in parallel with foundational
  work because they touch only the existing mockup component.
- **Polish (Phase 7)**: Depends on all user stories being complete.

### Within Each User Story

- Tests are written and SHOULD fail before implementation lands.
- Repository changes precede use-case wiring, which precedes Tauri
  command exposure, which precedes UI integration.
- Story completion is verified by its independent test before moving on.

### Parallel Opportunities

- T001/T002/T003 in Phase 1.
- T005/T006 in Phase 2 once T004 lands.
- T013/T014/T015 contract and component tests in US2.
- US4 copy tasks (T026–T028) can run in parallel with US1/US2/US3
  implementation because they touch only the `STEPS` array.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 to unblock everything.
2. Phase 3 to ship a durable gate that doesn't regress the empty
   Inventory landing.
3. STOP and validate.

### Incremental Delivery

1. MVP → durable gate live.
2. US2 → native picker + DB persistence; the wizard becomes real.
3. US3 → restart is non-destructive and obvious.
4. US4 → copy and per-step affordances reduce wrong-category errors.

### Notes

- `[mockup ✓, needs Tauri impl]` tags mark tasks where the UI behavior
  already exists but the underlying I/O is stubbed; the task is real
  work that replaces the stub with a Tauri-backed implementation.
- Do not delete the stub picker until the Tauri picker has shipped in
  all CI environments — the stub is the fallback for browser-only
  component tests.
- All `[NEEDS DECISION]` markers in `spec.md` MUST be resolved (T032)
  before the feature exits Draft.
