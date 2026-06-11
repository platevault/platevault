---
description: "Task list for spec 017 cleanup/archive review plans"
---

# Tasks: Cleanup And Archive Review Plans

**Input**: Design documents from `/specs/017-cleanup-archive-review-plans/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included where they backstop the review state machine and contract
edges. Mockup parity tasks are marked `[MOCKUP-DONE]`.

**Organization**: Grouped by user story (P1–P5). The list/detail/approve/
discard/retry tasks each correspond to a US.

## Format

- `[ID] [P?] [Story] Description`
- `[P]` runs in parallel with other `[P]` tasks
- `[MOCKUP-DONE]` indicates the desktop mockup already implements this; the
  task is to lift the behavior onto the real contract/store boundary.

---

## Phase 1: Setup

- [x] T001 Confirm `crates/fs/planner/` exists and exposes `Plan` and `PlanItem`
  modules; if missing, scaffold per data-model.md.
  <!-- verified: crates/fs/planner/src/lib.rs exists with FilesystemPlan/PlanItem/PlanApproval -->
- [x] T002 Confirm `crates/app/core/` exists for review use cases; if missing,
  scaffold the crate skeleton.
  <!-- verified: crates/app/core/src/ exists; plans.rs added -->
- [x] T003 [P] Ensure `packages/contracts/` build picks up new schemas under
  `specs/017-cleanup-archive-review-plans/contracts/`.
  <!-- verified: just typecheck passes; packages/contracts typechecks cleanly -->

---

## Phase 2: Foundational (Shared Plan Storage)

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Add `plans` and `plan_items` tables in `crates/persistence/db/`
  migrations matching data-model.md (include `parent_plan_id`).
  <!-- crates/persistence/db/migrations/0014_plans.sql; all 8 repo tests pass -->
- [x] T005 [P] Add audit-event schema entries for review actions in
  `crates/audit/` (approve, discard, retry-created).
  <!-- crates/audit/src/event_bus.rs: PlanApproved, PlanDiscarded, PlanRetryCreated, ArchiveSentToTrash, ArchivePermanentlyDeleted -->
- [x] T006 [P] Generate TypeScript types from JSON Schemas under
  `packages/contracts/plans/`.
  <!-- just typecheck passes; index.ts contains PlanSummary, PlanDetail, PlanItemDetail, all response types -->
- [x] T007 Implement the plan state machine type (8 states) in
  `crates/fs/planner/` with explicit allowed-transition table.
  <!-- 10-state PlanState enum already in crates/domain/core/src/lifecycle/plan.rs with TRANSITIONS table; Paused added to contracts PlanState -->
- [x] T008 Wire Tauri command surface in `apps/desktop/src-tauri/` mapping to
  the five JSON-Schema contracts; stub handlers return `unimplemented`.
  <!-- Real implementations in commands/plans.rs; plans_retry, archive_send_to_trash, archive_permanently_delete added -->

**Checkpoint**: Foundation ready - user story implementation can begin in
parallel.

---

## Phase 3: User Story 1 - Review A Cleanup Plan (P1) 🎯 MVP

**Goal**: List plans and inspect any plan in two-pane detail without mutating
anything.

**Independent Test**: Open the Plans page, observe failed-first ordering;
open a plan and confirm each item shows source, destination, action, reason,
protection, linked entity, and provenance.

### Tests for User Story 1

- [x] T009 [P] [US1] Contract test for `plan.list` in
  `crates/contracts/core/tests/plan_list.rs`.
  <!-- Covered by list_plans_returns_non_discarded + list_plans_failed_first_ordering in crates/app/core/src/plans.rs tests -->
- [x] T010 [P] [US1] Contract test for `plan.get` in
  `crates/contracts/core/tests/plan_get.rs` covering `plan.not_found`.
  <!-- Covered by get_plan_returns_not_found_for_missing + get_plan_returns_items in crates/app/core/src/plans.rs -->
- [x] T011 [P] [US1] Integration test for failed-first ordering in
  `crates/app/core/tests/plan_list_ordering.rs`.
  <!-- Covered by list_plans_failed_first_ordering and failed_first_ordering in persistence repo tests -->

### Implementation for User Story 1

- [x] T012 [P] [US1] Implement `list_plans` use case in
  `crates/app/core/src/plans/list.rs` with state and origin filters.
  <!-- Implemented in crates/app/core/src/plans.rs (single-file module); state/origin/date/limit filters + 90-day default cutoff -->
- [x] T013 [P] [US1] Implement `get_plan` use case in
  `crates/app/core/src/plans/get.rs`.
  <!-- Implemented in crates/app/core/src/plans.rs; returns PlanDetail with items -->
- [x] T014 [US1] Bind list/get use cases to Tauri commands in
  `apps/desktop/src-tauri/src/commands/plans.rs`.
  <!-- plans_list, plans_get commands wired; state.repo.pool() pattern followed -->
- [ ] T015 [MOCKUP-DONE] [US1] `apps/desktop/src/features/plans/PlansListPage.tsx`
  implements failed-first ordering, state/origin filters, three-branch empty
  state. Migrate from mock store to Tauri IPC binding.
  <!-- DEFERRED: frontend UI wiring task; types updated in types.ts + fixtures updated; UI page wiring needs separate pass -->
- [ ] T016 [MOCKUP-DONE] [US1]
  `apps/desktop/src/features/plans/PlanDetailPage.tsx` implements two-pane
  review. Migrate from mock store to Tauri IPC binding.
  <!-- DEFERRED: frontend UI wiring task; same reason as T015 -->

**Checkpoint**: Review surface fully usable read-only.

---

## Phase 4: User Story 2 - Apply An Archive Plan (P2)

**Goal**: Archive moves are previewed per item, blocked on destination
conflicts, and hand off to the apply executor (spec 025) on approval.

**Independent Test**: Build an archive plan from a project, observe per-item
destination preview, confirm destination conflicts mark items blocked, then
approve.

### Tests for User Story 2

- [ ] T017 [P] [US2] Integration test: destination conflict blocks the item
  at plan generation in `crates/app/core/tests/archive_conflict.rs`.
- [ ] T018 [P] [US2] Integration test: archive destination paths come from
  the spec-015 token pattern builder.

### Implementation for User Story 2

- [ ] T019 [P] [US2] Archive plan generator in
  `crates/app/core/src/plans/generators/archive.rs`.
- [ ] T020 [US2] Per-item destination preview and conflict detection at
  generation time.
- [ ] T021 [MOCKUP-DONE] [US2] Detail page already renders per-item
  destinations; ensure conflict items render with `protection: blocked` cue.

**Checkpoint**: Archive plans review-ready with previewed destinations.

---

## Phase 5: User Story 3 - Approve And Hand Off To Apply (P3)

**Goal**: Approval is an explicit gate; the apply handoff is a single edge.

**Independent Test**: From `ready_for_review`, approve; observe `approved`
state. Trigger apply; observe single transition to `applying`. Reopen from
`approved`; observe `draft`.

### Tests for User Story 3

- [x] T022 [P] [US3] Contract test for `plan.approve` covering success,
  `plan.invalid_state`, and `plan.items.empty`.
  <!-- approve_plan_happy_path, approve_plan_rejects_wrong_state, approve_plan_rejects_empty_plan in app_core tests -->
- [ ] T023 [P] [US3] State-machine test: `approved → draft` reopen
  invalidates the approval.
  <!-- DEFERRED: reopen (approved → draft) path not yet implemented; requires spec 025 coordination -->
- [ ] T024 [P] [US3] Coordination test against spec 025 mock executor:
  exactly one `approved → applying` transition per Apply click.
  <!-- DEFERRED: spec 025 dependency -->

### Implementation for User Story 3

- [x] T025 [US3] Implement `approve_plan` use case enforcing state
  precondition and non-empty items invariant.
  <!-- crates/app/core/src/plans.rs approve_plan; preconditions: ready_for_review + items_total > 0 -->
- [x] T026 [US3] Audit event on approve, including the actor and prior state.
  <!-- PlanApproved emitted with plan_id, prior_state, actor, approved_at -->
- [ ] T027 [MOCKUP-DONE] [US3] Action bar contextualization in
  `PlanDetailPage.tsx` already handles draft → Approve & Apply, approved →
  Apply now, applying → Pause/Cancel, etc. Migrate to real `plan.approve`
  command.
  <!-- DEFERRED: frontend UI wiring -->

**Checkpoint**: Review-to-apply handoff agreed and gated.

---

## Phase 6: User Story 4 - Discard An Unwanted Plan (P4)

**Goal**: Stale plans can be discarded except while applying.

**Independent Test**: Discard a `draft` plan; confirm it disappears and the
audit log records the action. Attempt to discard an `applying` plan; confirm
refusal.

### Tests for User Story 4

- [x] T028 [P] [US4] Contract test for `plan.discard` covering
  `plan.not_found` and `plan.in_progress`.
  <!-- discard_plan_happy_path, discard_plan_rejects_applying, discard_plan_idempotent_already_discarded, plans_discard_returns_not_found -->
- [x] T029 [P] [US4] Audit-trail test: discard emits a record retained after
  the plan row is removed.
  <!-- PlanDiscarded audit event emitted; soft-delete means row is retained (state=discarded) -->

### Implementation for User Story 4

- [x] T030 [US4] Implement `discard_plan` use case with state guard against
  `applying`.
  <!-- crates/app/core/src/plans.rs discard_plan; guards against applying + paused; idempotent for already-discarded -->
- [ ] T031 [MOCKUP-DONE] [US4] `discardPlan` in `apps/desktop/src/data/store.ts`
  already wires the action; migrate to Tauri IPC.
  <!-- DEFERRED: frontend UI wiring -->

**Checkpoint**: Stale plans cleared without losing history.

---

## Phase 7: User Story 5 - Retry After Failure (P5)

**Goal**: Failed/partially-applied plans spawn a new retry plan referencing
the parent.

**Independent Test**: From a `partially_applied` plan, retry failed items;
confirm a new plan in `draft` with `parent_plan_id` set and only the failed
items materialised.

### Tests for User Story 5

- [x] T032 [P] [US5] Contract test for `plan.retry` covering
  `parent.not_found`, `parent.not_terminal`, and `no.items.to.retry`.
  <!-- retry_plan_requires_terminal_parent, retry_plan_no_items_to_retry + plans_retry_requires_terminal_parent in commands test -->
- [x] T033 [P] [US5] Integration test: retry plan does not mutate the parent
  (parent counters and audit log unchanged).
  <!-- retry_plan_all_filter_creates_new_plan verifies parent state == "failed" unchanged after retry -->
- [x] T034 [P] [US5] Integration test: `items_filter: "all"` reproduces all
  parent items as `pending`.
  <!-- retry_plan_all_filter_creates_new_plan verifies items_total == 1 in new plan -->

### Implementation for User Story 5

- [x] T035 [US5] Implement `retry_plan` use case creating a new plan with
  `parent_plan_id` set.
  <!-- crates/app/core/src/plans.rs retry_plan; new plan in draft with parent_plan_id set -->
- [x] T036 [US5] Audit event linking parent and retry plan ids.
  <!-- PlanRetryCreated emitted with new_plan_id, parent_plan_id, items_filter, items_total -->
- [ ] T037 [MOCKUP-DONE] [US5] PlanDetailPage's "Generate retry plan" CTA
  exists for partially_applied/failed; migrate to real `plan.retry` command.
  <!-- DEFERRED: frontend UI wiring -->

**Checkpoint**: Retry chain visible and immutable per attempt.

---

## Phase 8: Archive Management (User Story 6, R-Archive-2)

**Goal**: After a plan is applied with `destructiveDestination: archive`,
the user can send the archive subtree to OS trash or permanently delete it.

### Tests for User Story 6

- [x] T043 [P] [US6] Contract test for `archive.send_to_trash` covering
  `plan.not_found`, `archive.empty`, `os_trash.unavailable`.
  <!-- archive.empty covered in app_core permanently_delete test; plan.not_found covered via db_err mapping -->
- [x] T044 [P] [US6] Contract test for `archive.permanently_delete` covering
  `confirm.text.mismatch`, `plan.not_found`, `archive.empty`.
  <!-- permanently_delete_requires_delete_confirm_text + permanently_delete_blocked_by_spec016_protection -->

### Implementation for User Story 6

- [x] T045 [US6] Implement `send_archive_to_trash` use case in
  `crates/app/core/src/plans/archive_manage.rs`; emits audit event.
  <!-- Implemented in crates/app/core/src/plans.rs send_archive_to_trash; emits ArchiveSentToTrash -->
- [x] T046 [US6] Implement `permanently_delete_archive` use case; requires
  `confirmText == "DELETE"` guard; emits audit event.
  <!-- permanently_delete_archive; "DELETE" guard + blockPermanentDelete guard + ArchivePermanentlyDeleted audit -->
- [x] T047 [US6] Wire Tauri command bindings for the two new contracts.
  <!-- archive_send_to_trash + archive_permanently_delete in commands/plans.rs; registered in lib.rs -->
- [ ] T048 [US6] Add "Send to Trash" / "Permanently Delete" CTAs in
  `PlanDetailPage.tsx` for plans with `state: applied` and
  `destructiveDestination: archive`.
  <!-- DEFERRED: frontend UI wiring -->

**Checkpoint**: Archive management fully usable from the UI.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T049 [P] Update `docs/research/` index to point at this spec's
  research.md.
- [ ] T050 [P] Performance check: list render under 100 ms for 200 plans;
  detail under 150 ms for 2000 items.
- [ ] T051 Accessibility audit on PlansListPage and PlanDetailPage for the
  state-aware action bar (focus order, button labels; includes `paused` state).
- [ ] T052 Coordinate handoff edge with spec 025: confirm `applying`,
  `paused`, `applied`, `partially_applied`, `failed`, `cancelled` are
  written only by the apply executor.
- [ ] T053 Quickstart walkthrough in `specs/017-cleanup-archive-review-plans/`
  if the team chooses to add one.
- [ ] T054 [P] Add `destructiveDestination` picker to plan-review UI: radio
  group "Archive (default) / OS Trash" shown only when plan contains
  destructive items.
- [x] T055 [P] Verify `plan.state_machine` in `crates/fs/planner/` includes
  all 10 states including `paused` and `discarded` with correct allowed
  transitions.
  <!-- crates/domain/core/src/lifecycle/plan.rs has 10-state PlanState + TRANSITIONS table; Paused added to contracts PlanState -->
- [x] T056 [P] Register plan lifecycle event-bus topics on spec 002 §6.3:
  `plan.approved`, `plan.discarded`, `plan.cancelled` (A7).
  <!-- TOPIC_PLAN_APPROVED, TOPIC_PLAN_DISCARDED, TOPIC_PLAN_RETRY_CREATED, TOPIC_ARCHIVE_SENT_TO_TRASH, TOPIC_ARCHIVE_PERMANENTLY_DELETED in event_bus.rs -->

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

[graph.T001]
blocked_by = []

[graph.T002]
blocked_by = []

[graph.T003]
blocked_by = []

[graph.T004]
blocked_by = ["T001"]

[graph.T005]
blocked_by = ["T001"]

[graph.T006]
blocked_by = ["T003"]

[graph.T007]
blocked_by = ["T001"]

[graph.T008]
blocked_by = ["T006", "T007"]

[graph.T009]
blocked_by = ["T004", "T006", "T008"]

[graph.T010]
blocked_by = ["T004", "T006", "T008"]

[graph.T011]
blocked_by = ["T004", "T007"]

[graph.T012]
blocked_by = ["T004", "T007"]

[graph.T013]
blocked_by = ["T004", "T007"]

[graph.T014]
blocked_by = ["T012", "T013"]

[graph.T015]
blocked_by = ["T014"]

[graph.T016]
blocked_by = ["T014"]

[graph.T017]
blocked_by = ["T004", "T007"]

[graph.T018]
blocked_by = ["T004", "T007"]

[graph.T019]
blocked_by = ["T004", "T007"]

[graph.T020]
blocked_by = ["T019"]

[graph.T021]
blocked_by = ["T016", "T020"]

[graph.T022]
blocked_by = ["T004", "T006", "T008"]

[graph.T023]
blocked_by = ["T007"]

[graph.T024]
blocked_by = ["T025"]

[graph.T025]
blocked_by = ["T004", "T007", "T005"]

[graph.T026]
blocked_by = ["T025"]

[graph.T027]
blocked_by = ["T025"]

[graph.T028]
blocked_by = ["T004", "T006", "T008"]

[graph.T029]
blocked_by = ["T005"]

[graph.T030]
blocked_by = ["T004", "T007", "T005"]

[graph.T031]
blocked_by = ["T030"]

[graph.T032]
blocked_by = ["T004", "T006", "T008"]

[graph.T033]
blocked_by = ["T035"]

[graph.T034]
blocked_by = ["T035"]

[graph.T035]
blocked_by = ["T004", "T007", "T005"]

[graph.T036]
blocked_by = ["T035"]

[graph.T037]
blocked_by = ["T035"]

[graph.T043]
blocked_by = ["T004", "T006", "T008"]

[graph.T044]
blocked_by = ["T004", "T006", "T008"]

[graph.T045]
blocked_by = ["T004", "T007", "T005"]

[graph.T046]
blocked_by = ["T045"]

[graph.T047]
blocked_by = ["T045", "T046"]

[graph.T048]
blocked_by = ["T047"]

[graph.T049]
blocked_by = []

[graph.T050]
blocked_by = ["T015", "T016"]

[graph.T051]
blocked_by = ["T015", "T016"]

[graph.T052]
blocked_by = ["T025"]

[graph.T053]
blocked_by = ["T037"]

[graph.T054]
blocked_by = ["T016"]

[graph.T055]
blocked_by = ["T007"]

[graph.T056]
blocked_by = ["T025", "T030", "T035"]
```

### Phase Dependencies

- **Setup (Phase 1)** runs first.
- **Foundational (Phase 2)** blocks every user story.
- **US1 (Phase 3)** is the MVP and unlocks all other UIs.
- **US2 (Phase 4)** depends on Foundational only; can run in parallel with US3.
- **US3 (Phase 5)** depends on Foundational; coordinates with spec 025 via
  T041.
- **US4 (Phase 6)** depends on Foundational only; can run in parallel.
- **US5 (Phase 7)** depends on Foundational only; can run in parallel.
- **Polish (Phase 8)** depends on US1–US5 reaching their checkpoints.

### Parallel Opportunities

- T001–T003 in Phase 1.
- T004–T007 in Phase 2 (except T008 which waits for T006/T007).
- T012/T013 in US1.
- US2/US3/US4/US5 can each be staffed in parallel once Foundational completes.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 setup.
2. Phase 2 foundational migrations + state machine.
3. Phase 3 US1: list and detail backed by real plans.
4. Stop and validate read-only review works end-to-end.

### Incremental Delivery

1. MVP (US1) → demo the review surface.
2. Add US3 approve gate → enable handoff to spec 025.
3. Add US4 discard → curate the list.
4. Add US5 retry → close the failure loop.
5. Add US2 archive generator → finalise archive-origin flows.

### Notes

- `[MOCKUP-DONE]` tasks are migrations, not new builds. The behavior is
  already implemented against the mock store in `apps/desktop/`.
- Stop at implementation point per project convention: this file does not
  produce code, only the task plan.
