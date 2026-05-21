# Tasks: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: NOT IMPLEMENTED

Tasks are grouped by user story so each priority can be delivered and tested
independently. Numbering is global to preserve cross-story dependencies.

## US1 - Remove Generated Source Views (P1)

- **T001**: Define `PreparedSourceView` and `PreparedSourceViewItem` types in
  `crates/project/structure/` matching `data-model.md`.
- **T002**: Add `ViewRemovalPlan` as a `FilesystemPlan` variant in
  `crates/fs/planner/` with `origin = prepared_view_removal`.
- **T003**: Implement `RemovePreparedView` use case in `crates/app/core/`:
  enumerate view items, build action list (unlink for link kinds, archive for
  copy kind), and persist the plan.
- **T004**: Constrain plan action targets to recorded view membership and add a
  guard test rejecting any action whose target is not in the view's recorded
  paths.
- **T005**: Implement cross-platform per-item apply: Windows symlink/junction
  reparse-point handling, POSIX `unlink`, archive workflow for copy kind.
- **T006**: Define `preparedview.remove` contract handler in
  `crates/contracts/core/` and `packages/contracts/` matching
  `contracts/preparedview.remove.json` (errors `view.not_found`,
  `view.in_use`).
- **T007**: Project detail UI: action to start view removal, plan review,
  apply, and surface per-item outcomes (`apps/desktop/`).
- **T008**: Integration test: generate a view, remove it through plan review,
  assert inventory paths are untouched and the view is marked `removed` with
  membership preserved.

## US2 - Regenerate a Removed Source View (P2)

- **T009**: Add `ViewRegenerationPlan` variant with
  `origin = prepared_view_regeneration` in `crates/fs/planner/`.
- **T010**: Implement `RegeneratePreparedView` use case in `crates/app/core/`:
  resolve canonical inventory paths for preserved membership and produce a new
  plan, including `RegenerationWarning` entries for unresolved references.
- **T011**: Define `preparedview.regenerate` contract handler matching
  `contracts/preparedview.regenerate.json`.
- **T012**: UI affordance to regenerate a `removed` or `stale` view from
  project detail.
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
- T004 depends on T003.
- T005 depends on T003.
- T006 depends on T003.
- T007 depends on T006.
- T008 depends on T005, T006, T007.
- T009 depends on T002.
- T010 depends on T001, T009.
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
