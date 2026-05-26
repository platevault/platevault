---
description: "Task list for First-Run Source Setup (spec 003)"
---

# Tasks: First-Run Source Setup

**Input**: Design documents from `/specs/003-first-run-source-setup/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`
**Reconciled**: 2026-05-26 (post specs 027/029 merge)

**Context**: Specs 027 (frontend) and 029 (Tauri backend wiring) have been
merged. The setup wizard exists as a 5-step flow with stub Tauri commands.
This spec replaces stubs with real persistence and refactors the wizard
into an 8-step design.

**Tests**: Tests are included because spec acceptance scenarios are
testable end-to-end and the contract surface needs schema conformance
coverage.

**Organization**: Tasks are grouped by user story so each can be
implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

## Phase 1: Contracts & Schema Setup

- [x] T001 [P] Rename contract files: `source.register.json` →
      `roots.register.json`, `source.register.batch.json` →
      `roots.register.batch.json`. Update command names inside each schema
      to use dotted names (`roots.register`, `roots.register.batch`).
- [x] T002 [P] Wire the JSON Schemas in `specs/003-first-run-source-setup/contracts/`
      into the contracts index in `packages/contracts/` so generated TS
      types are produced. Contracts: `roots.register.json`,
      `roots.register.batch.json`, `firstrun.complete.json`,
      `firstrun.restart.json`, `audit.first_run.completed.json`.
- [x] T003 [P] Add JSON Schema validator dev dependency (Ajv 2020 or
      equivalent) and a contract-test harness under `tests/contract/` if
      not already present.

---

## Phase 2: Persistence & Domain (Blocking Prerequisites)

- [x] T004 Define `RegisteredSource` and `FirstRunState` schema and
      migration in `crates/persistence/db/migrations/`. `RegisteredSource`
      includes `scan_depth` column (default `recursive`, R-Wiz-1) and
      server-derived `created_via` column (R-Auth-1). `FirstRunState` does
      NOT include `sources_buffer` — scratch state is localStorage-only
      (R-Buf).
- [x] T005 [P] Add Rust DTOs mirroring the JSON contracts in
      `crates/contracts/core/src/first_run.rs`. Types for
      `roots.register`, `roots.register.batch`, `firstrun.complete`,
      `firstrun.restart`, and `firstrun.state` requests/responses.
- [x] T006 [P] Implement repository methods in
      `crates/persistence/db/src/first_run.rs`:
      `register_source`, `register_source_batch`, `list_sources`,
      `remove_source`, `get_first_run_state`, `set_first_run_state`,
      `complete_first_run`, and `restart_first_run`.
      `register_source` derives `created_via` from
      `FirstRunState.completed_at` context (R-Auth-1).
      `register_source_batch` is transactional: all-or-nothing on full
      failure; partial commit on partial success (R-Batch).
- [x] T007 Implement use cases in `crates/app/core/src/first_run.rs`:
      `register_source`, `register_source_batch`, `complete_first_run`,
      `restart_first_run`, and `get_first_run_state`. Path validation
      (exists, is_dir, readable) and error mapping to the contract error
      enum (FR-005). Include unit tests for path validation edge cases:
      non-existent path, file instead of directory, permission denied,
      symlink target, Windows long path. Detect
      `path.already.registered` (idempotent — D1) and
      `path.already.registered.different_kind` (reject — R-1.4).
      `complete_first_run` checks both raw and project kinds present
      (R-Wiz-2). `restart_first_run` clears `completed_at` and returns
      existing sources as prefilled (R-E5). `complete_first_run` emits
      `first_run.completed` audit event via `crates/audit/` (R-E2).
- [x] T008 Replace the `roots.register` stub in
      `apps/desktop/src-tauri/src/commands/roots.rs` with a real
      implementation delegating to `crates/app/core/`. Add new Tauri
      commands: `roots.register.batch`, `firstrun.complete`,
      `firstrun.restart`, `firstrun.state` in
      `apps/desktop/src-tauri/src/commands/firstrun.rs`. Register all
      new commands in `specta_builder()` in `lib.rs`.

**Checkpoint**: Domain + persistence + command surface are live; user
stories can begin.

---

## Phase 3: User Story 1 — Land On The Wizard On First Launch (P1)

**Goal**: Index route correctly gates between `/setup` and `/sessions`
based on durable first-run state.

**Independent Test**: With the DB reset, open the app and confirm the
gate sends the user to `/setup`. Complete the wizard and confirm the
gate sends to `/sessions` on next launch.

### Tests for User Story 1

- [x] T009 [P] [US1] Integration test for the gate behavior in
      `tests/integration/first_run_gate.spec.ts` (Playwright MCP).

### Implementation for User Story 1

- [x] T010 [US1] Update `apps/desktop/src/app/router.tsx`: add a
      `beforeLoad` guard on the index route that calls `firstrun.state`
      via Tauri and redirects to `/setup` when `completed_at` is null.
      Fall back to `setupCompleted` localStorage preference if the Tauri
      call fails. Render a loading/pending state (spinner or skeleton)
      while the async DB check resolves to prevent a flash of the wrong
      route (FR-016).
- [x] T011 [US1] Update `apps/desktop/src/features/setup/SetupPage.tsx`:
      replace the `usePreference('setupCompleted')` guard with a
      DB-backed check via `firstrun.state`. Keep localStorage as cache.

**Checkpoint**: First-launch gating is durable and tested end-to-end.

---

## Phase 4: User Story 2 — Register Source Roots By Category (P2)

**Goal**: User can add, remove, and finalize source roots across the
four categories with native picker + durable DB writes via an 8-step
wizard flow.

**Independent Test**: Walk the wizard end-to-end against a fresh DB.
Confirm Raw blocks advance when empty, Project blocks when empty, the
other two advance freely, and Finish writes `RegisteredSource` rows plus
`FirstRunState.completed_at`.

### Tests for User Story 2

- [x] T012 [P] [US2] Contract conformance test for
      `contracts/roots.register.json` in
      `tests/contract/roots_register_test.rs`.
- [x] T013 [P] [US2] Contract conformance test for
      `contracts/roots.register.batch.json` in
      `tests/contract/roots_register_batch_test.rs`. Cover: all-success,
      partial (one error), all-failure atomic rollback, idempotent
      `path.already.registered`, `path.already.registered.different_kind`
      (R-Batch, R-1.4).
- [x] T014 [P] [US2] Contract conformance test for
      `contracts/firstrun.complete.json` in
      `tests/contract/firstrun_complete_test.rs`. Cover: missing raw
      source, missing project source (R-Wiz-2).
- [x] T015 [P] [US2] Component test for the wizard's Raw-required and
      Project-required gating in
      `apps/desktop/src/features/setup/SetupWizard.test.tsx`.
- [x] T016 [P] [US2] Playwright end-to-end test for the full wizard
      happy path in `tests/integration/first_run_happy_path.spec.ts`.

### Implementation for User Story 2

- [x] T017 [US2] Refactor `SetupWizard.tsx`: replace the 5-step `STEPS`
      array with the 8-step sequence (Welcome → Raw → Calibration →
      Project → Inbox → Detect Tools → Download Catalogs → Finish).
      Update `canAdvance` to require entries for Raw (step 1) and
      Project (step 3).
- [x] T018 [US2] Split `StepSources.tsx` into four per-category step
      components: `StepRaw.tsx`, `StepCalibration.tsx`,
      `StepProject.tsx`, `StepInbox.tsx`. Each uses the existing
      `DirPicker` component for directory selection. Include category
      explanation copy, Required/Optional badge, and example paths per
      the spec's US4 acceptance scenarios. Each step includes an
      optional scan-depth selector (Recursive / Single-level) as
      advanced/collapsed disclosure, hidden by default behind an
      "Advanced" expander on each row (FR-017).
- [x] T019 [US2] Add `apps/desktop/src/features/setup/sources-store.ts`
      to centralize the localStorage buffer and the DB-promotion flow.
      The store manages the working source list, deduplication checks,
      and flush-to-DB via `roots.register.batch` on Finish.
- [x] T020 [US2] Wire the wizard's per-step "Add folder" action through
      `sources-store.ts`. After the user selects a directory via
      `DirPicker`, call `roots.register` to validate and render contract
      errors (`path.not.exists`, `path.not.directory`,
      `path.permission.denied`, `path.already.registered`,
      `path.already.registered.different_kind`) inline next to the row.
- [x] T021 [US2] Update the Finish step (`StepConfirm.tsx`): on submit,
      call `roots.register.batch` with the full working buffer, then
      call `firstrun.complete`. On batch partial-failure, stay on
      Finish with per-row error indicators. Treat
      `path.already.registered` as success (D1). On
      `required.step.incomplete`, return to the relevant step. On
      success, clear localStorage buffer and navigate to `/sessions`.
- [x] T022 [US2] Add `StepDetectTools.tsx` as a stub/placeholder step.
      Show a fixture list of common tools (PixInsight, Siril, planetary
      tools) with a note that auto-detection will be available in a
      future update. User can skip freely.
- [x] T023 [US2] Update `StepCatalogs.tsx` for stub mode: show OpenNGC
      and common catalogs with simulated download progress. Include
      "Skip for now" action that advances without blocking. Note that
      real catalog download will be available in a future update.
- [x] T024 [US2] Update `apps/desktop/src/api/commands.ts`: add
      `registerRootBatch()`, `completeFirstRun()`, `restartFirstRun()`,
      and `getFirstRunState()` wrappers calling the new Tauri commands.

**Checkpoint**: Wizard performs durable writes and surfaces contract
errors.

---

## Phase 5: User Story 3 — Restart Setup From Settings (P3)

**Goal**: Settings provides an obvious restart entry, and restart uses
the prefill behavior.

**Independent Test**: Complete setup, restart from Settings, confirm the
wizard opens at Welcome with previously registered sources prefilled
into the working buffer.

### Tests for User Story 3

- [x] T025 [P] [US3] Playwright test for the restart flow in
      `tests/integration/first_run_restart.spec.ts`, asserting prefilled
      sources and a cleared completion flag.
- [x] T026 [P] [US3] Contract conformance test for
      `contracts/firstrun.restart.json` in
      `tests/contract/firstrun_restart_test.rs`. Cover: happy path with
      prefilled sources, `wizard.not.completed` error (R-E5).

### Implementation for User Story 3

- [x] T027 [US3] Update
      `apps/desktop/src/features/settings/SettingsPage.tsx`: replace
      the destructive reset with a call to `restartFirstRun()` that
      receives `prefilled_sources`, writes them to
      `localStorage["alm-setup-wizard-state"]`, clears `setupCompleted`
      preference, and navigates to `/setup`.
- [x] T028 [US3] Add a confirm-before-restart dialog so users do not
      lose the completion flag accidentally.

**Checkpoint**: Restart is durable, non-destructive, and discoverable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T029 [P] Audit event `first_run.completed` schema conformance test
      in `tests/contract/audit_first_run_completed_test.rs` (R-E2).
- [x] T030 [P] Update `docs/research/` with a short note linking back to
      `specs/003-first-run-source-setup/research.md` for reference.
- [x] T031 Run `just lint`, `just typecheck`, `just test`, and verify
      Playwright MCP coverage of the gate, happy path, restart, and
      batch partial-failure.
- [x] T032 Remove old `StepSources.tsx` and `StepScan.tsx` (superseded
      by per-category steps and merged into confirm flow). Update
      `steps/index.ts` exports.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

T001 = { blocked_by = [] }
T002 = { blocked_by = ["T001"] }
T003 = { blocked_by = [] }

T004 = { blocked_by = [] }
T005 = { blocked_by = ["T002"] }
T006 = { blocked_by = ["T004"] }
T007 = { blocked_by = ["T005", "T006"] }
T008 = { blocked_by = ["T007"] }

T009 = { blocked_by = ["T010"] }
T010 = { blocked_by = ["T008"] }
T011 = { blocked_by = ["T008"] }

T012 = { blocked_by = ["T002"] }
T013 = { blocked_by = ["T002"] }
T014 = { blocked_by = ["T002"] }
T015 = { blocked_by = ["T017"] }
T016 = { blocked_by = ["T021"] }
T017 = { blocked_by = ["T008"] }
T018 = { blocked_by = ["T017"] }
T019 = { blocked_by = ["T008"] }
T020 = { blocked_by = ["T018", "T019"] }
T021 = { blocked_by = ["T020", "T024"] }
T022 = { blocked_by = ["T017"] }
T023 = { blocked_by = ["T017"] }
T024 = { blocked_by = ["T008"] }

T025 = { blocked_by = ["T027"] }
T026 = { blocked_by = ["T002"] }
T027 = { blocked_by = ["T008", "T024"] }
T028 = { blocked_by = ["T027"] }

T029 = { blocked_by = ["T002"] }
T030 = { blocked_by = [] }
T031 = { blocked_by = ["T021", "T027", "T022", "T023", "T032"] }
T032 = { blocked_by = ["T018"] }
```

### Phase Dependencies

- **Contracts & Schema (Phase 1)**: No dependencies; can start immediately.
- **Persistence & Domain (Phase 2)**: T004 has no deps; T005 depends on
  T002 (generated types); T006 depends on T004 (migration).
- **User Story 1 (Phase 3)**: Depends on T008 (Tauri commands live).
- **User Story 2 (Phase 4)**: Depends on T008 (commands) for real wiring;
  T017 (wizard refactor) can start once T008 lands.
- **User Story 3 (Phase 5)**: Depends on T008 and T024 (command wrappers).
- **Polish (Phase 6)**: Depends on all user stories being complete.

### Parallel Opportunities

- T001/T003/T004/T030 in Phase 1 — all independent.
- T005/T006 once T002/T004 land — different crates.
- T012/T013/T014/T026/T029 contract tests — all independent once T002 lands.
- T017/T019/T024 once T008 lands — different files.
- T018/T022/T023 once T017 lands — independent step components.

---

## Implementation Strategy

### MVP First (Gate + Core Persistence)

1. Phase 1 + Phase 2 to get real commands live.
2. Phase 3 (US1) to ship a durable gate.
3. STOP and validate.

### Incremental Delivery

1. MVP → durable gate live.
2. US2 → 8-step wizard with real persistence; the wizard becomes real.
3. US3 → restart with prefill is non-destructive and obvious.
4. Polish → cleanup old components, full test coverage.
