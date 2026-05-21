# Tasks: Developer Contract Diagnostics

**Input**: Design documents from `/specs/021-developer-contract-diagnostics/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Tests are required at the contract boundary (both contracts) and
at the recording-proxy boundary because the proxy is the only path that
captures runtime payloads.

**Organization**: Grouped by user story so each story delivers
incrementally. The original framework-review surface has been removed; no
`MOCKUP-DONE` tasks exist for this feature.

## Path Conventions

- Desktop: `apps/desktop/src/dev/`, `apps/desktop/src/data/`,
  `apps/desktop/src/routes.ts`
- Rust core: `crates/app/core/`, `crates/contracts/core/`
- Contracts: `specs/021-developer-contract-diagnostics/contracts/` mirrored
  to `packages/contracts/dev/`

---

## Phase 1: Setup

- [ ] T001 Mirror `contracts/dev.contracts.list.json` and
      `contracts/dev.calls.list.json` into `packages/contracts/dev/` and
      regenerate TypeScript types.
- [ ] T002 [P] Add a `dev/ContractCall.v1.json` shared schema in
      `packages/contracts/dev/` referenced by `dev.calls.list`.
- [ ] T003 [P] Add a `dev/ContractMeta.v1.json` shared schema in
      `packages/contracts/dev/` referenced by `dev.contracts.list`.

---

## Phase 2: Foundational

- [ ] T004 Add Rust DTO mirrors of `ContractMeta`, `ContractCall`, and the
      two operation request/response shapes in
      `crates/contracts/core/src/dev.rs`.
- [ ] T005 [P] Expose a registry-view helper in
      `crates/contracts/core/src/registry.rs` that yields one
      `ContractMeta` per registered operation with `name`, `version`,
      `schema_path`, `direction`, `replay_safe`, `sensitive_fields`,
      `ts_hash`, `rust_hash`.
- [ ] T006 Create the
      `crates/app/core/usecases/dev_contracts.rs` module skeleton with
      `list_contracts() -> Vec<ContractMeta>` and
      `list_calls(limit?) -> Vec<ContractCall>` (calls read from a
      desktop-side buffer via Tauri state).
- [ ] T007 [P] Add the `devMode` settings key (boolean, default `false`)
      to the settings store data model and mark it as a developer-only
      key.

**Checkpoint**: contract types, registry view, use-case skeleton, and the
`devMode` settings key ready.

---

## Phase 3: User Story 1 - Inspect Contract References (P1) - MVP

**Goal**: `/dev/contracts` lists every registered contract with name,
version, schema path, direction, and replay-safe flag; the route is only
reachable through the command palette when `devMode` is on.

**Independent Test**: With `devMode` on, open Cmd+K, type "contracts",
activate the entry, and confirm the list matches the registry.

### Tests for User Story 1

- [ ] T008 [P] [US1] Contract test for `dev.contracts.list` happy path and
      `dev_mode.disabled` in `crates/app/core/tests/dev_contracts_list.rs`.
- [ ] T009 [P] [US1] Desktop unit test that the command-palette entry is
      hidden when `devMode = false` and visible when `devMode = true` in
      `apps/desktop/src/data/commandPalette.test.ts`.
- [ ] T010 [P] [US1] Desktop unit test that `/dev/contracts` renders the
      "developer mode disabled" stub when `devMode = false` in
      `apps/desktop/src/dev/ContractsPage.test.tsx`.

### Implementation for User Story 1

- [ ] T011 [US1] Implement `list_contracts` in
      `crates/app/core/usecases/dev_contracts.rs` and the Tauri command
      `dev_contracts_list` in `apps/desktop/src-tauri/`.
- [ ] T012 [US1] Register `/dev/contracts` in
      `apps/desktop/src/routes.ts` with a `devMode` gate that renders the
      disabled stub when off.
- [ ] T013 [US1] Add the "Developer / Contracts" command-palette entry in
      `apps/desktop/src/data/commandPalette.ts` filtered by `devMode`.
- [ ] T014 [US1] Build `ContractList.tsx` rendering name, version,
      schema path, direction, replay-safe flag, and mismatch warning in
      `apps/desktop/src/dev/ContractList.tsx`.
- [ ] T015 [US1] Compute the `ts_hash` vs `rust_hash` mismatch once at
      startup and feed it into `ContractMeta.mismatch` for FR-006.

**Checkpoint**: US1 fully functional behind `devMode`.

---

## Phase 4: User Story 2 - Inspect Recent Contract Calls (P2)

**Goal**: The recording proxy captures every contract call into a
100-entry ring buffer when `devMode` is on; `/dev/contracts` shows the
buffer newest-first with request, response or error, start time, and
duration.

**Independent Test**: Trigger five contract calls (success, validation
error, not-found, long-running, cancelled); confirm all five appear with
correct fields.

### Tests for User Story 2

- [ ] T016 [P] [US2] Contract test for `dev.calls.list` happy path,
      `limit` clamping, and `dev_mode.disabled` in
      `crates/app/core/tests/dev_calls_list.rs`.
- [ ] T017 [P] [US2] Desktop unit test for ring buffer eviction order,
      `dropped` counter, and dedupe-free insertion in
      `apps/desktop/src/dev/recorder.test.ts`.
- [ ] T018 [P] [US2] Desktop unit test that the recorder is not installed
      when `devMode = false` (verified by absence of proxy frames) in
      `apps/desktop/src/dev/recorder.installation.test.ts`.
- [ ] T019 [P] [US2] Desktop unit test that sensitive fields declared in
      `ContractMeta.sensitive_fields` are replaced with `"<redacted>"`
      before storage in `apps/desktop/src/dev/recorder.redaction.test.ts`.

### Implementation for User Story 2

- [ ] T020 [US2] Implement `recorder.ts` with `wrap(dispatch)`, the
      100-entry ring buffer, monotonic id generation, payload truncation
      at 64 KB, and redaction via JSON Pointer paths in
      `apps/desktop/src/dev/recorder.ts`.
- [ ] T021 [US2] Install the wrapped dispatcher at app boot only when
      `devMode = true`; bypass at module load otherwise. Wire in
      `apps/desktop/src/data/tauriDispatch.ts` (or current dispatcher
      module).
- [ ] T022 [US2] Implement `list_calls` use case to read the buffer over a
      Tauri state handle and the Tauri command `dev_calls_list`.
- [ ] T023 [US2] Build `CallList.tsx` rendering one row per record with
      contract, version, started_at, duration_ms, response/error
      indicator, and a truncation marker in
      `apps/desktop/src/dev/CallList.tsx`.

**Checkpoint**: US1 + US2 work.

---

## Phase 5: User Story 3 - View JSON Schemas Inline (P3)

**Goal**: From a contract row or a call row, view the JSON Schema
pretty-printed; copy the schema to clipboard.

**Independent Test**: Activate "view schema" on a contract row; confirm
the body matches the file at `schema_path` and the copy action puts valid
JSON Schema text on the clipboard.

### Tests for User Story 3

- [ ] T024 [P] [US3] Desktop unit test that `SchemaViewer` reads the file
      at `schema_path`, pretty-prints with two-space indentation, and
      surfaces `schema.missing` when the file is absent in
      `apps/desktop/src/dev/SchemaViewer.test.tsx`.
- [ ] T025 [P] [US3] Desktop unit test that "view schema for this call"
      uses the call's `contract_version`, not the registry's current
      version, in `apps/desktop/src/dev/SchemaViewer.callVersion.test.tsx`.

### Implementation for User Story 3

- [ ] T026 [US3] Build `SchemaViewer.tsx` with a Tauri-backed file read,
      pretty-print, copy-to-clipboard, and missing-file rendering in
      `apps/desktop/src/dev/SchemaViewer.tsx`.
- [ ] T027 [US3] Wire "view schema" from `ContractList.tsx` and
      "view schema for this call" from `CallList.tsx`.
- [ ] T028 [US3] Implement the replay action on `CallList.tsx`,
      gated by `ContractMeta.replay_safe`; render disabled with tooltip
      when false.

**Checkpoint**: US1-US3 work. Replay is available for read-only contracts.

---

## Phase 6: User Story 4 - Hidden By Default and Performance-Safe (P4)

**Goal**: With `devMode = false`, the surface is unreachable from the
command palette and Settings, the route shows a disabled stub, and no
recorder overhead is present.

**Independent Test**: In a production-style build with `devMode = false`,
search top-nav, Settings, and the command palette; confirm no
developer-diagnostics entry. Profile contract dispatch; confirm no proxy
frame appears in the flame chart.

### Tests for User Story 4

- [ ] T029 [P] [US4] Performance test asserting zero added frames in the
      dispatch flame chart when `devMode = false`, in
      `apps/desktop/src/dev/recorder.perf.test.ts`.
- [ ] T030 [P] [US4] Desktop unit test that Settings does not render an
      API Contracts entry under any `devMode` state in
      `apps/desktop/src/ui/Settings.noContracts.test.tsx`.

### Implementation for User Story 4

- [ ] T031 [US4] Confirm `apps/desktop/src/dev/recorder.ts` is
      tree-shakable when `devMode = false` (dynamic import gated on the
      flag) so the proxy code is not loaded.
- [ ] T032 [US4] Add the hidden settings page that toggles `devMode`
      (reachable by typing the full URL only) and document the URL in
      `docs/research/`.
- [ ] T033 [US4] Quickstart pass: enable `devMode`, open Cmd+K, navigate
      to `/dev/contracts`, trigger five calls of mixed outcomes, view a
      schema, replay a read-only call, then disable `devMode` and
      confirm the surface and proxy are gone.

**Checkpoint**: US1-US4 work.

---

## Phase 7: Polish

- [ ] T034 [P] Confirm the diagnostic export action emits a JSON snapshot
      containing the contract list and the recent-calls buffer (FR-007);
      file the export contract as a follow-up if it grows beyond this
      surface.
- [ ] T035 Update `docs/research/` index to point at this feature's
      `research.md`.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = [] }
T004 = { blocked_by = ["T001", "T002", "T003"] }
T005 = { blocked_by = [] }
T006 = { blocked_by = ["T004", "T005"] }
T007 = { blocked_by = [] }
T008 = { blocked_by = ["T006"] }
T009 = { blocked_by = ["T007"] }
T010 = { blocked_by = ["T007"] }
T011 = { blocked_by = ["T006", "T008"] }
T012 = { blocked_by = ["T007", "T010"] }
T013 = { blocked_by = ["T007", "T009"] }
T014 = { blocked_by = ["T011", "T012"] }
T015 = { blocked_by = ["T005", "T014"] }
T016 = { blocked_by = ["T006"] }
T017 = { blocked_by = [] }
T018 = { blocked_by = ["T007"] }
T019 = { blocked_by = ["T005"] }
T020 = { blocked_by = ["T017", "T019"] }
T021 = { blocked_by = ["T020", "T018"] }
T022 = { blocked_by = ["T020", "T016"] }
T023 = { blocked_by = ["T022", "T014"] }
T024 = { blocked_by = [] }
T025 = { blocked_by = [] }
T026 = { blocked_by = ["T024"] }
T027 = { blocked_by = ["T026", "T023", "T014"] }
T028 = { blocked_by = ["T023", "T015"] }
T029 = { blocked_by = ["T021"] }
T030 = { blocked_by = [] }
T031 = { blocked_by = ["T021", "T029"] }
T032 = { blocked_by = ["T007"] }
T033 = { blocked_by = ["T027", "T028", "T031", "T032"] }
T034 = { blocked_by = ["T022", "T011"] }
T035 = { blocked_by = [] }
```

### Phase Dependencies

- **Setup (Phase 1)** starts immediately.
- **Foundational (Phase 2)** depends on Setup.
- **US1 (Phase 3)** is the MVP and depends on Foundational.
- **US2 (Phase 4)** adds the recording proxy and call list.
- **US3 (Phase 5)** depends on US1 and US2 to anchor schema viewing on both
  registry rows and call rows.
- **US4 (Phase 6)** depends on the proxy from US2 to assert zero overhead
  when off.
- **Polish (Phase 7)** depends on US2/US3.

### Parallel Opportunities

- T001 / T002 / T003 in Setup.
- T005 / T007 in Foundational.
- T008 / T009 / T010 in US1 tests.
- T016 / T017 / T018 / T019 in US2 tests.
- T024 / T025 in US3 tests.
- T029 / T030 in US4 tests.

---

## Implementation Strategy

### MVP First

1. Phases 1-2.
2. Phase 3 (US1) — contract list behind `devMode`, command-palette entry.
3. Stop and validate with a developer reproducing a real bug from the
   contract list alone.

### Incremental Delivery

1. MVP (US1).
2. US2 (recording proxy and call list).
3. US3 (schema viewer and replay for read-only contracts).
4. US4 (hidden-by-default and zero-overhead guarantees).
5. Polish.

---

## Notes

- [P] = different files, no dependencies.
- [Story] = traceability to spec.md user story.
- Avoid: enabling the recording proxy by default; exposing the surface in
  Settings; replaying write contracts without an explicit research
  decision; persisting the call buffer across restarts.
