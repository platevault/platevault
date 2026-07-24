# Tasks: Tauri Backend Wiring

**Input**: Design documents from `specs/029-tauri-backend-wiring/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/commands.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Add dependencies and workspace-level tooling needed by all subsequent phases.

- [x] T001 Add `tracing` dependency to `apps/desktop/src-tauri/Cargo.toml`
- [x] T002 [P] Add `just tauri-dev` command to `justfile` that runs `cd apps/desktop && cargo tauri dev`

---

## Phase 2: Proof of Concept (Blocking)

**Purpose**: Validate that dotted command names work in Tauri IPC dispatch end-to-end before building all 31 stubs. If dotted names fail, pivot to snake_case and update `commands.ts`.

**CRITICAL**: No further stub work begins until this phase validates the naming approach.

- [x] T003 [US1] Create a single DTO `AcquisitionSession` struct in `crates/contracts/core/src/sessions.rs` with `Serialize, Deserialize, specta::Type, Clone` and `#[serde(rename_all = "camelCase")]`. Add `pub mod sessions;` to `crates/contracts/core/src/lib.rs`.
- [x] T004 [US1] Create `apps/desktop/src-tauri/src/commands/sessions.rs` with one stub command `sessions_list` annotated with `#[tauri::command]`, `#[specta::specta]`, and `#[specta(rename = "sessions.list")]`. Return a hardcoded `Vec<AcquisitionSession>` matching `mocks.ts` fixture shape. Emit `tracing::debug!("stub: sessions.list")`.
- [x] T005 [US1] Register `sessions_list` in `specta_builder()` in `apps/desktop/src-tauri/src/lib.rs` via `collect_commands!`. Add `pub mod sessions;` to `commands/mod.rs`.
- [x] T006 [US1] Run `cargo test -p desktop_shell` to regenerate `apps/desktop/src/bindings/index.ts`. Verify the output contains a `sessionsList` binding with the correct return type.
- [x] T007 [US1] Run `just tauri-dev` and verify `invoke('sessions.list')` resolves from the frontend. Check browser console for zero invoke errors and Rust logs for `stub: sessions.list`. If dotted names fail in Tauri IPC, document in `research.md` and switch to snake_case naming — update `apps/desktop/src/api/commands.ts` invoke calls accordingly.

**Checkpoint**: Naming convention validated. All subsequent stubs follow the proven pattern.

---

## Phase 3: User Story 1 — Launch the App in Tauri (Priority: P1) MVP

**Goal**: All 31 frontend commands have matching Tauri stub handlers; `tauri dev` launches and every page renders with stub data.

**Independent Test**: Run `just tauri-dev`, navigate to all 8 pages + setup wizard, zero invoke errors in console.

### DTO Types (parallelizable — each file is independent)

- [x] T008 [P] [US1] Create `SessionDetail`, `CalendarData` structs in `crates/contracts/core/src/sessions.rs`
- [x] T009 [P] [US1] Create `CalibrationMaster`, `MasterDetail`, `MatchCandidate` structs in `crates/contracts/core/src/calibration.rs`
- [x] T010 [P] [US1] Create `Target`, `TargetDetail` structs in `crates/contracts/core/src/targets.rs`
- [x] T011 [P] [US1] Create `Project`, `ProjectDetail` structs in `crates/contracts/core/src/projects.rs`
- [x] T012 [P] [US1] Create `FilesystemPlan`, `PlanDetail` structs in `crates/contracts/core/src/plans.rs`
- [x] T013 [P] [US1] Create `AuditEntry` struct and `AuditListResponse` in `crates/contracts/core/src/audit.rs`
- [x] T014 [P] [US1] Create `ReviewItem` struct in `crates/contracts/core/src/review.rs`
- [x] T015 [P] [US1] Create `LibraryRoot`, `Equipment`, `RemapVerification`, `OperationHandle` structs in `crates/contracts/core/src/roots.rs`
- [x] T016 [P] [US1] Create `SettingsData` struct in `crates/contracts/core/src/settings.rs`
- [x] T017 [P] [US1] Create `SearchResult` struct in `crates/contracts/core/src/search.rs`
- [x] T018 [P] [US1] Create `AppPreferences` struct in `crates/contracts/core/src/preferences.rs`
- [x] T019 [P] [US1] Create shared enums (`SessionState`, `ProjectState`, `PlanState`, `PlanKind`, `ConfidenceLevel`, `ProvenanceOrigin`, `ViewMode`) in `crates/contracts/core/src/enums.rs`. Reconcile variants against existing generated bindings and hand-written `api/types.ts` — Rust is canonical.
- [x] T020 [US1] Register all new DTO modules in `crates/contracts/core/src/lib.rs` and verify `cargo build -p contracts_core` succeeds.

### Stub Command Modules (parallelizable — each file is independent)

- [x] T021 [P] [US1] Add remaining stub commands to `apps/desktop/src-tauri/src/commands/sessions.rs`: `sessions_get`, `sessions_calendar`, `sessions_transition`, `sessions_split`, `sessions_merge`. Each returns hardcoded fixture data and emits `tracing::debug!`.
- [x] T022 [P] [US1] Create `apps/desktop/src-tauri/src/commands/calibration.rs` with stubs: `calibration_masters_list`, `calibration_masters_get`, `calibration_matches`.
- [x] T023 [P] [US1] Create `apps/desktop/src-tauri/src/commands/targets.rs` with stubs: `targets_list`, `targets_get`.
- [x] T024 [P] [US1] Create `apps/desktop/src-tauri/src/commands/projects.rs` with stubs: `projects_list`, `projects_get`, `projects_create_plan`.
- [x] T025 [P] [US1] Create `apps/desktop/src-tauri/src/commands/plans.rs` with stubs: `plans_list`, `plans_get`, `plans_approve`, `plans_apply`, `plans_discard`.
- [x] T026 [P] [US1] Create `apps/desktop/src-tauri/src/commands/audit.rs` with stubs: `audit_list`, `audit_export`.
- [x] T027 [P] [US1] Create `apps/desktop/src-tauri/src/commands/review.rs` with stub: `review_queue`.
- [x] T028 [P] [US1] Create `apps/desktop/src-tauri/src/commands/roots.rs` with stubs: `roots_list`, `roots_register`, `roots_remap`, `roots_remap_apply`, `scan_start`, `equipment_list`.
- [x] T029 [P] [US1] Create `apps/desktop/src-tauri/src/commands/settings.rs` with stubs: `settings_get`, `settings_update`.
- [x] T030 [P] [US1] Create `apps/desktop/src-tauri/src/commands/preferences.rs` with stubs: `preferences_get`, `preferences_set`.
- [x] T031 [P] [US1] Create `apps/desktop/src-tauri/src/commands/search.rs` with stub: `search_global`.
- [x] T032 [P] [US1] Create `apps/desktop/src-tauri/src/commands/tour.rs` with stub: `tour_complete_step`.

### Registration & Build

- [x] T033 [US1] Register all new command modules in `apps/desktop/src-tauri/src/commands/mod.rs`.
- [x] T034 [US1] Register all new commands in `specta_builder()` in `apps/desktop/src-tauri/src/lib.rs` via `collect_commands![]`. Verify `cargo build -p desktop_shell` succeeds.

### Verification

- [x] T035 [US1] Run `just tauri-dev`, navigate all 8 pages + setup wizard. Verify stub data renders on every page and zero invoke errors in the browser console. Run with `RUST_LOG=debug` and confirm `stub:` log lines appear.

**Checkpoint**: US1 complete — the app runs in Tauri with all stub commands wired.

---

## Phase 4: User Story 2 — Stub Surface Matches Frontend Expectations (Priority: P1)

**Goal**: Command names, argument shapes, and response types match exactly. Frontend `invoke()` calls resolve correctly for all 31 commands.

**Independent Test**: Set `VITE_USE_MOCKS=false`, `just tauri-dev`, navigate all pages — identical UX to mock mode.

- [x] T036 [US2] Audit every stub command's argument types against `apps/desktop/src/api/commands.ts` invoke call signatures. Fix any argument shape mismatches in the Rust stubs.
- [x] T037 [US2] Audit every stub command's response shape against `apps/desktop/src/api/mocks.ts` mock return values. Fix any field name or type mismatches (ensure `#[serde(rename_all = "camelCase")]` is consistent).
- [x] T038 [US2] Run `just tauri-dev` with `VITE_USE_MOCKS=false` and navigate all pages. Verify the stub data renders identically to mock mode. Document any remaining mismatches.

**Checkpoint**: US2 complete — stubs and frontend are shape-compatible.

---

## Phase 5: User Story 3 — Persistent Database (Priority: P1)

**Goal**: SQLite database persists to platform-appropriate on-disk path across app restarts.

**Independent Test**: Launch app, verify DB file at platform path, restart, verify data persists. Override with `PV_DB_URL` and verify.

- [x] T039 [US3] Refactor `apps/desktop/src-tauri/src/main.rs`: use `tauri::Builder::default().build()` to get the `App` handle, call `app.path().app_data_dir()` to resolve the platform DB path, create the directory if needed, then connect SQLite and run migrations before calling `app.run(callback)`. Preserve `PV_DB_URL` env override.
- [x] T040 [US3] Verify on the current platform: launch with `just tauri-dev`, confirm DB file is created at the expected path. Restart and confirm the DB is reused. Set `PV_DB_URL=/tmp/test-alm.db` and confirm the override works.

**Checkpoint**: US3 complete — persistent storage works.

---

## Phase 6: User Story 4 — Generated Bindings Replace Hand-Written Types (Priority: P2)

**Goal**: Generated tauri-specta bindings become the authoritative TypeScript type source. `api/types.ts` is deleted.

**Independent Test**: `just typecheck` passes with all frontend imports pointing at generated bindings.

- [x] T041 [US4] Run `cargo test -p desktop_shell` to regenerate `apps/desktop/src/bindings/index.ts` with all 31 commands.
- [x] T042 [US4] Update `apps/desktop/src-tauri/tests/bindings.rs` to assert all 31 command names appear in the generated output.
- [x] T043 [US4] Audit type names: compare every type in `apps/desktop/src/api/types.ts` against the generated `bindings/index.ts`. Document specta suffixes (`_Serialize`, `_Deserialize`), casing differences, and enum variant mismatches in a temporary migration checklist.
- [x] T044 [US4] Create `apps/desktop/src/bindings/types.ts` compatibility barrel that re-exports generated types under the plain names the frontend expects (e.g., `export type AcquisitionSession = ...`). Include all enums and structs from the audit.
- [x] T045 [US4] Migrate frontend imports: update all files that import from `@/api/types` to import from `@/bindings/types` instead. Run `tsc --noEmit` after each batch to keep the build green.
- [x] T046 [US4] Delete `apps/desktop/src/api/types.ts`. Run `just typecheck` to confirm zero errors.
- [x] T047 [US4] Update `apps/desktop/src/api/commands.ts` type annotations to reference `@/bindings/types` instead of the deleted `@/api/types`.

**Checkpoint**: US4 complete — single source of truth for types from Rust to TypeScript.

---

## Phase 7: User Story 5 — Mock Layer Remains Available (Priority: P2)

**Goal**: `VITE_USE_MOCKS=true` with `just dev` (Vite only) still works after the type migration.

**Independent Test**: `VITE_USE_MOCKS=true just dev`, navigate all pages, confirm mock data renders.

- [x] T048 [US5] Update `apps/desktop/src/api/mocks.ts` imports to reference `@/bindings/types` instead of the deleted `@/api/types`.
- [x] T049 [US5] Run `VITE_USE_MOCKS=true just dev` (Vite only, no Tauri) and navigate all pages. Confirm mock data renders and no import errors.

**Checkpoint**: US5 complete — both dev modes work.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup across all user stories.

- [x] T050 Run `just lint && just typecheck && just test` — all must pass.
- [x] T051 Run quickstart.md milestone validation: M1 (`cargo build -p desktop_shell`), M2 (bindings with 31 commands), M3 (`just typecheck`), M4 (`just tauri-dev` all pages render).
- [x] T052 Verify `RUST_LOG=debug just tauri-dev` shows `stub:` lines for every command invoked during page navigation.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (PoC)**: Depends on Phase 1 — BLOCKS all stub work
- **Phase 3 (US1 - Tauri Launch)**: Depends on Phase 2 naming validation
  - DTO types (T008–T020) are parallelizable
  - Stub modules (T021–T032) are parallelizable, depend on DTOs
  - Registration (T033–T034) depends on all stubs
- **Phase 4 (US2 - Shape Match)**: Depends on Phase 3
- **Phase 5 (US3 - Persistent DB)**: Depends on Phase 1 only — can run in parallel with Phase 3/4
- **Phase 6 (US4 - Bindings)**: Depends on Phase 3 (all commands registered)
- **Phase 7 (US5 - Mock Layer)**: Depends on Phase 6 (type migration)
- **Phase 8 (Polish)**: Depends on all previous phases

### Parallel Opportunities

- T008–T019: All DTO type files in parallel (12 tasks)
- T021–T032: All stub command modules in parallel (12 tasks)
- Phase 5 (DB path) can run in parallel with Phases 3–4

---

## Implementation Strategy

### MVP (Phases 1–3)

Complete setup, validate naming, create all stubs. App runs in Tauri with stub data.

### Full Delivery (Phases 4–8)

Add persistent DB, migrate types to generated bindings, verify both dev modes, polish.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
