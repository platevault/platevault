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

- [ ] T001 Create new crate `crates/fs/executor/` (Cargo manifest, lib.rs, default features off).
- [ ] T002 [P] Add the four JSON Schemas in `specs/025-filesystem-plan-application/contracts/` to the contracts code-generation pipeline so `crates/contracts/core/` and `packages/contracts/` produce Rust + TS bindings.
- [ ] T003 [P] Configure clippy and fmt for `crates/fs/executor/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 Add `plan_apply_events` table migration in `crates/persistence/db/migrations/` per `data-model.md` (append-only, indexed by `plan_id` and `at`).
- [ ] T005 Add `plan_apply_runs` table migration in `crates/persistence/db/migrations/` per `data-model.md` (one row per apply attempt, indexed by `plan_id`).
- [ ] T006 [P] Define `PlanItemState`, `PlanItemFailure`, `PlanApplyEvent`, `PlanApplyRun` types in `crates/audit/src/plan_apply.rs`.
- [ ] T007 [P] Extend `crates/fs/planner/` to expose path-set comparison for the overlap check (`plan.conflict.overlap`).
- [ ] T008 Define the executor trait `FsExecutor` in `crates/fs/executor/src/lib.rs` with `execute_item`, cancellation token, and dependency injection for filesystem ops (so tests can substitute an in-memory FS).

**Checkpoint**: Foundation ready — user-story implementation can now begin.

---

## Phase 3: User Story 1 — Apply A Reviewed Plan (Priority: P1) MVP

**Goal**: Walk an `approved` plan sequentially, mutate the filesystem, write audit events, and compute a terminal state.

**Independent Test**: Approve a plan with mixed item kinds (move, archive, remove generated source view) and apply it; verify per-item state events and final `applied` / `partially_applied` / `failed` terminal state.

**Status**: `[mockup-done]` — `simulateApply` in `apps/desktop/src/data/store.ts` covers UI behaviour. Real executor still pending.

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test for `plan.apply` in `tests/contract/plan_apply.spec.ts` (request/response shape, event shapes).
- [ ] T010 [P] [US1] Integration test for happy-path apply in `tests/integration/apply_happy.rs` (in-memory FS, 10 items, all succeed, terminal = `applied`).
- [ ] T011 [P] [US1] Integration test for partial-failure apply in `tests/integration/apply_partial.rs` (one item fails with `conflict.destination_exists`, terminal = `partially_applied`).
- [ ] T012 [P] [US1] Integration test for re-apply with leftover pending items in `tests/integration/apply_resume.rs` (verify `succeeded` items skipped on second apply).

### Implementation for User Story 1

- [ ] T013 [US1] Implement the sequential per-item executor loop in `crates/fs/executor/src/run.rs` (read approved plan, walk items, emit events).
- [ ] T014 [US1] Implement the cross-platform move primitive in `crates/fs/executor/src/ops/move_op.rs` per research R1 (rename when same-volume, copy-then-delete otherwise; no silent overwrite).
- [ ] T015 [US1] Implement the archive primitive in `crates/fs/executor/src/ops/archive_op.rs` (delegates to move with configured archive root).
- [ ] T016 [US1] Implement the trash primitive in `crates/fs/executor/src/ops/trash_op.rs` per research R2 (platform trash, fallback to `trash.unavailable`).
- [ ] T017 [US1] Implement the permanent-delete primitive in `crates/fs/executor/src/ops/delete_op.rs` (requires `confirm_required=true`).
- [ ] T018 [US1] Implement the use-case `plan_apply` in `crates/app/core/src/usecases/plan_apply.rs` composing executor + persistence + audit.
- [ ] T019 [US1] Implement the Tauri command binding for `plan.apply` in `apps/desktop/src-tauri/src/commands/plan_apply.rs`.
- [ ] T020 [US1] Implement approval-token freshness check per research R8 (compare plan content hash; emit `plan.approval.stale` on mismatch).
- [ ] T021 [US1] Implement the overlap check per research R7 using T007 (`plan.conflict.overlap`).
- [ ] T022 [US1] Wire counters update transactionally with each item state transition per `data-model.md` invariants.
- [ ] T023 [US1] Replace `simulateApply` consumers in `apps/desktop/src/data/store.ts` to call the real Tauri command behind a feature flag; keep simulate path for storybook/demo.

**Checkpoint**: US1 fully functional and testable independently.

---

## Phase 4: User Story 2 — Handle Failure Safely (Priority: P2)

**Goal**: Failed items carry structured failure info; rollback (where possible) is logged distinctly; manual-recovery items are flagged.

**Independent Test**: Apply a plan with one permission-denied destination; verify the item resolves to `failed` with `{code: "permission.denied", recoverable: true}` and the plan terminal state is `partially_applied`.

### Tests for User Story 2

- [ ] T024 [P] [US2] Integration test for failure-code taxonomy in `tests/integration/apply_failures.rs` (one test per code from research R3).
- [ ] T025 [P] [US2] Integration test for rollback-attempt audit event in `tests/integration/apply_rollback.rs` (cross-volume copy-then-delete failure leaves source intact; audit event records rollback outcome).

### Implementation for User Story 2

- [ ] T026 [US2] Implement the failure taxonomy mapper in `crates/fs/executor/src/failure.rs` (raw `io::Error` → `PlanItemFailure`).
- [ ] T027 [US2] Implement per-operation rollback hooks in `crates/fs/executor/src/ops/*.rs` (move: best-effort rename-back; archive: same; trash: not applicable; delete: not applicable). Each writes a separate `PlanApplyEvent` with `rollback` populated.
- [ ] T028 [US2] Manual-recovery surfacing in the use-case: items with `recoverable=false` get a flag the UI can render in the Needs Attention section.

**Checkpoint**: US1 + US2 work.

---

## Phase 5: User Story 3 — Cancel An In-Flight Apply (Priority: P2)

**Goal**: Cancellation halts forward progress within one item boundary; remaining pending items become `cancelled`; plan terminal = `cancelled`.

**Independent Test**: Start applying a 100-item plan, cancel after ~10 items, verify ≥10 items finished, the rest become `cancelled`, and the plan state is `cancelled` even if successes preceded the cancel.

### Tests for User Story 3

- [ ] T029 [P] [US3] Contract test for `plan.cancel` in `tests/contract/plan_cancel.spec.ts`.
- [ ] T030 [P] [US3] Integration test for cancellation in `tests/integration/apply_cancel.rs` (verify no item starts after cancel observed; remaining items batched to `cancelled`).

### Implementation for User Story 3

- [ ] T031 [US3] Wire a `CancellationToken` into the executor loop in `crates/fs/executor/src/run.rs`; check between items only (never mid-item).
- [ ] T032 [US3] Implement the use-case `plan_cancel` in `crates/app/core/src/usecases/plan_cancel.rs`.
- [ ] T033 [US3] Implement the Tauri command binding for `plan.cancel` in `apps/desktop/src-tauri/src/commands/plan_cancel.rs`.
- [ ] T034 [US3] Write the batched per-item `pending → cancelled` audit events on cancel completion.

**Checkpoint**: US1 + US2 + US3 work. `[mockup-done]` for the UI cancellation path (`updatePlanState(plan.id, "cancelled")`).

---

## Phase 6: User Story 4 — Per-Item Skip And Retry Within Apply (Priority: P3)

**Goal**: While a plan is `applying`, the user can skip a `pending` item or retry a `failed` item without restarting the plan.

**Independent Test**: During an active apply, skip one pending item (verify `skipped`, never executed) and retry one failed item (verify it transitions back to `applying` and re-executes once).

### Tests for User Story 4

- [ ] T035 [P] [US4] Contract test for `plan.item.skip` in `tests/contract/plan_item_skip.spec.ts`.
- [ ] T036 [P] [US4] Contract test for `plan.item.retry` in `tests/contract/plan_item_retry.spec.ts`.
- [ ] T037 [P] [US4] Integration test for skip in `tests/integration/apply_item_skip.rs`.
- [ ] T038 [P] [US4] Integration test for retry in `tests/integration/apply_item_retry.rs`.

### Implementation for User Story 4

- [ ] T039 [US4] Implement the use-case `plan_item_skip` in `crates/app/core/src/usecases/plan_item_skip.rs` (validate plan is `applying` and item is `pending`).
- [ ] T040 [US4] Implement the use-case `plan_item_retry` in `crates/app/core/src/usecases/plan_item_retry.rs` (validate plan is `applying` and item is `failed`; route to plan-level retry hint when plan is terminal).
- [ ] T041 [US4] Implement the Tauri command bindings in `apps/desktop/src-tauri/src/commands/plan_item_skip.rs` and `plan_item_retry.rs`.
- [ ] T042 [US4] Wire the executor to honour skip-set and retry-injection between items (skip-set checked before pickup; retry pushes a re-run entry for the failed item).

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Documentation updates in `docs/research/` linking research.md decisions R1–R8 to runtime behaviour.
- [ ] T044 [P] Quickstart in `specs/025-filesystem-plan-application/quickstart.md` walking through an in-memory apply with all four contracts.
- [ ] T045 Performance check: 10k-item plan emits item progress within 50 ms of state transition (per plan.md Performance Goals).
- [ ] T046 Security hardening review: ensure no path escapes the configured library/archive roots; ensure no apply runs without an approval token.
- [ ] T047 Run quickstart.md validation.

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
T044 = { blocked_by = ["T019", "T033", "T041"] }
T045 = { blocked_by = ["T013"] }
T046 = { blocked_by = ["T020", "T018"] }
T047 = { blocked_by = ["T044"] }
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
