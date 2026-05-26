---
description: "Task list for Native Filesystem Controls (spec 004)"
---

# Tasks: Native Filesystem Controls

**Input**: Design documents from `/specs/004-native-filesystem-controls/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/native.directory.pick.json`,
`contracts/native.file.pick.json`, `contracts/native.reveal.json`

**Tests**: Tests are included because each operation has a contract
surface and the per-OS reveal behavior is the highest-risk area in the
feature.

**Organization**: Tasks are grouped by user story so each picker and
the reveal action can be implemented independently. The pre-existing wiring is an ad-hoc dynamic import of
`@tauri-apps/plugin-dialog` in `AddFolderButton`
(`apps/desktop/src/features/setup/steps/StepRaw.tsx`), added by spec
003. The dependency is not in `package.json`, has no Tauri capability,
no contract DTO, no audit logging, and no last-path memory. Everything
else is new.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Add `@tauri-apps/plugin-dialog` and `@tauri-apps/api` to
      `apps/desktop/package.json`. Add `tauri-plugin-dialog` and
      `tauri-plugin-opener` Rust crates to
      `apps/desktop/src-tauri/Cargo.toml`. Verify versions with
      `mcp-package-version` before pinning.
- [x] T002 [P] Extend `apps/desktop/src-tauri/capabilities/default.json`
      to allow `dialog:default`, `dialog:allow-open`, and
      `opener:allow-reveal-item-in-dir` per the Tauri 2.x capability spec.
      Note: `launch-app` and `launch-url` capabilities are owned by spec 011.
- [x] T003 [P] Wire the three JSON Schemas in
      `specs/004-native-filesystem-controls/contracts/` into the
      contracts index in `packages/contracts/` so generated TypeScript
      types are produced for the request/response shapes.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 Add Rust DTOs mirroring the three contracts in
      `crates/contracts/core/src/native.rs` (`PickerRequest`,
      `PickerResult`, `RevealRequest`, `RevealResult`,
      `FileFilter`, and the error enum).
- [x] T005 [P] Define audit-event types `native.picker.failed` and
      `native.reveal.failed` in `crates/audit/src/events.rs` per
      `data-model.md`. Correlate reveal failures via `entity_id` only;
      do NOT include a `path_hash` field (A2: path hash dropped from audit).
- [x] T006 [P] Implement the three use cases in
      `crates/app/core/src/native.rs`: `pick_directory`,
      `pick_file`, and `reveal_path`. Path validation for
      `reveal_path` happens here (exists check using
      `std::fs::metadata`; non-existence maps to
      `path.not_exists`).
- [x] T007 Expose Tauri commands `native_directory_pick`,
      `native_file_pick`, and `native_reveal` in
      `apps/desktop/src-tauri/src/commands/native.rs`, delegating to
      `crates/app/core/`.

**Checkpoint**: Contract surface, audit hooks, and Tauri commands are
live. User-story phases can begin.

---

## Phase 3: User Story 1 — Choose Source Directories (P1) MVP

**Goal**: All source-root selection flows (first-run, Settings →
Add source) use the native directory picker. The `pickFolderStub` is
gone from production builds.

**Independent Test**: Open first-run, click "Add raw source" and
confirm the native OS directory picker appears. Repeat for
calibration, project, and inbox source kinds. Cancel each and confirm
no row is added.

### Tests for User Story 1

- [x] T008 [P] [US1] Contract conformance test for
      `native.directory.pick.json` in
      `tests/contract/native_directory_pick.rs`.
- [x] T009 [P] [US1] Vitest unit test for the `useDirectoryPicker`
      hook in
      `apps/desktop/src/shared/native/picker.test.ts`, covering
      success, cancellation (null path), and OS-error branches with
      `@tauri-apps/plugin-dialog` mocked.
- [x] T010 [P] [US1] Playwright MCP smoke test that the first-run
      wizard renders the picker (intercepted at the Tauri command
      boundary) in
      `tests/integration/first_run_picker.spec.ts`.

### Implementation for User Story 1

- [x] T011 [US1] Create `apps/desktop/src/shared/native/picker.ts`
      exporting `useDirectoryPicker()` and a `pickDirectory()` async
      helper that calls `tauri.invoke("native_directory_pick",
      payload)`. Generate the `request_id` per call.
- [x] T012 [US1] Persist last-chosen parent per source kind in
      `localStorage` under `alm.lastPath.<kind>` and pass it as
      `default_path` on the next open (research §5, data-model.md
      §LastPathMemory).
- [x] T013 [US1] Replace the ad-hoc `@tauri-apps/plugin-dialog` dynamic
      import in `AddFolderButton`
      (`apps/desktop/src/features/setup/steps/StepRaw.tsx`) and the
      equivalent affordances in `StepCalibration.tsx`,
      `StepProject.tsx`, `StepInbox.tsx`, and
      `features/settings/DataSources.tsx` with the new
      `pickDirectory()` helper. Keep the `window.prompt` fallback
      behind the `VITE_TAURI=false` build flag for component tests.
- [x] T014 [US1] Surface picker errors (`picker.unavailable`,
      `os.command_failed`) inline next to the offending row and emit
      a toast plus an audit event via the existing audit sink.

**Checkpoint**: Directory selection across the app is native and
contract-driven.

---

## Phase 4: User Story 2 — Choose Master Calibration Files (P2)

**Goal**: All master-calibration "Choose file" affordances use the
native file picker with the FITS/XISF/TIFF filter set defined in
research §2.

**Independent Test**: Open the Add Master flow, confirm the native
file picker appears with filters in the documented order, confirm
`All supported` is the default, and confirm a TIFF file can be
selected when the filter is switched to `TIFF`.

### Tests for User Story 2

- [x] T015 [P] [US2] Contract conformance test for
      `native.file.pick.json` in
      `tests/contract/native_file_pick.rs`.
- [x] T016 [P] [US2] Vitest unit test for `useFilePicker` covering
      filter ordering, `default_path` propagation, cancellation, and
      `filters.invalid` rejection in
      `apps/desktop/src/shared/native/picker.test.ts`.
- [x] T017 [P] [US2] Playwright MCP test for the master-add flow in
      `tests/integration/master_file_picker.spec.ts`, intercepting
      the Tauri command and asserting the filter list passed in
      from the UI.

### Implementation for User Story 2

- [x] T018 [US2] Add `pickFile(filters, default_path?)` and
      `useFilePicker()` to
      `apps/desktop/src/shared/native/picker.ts`. Build the default
      filter list once and reuse it across master-add surfaces.
- [x] T019 [US2] Wire the calibration source root (when registered)
      as `default_path` for the master picker (research §5 open
      follow-up).
- [x] T020 [US2] Validate the filter list in
      `crates/app/core/src/native.rs::pick_file`, returning
      `filters.invalid` if extensions are empty or contain illegal
      characters per the JSON Schema pattern.
- [x] T021 [US2] Persist the user's `selected_filter` choice along
      with the chosen path so downstream calibration entry forms can
      pre-fill the frame type when unambiguous (e.g. XISF → declared
      master type taken from filename heuristic in a later spec).

**Checkpoint**: Master file selection is native, filter-aware, and
filter-validated.

---

## Phase 5: User Story 3 — Reveal Item Locations In The OS File Browser (P3)

**Goal**: `Reveal in OS` works from Inbox, Inventory, Projects, and
master calibration rows on Windows, macOS, and Linux, with graceful
fallback when per-item selection is unsupported.

**Independent Test**: Pick a row in Inbox, Inventory, and Projects.
Click `Reveal in OS` on each. Confirm Finder/Explorer highlights the
target on macOS and Windows. On Linux GNOME, confirm Files opens with
the target selected via freedesktop `ShowItems`. On a Linux desktop
without the interface, confirm the parent directory opens and the
response carries `selection: "directory_only"`.

### Tests for User Story 3

- [x] T022 [P] [US3] Contract conformance test for
      `native.reveal.json` in
      `tests/contract/native_reveal.rs`.
- [x] T023 [P] [US3] Rust unit tests for `reveal_path` in
      `crates/app/core/src/native.rs` covering `path.not_exists`,
      `os.command_failed`, and the `selection` enum branches with a
      mocked opener trait.
- [x] T024 [P] [US3] Playwright MCP integration test for the reveal
      flow in `tests/integration/reveal_in_os.spec.ts`, intercepting
      the Tauri command and asserting the request payload (including
      `entity_kind` and `entity_id` correlation).

### Implementation for User Story 3

- [x] T025 [US3] Add `apps/desktop/src/shared/native/reveal.ts`
      exporting `useRevealInOs()` and a `revealInOs(path, ctx?)`
      helper. The helper generates `request_id`, attaches the
      optional `entity_kind` / `entity_id`, and calls
      `tauri.invoke("native_reveal", payload)`.
- [x] T026 [US3] Implement `reveal_path` in
      `crates/app/core/src/native.rs` against a `RevealAdapter`
      trait. Default implementation delegates to
      `tauri-plugin-opener` `revealItemInDir`. Map plugin errors to
      the contract's error enum.
- [x] T027 [US3] Add a Linux fallback path in the Tauri command
      handler: if `tauri-plugin-opener` reports the freedesktop
      `ShowItems` interface is unavailable, call `xdg-open` on the
      parent directory and return `selection: "directory_only"`.
- [x] T028 [US3] Replace the existing toast-only "Open location"
      handlers in Inbox, Inventory, Projects, and master calibration
      surfaces with `revealInOs(path, { entity_kind, entity_id })`.
      Remove the prototype TODO comments referenced in
      `FR-007`.
- [x] T029 [US3] On `path.not_exists` and `os.command_failed`,
      surface a toast with a "Copy path" action and emit the
      `native.reveal.failed` audit event.

**Checkpoint**: Reveal-in-OS works across all consumer surfaces with
contract-defined error handling.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T030 [P] Document the three new operations in
      `docs/architecture/native-filesystem.md` (or extend the
      existing platform doc) with the per-OS notes from
      `research.md`.
- [~] T031 SKIPPED (no Storybook in project): [P] Add a Storybook entry (browser-only build flag) that
      exercises the stub picker and a fake reveal handler so design
      reviews do not require a Tauri runtime.
- [x] T032 Run `just lint`, `just typecheck`, `just test`, and
      verify Playwright MCP coverage of the three flows on at least
      one platform.
- [x] T033 Resolve all `[NEEDS DECISION]` markers in `spec.md`
      (filter ordering choice, last-path memory scope, toast
      copy-path support) before this feature exits Draft status.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

T001 = { blocked_by = [] }
T002 = { blocked_by = ["T001"] }
T003 = { blocked_by = [] }

T004 = { blocked_by = ["T003"] }
T005 = { blocked_by = [] }
T006 = { blocked_by = ["T004", "T005"] }
T007 = { blocked_by = ["T006", "T002"] }

T008 = { blocked_by = ["T003"] }
T009 = { blocked_by = ["T007"] }
T010 = { blocked_by = ["T013"] }
T011 = { blocked_by = ["T007"] }
T012 = { blocked_by = ["T011"] }
T013 = { blocked_by = ["T011"] }
T014 = { blocked_by = ["T013", "T005"] }

T015 = { blocked_by = ["T003"] }
T016 = { blocked_by = ["T018"] }
T017 = { blocked_by = ["T019"] }
T018 = { blocked_by = ["T007"] }
T019 = { blocked_by = ["T018"] }
T020 = { blocked_by = ["T006"] }
T021 = { blocked_by = ["T018"] }

T022 = { blocked_by = ["T003"] }
T023 = { blocked_by = ["T026"] }
T024 = { blocked_by = ["T028"] }
T025 = { blocked_by = ["T007"] }
T026 = { blocked_by = ["T006"] }
T027 = { blocked_by = ["T026"] }
T028 = { blocked_by = ["T025"] }
T029 = { blocked_by = ["T028", "T005"] }

T030 = { blocked_by = [] }
T031 = { blocked_by = ["T011", "T025"] }
T032 = { blocked_by = ["T014", "T021", "T029"] }
T033 = { blocked_by = ["T032"] }
```

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1. Blocks every user
  story that touches Tauri commands.
- **US1 (Phase 3)**: Depends on Phase 2. The directory picker is the
  MVP and the unblocker for spec 003's first-run wizard.
- **US2 (Phase 4)**: Depends on Phase 2. Can run in parallel with
  US1 since the picker hook module is shared but the consumers are
  different.
- **US3 (Phase 5)**: Depends on Phase 2. Independent of US1 and US2
  on the implementation side; the consumer surfaces (Inbox,
  Inventory, Projects) are owned by their own specs but the reveal
  hook can ship before those consumers are updated.
- **Polish (Phase 6)**: Depends on all user stories being complete.

### Within Each User Story

- Contract conformance tests are written first and validate against
  the JSON Schema in `contracts/`.
- Rust unit tests precede the Tauri command wiring.
- Hook implementation precedes consumer rewiring (e.g. T011 before
  T013 in US1).
- Story completion is verified by its independent test before the
  next priority begins.

### Parallel Opportunities

- T001/T003 in Phase 1.
- T004/T005 in Phase 2 once T003 lands.
- T008/T009 contract and unit tests in US1.
- T015/T016 contract and unit tests in US2.
- T022/T023 contract and unit tests in US3.
- US1, US2, and US3 implementation tracks can run in parallel after
  Phase 2 because they touch separate hook files and separate
  consumer surfaces.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 to unblock the contract surface.
2. Phase 3 to replace `pickFolderStub` with the real directory
   picker.
3. STOP and validate — first-run can now register real paths.

### Incremental Delivery

1. MVP → directory picker live; spec 003 unblocked.
2. US2 → master file picker live; spec 007 (calibration matching) can
   begin consuming real master paths.
3. US3 → Reveal-in-OS live across Inbox, Inventory, Projects, and
   calibration masters.

### Notes

- The browser-only stub MUST NOT be removed until US1 and US2 ship
  in all production CI environments. The stub is the fallback for
  Storybook and browser-only component tests.
- Audit-event payloads MUST hash the path, not log it raw, to keep
  exported audit logs free of user PII.
- Cancellation is a non-error null response everywhere; no audit
  event is emitted for cancellation.
- All `[NEEDS DECISION]` markers in `spec.md` MUST be resolved
  (T033) before the feature exits Draft.
