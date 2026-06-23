# Tasks: Settings Configuration Model

**Input**: Design documents from `/specs/018-settings-configuration-model/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Tests are required at the contract and use-case boundary for this
feature because writes mutate persisted state.

**Organization**: Grouped by user story so each story can be delivered
incrementally without breaking prior stories. Tasks marked `MOCKUP-DONE` are
already implemented in the desktop mockup; reuse the existing code.

> **Reconciled 2026-06-23** against as-built code (specs 035/041/042). Scope/values
> transport is canonical; domain types live in `crates/domain/core/src/settings.rs`
> (re-exported by `crates/contracts/core`); use-case layer is
> `crates/app/settings/src/lib.rs` (`app_core_settings`, re-exported as `app_core::settings`)
> with key metadata in `descriptors.rs` (`DESCRIPTORS` table, 29 keys); low-level
> storage in `crates/persistence/db/src/repositories/settings.rs`; Tauri adapter in
> `apps/desktop/src-tauri/src/commands/settings.rs`; flat absorbed-key fields replace
> structured-path keys for penalties and watcher config; `packages/contracts/settings/`
> mirror was never built (obsolete); `crates/app/core/usecases/settings.rs` does not
> exist. See `pending-iteration.md`.

## Path Conventions

- Desktop: `apps/desktop/src/`
- Rust core: `crates/domain/core/`, `crates/persistence/db/`,
  `crates/audit/`, `crates/contracts/core/`
- Tauri commands: `apps/desktop/src-tauri/src/commands/settings.rs`
- Desktop API: `apps/desktop/src/api/commands.ts`
- Contracts: `specs/018-settings-configuration-model/contracts/` mirrored to
  `packages/contracts/schemas/` (canonical) and `crates/contracts/core/`

---

## Phase 1: Setup

- [~] T001 **OBSOLETE** — `packages/contracts/settings/` schema mirror was never built; canonical contracts are `crates/contracts/core` + `packages/contracts/schemas`.
- [~] T002 [P] **OBSOLETE** — `settings.state.v1.json` per-key sub-schema mirror was never built; same reason as T001.

---

## Phase 2: Foundational

- [x] T003 Add a `settings` table and a `source_overrides` table to
      `crates/persistence/db/` migrations: `(key TEXT PRIMARY KEY, value JSON,
      updated_at TEXT)` and `(source_id TEXT, key TEXT, value JSON, updated_at
      TEXT, PRIMARY KEY(source_id, key))`.
- [x] T004 [P] Add `SettingsState v1` and `SourceOverride` types in
      `crates/domain/core/src/settings.rs` (PatternPart, ImageTypMapping,
      SettingsState, SourceOverride); re-exported by `crates/contracts/core/src/settings.rs`
      (spec 042 T254).
- [x] T005 [P] Add `SettingsChanged` / `SettingsSnapshot` / `SettingsRepair` audit
      event variants in `crates/audit/src/event_bus.rs` with fields `key`,
      `prior_value`, `new_value`, optional `snapshot`.
- [x] T006 Use-case skeleton realized in `crates/app/settings/src/lib.rs`
      (crate `app_core_settings`, re-exported as `app_core::settings`): entry
      points `get_settings`, `update_setting` (no-op guard via `settings_value_eq`,
      validation, audit emission), `restore_defaults`, `set_source_override`,
      `resolve_setting`, `emit_snapshot`. Key metadata (key set, noisy membership,
      overridable membership, defaults) is descriptor-driven from
      `crates/app/settings/src/descriptors.rs` (`DESCRIPTORS` table, 29 keys).
      Low-level storage in `crates/persistence/db/src/repositories/settings.rs`
      (get_raw/set_raw/load_settings/patterns_by_type helpers). Tauri adapter:
      `apps/desktop/src-tauri/src/commands/settings.rs`.
      NOTE: there is NO `crates/app/core/usecases/settings.rs`.

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
- [x] T009 [P] [US1] Desktop unit test for the settings data/hook module no-op guard
      and `NOISY_KEYS` skip-log behavior. NOTE: `apps/desktop/src/data/settings.ts`
      does NOT exist; retarget to the real desktop settings layer — section panes use
      `apps/desktop/src/features/settings/useAutoSave.ts` + `apps/desktop/src/api/commands.ts`.
      Must include: (a) primitive no-op (unchanged scalar), (b) a `PatternPart[]`
      structurally equal to the stored value — same length, same `id`/`kind`/`value`
      — treated as noop (A4, R4.1), (c) a `string[]` for `protectedCategories`
      structurally-equal test case (R-Set-1).
      Also add a pending-DB-reconcile race test: the index route must render a
      loading/pending state while the DB-first gate is resolving (D2).

### Implementation for User Story 1

- [x] T010 [US1] MOCKUP-DONE: `SettingsState`, `useSettings()`,
      `updateSettings(key, value)`, `NOISY_KEYS`, default table in
      `apps/desktop/src/data/settings.ts`. Keep the localStorage path as the
      offline fallback after T013 lands.
- [x] T011 [US1] MOCKUP-DONE: `SettingsPage.tsx` rows for every v1 key with
      one-per-line layout, info affordance, and auto-save status text in
      `apps/desktop/src/features/settings/SettingsPage.tsx`.
- [x] T012 [US1] MOCKUP-DONE: Theme persistence under `alm.theme` in
      `apps/desktop/src/app/theme.tsx`. Keep Appearance section wired to this
      module rather than to `useSettings()`.
- [x] T013 [US1] Get/update use case with no-op guard, validation, and audit
      emission realized in `crates/app/settings/src/lib.rs` (`update_setting`).
      Implementation notes:
      - No-op guard uses `settings_value_eq(a, b)` — deep structural equality
        for object/array types, strict for primitives (A4, R4.1).
      - `protectedCategories` is `string[]`; structural equality applies
        (element-wise, order-sensitive) (R-Set-1). Cover in T009.
      - Response shape is `{ status: "success"|"noop", key, prior_value,
        new_value, audit_id? }` (E1+E4; no `value.unchanged` error code).
      NOTE: there is NO `crates/app/core/usecases/settings.rs`.
- [x] T014 [US1] Add Tauri commands `settings_get` and `settings_update` in
      `apps/desktop/src-tauri/` wired to the use-case crate.
- [x] T015 [US1] Desktop Tauri dispatch realized in `apps/desktop/src/api/commands.ts`
      (settingsGet / settingsUpdate); localStorage path is replaced by the Tauri
      backend. NOTE: `apps/desktop/src/data/settings.ts` does not exist; the
      canonical desktop binding is `apps/desktop/src/api/commands.ts`.

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
- [x] T017 [P] [US2] Integration test that updates to `pattern` and
      `protectedCategories` do not emit per-change audit entries but do
      appear in a `settings.snapshot` event. NOTE: core behavior is already
      covered by unit tests (`emit_snapshot_fires_and_publishes_event`;
      noop + non-noisy-emits in `crates/app/core/tests/settings_logs_integration.rs`);
      a dedicated noisy-suppression integration test may still be added for
      completeness.

### Implementation for User Story 2

- [x] T018 [US2] `load_settings` hydrates defaults for missing rows; default
      values and noisy/overridable membership come from `DESCRIPTORS` in
      `crates/app/settings/src/descriptors.rs`.
- [x] T019 [US2] Invalid stored-value repair → deletes bad row and emits
      `SettingsRepair` warn audit entry (implemented in `crates/app/settings/src/lib.rs`
      using low-level repo helpers).
- [x] T020 [US2] `emit_snapshot` in `crates/app/settings/src/lib.rs` called at
      `"session_start"` and `"debounce_5min"` from
      `apps/desktop/src-tauri/src/lib.rs`. The 5-minute inactivity debounce is
      fully wired and unit-tested (`emit_snapshot_fires_and_publishes_event`).

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
- [x] T025 [US3] Add the per-source override stub wiring in
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
- [x] T028 [US4] Add a "Restore defaults" action to each section header in
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

- [x] T029 [P] [US5] Migration test in
      `crates/persistence/db/tests/settings_v1_to_v2.rs` using a fixture
      database.

### Implementation for User Story 5

- [x] T030 [US5] Add a migration module that maps v1 keys to v2 keys with
      explicit drop and reset behavior.
- [x] T031 [US5] Emit one `info` audit event summarizing migrated, dropped,
      and reset counts.

**Checkpoint**: All user stories complete; the schema can evolve.

---

## Phase 9: Absorbed Key Implementation

Tasks for keys absorbed from cross-spec ratification passes (2026-05-22).

### Group A — Library context + dev mode + UI persistence

- [x] T035 [US1] `current_library_id` (string?, uuid) field on `SettingsState`
      in `crates/domain/core/src/settings.rs`. Desktop reads this key to
      inject `?lib=` into `<Link>` components (spec 020 R-Lib-V1).
- [x] T036 [US1] `devMode` (bool, default false) on `SettingsState`. Compile-time
      release gate is enforced: `crates/app/settings/src/descriptors.rs` uses
      `#[cfg(not(feature = "dev-tools"))]` to reject devMode writes ("devMode
      cannot be set in release builds") and force `dev_mode: false` on get.
      The `dev-tools` Cargo feature forwards `app_core` → `app_core_settings`.
- [x] T037 [US1] `plans_list_default_age_cutoff_days` (number, default 90)
      field on `SettingsState`. Marked noisy. Desktop uses this key in the plans
      list to clip the visible terminal-plan window.
- [x] T038 [US1] `rememberFollowLogs` is noisy in `descriptors.rs` (DESCRIPTORS
      table) and defaults to `false` in `crates/domain/core/src/settings.rs`
      (spec 019 E-019-3 default flip from `true`). Desktop log viewer reads this
      on mount.

### Group B — Target lookup

- [~] T039 [US1] **OBSOLETE** — `target_lookup.active_catalogs` references spec 014 catalog manifest, which is superseded by spec 035 (SIMBAD resolve-on-demand). No manifest exists; this key is dropped.

### Group C — Calibration matching

- [x] T040 [US1] `calibration_dark_temp_tolerance` (number, default 2.0) and
      `calibration_prefill_suggestion` (boolean, default true) fields on
      `SettingsState` in `crates/domain/core/src/settings.rs`.
- [x] T041 [US1] Three FLAT typed fields on `SettingsState`:
      `calibration_dark_override_penalty`, `calibration_flat_override_penalty`,
      `calibration_bias_override_penalty` (f64 in [0,1], default 0.3 each).
      These are NOT structured-path keys; they are ordinary typed fields in
      `crates/domain/core/src/settings.rs`, with descriptors in
      `crates/app/settings/src/descriptors.rs`.

### Group D — Tool launching

- [x] T042 [US1] `tools.<tool_id>.bundle_id` per-tool key: validate `<tool_id>`
      against existing ToolProfile rows in `crates/workflow/profiles` before writing.
      This remains a per-tool structured key (not a flat field). Consumed by spec 011
      tool launch. Seed known-tool defaults at ToolProfile registration time
      (`tools.pixinsight.bundle_id`, `tools.siril.bundle_id`).

### Group E — Workflow profile watcher

- [x] T043 [US1] Add TWO FLAT GLOBAL fields to `SettingsState` (replaces the
      now-dropped per-profile structured-path keys and the nonexistent
      WorkflowProfile model):
      - `tool_watch_extensions` (string[], default `[".xisf",".fits",".fit",".tif",
        ".tiff",".png",".jpg",".ser",".avi"]`): global allow-list of extensions
        monitored by the artifact-observation watcher.
      - `tool_attribution_window_hours` (number, default 6): global attribution
        window for matching artifacts to tool launches.
      Consumed by spec 012's artifact-observation watcher (currently partial;
      dependency noted).

### Group F — IMAGETYP normalization

- [x] T044 [US1] `imagetyp_normalization_user_mappings`
      (`Vec<ImageTypMapping>`, default `[]`) field on `SettingsState`. Stored as
      JSON array in `settings.value` column. Deep structural equality applies
      element-wise (R4.1); order is significant. Desktop Settings surface exposes
      a table control for add/remove row.

### Cross-group

- [~] T045 [P] **OBSOLETE** — extends the `packages/contracts/settings/` mirror that was never built; obsolete with T001/T002. Canonical = `crates/contracts/core` + `packages/contracts/schemas`.
- [x] T046 [P] Extend `crates/app/core/tests/settings_update.rs` (T008) to
      cover: (a) structured-path key happy paths for all three pattern groups,
      (b) `devMode` update rejected in release build, (c)
      `calibration.dark_temp_tolerance` out-of-range rejection, (d)
      `imagetyp_normalization.user_mappings` deep-equal noop.

## Phase 8: Polish

- [x] T032 [P] Remove the `rowDensity` key from `SettingsState` once FR-006 is
      enforced everywhere in the desktop shell; update the v1 schema and
      migration table accordingly.
- [x] T033 Update `docs/research/` index to point at this feature's
      `research.md`.
- [x] T034 Quickstart pass: open Settings, change one of every kind of
      control, verify auto-save and audit behavior end-to-end.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = [] }
T004 = { blocked_by = [] }  # DONE; T001/T002 obsolete
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
T035 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T036 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T037 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T038 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T039 = { blocked_by = [] }  # OBSOLETE
T040 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T041 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T042 = { blocked_by = [] }  # open; was blocked by T045 (now obsolete)
T043 = { blocked_by = [] }  # open; was blocked by T045 (now obsolete)
T044 = { blocked_by = [] }  # DONE; was blocked by T045 (now obsolete)
T045 = { blocked_by = [] }  # OBSOLETE
T046 = { blocked_by = ["T008", "T042", "T043"] }  # T036/T038/T039/T041/T044 done or obsolete
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
