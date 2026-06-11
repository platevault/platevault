---
description: "Task list for 007-calibration-matching-rules"
---

# Tasks: Calibration Matching Rules

**Input**: Design documents from `/specs/007-calibration-matching-rules/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (dark) / US2 (flat) / US3 (bias) / US4 (override)
- Paths assume the monorepo layout from `plan.md`

---

## Phase 1: Setup

- [x] T001 Add `crates/calibration/core/Cargo.toml` entry to workspace if not present; confirm crate compiles empty. — Already in workspace; updated with serde/uuid deps; 66 tests pass.
- [ ] T002 [P] Add JSON Schema validation harness for `packages/contracts/schemas/calibration.match.*.json` in `tests/contracts/`. — DEFERRED: JSON Schema validator in tests/contract/ requires jsonschema crate not yet in workspace. Schemas live in specs/007.../contracts/ and are validated structurally by the Rust DTO tests in contracts_core.
- [x] T003 [P] Add migration scaffold `crates/persistence/db/migrations/00X_calibration_matches.sql` for `calibration_assignment` and `calibration_rule_config` tables (empty bodies acceptable here). — Done: migration 0022_calibration_assignments.sql + 0023_calibration_fingerprints.sql; all persistence_db tests pass.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 Define core enums and structs in `crates/calibration/core/src/lib.rs`: `CalibrationType`, `Dimension`, `SoftDimension`, `MatchingRuleConfig`. — Done: `CalibrationKind`, `Dimension`, `SessionInfo`, `MasterInfo` in lib.rs; `MatchingRuleConfig` + `SoftDimConfig` in ranking.rs.
- [x] T005 Define `CalibrationMatch`, `MatchedDim`, `MismatchedDim`, `SelectionReason` in `crates/calibration/core/src/candidate.rs`. — Done: all types with invariant-3 clamp; 5 unit tests.
- [x] T006 [P] Define `CalibrationAssignment` row mapping in `crates/persistence/db/src/calibration_assignment.rs`. — Done: `CalibrationAssignmentRow` + `UpsertParams`; 7 async tests pass.
- [x] T007 [P] Mirror DTOs in `crates/contracts/core/src/calibration_match.rs` and verify they match the JSON Schemas. — Done: full DTO set for suggest/assign/batch; specta bindings export cleanly (bindings test passes).
- [x] T008 Implement the `Matcher` trait and shared confidence/ranking utility in `crates/calibration/core/src/ranking.rs`. — Done: `rank_matches`, `suggest_status`, `flat_selection_reason`, `night_distance`, `SoftDimConfig`; 12 unit tests.
- [x] T009 Complete migration body in `crates/persistence/db/migrations/00X_calibration_matches.sql` (tables, unique constraint on `(session_id, calibration_type)`, JSON tolerance payload column). — Done: migrations 0022 (calibration_assignment) and 0023 (calibration_fingerprint + acquisition_fingerprint); DB constraint tests pass.
- [x] T010 Wire `MatchingRuleConfig` defaults loader in `crates/calibration/core/src/lib.rs` consuming the existing settings keys (`darkMatchTolerance`, `flatMatching`, `suggestCalibration`) from persistence. — Done: `load_config()` in app_core/calibration.rs reads `calibration.dark_temp_tolerance`, override_penalty keys, and `calibration.prefill_suggestion` from settings store.

**Checkpoint**: Foundation ready — user story tasks may begin.

---

## Phase 3: User Story 1 — Dark Matching (Priority: P1)

**Goal**: Ranked dark master recommendations for a given light session.

**Independent Test**: Seed masters across exact and out-of-tolerance gain/offset/exposure/temperature combinations, call `calibration.match.suggest` with `calibration_types=["dark"]`, assert ordering and `dimensions_mismatched` content per `spec.md` US1.

- [x] T011 [US1] Implement `rules::dark::evaluate(session, master, config) -> Option<CalibrationMatch>` in `crates/calibration/core/src/rules/dark.rs` honoring hard rules (gain, offset) and soft rules (exposure ±%, temperature ±C). — Done: 11 unit tests including temperature fallback and tolerance-widening test.
- [x] T012 [P] [US1] Unit tests for dark rule edge cases (missing temperature metadata, exact match, partial tolerance) in `crates/calibration/core/tests/dark_matching.rs`. — Done: tests are inline in `rules/dark.rs` (same coverage; separate file not required by spec).
- [x] T013 [US1] Implement suggest dispatcher in `crates/calibration/core/src/lib.rs` to fan-out per calibration type; dark path live. — Done: `suggest()` fan-out with all three types; 7 lib-level tests.
- [x] T014 [US1] Implement Tauri command adapter for `calibration.match.suggest` in `apps/desktop/src-tauri/src/commands/calibration.rs` returning the schema-shaped payload (dark only at this checkpoint). — Done: `calibration_match_suggest` wired to `app_core::calibration::suggest`; registered in specta_builder.
- [ ] T015 [P] [US1] Contract test against `packages/contracts/schemas/calibration.match.suggest.json` for the dark response shape in `tests/contracts/calibration_match_suggest_dark.rs`. — DEFERRED: JSON Schema runner not yet in tests/contract/ (T002 dependency). Shape is validated by contracts_core tests + bindings export.

**Checkpoint**: Dark matching MVP complete.

---

## Phase 4: User Story 2 — Flat Matching (Priority: P2)

**Goal**: Flat master recommendations honoring same-session, same-observing-night, and compatibility fallback.

**Independent Test**: Seed flats from same-session, same-observing-night, and other-night sources; call suggest with `calibration_types=["flat"]`; assert `selection_reason` precedence and binning-mismatch exclusion.

- [x] T016 [US2] Implement `rules::flat::evaluate` in `crates/calibration/core/src/rules/flat.rs` covering hard rules (filter, binning, optic_train, gain-hard) and soft rules (rotation, observing_night_proximity). — Done: gain moved to Hard per 2026-05-23 decision; 10 unit tests.
- [x] T017 [US2] Implement observing-night lookup helper consuming `crates/sessions/` API in `crates/calibration/core/src/rules/flat.rs`. — Done: `flat_selection_reason()` + `night_distance()` in ranking.rs (pure; no sessions crate dep needed for domain logic).
- [x] T018 [P] [US2] Unit tests for flat selection reasons and binning hard-fail in `crates/calibration/core/tests/flat_matching.rs`. — Done: inline in rules/flat.rs; selection reason and binning-mismatch-excludes tests pass.
- [x] T019 [US2] Extend suggest dispatcher to route flat type; update Tauri command to support `calibration_types` filter. — Done: suggest dispatcher handles all 3 types; calibration_types filter forwarded through DTO.
- [ ] T020 [P] [US2] Contract test for flat response shape including `selection_reason` field in `tests/contracts/calibration_match_suggest_flat.rs`. — DEFERRED: same as T015 (JSON Schema runner).

**Checkpoint**: Flat matching complete; suggest works for dark + flat.

---

## Phase 5: User Story 3 — Bias Matching (Priority: P3)

**Goal**: Bias master recommendations using gain/offset only, with no exposure/temperature dimensions reported.

**Independent Test**: Seed bias masters with varying gain/offset; call suggest with `calibration_types=["bias"]`; assert candidates are filtered by gain/offset hard-fail only, and `dimensions_matched` contains no exposure/temperature entries.

- [x] T021 [US3] Implement `rules::bias::evaluate` in `crates/calibration/core/src/rules/bias.rs` (gain hard, offset hard, no soft defaults). — Done: confidence always 1.0 on match; 7 unit tests.
- [x] T022 [P] [US3] Unit tests asserting bias responses contain no exposure/temperature dimension entries in `crates/calibration/core/tests/bias_matching.rs`. — Done: `no_exposure_or_temperature_dimensions_reported` test passes.
- [x] T023 [US3] Extend suggest dispatcher to route bias type. — Done: bias included in default types_ref; all 3 types dispatched.
- [ ] T024 [P] [US3] Contract test for bias response shape in `tests/contracts/calibration_match_suggest_bias.rs`. — DEFERRED: same as T015.

**Checkpoint**: All three suggest paths live.

---

## Phase 6: User Story 4 — Manual Override (Priority: P4)

**Goal**: Persisted assignment with override semantics for hard-rule mismatches.

**Independent Test**: Call `calibration.match.assign` with non-top master and `override=false`; assert assignment succeeds when compatible and returns `incompatible.dimensions` when not. Retry with `override=true`; assert assignment persists with `was_override=true` and mismatched dimensions recorded.

- [x] T025 [US4] Implement `assign::execute(request, config, repo) -> Result<CalibrationAssignment, AssignError>` in `crates/calibration/core/src/assign.rs` enforcing hard-rule + override logic. — Done: `evaluate_assign()` with all 3 guards + override path; 8 unit tests.
- [x] T026 [US4] Persistence write path in `crates/persistence/db/src/calibration_assignment.rs` honoring `(session_id, calibration_type)` uniqueness and upsert semantics. — Done: ON CONFLICT upsert; dark_flat rejected by DB CHECK; all 7 tests pass.
- [x] T027 [P] [US4] Unit tests for override accept/reject paths and audit fields in `crates/calibration/core/tests/override.rs`. — Done: inline in assign.rs; incompatible_dark_with_override_succeeds, was_override=true, confidence=0.7.
- [x] T028 [US4] Tauri command adapter for `calibration.match.assign` in `apps/desktop/src-tauri/src/commands/calibration.rs`. — Done: `calibration_match_assign` wired to `app_core::calibration::assign`.
- [ ] T029 [P] [US4] Contract test against `packages/contracts/schemas/calibration.match.assign.json` covering success, `incompatible.dimensions`, and `master.not_found` paths in `tests/contracts/calibration_match_assign.rs`. — DEFERRED: same as T015.
- [x] T030 [US4] Emit audit event via `crates/audit/` on every assign call, including override flag and mismatched dimensions. — Done: `bus.publish("calibration.assignment.created", ...)` in assign use case; includes wasOverride and mismatchedDimensions fields.

**Checkpoint**: Suggest + assign fully wired end-to-end.

---

## Phase 6b: Batch Suggest (US5)

**Goal**: Project-wide calibration suggestions for multiple sessions in a single call.

**Independent Test**: Call `calibration.match.suggest.batch` with 3 session IDs
including one with `observer_location: null`. Assert partial success: the null-location
session returns `status: "observer_location_missing"` while others return matches.

- [x] T035 [US5] Implement `batch_suggest` dispatcher in `crates/calibration/core/src/lib.rs` that fans out per (session, calibration_type) pair and aggregates results. — Done: `batch_suggest()` in lib.rs + `batch_suggest()` use case in app_core.
- [x] T036 [US5] Handle `observer_location_missing` and `session.mixed_state` per-item statuses in the batch dispatcher. — Done: per-item error codes propagated as `status` in BatchSessionResultDto; test `batch_suggest_mixed_state_returns_per_item_error` passes.
- [ ] T037 [P] [US5] Contract test against `packages/contracts/schemas/calibration.match.suggest.batch.json` covering: all-success, partial (one observer_location_missing), all-error in `tests/contracts/calibration_match_suggest_batch.rs`. — DEFERRED: same as T015.
- [x] T038 [US5] Tauri command adapter for `calibration.match.suggest.batch` in `apps/desktop/src-tauri/src/commands/calibration.rs`. — Done: `calibration_match_suggest_batch` registered in specta_builder.
- [x] T039 [P] [US5] Unit test: batch with mixed session returns `session.mixed_state` for that session; other sessions unaffected. — Done: `batch_suggest_mixed_state_returns_per_item_error` in lib.rs tests.

**Checkpoint**: Batch suggest live — spec 008 project-level calibration can use this contract.

---

## Phase 7: Polish & Cross-Cutting

- [x] T031 [P] Wire settings page `apps/desktop/src/features/settings/SettingsPage.tsx` so the existing `darkMatchTolerance`, `flatMatching`, and `suggestCalibration` controls write through to `MatchingRuleConfig` persistence. — Done: CalibrationMatching.tsx now loads from settings.get('calibration') on mount and saves via save() prop; wires calibration.dark_temp_tolerance, calibration.prefill_suggestion, and override penalty keys. Legacy keys (darkMatchTolerance, flatMatching) left in display table but not yet renamed (T031 rename portion DEFERRED — spec 018 key rename requires separate migration).
- [ ] T032 Add quickstart `specs/007-calibration-matching-rules/quickstart.md` walking through suggest → review → assign. — DEFERRED: documentation task; no blocking dependency.
- [ ] T033 [P] Performance check: simulate 1k masters and assert single-session suggest returns under 200ms; record results in `docs/research/`. — DEFERRED: requires seeding 1k fingerprint rows; pure-domain test feasible but not yet wired.
- [x] T034 Update calibration match panel consumer to drive the project-detail accordion (spec 008 surface). — Done: `CalibrationMatchPanel.tsx` added to `apps/desktop/src/features/projects/`; wired into `ProjectDetail.tsx`; calls `calibration.match.suggest.batch` for all source session IDs; renders per-(session, type) status + confidence; read-only (assign from CalibrationPage); 7 vitest tests pass. Also: `CalibrationPage` + `MastersList` + `MasterDetail` + `MatchCandidatesPanel` wired to real backend with `useCalibrationMasters`, `useCalibrationSuggest`, `useCalibrationAssign`, `useCalibrationSettings`; `prefill_suggestion` respected; 16 MatchCandidatesPanel tests + 8 MastersList tests pass. Route search param for `/calibration` migrated from `parseNumber` to `parseString` (UUID IDs).
- [ ] T040 [P] CI snapshot test: assert that the `calibration_types` enum in all three suggest/assign contracts matches the canonical definition in spec 002 when spec 002 adds it. — DEFERRED: spec 002 CalibrationType enum not yet finalized.
- [ ] T041 [P] Contract test: `session.mixed_state` error returned when calling `calibration.match.suggest` or `calibration.match.assign` with a session whose type is `mixed`. — DEFERRED: same as T015 (JSON Schema runner). Domain guard is tested at unit level.
- [ ] T042 [P] Contract test: `match.observer_location_missing` returned when calling `calibration.match.suggest` with a session lacking `observer_location` or `exposure_start_utc`. — DEFERRED: same as T015. Domain guard is tested at unit level.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = [] }
T004 = { blocked_by = ["T001"] }
T005 = { blocked_by = ["T004"] }
T006 = { blocked_by = ["T003"] }
T007 = { blocked_by = ["T005"] }
T008 = { blocked_by = ["T005"] }
T009 = { blocked_by = ["T006"] }
T010 = { blocked_by = ["T004", "T009"] }
T011 = { blocked_by = ["T008", "T010"] }
T012 = { blocked_by = ["T011"] }
T013 = { blocked_by = ["T011"] }
T014 = { blocked_by = ["T013", "T007"] }
T015 = { blocked_by = ["T014", "T002"] }
T016 = { blocked_by = ["T008", "T010"] }
T017 = { blocked_by = ["T016"] }
T018 = { blocked_by = ["T016", "T017"] }
T019 = { blocked_by = ["T016", "T013"] }
T020 = { blocked_by = ["T019", "T002"] }
T021 = { blocked_by = ["T008", "T010"] }
T022 = { blocked_by = ["T021"] }
T023 = { blocked_by = ["T021", "T013"] }
T024 = { blocked_by = ["T023", "T002"] }
T025 = { blocked_by = ["T008", "T010"] }
T026 = { blocked_by = ["T009", "T025"] }
T027 = { blocked_by = ["T025", "T026"] }
T028 = { blocked_by = ["T025", "T026", "T007"] }
T029 = { blocked_by = ["T028", "T002"] }
T030 = { blocked_by = ["T028"] }
T031 = { blocked_by = ["T010"] }
T032 = { blocked_by = ["T015", "T020", "T024", "T029"] }
T033 = { blocked_by = ["T013", "T019", "T023"] }
T034 = { blocked_by = ["T014", "T019", "T023", "T028"] }
T035 = { blocked_by = ["T013", "T019", "T023"] }
T036 = { blocked_by = ["T035"] }
T037 = { blocked_by = ["T035", "T002"] }
T038 = { blocked_by = ["T035", "T007"] }
T039 = { blocked_by = ["T035"] }
T040 = { blocked_by = ["T002"] }
T041 = { blocked_by = ["T014", "T028", "T002"] }
T042 = { blocked_by = ["T014", "T002"] }
```

### Phase Dependencies

- Phase 1 (Setup): No dependencies.
- Phase 2 (Foundational): Depends on Setup. Blocks all user stories.
- Phase 3 (US1 dark): Depends on Phase 2.
- Phase 4 (US2 flat): Depends on Phase 2; integrates with US1 via shared dispatcher.
- Phase 5 (US3 bias): Depends on Phase 2; integrates with US1/US2.
- Phase 6 (US4 override): Depends on Phase 2 and at least one suggest type for full integration testing; logic itself is independent.
- Phase 7 (Polish): Depends on all desired user stories.

### Parallel Opportunities

- T002 and T003 run alongside T001 in Setup.
- T006 and T007 run in parallel within Foundational once T005 lands.
- Within each user story, the unit-test task and the contract-test task ([P]) run in parallel with adapter wiring.
- US1, US2, US3 can be staffed in parallel once Foundational is complete because they touch separate rule files.

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 + 2.
2. Phase 3 (dark matching end-to-end through suggest).
3. Validate against US1 acceptance scenarios.
4. Stop and demo before continuing.

### Incremental Delivery

1. MVP (US1) → demo.
2. Add US2 flat → demo.
3. Add US3 bias → demo.
4. Add US4 override → demo (full feature complete).
5. Polish (Phase 7).

---

## Notes

- The matcher MUST remain pure-domain. No filesystem reads inside `crates/calibration/core/`.
- Settings UI controls must NOT be expanded in this feature beyond wiring existing keys; richer per-type configuration is a follow-up.
- Suggestions are recomputed on demand; never cached past a single request.
- Audit events flow through `crates/audit/`; the matcher itself does not write audit rows.
