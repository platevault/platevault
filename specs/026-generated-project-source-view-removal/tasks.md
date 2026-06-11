# Tasks: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: IMPLEMENTED (core pipeline complete; see spec.md for deferred items)

Tasks are grouped by user story so each priority can be delivered and tested
independently. Numbering is global to preserve cross-story dependencies.

## US1 - Remove Generated Source Views (P1)

- [x] **T001**: Define `PreparedSourceView` and `PreparedSourceViewItem` types in
  `crates/domain/core/src/lifecycle/prepared_source.rs` matching `data-model.md`. Include `kind_diverged`
  in the view state enum and `hash_diverged` in `last_observed_state` enum
  (GRILL 2026-05-22 amendments). Evidence: `ViewKind`, `ViewState`, `ItemObservedState`,
  `PreparedSourceView026`, `PreparedSourceViewItem` types in `prepared_source.rs`.
- [x] **T002**: Add `ViewRemovalPlan` as a `FilesystemPlan` variant: `PlanOrigin::PreparedViewRemoval`
  + `PlanType::SourceViewRemoval` added to `contracts_core/src/plans.rs`; `parse_plan_origin` and
  `parse_plan_type` extended in `crates/app/core/src/plans.rs`. DB CHECK constraint expanded in
  migration 0029. Evidence: clippy + `cargo test` green.
- [x] **T003**: Implement `RemovePreparedView` use case in `crates/app/core/src/prepared_views.rs`:
  lifecycle guard, kind_diverged block, hardlink refusal, mixed-kind check, plan creation with
  `origin=prepared_view_removal`, `plan_type=source_view_removal`, `archive` destination. 10 tests pass.
- [x] **T003a**: Plan output uses `origin = "prepared_view_removal"` and advances to `ready_for_review`
  so it immediately enters the spec 017/025 review pipeline (`plans.approve` → `plan.apply`).
- [x] **T004**: Guard test `remove_plan_items_restricted_to_view_paths` verifies all plan item
  `from_relative_path` values come from the view's recorded paths and `linked_entity = view_id`.
- [ ] **T005**: Cross-platform per-item apply deferred — plan `archive` action is already supported
  by the spec 025 executor. Windows junction/reparse-point specifics deferred to v1.x.
- [x] **T006**: `preparedview.remove` contract handler in `crates/contracts/core/src/prepared_views.rs`
  + Tauri command `preparedview.remove` in `apps/desktop/src-tauri/src/commands/prepared_views.rs`.
  All five error codes implemented: `view.not_found`, `view.in_use` (not_found path), `view.mixed_kind`,
  `view.unsupported_kind`, `lifecycle.read_only`.
- [ ] **T006a**: Data-migration scan for pre-existing kind_diverged records deferred — no legacy
  PreparedSourceView records exist in a fresh DB.
- [x] **T007**: `SourceViewsSection.tsx` in `apps/desktop/src/features/projects/` renders all views
  with state badge, Remove/Regenerate actions, kind_diverged affordance. Wired into `ProjectDetail.tsx`.
- [ ] **T008**: End-to-end integration test (generate view → remove → assert inventory untouched)
  deferred; requires spec 025 executor integration harness outside this agent's scope.

## US2 - Regenerate a Removed Source View (P2)

- [x] **T009**: `PlanOrigin::PreparedViewRegeneration` + `PlanType::SourceViewRegeneration` added
  to contracts_core and parse maps; DB CHECK constraint includes `prepared_view_regeneration` /
  `source_view_regeneration` (migration 0029).
- [x] **T010**: `regenerate_prepared_view` in `crates/app/core/src/prepared_views.rs`: lifecycle
  guard, kind_diverged block, hardlink refusal, inventory path resolution against `file_record`,
  unresolved count surfaced in response, plan creation with `origin=prepared_view_regeneration`.
  Tests: `regenerate_creates_plan_for_ready_project`, `regenerate_surfaces_unresolved_count`,
  `regenerate_refuses_archived_project` all pass.
- [x] **T010a**: Plan advances to `ready_for_review` and enters spec 017/025 pipeline.
- [x] **T011**: `preparedview.regenerate` Tauri command in `commands/prepared_views.rs`.
  Contract DTOs in `crates/contracts/core/src/prepared_views.rs`.
- [x] **T012**: `SourceViewsSection.tsx` shows Regenerate button for `removed` and `stale` states.
  kind_diverged blocks regeneration with visible Banner.
- [ ] **T013**: End-to-end integration test deferred (requires spec 025 executor integration).

## US3 - Detect Stale Source Views (P3)

- [ ] **T014**: Stale-detection sweep deferred. Domain types (`ItemObservedState`, `ViewState`)
  and DB schema (`last_observed_state` column) are in place.
- [ ] **T015**: `update_item_observed_state` and `update_view_state` repo helpers exist and are
  tested. Active sweep not implemented.
- [ ] **T016**: `SourceViewsSection` shows `stale` badge; broken-reference detail not yet shown
  (no sweep data to display). Deferred.
- [ ] **T017**: Deferred with sweep implementation.

## US4 - Audit Source View Removal (P3)

- [ ] **T018**: Per-item audit event emission deferred (applies when spec 025 executor is updated
  to call the hook for `prepared_view_removal`/`prepared_view_regeneration` origins).
- [ ] **T019**: UI audit history surface deferred.
- [ ] **T020**: Deferred with T018.

## Cross-Story Dependencies

- T002 depends on T001.
- T003 depends on T001 and T002.
- T003a depends on T003 (and on spec 017/025 plan pipeline being in place).
- T004 depends on T003.
- T005 depends on T003.
- T006 depends on T003.
- T006a depends on T001.
- T007 depends on T006.
- T008 depends on T005, T006, T007.
- T009 depends on T002.
- T010 depends on T001, T009.
- T010a depends on T010 (and on spec 017/025 plan pipeline).
- T011 depends on T010.
- T012 depends on T011.
- T013 depends on T008, T012.
- T014 depends on T001.
- T015 depends on T014.
- T016 depends on T015.
- T017 depends on T015.
- T018 depends on T005 (US1 apply path) and T010 (US2 apply path).
- T019 depends on T018.
- T020 depends on T018.

## Cross-Spec Dependencies

- **Spec 017/025** (R-026-Pipeline, GRILL 2026-05-22): All view plan operations
  use the spec 017/025 plan pipeline. T003a and T010a require the spec 017/025
  plan infrastructure to be in place. The `plan.approve` and `plan.apply`
  (including `plan.resume`) contracts are owned by spec 017/025.
- **Spec 009 R-Unarchive** (R-026-Lifecycle, GRILL 2026-05-22): The lifecycle
  check in T003 and T010 cross-references the `archived → ready` unarchive
  transition. If a user wants to operate on views of an archived project, they
  must first use the spec 009 unarchive path.
- **Envelope sweep** (E-026-1, GRILL 2026-05-22): The camelCase + envelope
  convention sweep for `preparedview.remove.json` and
  `preparedview.regenerate.json` is deferred to the cross-spec final envelope
  sweep pass. Do not apply in isolation.
