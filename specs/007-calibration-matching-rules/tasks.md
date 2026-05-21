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

- [ ] T001 Add `crates/calibration/core/Cargo.toml` entry to workspace if not present; confirm crate compiles empty.
- [ ] T002 [P] Add JSON Schema validation harness for `packages/contracts/schemas/calibration.match.*.json` in `tests/contracts/`.
- [ ] T003 [P] Add migration scaffold `crates/persistence/db/migrations/00X_calibration_matches.sql` for `calibration_assignment` and `calibration_rule_config` tables (empty bodies acceptable here).

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 Define core enums and structs in `crates/calibration/core/src/lib.rs`: `CalibrationType`, `Dimension`, `SoftDimension`, `MatchingRuleConfig`.
- [ ] T005 Define `CalibrationMatch`, `MatchedDim`, `MismatchedDim`, `SelectionReason` in `crates/calibration/core/src/candidate.rs`.
- [ ] T006 [P] Define `CalibrationAssignment` row mapping in `crates/persistence/db/src/calibration_assignment.rs`.
- [ ] T007 [P] Mirror DTOs in `crates/contracts/core/src/calibration_match.rs` and verify they match the JSON Schemas.
- [ ] T008 Implement the `Matcher` trait and shared confidence/ranking utility in `crates/calibration/core/src/ranking.rs`.
- [ ] T009 Complete migration body in `crates/persistence/db/migrations/00X_calibration_matches.sql` (tables, unique constraint on `(session_id, calibration_type)`, JSON tolerance payload column).
- [ ] T010 Wire `MatchingRuleConfig` defaults loader in `crates/calibration/core/src/lib.rs` consuming the existing settings keys (`darkMatchTolerance`, `flatMatching`, `suggestCalibration`) from persistence.

**Checkpoint**: Foundation ready — user story tasks may begin.

---

## Phase 3: User Story 1 — Dark Matching (Priority: P1)

**Goal**: Ranked dark master recommendations for a given light session.

**Independent Test**: Seed masters across exact and out-of-tolerance gain/offset/exposure/temperature combinations, call `calibration.match.suggest` with `calibration_types=["dark"]`, assert ordering and `dimensions_mismatched` content per `spec.md` US1.

- [ ] T011 [US1] Implement `rules::dark::evaluate(session, master, config) -> Option<CalibrationMatch>` in `crates/calibration/core/src/rules/dark.rs` honoring hard rules (gain, offset) and soft rules (exposure ±%, temperature ±C).
- [ ] T012 [P] [US1] Unit tests for dark rule edge cases (missing temperature metadata, exact match, partial tolerance) in `crates/calibration/core/tests/dark_matching.rs`.
- [ ] T013 [US1] Implement suggest dispatcher in `crates/calibration/core/src/lib.rs` to fan-out per calibration type; dark path live.
- [ ] T014 [US1] Implement Tauri command adapter for `calibration.match.suggest` in `apps/desktop/src-tauri/src/commands/calibration.rs` returning the schema-shaped payload (dark only at this checkpoint).
- [ ] T015 [P] [US1] Contract test against `packages/contracts/schemas/calibration.match.suggest.json` for the dark response shape in `tests/contracts/calibration_match_suggest_dark.rs`.

**Checkpoint**: Dark matching MVP complete.

---

## Phase 4: User Story 2 — Flat Matching (Priority: P2)

**Goal**: Flat master recommendations honoring same-session, same-observing-night, and compatibility fallback.

**Independent Test**: Seed flats from same-session, same-observing-night, and other-night sources; call suggest with `calibration_types=["flat"]`; assert `selection_reason` precedence and binning-mismatch exclusion.

- [ ] T016 [US2] Implement `rules::flat::evaluate` in `crates/calibration/core/src/rules/flat.rs` covering hard rules (filter, binning, optic_train) and soft rules (rotation, observing_night_proximity, gain soft).
- [ ] T017 [US2] Implement observing-night lookup helper consuming `crates/sessions/` API in `crates/calibration/core/src/rules/flat.rs`.
- [ ] T018 [P] [US2] Unit tests for flat selection reasons and binning hard-fail in `crates/calibration/core/tests/flat_matching.rs`.
- [ ] T019 [US2] Extend suggest dispatcher to route flat type; update Tauri command to support `calibration_types` filter.
- [ ] T020 [P] [US2] Contract test for flat response shape including `selection_reason` field in `tests/contracts/calibration_match_suggest_flat.rs`.

**Checkpoint**: Flat matching complete; suggest works for dark + flat.

---

## Phase 5: User Story 3 — Bias Matching (Priority: P3)

**Goal**: Bias master recommendations using gain/offset only, with no exposure/temperature dimensions reported.

**Independent Test**: Seed bias masters with varying gain/offset; call suggest with `calibration_types=["bias"]`; assert candidates are filtered by gain/offset hard-fail only, and `dimensions_matched` contains no exposure/temperature entries.

- [ ] T021 [US3] Implement `rules::bias::evaluate` in `crates/calibration/core/src/rules/bias.rs` (gain hard, offset hard, no soft defaults).
- [ ] T022 [P] [US3] Unit tests asserting bias responses contain no exposure/temperature dimension entries in `crates/calibration/core/tests/bias_matching.rs`.
- [ ] T023 [US3] Extend suggest dispatcher to route bias type.
- [ ] T024 [P] [US3] Contract test for bias response shape in `tests/contracts/calibration_match_suggest_bias.rs`.

**Checkpoint**: All three suggest paths live.

---

## Phase 6: User Story 4 — Manual Override (Priority: P4)

**Goal**: Persisted assignment with override semantics for hard-rule mismatches.

**Independent Test**: Call `calibration.match.assign` with non-top master and `override=false`; assert assignment succeeds when compatible and returns `incompatible.dimensions` when not. Retry with `override=true`; assert assignment persists with `was_override=true` and mismatched dimensions recorded.

- [ ] T025 [US4] Implement `assign::execute(request, config, repo) -> Result<CalibrationAssignment, AssignError>` in `crates/calibration/core/src/assign.rs` enforcing hard-rule + override logic.
- [ ] T026 [US4] Persistence write path in `crates/persistence/db/src/calibration_assignment.rs` honoring `(session_id, calibration_type)` uniqueness and upsert semantics.
- [ ] T027 [P] [US4] Unit tests for override accept/reject paths and audit fields in `crates/calibration/core/tests/override.rs`.
- [ ] T028 [US4] Tauri command adapter for `calibration.match.assign` in `apps/desktop/src-tauri/src/commands/calibration.rs`.
- [ ] T029 [P] [US4] Contract test against `packages/contracts/schemas/calibration.match.assign.json` covering success, `incompatible.dimensions`, and `master.not_found` paths in `tests/contracts/calibration_match_assign.rs`.
- [ ] T030 [US4] Emit audit event via `crates/audit/` on every assign call, including override flag and mismatched dimensions.

**Checkpoint**: Suggest + assign fully wired end-to-end.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T031 [P] Wire settings page `apps/desktop/src/features/settings/SettingsPage.tsx` so the existing `darkMatchTolerance`, `flatMatching`, and `suggestCalibration` controls write through to `MatchingRuleConfig` persistence; remove dead-end behavior.
- [ ] T032 Add quickstart `specs/007-calibration-matching-rules/quickstart.md` walking through suggest → review → assign.
- [ ] T033 [P] Performance check: simulate 1k masters and assert single-session suggest returns under 200ms; record results in `docs/research/`.
- [ ] T034 Update `apps/desktop/src/features/calibration/matchPanel.tsx` consumer hook to drive the project-detail accordion (spec 008 surface).

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
