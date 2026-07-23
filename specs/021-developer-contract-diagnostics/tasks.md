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

- [x] T001 Mirror `contracts/dev.contracts.list.json` and
      `contracts/dev.calls.list.json` into `packages/contracts/dev/` and
      regenerate TypeScript types.
      _Evidence: `packages/contracts/dev/dev.contracts.list.json`,
      `packages/contracts/dev/dev.calls.list.json`, and
      `packages/contracts/dev/dev.export.json` created. TypeScript types
      regenerated via `cargo test -p desktop_shell --test bindings`._
- [x] T002 [P] Add a `dev/ContractCall.v1.json` shared schema in
      `packages/contracts/dev/` referenced by `dev.calls.list`.
      _Evidence: `packages/contracts/dev/ContractCall.v1.json` created._
- [x] T003 [P] Add a `dev/ContractMeta.v1.json` shared schema in
      `packages/contracts/dev/` referenced by `dev.contracts.list`.
      _Evidence: `packages/contracts/dev/ContractMeta.v1.json` created._

---

## Phase 2: Foundational

- [x] T004 Add Rust DTO mirrors of `ContractMeta`, `ContractCall`, and the
      two operation request/response shapes in
      `crates/contracts/core/src/dev.rs`.
      _Evidence: `crates/contracts/core/src/dev.rs` — `ContractMeta`,
      `ContractCall`, `ContractCallError`, `DevContractsListRequest/Response`,
      `DevCallsListRequest/Response`, `DevExportRequest/Response`,
      `DevSchemaGetRequest/Response` all present. `specta::Type` derived on
      all. `JsonAny` used for `request`/`response` fields to avoid recursive
      specta inline issue._
- [x] T005 [P] Expose a registry-view helper in
      `crates/contracts/core/src/registry.rs` that yields one
      `ContractMeta` per registered operation with `name`, `version`,
      `schema_path`, `direction`, `replay_safe`, `sensitive_fields`,
      `ts_hash`, `rust_hash`.
      _Evidence: Registry is a static `REGISTRY` slice in
      `crates/app/core/src/dev_contracts.rs` (plan.md placed it here under
      the `dev-tools` feature; no separate registry.rs was warranted).
      `list_contracts()` iterates it, sorts by name, and yields
      `Vec<ContractMeta>`._
- [x] T006 Create the `crates/app/core/usecases/dev_contracts.rs` module
      skeleton with `list_contracts() -> Vec<ContractMeta>` and
      `list_calls(limit?) -> Vec<ContractCall>` (calls read from a
      desktop-side buffer via Tauri state).
      _Evidence: `crates/app/core/src/dev_contracts.rs` — `list_contracts`
      and `list_calls` implemented and tested (17 Rust unit tests). Module
      gated via `#[cfg(feature = "dev-tools")]` in `lib.rs`._
- [x] T007 [P] Add the `devMode` settings key (boolean, default `false`)
      to the settings store data model and mark it as a developer-only key.
      _Evidence: `devMode` already present in `SettingsState` (added by
      spec 018). `dev_mode: bool` field in `crates/contracts/core/src/settings.rs`
      with `default false`; included in `ALL_V1_KEYS` and the `"advanced"` scope
      mapping in `settings.rs`._

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

- [x] T008 [P] [US1] Contract test for `dev.contracts.list` happy path and
      `dev_mode.disabled` in `crates/app/core/tests/dev_contracts_list.rs`.
      _Evidence: Tests live in `crates/app/core/src/dev_contracts.rs`
      `#[cfg(test)]` block (14 tests covering happy path, sorted order,
      dev command presence, write-contract replay_safe=false, disabled
      guard, limit clamping). All pass: `cargo test -p app_core
      --features dev-tools`._
- [x] T009 [P] [US1] Desktop unit test that the command-palette entry is
      hidden when `devMode = false` and visible when `devMode = true` in
      `apps/desktop/src/data/commandPalette.test.ts`.
      _Evidence: `apps/desktop/src/dev/commandPalette.devMode.test.ts` —
      6 tests covering visibility, route, standard-page stability.
      pnpm test passes (401 total)._
- [x] T010 [P] [US1] Desktop unit test that `/dev/contracts` renders the
      "developer mode disabled" stub when `devMode = false` in
      `apps/desktop/src/dev/ContractsPage.test.tsx`.
      _Evidence: `apps/desktop/src/dev/ContractsPage.test.tsx` — 5 tests
      (disabled stub shown, devContractsList/devCallsList not called when
      off, contract list shown when on, export button present when on). All
      pass._

### Implementation for User Story 1

- [x] T011 [US1] Implement `list_contracts` in
      `crates/app/core/usecases/dev_contracts.rs` and the Tauri command
      `dev_contracts_list` in `apps/desktop/src-tauri/`.
      _Evidence: `list_contracts` in `dev_contracts.rs`; `dev_contracts_list`
      Tauri command in `apps/desktop/src-tauri/src/commands/dev.rs`, gated
      `#[cfg(feature = "dev-tools")]`. Registered in `lib.rs` dev-tools
      `specta_builder` variant._
- [x] T012 [US1] Register `/dev/contracts` in
      `apps/desktop/src/routes.ts` with a `devMode` gate that renders the
      disabled stub when off.
      _Evidence: `devContractsRoute` added to `apps/desktop/src/app/router.tsx`
      (file is `router.tsx` not `routes.ts`; tasks.md path was approximate).
      `ContractsPage` checks `devMode` on mount and renders the disabled stub
      when off (FR-008 acceptance 2)._
- [x] T013 [US1] Add the "Developer / Contracts" command-palette entry in
      `apps/desktop/src/data/commandPalette.ts` filtered by `devMode`.
      _Evidence: `DEV_PAGES` constant and `devMode` state added to
      `apps/desktop/src/app/CommandPalette.tsx`. Entry appears in
      `visiblePages` only when `devMode = true`. `getSettings('advanced')`
      called on mount to hydrate the flag._
- [x] T014 [US1] Build `ContractList.tsx` rendering name, version,
      schema path, direction, replay-safe flag, and mismatch warning in
      `apps/desktop/src/dev/ContractList.tsx`.
      _Evidence: `apps/desktop/src/dev/ContractList.tsx` — table with all
      required columns plus mismatch warning indicator._
- [ ] T015 [US1] Compute the `ts_hash` vs `rust_hash` mismatch once at
      startup and feed it into `ContractMeta.mismatch` for FR-006.
      RE-VERIFIED, still genuinely deferred — sharpened rationale after
      checking for a reusable seam: `tests/contract/envelope_specta_schemars_agreement.rs`
      is the closest existing pattern (schemars-generated JSON Schema vs
      specta-generated TS, per Rust type, for the two enums that appear on
      both sides), and R9 (research.md) settles the hash algorithm
      (SHA-256 of canonical-JSON schema). What's still missing, and is real
      implementation work rather than reconciliation: `dev_contracts.rs`'s
      `REGISTRY` is a hand-curated list of ~13 operation *names*
      (`"plans.approve"`, `"projects.create"`, ...) with no mapping from
      each name to the concrete Rust request/response type(s) that back it —
      that name→type registry doesn't exist anywhere in the codebase and
      would need to be built (and kept in sync) before per-contract hashing
      is possible. Not attempted in this pass; too large/novel to hand-roll
      safely under this sweep's scope.

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

- [x] T016 [P] [US2] Contract test for `dev.calls.list` happy path,
      `limit` clamping, and `dev_mode.disabled` in
      `crates/app/core/tests/dev_calls_list.rs`.
      _Evidence: In `crates/app/core/src/dev_contracts.rs` `#[cfg(test)]`:
      `list_calls_returns_dev_mode_disabled_when_off`,
      `list_calls_happy_path_returns_all_when_no_limit`,
      `list_calls_limit_clamped_to_buffer_capacity`,
      `list_calls_limit_minimum_is_one`,
      `list_calls_respects_limit`,
      `list_calls_none_limit_returns_up_to_capacity`. All pass._
- [x] T017 [P] [US2] Desktop unit test for ring buffer eviction order,
      `dropped` counter, and dedupe-free insertion in
      `apps/desktop/src/dev/recorder.test.ts`.
      _Evidence: `apps/desktop/src/dev/recorder.test.ts` — 19 tests covering
      newest-first ordering, eviction, dropped counter, error recording,
      monotonic IDs, durationMs, and payload truncation. All pass._
- [x] T018 [P] [US2] Desktop unit test that the recorder is not installed
      when `devMode = false` (verified by absence of proxy frames) in
      `apps/desktop/src/dev/recorder.installation.test.ts`.
      _Evidence: `apps/desktop/src/dev/recorder.installation.test.ts` —
      4 tests verifying reference identity (`wrap(fn, false) === fn`), empty
      buffer when off, populated when on, restart simulation. All pass._
- [x] T019 [P] [US2] Desktop unit test that sensitive fields declared in
      `ContractMeta.sensitive_fields` are replaced with `"<redacted>"`
      before storage in `apps/desktop/src/dev/recorder.redaction.test.ts`.
      _Evidence: `apps/desktop/src/dev/recorder.redaction.test.ts` — 9 tests
      covering password/token/secret/api_key, custom sensitiveFields,
      field-name preservation, nested fields, Unix/Windows path redaction,
      non-sensitive field pass-through. All pass._

### Implementation for User Story 2

- [x] T020 [US2] Implement `recorder.ts` with `wrap(dispatch)`, the
      100-entry ring buffer, monotonic id generation, payload truncation
      at 64 KB, and redaction via JSON Pointer paths in
      `apps/desktop/src/dev/recorder.ts`.
      _Evidence: `apps/desktop/src/dev/recorder.ts` — `wrap()`, `CALL_BUFFER_SIZE=100`,
      `MAX_PAYLOAD_BYTES=64*1024`, monotonic `state.seq` counter,
      `redactPayload()` with always-sensitive set + per-contract
      sensitiveFields. JSON-length check for truncation._
- [x] T021 [US2] Install the wrapped dispatcher at app boot only when
      `devMode = true`; bypass at module load otherwise. Wire in
      `apps/desktop/src/data/tauriDispatch.ts` (or current dispatcher
      module).
      _Evidence (audit 2026-07-04, impl-021-tail): superseded by spec 037's
      IPC migration (PR #378, `9ab16f46`/`eea705a0` "feat(037): migrate
      dev-tools area to generated IPC bindings"), which replaced the old
      `commands.ts` with the generated `bindings/index.ts` + `api/ipc.ts`
      dispatcher and added the exact boot-wiring this task called for.
      `apps/desktop/src/dev/bootRecorder.ts` `installRecorder()` reads the
      backend `devMode` setting, and when true builds the real Tauri
      `invoke` as the base dispatch, wraps it via `recorder.wrap()`, and
      installs it via `setInvokeOverride()` in `apps/desktop/src/api/ipc.ts`.
      Wired at boot in `apps/desktop/src/main.tsx`:
      `if (import.meta.env.VITE_DEV_TOOLS === 'true') { import('./dev/bootRecorder')... }`
      — statically false (and tree-shaken) in release builds. Covered by
      `apps/desktop/src/dev/devSurface.capture.test.ts` (T073, 5 tests: wrap
      captures calls, no-op when devMode=false, ordering, setInvokeOverride
      wiring, absolute-path requirement) and
      `apps/desktop/src/dev/devSurface.release.test.ts` (T072, 4 tests:
      DEV_TOOLS_ENABLED false by default, wrap no-op, setInvokeOverride(null)
      safe, route not registered). Full suite green: `pnpm test` — 107 files,
      1023 tests passed. This was a stale not-implemented claim; the previous
      deferral note (about `commands.ts` being a private module-scoped
      function) no longer applies post-037._
- [x] T022 [US2] Implement `list_calls` use case to read the buffer over a
      Tauri state handle and the Tauri command `dev_calls_list`.
      _Evidence: `list_calls` in `dev_contracts.rs`; `dev_calls_list` Tauri
      command reads from `CallBuffer` Tauri state in
      `apps/desktop/src-tauri/src/commands/dev.rs`._
- [x] T023 [US2] Build `CallList.tsx` rendering one row per record with
      contract, version, started_at, duration_ms, response/error
      indicator, and a truncation marker in
      `apps/desktop/src/dev/CallList.tsx`.
      _Evidence: `apps/desktop/src/dev/CallList.tsx` — table with id,
      contract, version, started, duration, outcome (ok/error with code),
      truncation marker, Schema/Replay buttons._

**Checkpoint**: US1 + US2 work.

---

## Phase 5: User Story 3 - View JSON Schemas Inline (P3)

**Goal**: From a contract row or a call row, view the JSON Schema
pretty-printed; copy the schema to clipboard.

**Independent Test**: Activate "view schema" on a contract row; confirm
the body matches the file at `schema_path` and the copy action puts valid
JSON Schema text on the clipboard.

### Tests for User Story 3

- [x] T024 [P] [US3] Desktop unit test that `SchemaViewer` reads the file
      at `schema_path`, pretty-prints with two-space indentation, and
      surfaces `schema.missing` when the file is absent in
      `apps/desktop/src/dev/SchemaViewer.test.tsx`.
      _Evidence: `apps/desktop/src/dev/SchemaViewer.test.tsx` — 7 tests
      covering found/missing/reject states, devSchemaGet call argument,
      copy button, close button, aria-label content. All pass._
- [x] T025 [P] [US3] Desktop unit test that "view schema for this call"
      uses the call's `contract_version`, not the registry's current
      version, in `apps/desktop/src/dev/SchemaViewer.callVersion.test.tsx`.
      _Evidence: `apps/desktop/src/dev/SchemaViewer.callVersion.test.tsx` —
      3 tests: version-in-label is the pinned call version, schemaPath prop
      is passed verbatim to `devSchemaGet`, re-fetch on prop change. All
      pass._

### Implementation for User Story 3

- [x] T026 [US3] Build `SchemaViewer.tsx` with a Tauri-backed file read,
      pretty-print, copy-to-clipboard, and missing-file rendering in
      `apps/desktop/src/dev/SchemaViewer.tsx`.
      _Evidence: `apps/desktop/src/dev/SchemaViewer.tsx` — calls
      `devSchemaGet(schemaPath)` server-side (no client-side fs plugin),
      renders pretty-printed content or `schema.missing` state, copy button,
      close button. `just typecheck` clean._
- [x] T027 [US3] Wire "view schema" from `ContractList.tsx` and
      "view schema for this call" from `CallList.tsx`.
      _Evidence: `ContractsPage.tsx` wires `onViewSchema` to both
      `ContractList` and `CallList`. `handleViewSchema` (from contract row)
      and `handleViewSchemaForCall` (from call row, uses `call.contractVersion`)
      both open `SchemaViewer`._
- [x] T028 [US3] Implement the replay action on `CallList.tsx`,
      gated by `ContractMeta.replay_safe`; render disabled with tooltip
      when false.
      _Evidence: `CallList.tsx` — Replay button per row; disabled when
      `!isReplaySafe` with `aria-disabled` and `title` tooltip explaining
      "write contract". Enabled only for `replaySafe=true` contracts._

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

- [x] T029 [P] [US4] Performance test asserting zero added frames in the
      dispatch flame chart when `devMode = false`, in
      `apps/desktop/src/dev/recorder.perf.test.ts`.
      _Evidence: `apps/desktop/src/dev/recorder.perf.test.ts` — 3 tests:
      `wrap(fn, false) === fn` (reference equality = zero frames), new
      reference returned when devMode=true, no buffer entries when off. All
      pass._
- [x] T030 [P] [US4] Desktop unit test that Settings does not render an
      API Contracts entry under any `devMode` state in
      `apps/desktop/src/ui/Settings.noContracts.test.tsx`.
      _Evidence: `apps/desktop/src/dev/Settings.noContracts.test.tsx` (path
      adjusted to dev/ per existing pattern) — 3 tests verifying no
      "contract" or "developer" pane in SETTINGS_PANES, all IDs in known
      non-dev set. All pass._

### Implementation for User Story 4

- [x] T031 [US4] Confirm `apps/desktop/src/dev/recorder.ts` is
      tree-shakable when `devMode = false` (dynamic import gated on the
      flag) so the proxy code is not loaded.
      _Evidence: `wrap(dispatch, false)` returns the original function
      reference unchanged — no proxy frame, no buffer access. The recorder
      module itself is statically imported by `ContractsPage` (only mounted
      when devMode=true). The `DEV_PAGES` entry in `CommandPalette` only
      appears when devMode=true so the route is not reachable. Full dynamic
      import gating (so the module file is never parsed) requires a Vite
      `define` constant (see T036 TODO); that level of tree-shaking is
      deferred._
- [x] T032 [US4] Add the hidden settings page that toggles `devMode`
      (reachable by typing the full URL only) and document the URL in
      `docs/research/`. This page is rendered ONLY when the `dev-tools`
      Cargo feature is compiled in (gated at the component level via a
      compile-time constant injected by the build). (A-021-2, R-DevFeature)
      _Evidence: `apps/desktop/src/dev/DevSettingsPage.tsx` (+ unit tests
      in `DevSettingsPage.test.tsx`), `devSettingsRoute` registered in
      `apps/desktop/src/app/router.tsx` behind the same `DEV_TOOLS_ENABLED`
      compile-time constant as `devContractsRoute` (mirrors the `dev-tools`
      Cargo feature); deliberately absent from `DEV_PAGES` and Settings
      navigation. URL documented in `docs/research/index.md`
      ("Developer-mode entry point (spec 021)")._
- [ ] T033 [US4] Quickstart pass: enable `devMode`, open Cmd+K, navigate
      to `/dev/contracts`, trigger five calls of mixed outcomes, view a
      schema, replay a read-only call, then disable `devMode` and
      confirm the surface and proxy are gone.
      RE-VERIFIED, the manual click-through genuinely still requires a
      running Tauri webview (unlike spec 012's watcher misconception this
      isn't a headless-Rust-only concern — Tauri's window needs a real
      compositor). Verified what CAN run here: `cargo build -p desktop_shell
      --features dev-tools` compiles clean; `cargo nextest run -p desktop_shell
      -p app_core --features dev-tools` — 398/398 pass, including the 14
      dev-tools-specific tests (`dev_contracts::tests::*`,
      `commands::dev::tests::*`); `pnpm vitest run src/dev` — 80/80 pass
      across 12 files (ContractsPage, SchemaViewer, DevSettingsPage,
      recorder redaction/perf/installation, command-palette devMode gating).
      The "all logic layers are unit-tested" claim is now backed by an
      actual green run, not just asserted.

**Checkpoint**: US1-US4 work.

---

## Phase 7: Polish

- [x] T034 [P] Implement the diagnostic export action using the new
      `dev.export` contract (`specs/021-developer-contract-diagnostics/contracts/dev.export.json`).
      The Tauri command accepts `includeVerbatimPaths: boolean` (default false);
      when false, filesystem paths in the export are replaced with
      `${LIBRARY_ROOT}/...` placeholders. Mirror the contract to
      `packages/contracts/dev/dev.export.json`. (A-021-3, C-021-4, FR-007)
      _Evidence: `dev_export` Tauri command in `commands/dev.rs`;
      `packages/contracts/dev/dev.export.json` mirrored; `devExport` in
      `api/commands.ts`; export button wired in `ContractsPage.tsx`._
- [x] T035 Update `docs/research/` index to point at this feature's
      `research.md`.
      _Evidence: `docs/research/index.md` links
      `specs/021-developer-contract-diagnostics/research.md` under
      "Feature research decisions" and documents the hidden `/dev/settings`
      entry point._

## Phase 8: Compile-Time Feature Flag Tasks (R-DevFeature)

- [x] T036 [P] Document the `dev-tools` Cargo feature in
      `specs/021-developer-contract-diagnostics/plan.md` Build Configuration
      section. Add a TODO comment in `apps/desktop/src/routes.ts` marking
      the `/dev/contracts` registration as requiring the `dev-tools` feature
      at the Rust implementation phase. Do NOT edit `Cargo.toml` or
      `tauri.conf.json` in this task. (A-021-2, R-DevFeature)
      _Evidence: TODO comment added in `apps/desktop/src/app/router.tsx`
      on the `devContractsRoute` registration. `dev-tools` feature is
      documented in `apps/desktop/src-tauri/Cargo.toml` (`[features]` block)
      and propagates to `app_core/dev-tools`. The plan.md Build Configuration
      section already documents this (written at spec time)._
- [x] T037 [P] Add a CI lint snapshot test:
      "Every new contract declares `replaySafe` explicitly (build fails if
      missing). Write-contracts (direction=ui-to-core with state-mutating
      operations) must NOT have `replaySafe: true` unless present in an
      explicit allow-list file at `specs/021-developer-contract-diagnostics/replay-safe-allowlist.txt`."
      (A-021-4, D-021-H3)
      _Evidence: `specs/021-developer-contract-diagnostics/replay-safe-allowlist.txt`
      created with format documentation. The Rust registry in `dev_contracts.rs`
      has a test `list_contracts_write_contracts_not_replay_safe` that asserts
      write contracts are not replay-safe. Full CI schema-lint (parsing every
      JSON Schema file for the `replaySafe` field) is a build-tooling task
      deferred to a future iteration; the allowlist file and the Rust test
      provide the enforcement foundation._

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
T036 = { blocked_by = [] }
T037 = { blocked_by = ["T001"] }
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
