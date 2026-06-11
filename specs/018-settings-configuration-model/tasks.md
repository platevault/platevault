# Tasks: Settings Configuration Model

**Input**: Design documents from `/specs/018-settings-configuration-model/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Tests are required at the contract and use-case boundary for this
feature because writes mutate persisted state.

**Organization**: Grouped by user story so each story can be delivered
incrementally without breaking prior stories. Tasks marked `MOCKUP-DONE` are
already implemented in the desktop mockup; reuse the existing code.

## Path Conventions

- Desktop: `apps/desktop/src/`
- Rust core (future): `crates/app/core/`, `crates/persistence/db/`,
  `crates/audit/`, `crates/contracts/core/`
- Contracts: `specs/018-settings-configuration-model/contracts/` mirrored to
  `packages/contracts/settings/`

---

## Phase 1: Setup

- [ ] T001 Mirror the four JSON Schemas from
      `specs/018-settings-configuration-model/contracts/` into
      `packages/contracts/settings/` and regenerate TypeScript types.
- [ ] T002 [P] Add a `settings.state.v1.json` schema in
      `packages/contracts/settings/` that captures per-key value sub-schemas
      referenced by `settings.update.json`.

---

## Phase 2: Foundational

- [x] T003 Add a `settings` table and a `source_overrides` table to
      `crates/persistence/db/` migrations: `(key TEXT PRIMARY KEY, value JSON,
      updated_at TEXT)` and `(source_id TEXT, key TEXT, value JSON, updated_at
      TEXT, PRIMARY KEY(source_id, key))`.
- [x] T004 [P] Add a Rust mirror of `SettingsState v1` and `SourceOverride` in
      `crates/contracts/core/src/settings.rs` matching the JSON Schemas.
- [x] T005 [P] Add a `settings` audit event variant to `crates/audit/` with
      fields `key`, `prior_value`, `new_value`, optional `snapshot`.
- [x] T006 Create the `crates/app/core/usecases/settings.rs` module skeleton
      with `get_settings`, `update_setting`, `restore_defaults`,
      `set_source_override` entry points returning typed errors.

**Checkpoint**: persistence, audit, and use-case skeleton ready.

---

## Phase 3: User Story 1 - View and Edit Settings (P1) - MVP

**Goal**: Every visible setting can be read and updated with auto-save through
a typed hook. No global save button. Density-fixed, one-per-line.

**Independent Test**: Open Settings; for each row, change the control; reload;
confirm the new value persists and the audit log shows one entry per
non-noisy change.

### Tests for User Story 1

- [x] T007 [P] [US1] Contract test for `settings.get` in
      `crates/app/core/tests/settings_get.rs` against
      `contracts/settings.get.json`.
- [x] T008 [P] [US1] Contract test for `settings.update` happy path,
      `key.unknown`, `value.invalid`, and the no-op informational path in
      `crates/app/core/tests/settings_update.rs`.
- [ ] T009 [P] [US1] Desktop unit test for `updateSettings` no-op guard and
      `NOISY_KEYS` skip-log behavior in
      `apps/desktop/src/data/settings.test.ts`. Must include:
      (a) primitive no-op (unchanged scalar), (b) a `PatternPart[]` that is
      structurally equal to the stored value — same length, same `id`/`kind`/`value`
      — must be treated as noop (A4, R4.1), (c) a `string[]` for
      `protectedCategories` structurally-equal test case (R-Set-1).
      Also add a pending-DB-reconcile race test: the index route must render a
      loading/pending state while the DB-first gate is resolving (D2).

### Implementation for User Story 1

- [ ] T010 [US1] MOCKUP-DONE: `SettingsState`, `useSettings()`,
      `updateSettings(key, value)`, `NOISY_KEYS`, default table in
      `apps/desktop/src/data/settings.ts`. Keep the localStorage path as the
      offline fallback after T013 lands.
- [ ] T011 [US1] MOCKUP-DONE: `SettingsPage.tsx` rows for every v1 key with
      one-per-line layout, info affordance, and auto-save status text in
      `apps/desktop/src/features/settings/SettingsPage.tsx`.
- [ ] T012 [US1] MOCKUP-DONE: Theme persistence under `alm.theme` in
      `apps/desktop/src/app/theme.tsx`. Keep Appearance section wired to this
      module rather than to `useSettings()`.
- [x] T013 [US1] Implement `get_settings` and `update_setting` use cases in
      `crates/app/core/usecases/settings.rs` with no-op guard, JSON Schema
      validation against the per-key sub-schema, and audit emission for
      non-noisy keys. Implementation notes:
      - No-op guard uses `settings_value_eq(a, b)` — deep structural equality
        for object/array types, strict for primitives (A4, R4.1).
      - `protectedCategories` is `string[]`; structural equality applies
        (element-wise, order-sensitive) (R-Set-1). Cover in T009.
      - Response shape is `{ status: "success"|"noop", key, prior_value,
        new_value, audit_id? }` (E1+E4; no `value.unchanged` error code).
- [x] T014 [US1] Add Tauri commands `settings_get` and `settings_update` in
      `apps/desktop/src-tauri/` wired to the use-case crate.
- [ ] T015 [US1] Replace the localStorage write path in
      `apps/desktop/src/data/settings.ts` with a Tauri dispatch that falls
      back to localStorage only when the backend channel is unavailable.

**Checkpoint**: US1 fully functional with auto-save against SQLite.

---

## Phase 4: User Story 2 - Persistence and Audit (P2)

**Goal**: Settings persist in SQLite, schema is versioned, the audit stream
is readable, noisy keys do not flood the log, and missing or invalid stored
values self-heal.

**Independent Test**: Open the library, edit `pattern` twice and `logLevel`
once; close and reopen; confirm exactly one audit entry exists for
`logLevel` and one `settings.snapshot` entry exists for the noisy keys.

### Tests for User Story 2

- [x] T016 [P] [US2] Integration test that an invalid stored value resets to
      default with one `warn` audit entry in
      `crates/app/core/tests/settings_repair.rs`.
- [ ] T017 [P] [US2] Integration test that updates to `pattern` and
      `protectedCategories` do not emit per-change audit entries but do
      appear in a `settings.snapshot` event in
      `crates/app/core/tests/settings_noisy.rs`.

### Implementation for User Story 2

- [x] T018 [US2] Hydrate defaults at `settings.get` time for missing rows in
      the use-case crate.
- [x] T019 [US2] Validate stored values against the v1 schema on read; on
      failure, delete the bad row and emit a `warn` audit entry.
- [x] T020 [US2] Emit a `settings.snapshot` audit event at session start and
      via a 5-minute inactivity debounce after noisy-key writes (R-Aud-1).
      The "page close" trigger is dropped. Implementation notes:
      - Debounce timer is per-session; resets on each noisy-key write.
      - Fires exactly once when 5 minutes elapse without a noisy write.
      - Timer is cancelled on library close.
      - Test: write a noisy key, write again within 5 min, confirm only one
        snapshot fires; write a noisy key, wait (mock timer), confirm snapshot
        fires exactly once.

**Checkpoint**: US1 + US2 work. Audit stream remains readable under
rapid edits.

---

## Phase 5: User Story 3 - Per-Source Override (P3)

**Goal**: Overridable keys can be overridden per data source root; resolution
order is per-source → global → default.

**Independent Test**: Set `hashOnScan = eager` globally and `hashOnScan = off`
for a specific source; trigger a scan of that source; confirm the override
wins. Attempt to override `logLevel`; confirm `key.unoverridable`.

### Tests for User Story 3

- [x] T021 [P] [US3] Contract test for `settings.source-override.set` in
      `crates/app/core/tests/settings_override_set.rs` covering happy path,
      `source.not_found`, and `key.unoverridable`.
- [x] T022 [P] [US3] Unit test of resolution order in
      `crates/app/core/tests/settings_resolution.rs`.

### Implementation for User Story 3

- [x] T023 [US3] Implement `set_source_override` in
      `crates/app/core/usecases/settings.rs` with overridable-key whitelist
      and source existence check.
- [x] T024 [US3] Add a resolver helper `resolve_setting(key, source_id?)` used
      by scan and protection code paths.
- [ ] T025 [US3] Add the per-source override stub wiring in
      `apps/desktop/src/features/settings/SettingsPage.tsx` (Naming &
      Structure section already exposes the stub; extend it to call the new
      Tauri command).

**Checkpoint**: US1 + US2 + US3 work. Overridable keys honor source overrides.

---

## Phase 6: User Story 4 - Restore Defaults (P4)

**Goal**: A user can restore one key, several keys, or every key to defaults.

**Independent Test**: Change five keys; restore two by name; reload; confirm
two are back to default and the other three are still customized.

### Tests for User Story 4

- [x] T026 [P] [US4] Contract test for `settings.restore-defaults` covering
      empty `keys`, partial `keys`, and `key.unknown` rejection in
      `crates/app/core/tests/settings_restore.rs`.

### Implementation for User Story 4

- [x] T027 [US4] Implement `restore_defaults` by writing the literal in-code
      default value as an explicit row for each requested key (A3). Keys
      already at default are collected in `already_at_default` and skipped
      (no write, no audit event — R-3.1). When all keys are already at
      default, return `status: "noop"`. Otherwise return `status: "success"`
      with `restored` listing keys that were actually written. Emit one
      audit entry per key in `restored`.
- [ ] T028 [US4] Add a "Restore defaults" action to each section header in
      `apps/desktop/src/features/settings/SettingsPage.tsx`, wired to the
      new command.

**Checkpoint**: US1-US4 work.

---

## Phase 7: User Story 5 - Schema Migration (P5)

**Goal**: A future bump from `v1` to `v2` migrates stored settings cleanly
with an audit summary.

**Independent Test**: Run the migration harness with a fixture v1 database;
confirm v2 reads succeed, audit entries summarize counts, and dropped keys
are not silently lost.

### Tests for User Story 5

- [ ] T029 [P] [US5] Migration test in
      `crates/persistence/db/tests/settings_v1_to_v2.rs` using a fixture
      database.

### Implementation for User Story 5

- [ ] T030 [US5] Add a migration module that maps v1 keys to v2 keys with
      explicit drop and reset behavior.
- [ ] T031 [US5] Emit one `info` audit event summarizing migrated, dropped,
      and reset counts.

**Checkpoint**: All user stories complete; the schema can evolve.

---

## Phase 9: Absorbed Key Implementation

Tasks for keys absorbed from cross-spec ratification passes (2026-05-22).

### Group A — Library context + dev mode + UI persistence

- [ ] T035 [US1] Add `current_library_id` (string?, uuid) to `SettingsState`
      and the v1 schema in `packages/contracts/settings/`. Wire to the library
      open/close lifecycle in `crates/app/core/`. Desktop reads this key to
      inject `?lib=` into `<Link>` components (spec 020 R-Lib-V1).
- [ ] T036 [US1] Add `devMode` (boolean, default false) to `SettingsState`.
      Implement compile-time gate in `crates/app/core/usecases/settings.rs`:
      `#[cfg(feature = "dev-tools")]` allows read/write; release build returns
      `devMode: false` on get and rejects update with `value.invalid`. Desktop
      Settings UI hides the row in release builds.
- [ ] T037 [US1] Add `plans.list.default_age_cutoff_days` (number, default 90)
      to `SettingsState`. Mark noisy in `NOISY_KEYS`. Desktop uses this key in
      the plans list to clip the visible terminal-plan window.
- [ ] T038 [US1] Add `rememberFollowLogs` (boolean, default false) to
      `SettingsState` and mark noisy in `NOISY_KEYS`. Desktop log viewer reads
      this key on mount to initialize the follow-tail toggle (spec 019 E-019-3).
      Note: `rememberFollowLogs` was already listed in the original SettingsState
      table; this task wires the noisy classification and default flip from
      `true` to `false` per the spec 019 amendment.

### Group B — Target lookup

- [ ] T039 [US1] Add `target_lookup.active_catalogs` (string[], dynamic default)
      to `SettingsState`. Implement dynamic-default resolution in the use-case:
      no stored row → return full installed catalog id list from spec 014
      manifest. Unknown catalog ids in stored array → filter + warn audit entry.
      Desktop Settings Catalogs section exposes a multi-select for this key.

### Group C — Calibration matching

- [ ] T040 [US1] Add `calibration.dark_temp_tolerance` (number, default 2.0),
      `calibration.prefill_suggestion` (boolean, default true) to `SettingsState`
      and the v1 schema.
- [ ] T041 [US1] Add `calibration.dark.override_penalty`,
      `calibration.flat.override_penalty`, `calibration.bias.override_penalty`
      (number [0,1], default 0.3 each) as three independent structured-path keys.
      Validate the `^calibration\\.(dark|flat|bias)\\.override_penalty$` pattern
      in the use-case; reject unrecognised frame-type slots with `key.unknown`.

### Group D — Tool launching

- [ ] T042 [US1] Add `tools.<tool_id>.bundle_id` structured-path key support.
      Validate `^tools\\.[a-z0-9_]+\\.bundle_id$` in use-case; verify that
      `<tool_id>` references an existing ToolProfile row before writing. Seed
      known-tool defaults at tool registration time in spec 011's ToolProfile
      migration (`tools.pixinsight.bundle_id`, `tools.siril.bundle_id`).

### Group E — Workflow profile watcher

- [ ] T043 [US1] Add `workflow_profile.<profile_id>.watch_extensions` and
      `workflow_profile.<profile_id>.launch_attribution_window_hours` structured-
      path keys. Validate regex patterns in use-case; verify `<profile_id>`
      references an existing WorkflowProfile row. Default for `watch_extensions`
      is `[".xisf",".fits",".fit",".tif",".tiff",".png",".jpg",".ser",".avi"]`.

### Group F — IMAGETYP normalization

- [ ] T044 [US1] Add `imagetyp_normalization.user_mappings`
      (`Array<{imagetyp_string: string, frame_type: FrameType}>`, default `[]`)
      to `SettingsState`. Store as JSON array in `settings.value` column.
      Deep structural equality applies element-wise (R4.1); order is significant.
      Desktop Settings surface exposes a table control for add/remove row.

### Cross-group

- [ ] T045 [P] Update `packages/contracts/settings/settings.state.v1.json` to
      add all newly absorbed keys' value sub-schemas (flat keys and structured-
      path key value shapes). This unblocks T002 and the contract round-trip
      tests in T007/T008.
- [ ] T046 [P] Extend `crates/app/core/tests/settings_update.rs` (T008) to
      cover: (a) structured-path key happy paths for all three pattern groups,
      (b) `devMode` update rejected in release build, (c)
      `calibration.dark_temp_tolerance` out-of-range rejection, (d)
      `imagetyp_normalization.user_mappings` deep-equal noop.

## Phase 8: Polish

- [ ] T032 [P] Remove the `rowDensity` key from `SettingsState` once FR-006 is
      enforced everywhere in the desktop shell; update the v1 schema and
      migration table accordingly.
- [ ] T033 Update `docs/research/` index to point at this feature's
      `research.md`.
- [ ] T034 Quickstart pass: open Settings, change one of every kind of
      control, verify auto-save and audit behavior end-to-end.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = [] }
T004 = { blocked_by = ["T001", "T002"] }
T005 = { blocked_by = [] }
T006 = { blocked_by = ["T003", "T004", "T005"] }
T007 = { blocked_by = ["T006"] }
T008 = { blocked_by = ["T006"] }
T009 = { blocked_by = [] }
T010 = { blocked_by = [] }
T011 = { blocked_by = [] }
T012 = { blocked_by = [] }
T013 = { blocked_by = ["T006", "T007", "T008"] }
T014 = { blocked_by = ["T013"] }
T015 = { blocked_by = ["T014", "T010"] }
T016 = { blocked_by = ["T013"] }
T017 = { blocked_by = ["T013"] }
T018 = { blocked_by = ["T013"] }
T019 = { blocked_by = ["T013", "T016"] }
T020 = { blocked_by = ["T013", "T017"] }
T021 = { blocked_by = ["T006"] }
T022 = { blocked_by = ["T006"] }
T023 = { blocked_by = ["T021", "T022"] }
T024 = { blocked_by = ["T023"] }
T025 = { blocked_by = ["T023", "T024"] }
T026 = { blocked_by = ["T006"] }
T027 = { blocked_by = ["T026", "T013"] }
T028 = { blocked_by = ["T027"] }
T029 = { blocked_by = ["T003"] }
T030 = { blocked_by = ["T029"] }
T031 = { blocked_by = ["T030"] }
T032 = { blocked_by = ["T015"] }
T033 = { blocked_by = [] }
T034 = { blocked_by = ["T015", "T020", "T025", "T028"] }
T035 = { blocked_by = ["T045"] }
T036 = { blocked_by = ["T045"] }
T037 = { blocked_by = ["T045"] }
T038 = { blocked_by = ["T045"] }
T039 = { blocked_by = ["T045"] }
T040 = { blocked_by = ["T045"] }
T041 = { blocked_by = ["T045"] }
T042 = { blocked_by = ["T045"] }
T043 = { blocked_by = ["T045"] }
T044 = { blocked_by = ["T045"] }
T045 = { blocked_by = [] }
T046 = { blocked_by = ["T008", "T035", "T036", "T037", "T038", "T039", "T040", "T041", "T042", "T043", "T044"] }
```

### Phase Dependencies

- **Setup (Phase 1)**: starts immediately.
- **Foundational (Phase 2)**: depends on Setup. Blocks all user stories.
- **US1 (Phase 3)**: MVP. Largely MOCKUP-DONE on the desktop side; backend
  wiring completes it.
- **US2-US5 (Phases 4-7)**: depend on Foundational; can run in priority order
  or in parallel after US1 lands.
- **Polish (Phase 8)**: depends on the stories whose surfaces it touches.

### Parallel Opportunities

- T001 / T002 / T003 / T005 in Setup + Foundational.
- T007 / T008 / T009 in US1 tests.
- T016 / T017 in US2 tests.
- T021 / T022 in US3 tests.
- T035–T044 in Phase 9 (all depend on T045; each group is independent).

---

## Implementation Strategy

### MVP First

1. Phases 1-2.
2. Phase 3 (US1) end-to-end: replace localStorage write path with Tauri while
   keeping the mockup wiring on the desktop.

### Incremental Delivery

1. MVP (US1).
2. US2 (audit + repair).
3. US3 (per-source override).
4. US4 (restore defaults).
5. US5 (schema migration).
6. Polish.

---

## Notes

- [P] = different files, no dependencies.
- [Story] = traceability to spec.md user story.
- MOCKUP-DONE = code already exists in the desktop mockup; reuse, do not
  rewrite.
- Avoid: rewriting `apps/desktop/src/data/settings.ts` from scratch; adding
  keys to `NOISY_KEYS` without a research decision; adding theme to
  `SettingsState`.
