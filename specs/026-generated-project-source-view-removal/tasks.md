# Tasks: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: IMPLEMENTED (all tasks closed; the former US1/US2 apply-path deferrals were
unblocked once a real spec 025 executor + real end-to-end test existed — see T005/T008/T013
for the two latent apply bugs that surfaced and were fixed in the process)

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
- [x] **T005**: Cross-platform per-item apply verified end-to-end with the real spec 025 executor
  (POSIX; Windows junction/reparse-point specifics remain unverified on Linux dev, deferred to v1.x).
  Writing the T008 e2e test surfaced and fixed a latent bug: `remove_prepared_view` left
  `archive_path`/`to_relative_path` empty, so every archive item failed `source.missing` on
  `rename(src, "")` — never previously exercised by a real apply. Fixed via
  `compute_archive_destination` in `crates/app/projects/src/prepared_views.rs`. Evidence:
  `remove_view_e2e_archives_links_and_marks_view_removed` in
  `crates/app/core/tests/view_removal_regeneration_e2e.rs`.
- [x] **T006**: `preparedview.remove` contract handler in `crates/contracts/core/src/prepared_views.rs`
  + Tauri command `preparedview.remove` in `apps/desktop/src-tauri/src/commands/prepared_views.rs`.
  All five error codes implemented: `view.not_found`, `view.in_use` (not_found path), `view.mixed_kind`,
  `view.unsupported_kind`, `lifecycle.read_only`.
- [x] **T006a**: `reconcile_kind_diverged_views` in
  `crates/persistence/db/src/repositories/prepared_source_views.rs`, run once per
  `Database::migrate()` call (no schema change, so no new migration number — pure data
  reconciliation over existing rows, no-op on a fresh DB). Evidence:
  `reconcile_flags_mismatched_legacy_view_kind_diverged`,
  `reconcile_is_noop_on_fresh_db_with_no_views`.
- [x] **T007**: `SourceViewsSection.tsx` in `apps/desktop/src/features/projects/` renders all views
  with state badge, Remove/Regenerate actions, kind_diverged affordance. Wired into `ProjectDetail.tsx`.
- [x] **T008**: End-to-end integration test with the real spec 025 executor (no `simulateApply`):
  generate → remove → apply asserts the link is archived off its original path and the view is
  marked `removed` (A4 membership preserved). Evidence:
  `remove_view_e2e_archives_links_and_marks_view_removed` in
  `crates/app/core/tests/view_removal_regeneration_e2e.rs`.

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
- [x] **T013**: End-to-end integration test with the real spec 025 executor: generate → remove →
  apply → regenerate → apply. Writing it surfaced and fixed a second latent bug:
  `regenerate_prepared_view` set `from_relative_path` to the raw `inventory_item_id` (a DB id, not
  a path) and dropped `provenance_json`, so `link` items had no real source and always fell back to
  `symlink` regardless of the view's recorded kind. Fixed by resolving each item's real absolute
  source path via `source_view_verify::resolve_source` (promoted `pub(crate)`, no duplicated
  `file_record`/`library_root` lookup) and carrying the item's own `materialization` through
  `provenance_json`. Evidence: `regenerate_view_e2e_recreates_links_and_marks_view_current` in
  `crates/app/core/tests/view_removal_regeneration_e2e.rs`.

## US3 - Detect Stale Source Views (P3)

- [x] **T014**: Stale-detection sweep implemented as `sweep_view_staleness` in
  `crates/app/projects/src/source_view_verify.rs`, sharing the exact per-item classification logic
  (`classify_item`, extracted) with the spec 049 US4 `verify_source_view` read-only check so the two
  never diverge. Read-only on the filesystem (only `stat`s paths); persists observed state to DB as
  an observation cache, same as inventory scan bookkeeping — not a filesystem mutation, so it stays
  outside the reviewable-plan pipeline. Wired into `prepared_views::list_views` (T016's load path) so
  every `preparedview.list` call refreshes staleness before reporting it. Also invoked from
  `plan_apply.rs`'s `finalize_view_removal`/`finalize_view_regeneration` hooks (T017). Evidence:
  `sweep_marks_clean_view_current`, `sweep_marks_partially_broken_view_stale`,
  `sweep_marks_fully_broken_view_missing`, `sweep_skips_removed_view` in `source_view_verify.rs`.
- [x] **T015**: `update_item_observed_state`/`update_view_state` repo helpers (pre-existing) are now
  actually called by the T014 sweep. Evidence: same sweep tests as T014, asserting
  `last_observed_state` and view `state` persist correctly.
- [x] **T016**: `SourceViewsSection.tsx` renders the persisted broken-reference detail
  (`lastObservedState !== 'present'`) inline per item, plus a stale-item-count summary banner for
  `stale`/`missing` views — both driven by the T014 sweep data that's already fresh on load, no
  Verify click required (distinct from the spec 049 US4 on-demand verify report, which is unchanged).
  `canRegenerateView` extended to allow `missing` (the sweep can legitimately produce that state;
  without this a sweep-observed `missing` view had no path back to `current`). Evidence:
  `SourceViewsSection.test.tsx`, `source-views.test.ts`, Playwright
  `tests/e2e/source_view_stale_audit.spec.ts`.
- [x] **T017**: Rides the T014 sweep rather than hand-maintaining separate state transitions:
  `finalize_view_regeneration` (`crates/app/core/src/plan_apply.rs`) always re-sweeps after a
  regeneration apply (clearing a terminal `removed` state first, since the sweep intentionally skips
  `removed`/`kind_diverged`); `finalize_view_removal` sweeps on a partial apply (a clean full apply
  writes the explicit `removed` state directly — not derivable from a sweep, since archived-away
  files look identical to independently-missing ones). Evidence: same e2e tests as T008/T013.

## US4 - Audit Source View Removal (P3)

- [x] **T018**: Per-item audit event emission was already origin-agnostic in the spec 025 executor
  (`plan_apply.rs`'s `on_item_progress` callback writes `plan_apply_events` for every plan item
  regardless of origin) — no executor change needed, just verified it actually covers these plan
  types now that a real apply exercises them. Evidence: `event_count(...) > 0` assertions in both
  `view_removal_regeneration_e2e.rs` tests.
- [x] **T019**: New `ViewAuditHistory.tsx` in `apps/desktop/src/features/projects/`: lists a view's
  `prepared_view_removal`/`prepared_view_regeneration` plans (`plans.list` filtered client-side by
  `originPath`, since the durable T018 audit trail is already there and a per-view server-side filter
  doesn't exist) with a "View" action that reuses the existing shared `PlanReviewOverlay` via the
  `onPlanCreated` callback `SourceViewsSection` already threads through — no new backend contract.
  Wired into `SourceViewsSection.tsx` per view. Evidence: `ViewAuditHistory.test.tsx`, Playwright
  `tests/e2e/source_view_stale_audit.spec.ts`.
- [x] **T020**: Deferred-with-T018, now closed alongside it (see T018 evidence).

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
