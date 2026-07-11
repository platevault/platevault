# Quickstart: Filesystem Plan Application

Walks through the five contracts this spec owns — `plan.apply`, `plan.cancel`,
`plan.resume`, `plan.item.skip`, `plan.item.retry` — against the real
executor, using the in-memory-DB integration harness already established in
this crate. There is no separate "run this script" step; each numbered stage
below points at the passing test that proves it, so this doubles as executable
documentation (T047 validation = these tests are green in CI).

## Prerequisites

- Rust toolchain (workspace edition); no external services — every scenario
  runs against `persistence_db::Database::in_memory()` + `tempfile::tempdir()`.

## 1. `plan.apply` — happy path

A plan with N approved move items, all sources present, all destinations
free: apply moves every file and the plan reaches the terminal `applied`
state.

```bash
cargo nextest run -p app_core apply_multi_item_all_succeed_reaches_applied
```

Code path: `app_core::plan_apply::apply_plan` → `fs_executor::run::execute_plan`
→ `fs_executor::ops::move_op::move_file` (same-volume rename). Contract:
`contracts/plan.apply.json`.

## 2. `plan.apply` — partial failure

One item's destination already exists (conflict); the rest are clear. The
conflicting item's source is left untouched (constitution §II — no silent
overwrite) and the plan reaches `partially_applied`, not `failed` (that state
is reserved for zero successes).

```bash
cargo nextest run -p app_core apply_partial_failure_reaches_partially_applied
```

## 3. `plan.apply` — pause on a stale item (R-Pause-1)

An item whose approval-time `(mtime, size)` CAS snapshot no longer matches
the real file halts the run with `item.stale` and moves the plan to `paused`
(not `failed`) — `plan.apply.status`'s `pauseReason` reports it.

```bash
cargo nextest run -p app_core apply_pauses_on_stale_item_cas_mismatch
```

`volume.unavailable` and `disk.full` are the other two pause triggers
(`contracts/plan.apply.json` events.itemProgress.failure.code); both require a
real OS-level condition (device unavailable / disk full) that isn't producible
in an in-memory/tempdir harness, so they remain exercised only at the
executor's classifier-unit-test layer (`crates/fs/executor/src/failure.rs`).

## 4. `plan.resume` — re-validate and continue (KNOWN GAP)

Per `contracts/plan.resume.json`, resuming a paused run should re-validate
the pause condition and, on success, continue applying the plan's remaining
`pending` items. As of this writing `resume_plan`
(`crates/app/core/src/plan_apply.rs`) only flips the plan's DB state
`paused -> applying` and emits the audit/event pair — it does **not**
re-validate the condition, and it does **not** re-spawn the executor to
process remaining items. See
[issue #575](https://github.com/nightwatch-astro/alm/issues/575) for the full
writeup and a suggested fix (extract the `tokio::spawn` executor block from
`apply_plan` into a shared helper callable from both `apply_plan` and
`resume_plan`).

The contract's success/`run.not_paused` response shapes are validated at the
schema level:

```bash
node packages/contracts/tests/conformance-harness.mjs
```

The desktop UI surfaces this honestly: a paused run shows a state badge with
the reported reason and a "Resume" affordance that calls the real
`plan.resume` command (`apps/desktop/src/features/plans/PlanReviewOverlay.tsx`,
`usePlanApplyProgress.ts`) — it does not simulate continuation.

## 5. `plan.cancel`

Cancelling an in-flight or paused run halts forward progress at the next
item boundary and batches remaining `pending` items to `cancelled`.

```bash
cargo nextest run -p app_core cancel_plan_rejects_non_applying
cargo nextest run -p fs_executor cancellation_halts_before_next_item
```

(No single cross-crate test proves the item-boundary race deterministically —
see T030's note in `tasks.md` for why that's inherent to
`#[tokio::test]`'s current-thread scheduling, not a coverage gap to close.)

## 6. `plan.item.skip` / `plan.item.retry`

Skip transitions a `pending` item to `skipped` without executing it; retry
resets a `failed` item back to `applying` and re-queues it for one more
attempt.

```bash
cargo nextest run -p app_core skip_item_rejects_when_not_applying
cargo nextest run -p app_core retry_plan_item_transitions_failed_item_to_applying
cargo nextest run -p app_core retry_plan_item_rejects_non_failed_item
cargo nextest run -p fs_executor user_skip_set_prevents_execution
```

## 7. CAS race (R-CAS-1)

Two concurrent `plan.apply` calls on the same approved plan: exactly one
wins the atomic `approved -> applying` transition; the loser gets
`plan.invalid_state`.

```bash
cargo nextest run -p app_core concurrent_apply_calls_race_on_cas_exactly_one_wins
```

## Contract fixtures

All five contracts' request/response shapes are validated against
`specs/025-filesystem-plan-application/contracts/*.json` in
`packages/contracts/tests/conformance-harness.mjs`:

```bash
node packages/contracts/tests/conformance-harness.mjs
```
