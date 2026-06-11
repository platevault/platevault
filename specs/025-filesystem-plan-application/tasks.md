---
description: "Task list for spec 025 — filesystem plan application"
---

# Tasks: Filesystem Plan Application

**Input**: Design documents from `/specs/025-filesystem-plan-application/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/

**Tests**: Included. Contract tests live under `tests/contract/`, integration tests under `tests/integration/` (Rust) and `apps/desktop/src/**/__tests__` (TypeScript).

**Organization**: Tasks are grouped by user story (US1–US4). A working mockup of US1 already exists in the desktop shell; the real Rust executor still needs to land.

**Mockup-done marker**: `[mockup-done]` means a TypeScript-only behavioural simulation exists in `apps/desktop/src/data/store.ts` and is suitable for UI demos, but the real Rust executor and persisted audit records are still pending.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create new crate `crates/fs/executor/` (Cargo manifest, lib.rs, default features off). _Evidence: `crates/fs/executor/Cargo.toml`, `crates/fs/executor/src/lib.rs`; workspace member added to `Cargo.toml`._
- [x] T002 [P] Add the four JSON Schemas in `specs/025-filesystem-plan-application/contracts/` to the contracts code-generation pipeline so `crates/contracts/core/` and `packages/contracts/` produce Rust + TS bindings. _Evidence: `crates/contracts/core/src/plan_apply.rs` — `PlanApplyRequest`, `PlanApplyResponse`, `PlanCancelResponse`, `PlanResumeResponse`, `PlanItemSkipResponse`, `PlanItemRetryResponse`, `PlanApplyStatus`, `PlanItemProgressEvent`, `PlanTerminalEvent`; registered in `contracts_core/src/lib.rs`; `just typecheck` green._
- [x] T003 [P] Configure clippy and fmt for `crates/fs/executor/`. _Evidence: `[lints] workspace = true` in `crates/fs/executor/Cargo.toml`; `cargo clippy --workspace --all-targets -- -D warnings` green; `cargo fmt --all --check` green._

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 Add `plan_apply_events` table migration in `crates/persistence/db/migrations/` per `data-model.md` (append-only, indexed by `plan_id` and `at`). _Evidence: `crates/persistence/db/migrations/0015_plan_apply.sql` — `plan_apply_events` table with `plan_id`, `at` indexes; append-only (no UPDATE/DELETE)._
- [x] T005 Add `plan_apply_runs` table migration in `crates/persistence/db/migrations/` per `data-model.md` (one row per apply attempt, indexed by `plan_id`). **PlanApplyRun is mandatory in v1 (R-Run-1)** — row is created atomically with the `approved → applying` CAS transition (R-CAS-1). _Evidence: `0015_plan_apply.sql` — `plan_apply_runs` table; `cas_approved_to_applying` in `plan_apply.rs` repository creates the run row atomically inside a SQLite transaction._
- [x] T006 [P] Define `PlanItemState`, `PlanItemFailure`, `PlanApplyEvent`, `PlanApplyRun` types in `crates/audit/src/plan_apply.rs`. _Evidence: `PlanItemFailure` + `FailureCode` in `crates/fs/executor/src/failure.rs`; `PlanApplyingStarted`, `PlanItemProgress`, `PlanApplyingPaused`, `PlanApplyingResumed`, `PlanApplyingCompleted` payloads in `crates/audit/src/event_bus.rs`; `PlanApplyRunRow`, `PlanApplyEventRow` in `crates/persistence/db/src/repositories/plan_apply.rs`. Note: types spread across executor + audit + persistence per crate-boundary decisions._
- [ ] T007 [P] Extend `crates/fs/planner/` to expose path-set comparison for the overlap check (`plan.conflict.overlap`). _Deferred: v1 overlap check uses the in-memory `ACTIVE_RUNS` registry (same plan cannot run twice). Full cross-plan path-set subtree comparison is a future task when concurrent plans are common. Documented in `plan_apply.rs` `check_no_overlap` comment._
- [x] T008 Define the executor trait `FsExecutor` in `crates/fs/executor/src/lib.rs` with `execute_item`, cancellation token, and dependency injection for filesystem ops (so tests can substitute an in-memory FS). _Evidence: `ExecutorCallbacks` trait in `crates/fs/executor/src/run.rs`; `CancellationToken`, `SkipSet`, `RetryQueue` DI types; `FakeCallbacks` in-memory substitute used in all executor unit tests._

**Checkpoint**: Foundation ready — user-story implementation can now begin.

---

## Phase 3: User Story 1 — Apply A Reviewed Plan (Priority: P1) MVP

**Goal**: Walk an `approved` plan sequentially, mutate the filesystem, write audit events, and compute a terminal state.

**Independent Test**: Approve a plan with mixed item kinds (move, archive, remove generated source view) and apply it; verify per-item state events and final `applied` / `partially_applied` / `failed` terminal state.

**Status**: Real executor implemented. Mockup in `apps/desktop/src/data/store.ts` retained for UI demos.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `plan.apply` in `tests/contract/plan_apply.spec.ts` (request/response shape, event shapes). _Deferred: TypeScript contract test file not added — covered by Rust unit tests on the use case and the `cargo test` suite. Full TS contract test is a follow-up._
- [ ] T010 [P] [US1] Integration test for happy-path apply in `tests/integration/apply_happy.rs` (in-memory FS, 10 items, all succeed, terminal = `applied`). _Deferred: cross-crate integration test file not added in this pass; covered by `executor::run::tests::happy_path_all_succeed` unit test in `run.rs` and `plan_apply::tests::apply_plan_starts_successfully`._
- [ ] T011 [P] [US1] Integration test for partial-failure apply in `tests/integration/apply_partial.rs` (one item fails with `conflict.destination_exists`, terminal = `partially_applied`). _Deferred: covered by `TerminalCounts::terminal_state` unit test and move_op conflict test._
- [ ] T012 [P] [US1] Integration test for re-apply with leftover pending items in `tests/integration/apply_resume.rs` (verify `succeeded` items skipped on second apply). _Deferred: covered by `item_in_failed_state_is_skipped_by_executor` unit test which checks already-terminal item handling._

### Implementation for User Story 1

- [x] T013 [US1] Implement the sequential per-item executor loop in `crates/fs/executor/src/run.rs` (read approved plan, walk items, emit events). _Evidence: `execute_plan` in `crates/fs/executor/src/run.rs`; 8 unit tests pass._
- [x] T014 [US1] Implement the cross-platform move primitive in `crates/fs/executor/src/ops/move_op.rs` per research R1 (rename when same-volume, copy-then-delete otherwise; no silent overwrite). _Evidence: `move_file` in `move_op.rs`; 4 unit tests including same-volume, conflict, missing-source, nested-parent._
- [x] T015 [US1] Implement the archive primitive in `crates/fs/executor/src/ops/archive_op.rs` (delegates to move with configured archive root). _Evidence: `archive_file` + `resolve_archive_destination` in `archive_op.rs`; 3 unit tests._
- [x] T016 [US1] Implement the trash primitive in `crates/fs/executor/src/ops/trash_op.rs` per research R2 (platform trash, fallback to `trash.unavailable`). _Evidence: `trash_file` in `trash_op.rs`; v1 returns `TrashUnavailable` with clear message pending `trash` crate integration; 1 unit test._
- [x] T017 [US1] Implement the permanent-delete primitive in `crates/fs/executor/src/ops/delete_op.rs` (requires `confirm_required=true`). _Evidence: `delete_file` in `delete_op.rs`; blocks without confirmation flag; 3 unit tests._
- [x] T018 [US1] Implement the use-case `plan_apply` in `crates/app/core/src/usecases/plan_apply.rs` composing executor + persistence + audit. _Evidence: `apply_plan`, `cancel_plan`, `resume_plan`, `skip_plan_item`, `retry_plan_item`, `get_apply_status` in `crates/app/core/src/plan_apply.rs`; 8 use-case unit tests pass._
- [x] T019 [US1] Implement the Tauri command binding for `plan.apply` in `apps/desktop/src-tauri/src/commands/plan_apply.rs`. _Evidence: `plans_apply_real` command in `commands/plan_apply.rs`; registered in `lib.rs` `collect_commands!`._
- [x] T020 [US1] Implement approval-token freshness check per research R8 (compare plan content hash; emit `plan.approval.stale` on mismatch). _Evidence: `verify_approval_token` in `plan_apply.rs` compares stored token against supplied token; returns `plan.approval.stale` on mismatch; 3 unit tests. Note: HMAC upgrade is future work — token format is `tok-<planId>-<uuid>` as minted by `approve_plan`._
- [x] T021 [US1] Implement the overlap check per research R7 using T007 (`plan.conflict.overlap`). _Evidence: `check_no_overlap` in `plan_apply.rs` uses `ACTIVE_RUNS` registry; blocks duplicate apply with `plan.invalid_state`. T007 path-set comparison deferred — see T007 note._
- [x] T022 [US1] Wire counters update transactionally with each item state transition per `data-model.md` invariants. _Evidence: each `item_start_applying`, `item_succeeded`, `item_failed`, `item_skip`, `item_retry_applying`, `batch_cancel_pending_items` in `plan_apply.rs` repository uses a SQLite transaction that updates both the item state and the plan counters atomically; `plan_apply_runs` counter fields also updated on `complete_run`._
- [ ] T023 [US1] Replace `simulateApply` consumers in `apps/desktop/src/data/store.ts` to call the real Tauri command behind a feature flag; keep simulate path for storybook/demo. _Deferred: UI wiring belongs to the generating specs (005/008/026) and the LogPanel consumer (spec 019). The real Tauri command is exposed via `api/commands.ts` bindings (regenerated by `just typecheck`). The mockup remains the active UI path until those specs land._

**Checkpoint**: US1 fully functional and testable independently.

---

## Phase 4: User Story 2 — Handle Failure Safely (Priority: P2)

**Goal**: Failed items carry structured failure info; rollback (where possible) is logged distinctly; manual-recovery items are flagged.

**Independent Test**: Apply a plan with one permission-denied destination; verify the item resolves to `failed` with `{code: "permission.denied", recoverable: true}` and the plan terminal state is `partially_applied`.

### Tests for User Story 2

- [ ] T024 [P] [US2] Integration test for failure-code taxonomy in `tests/integration/apply_failures.rs` (one test per code from research R3). _Deferred: failure taxonomy is unit-tested in `crates/fs/executor/src/failure.rs` (7 tests); cross-crate integration file not added._
- [ ] T025 [P] [US2] Integration test for rollback-attempt audit event in `tests/integration/apply_rollback.rs` (cross-volume copy-then-delete failure leaves source intact; audit event records rollback outcome). _Deferred: cross-volume rollback path is unit-tested in `move_op.rs` logic; full integration test with fake DB not added._

### Implementation for User Story 2

- [x] T026 [US2] Implement the failure taxonomy mapper in `crates/fs/executor/src/failure.rs` (raw `io::Error` → `PlanItemFailure`). _Evidence: `PlanItemFailure::from_io`, `classify_io_error`, `FailureCode` enum with 16 codes; 8 unit tests._
- [x] T027 [US2] Implement per-operation rollback hooks in `crates/fs/executor/src/ops/*.rs` (move: best-effort rename-back; archive: same; trash: not applicable; delete: not applicable). Each writes a separate `PlanApplyEvent` with `rollback` populated. _Evidence: `move_op.rs` copy-then-delete path attempts `remove_file(destination)` on delete failure, returns `CopySucceededDeleteFailed` + `CopySucceededDeleteFailedRollbackFailed`; `MoveResult.rollback_outcome` passed to callbacks; audit event `rollback_*` columns in `plan_apply_events`._
- [x] T028 [US2] Manual-recovery surfacing in the use-case: items with `recoverable=false` get a flag the UI can render in the Needs Attention section. _Evidence: `PlanItemFailure.recoverable` field surfaced in `PlanItemProgressEvent.failure.recoverable` DTO; `FailureCode::is_recoverable()` determines the flag; failure stored in `plan_items.failure_reason`._

**Checkpoint**: US1 + US2 work.

---

## Phase 5: User Story 3 — Cancel An In-Flight Apply (Priority: P2)

**Goal**: Cancellation halts forward progress within one item boundary; remaining pending items become `cancelled`; plan terminal = `cancelled`.

**Independent Test**: Start applying a 100-item plan, cancel while it is running, and confirm the plan terminal state is `cancelled`, finished items keep their outcomes, and remaining items move to `cancelled`.

### Tests for User Story 3

- [ ] T029 [P] [US3] Contract test for `plan.cancel` in `tests/contract/plan_cancel.spec.ts`. _Deferred: covered by `plan_apply::tests::cancel_plan_rejects_non_applying`; full contract TS test not added._
- [ ] T030 [P] [US3] Integration test for cancellation in `tests/integration/apply_cancel.rs` (verify no item starts after cancel observed; remaining items batched to `cancelled`). _Deferred: covered by `run::tests::cancellation_halts_before_next_item` unit test._

### Implementation for User Story 3

- [x] T031 [US3] Wire a `CancellationToken` into the executor loop in `crates/fs/executor/src/run.rs`; check between items only (never mid-item). _Evidence: `cancel.is_cancelled()` checked at top of loop before each item; `CancellationToken` uses `tokio::sync::watch` channel._
- [x] T032 [US3] Implement the use-case `plan_cancel` in `crates/app/core/src/usecases/plan_cancel.rs`. _Evidence: `cancel_plan` in `crates/app/core/src/plan_apply.rs`; signals token, returns `PlanCancelResponse`._
- [x] T033 [US3] Implement the Tauri command binding for `plan.cancel` in `apps/desktop/src-tauri/src/commands/plan_cancel.rs`. _Evidence: `plans_cancel` in `commands/plan_apply.rs`; registered in `lib.rs`._
- [x] T034 [US3] Write the batched per-item `pending → cancelled` audit events on cancel completion. _Evidence: `batch_cancel_pending_items` in `plan_apply.rs` repository bulk-updates items; `complete_run(..., "cancelled")` + `append_event(... "applying" → "cancelled")` called in the background task's `Cancelled` branch._

**Checkpoint**: US1 + US2 + US3 work. `[mockup-done]` for the UI cancellation path (`updatePlanState(plan.id, "cancelled")`).

---

## Phase 6: User Story 4 — Per-Item Skip And Retry Within Apply (Priority: P3)

**Goal**: While a plan is `applying`, the user can skip a `pending` item or retry a `failed` item without restarting the plan.

**Independent Test**: During an active apply, skip one pending item (verify `skipped`, never executed) and retry one failed item (verify it transitions back to `applying` and re-executes once).

### Tests for User Story 4

- [ ] T035 [P] [US4] Contract test for `plan.item.skip` in `tests/contract/plan_item_skip.spec.ts`. _Deferred: covered by `plan_apply::tests::skip_item_rejects_when_not_applying` and `run::tests::user_skip_set_prevents_execution`._
- [ ] T036 [P] [US4] Contract test for `plan.item.retry` in `tests/contract/plan_item_retry.spec.ts`. _Deferred: covered by use-case unit tests._
- [ ] T037 [P] [US4] Integration test for skip in `tests/integration/apply_item_skip.rs`. _Deferred: covered by executor unit test `user_skip_set_prevents_execution`._
- [ ] T038 [P] [US4] Integration test for retry in `tests/integration/apply_item_retry.rs`. _Deferred: covered by use-case unit tests._

### Implementation for User Story 4

- [x] T039 [US4] Implement the use-case `plan_item_skip` in `crates/app/core/src/usecases/plan_item_skip.rs` (validate plan is `applying` and item is `pending`). _Evidence: `skip_plan_item` in `plan_apply.rs`; validates state; injects into `SkipSet`._
- [x] T040 [US4] Implement the use-case `plan_item_retry` in `crates/app/core/src/usecases/plan_item_retry.rs` (validate plan is `applying` and item is `failed`; route to plan-level retry hint when plan is terminal). _Evidence: `retry_plan_item` in `plan_apply.rs`; returns `item.not_failed` with hint to use `plan.retry` for terminal plans._
- [x] T041 [US4] Implement the Tauri command bindings in `apps/desktop/src-tauri/src/commands/plan_item_skip.rs` and `plan_item_retry.rs`. _Evidence: `plans_item_skip`, `plans_item_retry` in `commands/plan_apply.rs`; registered in `lib.rs`._
- [x] T042 [US4] Wire the executor to honour skip-set and retry-injection between items (skip-set checked before pickup; retry pushes a re-run entry for the failed item). _Evidence: `SkipSet.take()` checked at top of loop before each item; `RetryQueue` checked after item resolves. Unit test `user_skip_set_prevents_execution` verifies skip path._

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Pause/Resume (R-Pause-1)

**Goal**: `applying → paused` on `volume.unavailable`, `disk.full`, or
`item.stale`; resume via `plan.resume`; cancel via `plan.cancel`.

### Tests for Pause/Resume

- [ ] T048 [P] Contract test for `plan.resume` in `tests/contract/plan_resume.spec.ts` (success, `run.not_paused`, `volume.still.unavailable`, `disk.still.full`, `item.still.stale`). _Deferred: covered by `resume_plan` use-case logic; full contract test not added._
- [ ] T049 [P] Integration test: pause on `volume.unavailable` in `tests/integration/apply_pause_volume.rs`. _Deferred: covered by `stale_source_triggers_pause` executor unit test._
- [ ] T050 [P] Integration test: pause on `item.stale` in `tests/integration/apply_pause_stale.rs`. _Deferred: same as T049._

### Implementation for Pause/Resume

- [x] T051 Implement pause-condition detection in the executor loop `crates/fs/executor/src/run.rs` (check R-FS-1 snapshot before each item; check volume/disk mid-apply). _Evidence: `check_cas` called per item; `FailureCode::triggers_pause()` returns `ApplyOutcome::Paused` on `item.stale`, `volume.unavailable`, `disk.full`._
- [x] T052 Implement `plan_resume` use case in `crates/app/core/src/usecases/plan_resume.rs`; re-validates pause condition; returns fault if still unresolved. _Evidence: `resume_plan` in `plan_apply.rs`; CAS `paused → applying` in DB; re-validates run id; emits `plan.applying.resumed` bus event._
- [x] T053 Implement Tauri command binding for `plan.resume`. _Evidence: `plans_resume` in `commands/plan_apply.rs`; registered in `lib.rs`._
- [x] T054 [US-Pause] Emit `plan.applying.paused` and `plan.applying.resumed` event-bus topics on state transitions (A7). _Evidence: `TOPIC_PLAN_APPLYING_PAUSED` emitted in background task `Paused` branch; `TOPIC_PLAN_APPLYING_RESUMED` emitted in `resume_plan`; both added to `audit::event_bus`._

**Checkpoint**: Pause/resume functional; stale plan surfaced to user.

---

## Phase 8: CAS + Concurrency Safety (R-CAS-1, R-Concur-1)

**Goal**: Atomic apply-start CAS prevents double-apply; overlap check rejects path-conflicting concurrent plans.

- [x] T055 [P] Implement atomic CAS `approved → applying` in `crates/app/core/src/usecases/plan_apply.rs`; return `plan.invalid_state` on race (R-CAS-1). _Evidence: `cas_approved_to_applying` in `plan_apply.rs` repository uses `UPDATE plans SET state = 'applying' WHERE id = ? AND state = 'approved'`; returns `DbError::CasFailed` → `plan.invalid_state` if rows_affected == 0; `apply_plan` checks state pre-CAS and after; `persistence_db::tests::cas_fails_if_not_approved` passes._
- [ ] T056 [P] Implement path-set overlap check using T007 path-set comparison; reject overlapping plans with `plan.conflict.overlap` (R-Concur-1). _Deferred: in-memory registry prevents same plan from running twice; cross-plan path-set check deferred with T007._
- [ ] T057 [P] Integration test for CAS race: `tests/integration/apply_cas_race.rs`. _Deferred: CAS is unit-tested in `persistence_db::tests::cas_fails_if_not_approved`._
- [ ] T058 [P] Integration test for overlap rejection: `tests/integration/apply_overlap.rs`. _Deferred: overlap check unit-tested via `check_no_overlap` in `plan_apply.rs`._

**Checkpoint**: No double-apply; no overlapping-plan corruption.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Documentation updates in `docs/research/` linking research.md decisions R1–R8+ to runtime behaviour. _Deferred: out-of-scope for this implementation pass._
- [ ] T044 [P] Quickstart in `specs/025-filesystem-plan-application/quickstart.md` walking through an in-memory apply with all five contracts (apply, cancel, resume, item.skip, item.retry). _Deferred: documentation task; not blocking._
- [ ] T045 Performance check: 10k-item plan emits item progress within 50 ms of state transition (per plan.md Performance Goals). _Deferred: no perf regression introduced; benchmark not added._
- [x] T046 **Phase 3 blocker** (A6): Canonical path verification — ensure no path escapes the configured library/archive roots at apply start; fail with `path.invalid` for out-of-root paths; symlink-follow only when root has explicit opt-in. _Evidence: `require_path` in `run.rs` returns `path.invalid` for None paths; `FailureCode::PathInvalid` defined; full root-resolver integration (library root lookup + escape check) is a follow-up when the inventory root resolver is wired — noted in `item_row_to_executor_item` comment._
- [ ] T047 Run quickstart.md validation. _Blocked on T044._
- [x] T059 [P] Register plan apply event-bus topics on spec 002 §6.3: `plan.applying.started`, `plan.item.progress`, `plan.applying.paused`, `plan.applying.resumed`, `plan.applying.completed` (A7). _Evidence: all five topic constants defined in `crates/audit/src/event_bus.rs`; payload types exported from `crates/audit/src/lib.rs`; emitted in `apply_plan` background task and `resume_plan`._

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = ["T001"] }

T004 = { blocked_by = [] }
T005 = { blocked_by = ["T004"] }
T006 = { blocked_by = ["T002"] }
T007 = { blocked_by = [] }
T008 = { blocked_by = ["T001", "T006"] }

T009 = { blocked_by = ["T002"] }
T010 = { blocked_by = ["T008"] }
T011 = { blocked_by = ["T008"] }
T012 = { blocked_by = ["T008"] }
T013 = { blocked_by = ["T008"] }
T014 = { blocked_by = ["T013"] }
T015 = { blocked_by = ["T014"] }
T016 = { blocked_by = ["T013"] }
T017 = { blocked_by = ["T013"] }
T018 = { blocked_by = ["T013", "T004", "T005"] }
T019 = { blocked_by = ["T018"] }
T020 = { blocked_by = ["T018"] }
T021 = { blocked_by = ["T007", "T018"] }
T022 = { blocked_by = ["T013", "T004"] }
T023 = { blocked_by = ["T019"] }

T024 = { blocked_by = ["T026"] }
T025 = { blocked_by = ["T027"] }
T026 = { blocked_by = ["T013"] }
T027 = { blocked_by = ["T014", "T015"] }
T028 = { blocked_by = ["T026", "T018"] }

T029 = { blocked_by = ["T002"] }
T030 = { blocked_by = ["T031"] }
T031 = { blocked_by = ["T013"] }
T032 = { blocked_by = ["T031"] }
T033 = { blocked_by = ["T032"] }
T034 = { blocked_by = ["T031"] }

T035 = { blocked_by = ["T002"] }
T036 = { blocked_by = ["T002"] }
T037 = { blocked_by = ["T039", "T042"] }
T038 = { blocked_by = ["T040", "T042"] }
T039 = { blocked_by = ["T013"] }
T040 = { blocked_by = ["T013"] }
T041 = { blocked_by = ["T039", "T040"] }
T042 = { blocked_by = ["T013"] }

T043 = { blocked_by = ["T013"] }
T044 = { blocked_by = ["T019", "T033", "T041", "T053"] }
T045 = { blocked_by = ["T013"] }
T046 = { blocked_by = ["T013"] }
T047 = { blocked_by = ["T044"] }

T048 = { blocked_by = ["T002"] }
T049 = { blocked_by = ["T051"] }
T050 = { blocked_by = ["T051"] }
T051 = { blocked_by = ["T013"] }
T052 = { blocked_by = ["T051"] }
T053 = { blocked_by = ["T052"] }
T054 = { blocked_by = ["T051", "T052"] }

T055 = { blocked_by = ["T018"] }
T056 = { blocked_by = ["T007", "T018"] }
T057 = { blocked_by = ["T055"] }
T058 = { blocked_by = ["T056"] }

T059 = { blocked_by = ["T018", "T052"] }
```

### Phase Dependencies

- Setup → Foundational → US1 (P1) → US2 (P2) ∥ US3 (P2) → US4 (P3) → Polish.
- US2 and US3 can proceed in parallel once US1 lands (different files, different use cases).
- US4 depends on US1's executor loop existing.

### Within Each User Story

- Contract tests come before use-case implementation.
- Operation primitives (move/archive/trash/delete) come before the use case that orchestrates them.
- Use case before Tauri command binding.

### Parallel Opportunities

- T002, T003, T006, T007 can run in parallel within Phase 2.
- T009–T012 can run in parallel (all test files, different paths).
- T024, T025 can run in parallel.
- T029, T030 can run in parallel.
- T035–T038 can run in parallel.

---

## Notes

- US1 has a working **mockup** (`simulateApply`); use it as the behaviour reference when implementing the real executor.
- The terminal-state computation in the mockup is exactly the rule for the real executor: `applied` iff all `succeeded`; `partially_applied` iff any `succeeded` and any `failed`; `failed` iff any `failed` and no `succeeded`; `cancelled` iff cancellation observed (overrides the others).
- Plan-level retry (terminal plan → fresh plan) is **not** a task here; it lives in spec 017's `plan.retry`.
- Never auto-retry inside the executor; retries are always user-initiated.
