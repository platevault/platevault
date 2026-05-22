# Tasks: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: NOT IMPLEMENTED

Tasks are grouped by user story so each priority can be delivered and tested
independently. Numbering is global to preserve cross-story dependencies.

## US1 - Remove Generated Source Views (P1)

- **T001**: Define `PreparedSourceView` and `PreparedSourceViewItem` types in
  `crates/project/structure/` matching `data-model.md`. Include `kind_diverged`
  in the view state enum and `hash_diverged` in `last_observed_state` enum
  (GRILL 2026-05-22 amendments).
- **T002**: Add `ViewRemovalPlan` as a `FilesystemPlan` variant in
  `crates/fs/planner/` with `origin = prepared_view_removal`.
- **T003**: Implement `RemovePreparedView` use case in `crates/app/core/`:
  (a) validate owning project lifecycle is in the allowed set (refuse with
  `lifecycle.read_only` if `archived` — R-026-Lifecycle); (b) validate
  `kind == materialization` for all items (refuse with `view.mixed_kind` if
  not — A2); (c) enumerate view items, build action list (archive for all
  kinds — R-026-Dest-Archive; `hardlink` refused with `view.unsupported_kind`
  in v1 — R-026-Strategies); (d) persist the plan and return `plan_id`.
- **T003a**: Wire `RemovePreparedView` plan output through the full spec
  017/025 pipeline (R-026-Pipeline, GRILL 2026-05-22): plan goes through
  `plan.approve` (approvalToken) → `plan.apply` (per-item FS revalidation,
  paused state, `plan.resume`). All spec 017/025 error codes can surface.
- **T004**: Constrain plan action targets to recorded view membership and add a
  guard test rejecting any action whose target is not in the view's recorded
  paths.
- **T005**: Implement cross-platform per-item apply: Windows symlink/junction
  reparse-point handling, POSIX `unlink`, archive workflow for copy kind
  (v1 strategies: symlink, junction, copy only — R-026-Strategies).
- **T006**: Define `preparedview.remove` contract handler in
  `crates/contracts/core/` and `packages/contracts/` matching
  `contracts/preparedview.remove.json` (errors `view.not_found`,
  `view.in_use`, `view.mixed_kind`, `view.unsupported_kind`,
  `lifecycle.read_only`).
- **T006a**: Add data-migration task: scan existing `PreparedSourceView`
  records for `kind` vs `materialization` divergence; set state to
  `kind_diverged` for any mismatched records (D-026-H2, GRILL 2026-05-22).
- **T007**: Project detail UI: action to start view removal, plan review,
  apply, and surface per-item outcomes (`apps/desktop/`). Surface `kind_diverged`
  state with a manual-resolution affordance. Cross-link unarchive action to
  spec 009 R-Unarchive when project is `archived`.
- **T008**: Integration test: generate a view, remove it through plan review,
  assert inventory paths are untouched and the view is marked `removed` with
  membership preserved indefinitely (A4).

## US2 - Regenerate a Removed Source View (P2)

- **T009**: Add `ViewRegenerationPlan` variant with
  `origin = prepared_view_regeneration` in `crates/fs/planner/`.
- **T010**: Implement `RegeneratePreparedView` use case in `crates/app/core/`:
  (a) validate owning project lifecycle (refuse `lifecycle.read_only` if
  `archived` — R-026-Lifecycle); (b) resolve canonical inventory paths for
  preserved membership; (c) produce a new plan including `RegenerationWarning`
  entries for unresolved references; (d) return `plan_id`. Removed views have
  indefinite regenerable lifetime (A4).
- **T010a**: Wire `RegeneratePreparedView` plan output through the full spec
  017/025 pipeline (R-026-Pipeline, GRILL 2026-05-22).
- **T011**: Define `preparedview.regenerate` contract handler matching
  `contracts/preparedview.regenerate.json` (errors `view.not_found`,
  `view.in_use`, `view.mixed_kind`, `view.unsupported_kind`,
  `lifecycle.read_only`).
- **T012**: UI affordance to regenerate a `removed` or `stale` view from
  project detail. Surface `kind_diverged` state for manual resolution before
  regeneration is possible.
- **T013**: Integration test: remove then regenerate; confirm a new plan is
  produced from canonical sources and the resulting view returns to `current`.

## US3 - Detect Stale Source Views (P3)

- **T014**: Implement read-only stale-detection sweep in
  `crates/project/structure/` using `crates/fs/inventory/` resolution.
- **T015**: Persist `last_observed_state` per item and transition view `state`
  to `stale` when any item diverges.
- **T016**: Project detail UI: badge stale views with the broken reference
  visible; no implicit mutation.
- **T017**: Test: simulate root remap and confirm affected views transition to
  `stale` without producing a plan.

## US4 - Audit Source View Removal (P3)

- **T018**: Extend `crates/audit/` consumers to emit per-item events for
  `prepared_view_removal` and `prepared_view_regeneration` plan applies,
  capturing attempted action, outcome, and failure context.
- **T019**: Surface removal audit history on project detail.
- **T020**: Test: a failing per-item removal records a `failed` audit entry
  and the view transitions to `failed` state with retry context.

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
