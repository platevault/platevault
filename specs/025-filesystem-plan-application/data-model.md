# Data Model: Filesystem Plan Application

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document scopes only the entities owned by spec 025. The `Plan` and
`PlanItem` parent shapes are owned by spec 017 (`crates/fs/planner/`); this
spec adds item-level run state, item-level failure structure, and a typed
audit event for each state transition.

## Shared entities (owned by 017)

- `Plan { id, number, state, items, itemsTotal, itemsApplied, itemsFailed, itemsSkipped, itemsCancelled, itemsPending, totalBytesRequired, destructiveDestination, approvalToken?, ... }`
- `PlanItem { id, planId, operation, source, destination?, reason, protected, confirmRequired, state, approvedMtime?, approvedSizeBytes?, archivePath? }`

Spec 025 consumes these shapes. Counter names are camelCase per R-Env-1.
`approvedMtime` and `approvedSizeBytes` are populated by spec 017's
`plan.approve` at approval time and consumed here for per-item FS
revalidation (R-FS-1).

## Entities owned by spec 025

### `PlanItemState` (enum)

The per-item run state, distinct from the plan state machine.

```text
PlanItemState =
  | pending      # not yet executed in this run; default
  | applying     # executor is acting on this item right now
  | succeeded    # filesystem operation completed
  | failed       # filesystem operation failed; see PlanItemFailure
  | stale        # per-item FS revalidation mismatch; non-skippable (R-FS-1)
  | skipped      # user marked the item skipped before it ran
  | cancelled    # user cancelled the run before this item was reached
```

Transitions allowed by the executor:

- `pending → applying` (executor picks the item up)
- `applying → succeeded`
- `applying → failed`
- `pending → skipped` (only while plan is `applying` and the item is still
  pending; via `plan.item.skip`)
- `failed → applying` (only via `plan.item.retry` while plan is `applying`)
- `pending → cancelled` (set in batch when the run cancels)
- `applying → stale` (per-item FS revalidation mismatch; R-FS-1; transitions
  run to `paused`; non-skippable; requires re-approval)

Disallowed transitions MUST be rejected at the use-case layer.

### `PlanItemFailure`

```text
PlanItemFailure {
  code:        string  # one of the codes from research.md R3
  message:     string  # human-readable detail, includes raw OS error where relevant
  recoverable: bool    # true ⇒ per-item-retry or plan.retry is expected to help
}
```

Stored on the plan_items row when state transitions to `failed`. Preserved
across re-apply; cleared only when the item state moves to `applying` again
(via per-item retry).

### `PlanApplyEvent`

The append-only audit row written for every state transition.

```text
PlanApplyEvent {
  id:          string  # ULID
  plan_id:     string
  item_id:     string  # nullable for plan-level transitions (start/terminal)
  prior_state: string  # PlanItemState OR PlanState
  new_state:   string  # PlanItemState OR PlanState
  at:          datetime # UTC ISO 8601
  failure?:    PlanItemFailure  # set on transitions into `failed`
  rollback?:   {
    attempted: bool
    outcome:   "succeeded" | "failed" | "not_applicable"
    message?:  string
  }
}
```

Persisted in a new SQLite table `plan_apply_events`. The audit crate exposes
the type; the persistence crate owns the schema. The table is append-only
(no UPDATE/DELETE) so the audit chain is reconstructable per FR-003 and
SC-001.

### `PlanApplyRun` (REQUIRED in v1, R-Run-1)

`PlanApplyRun` is a **mandatory** SQLite table (not optional). Persisted on
apply start. Tracks each execution attempt independently.

```text
PlanApplyRun {
  id:             string   # ULID
  planId:         string   # FK → plans.id
  approvalToken:  string   # the token used; allows audit of which approval gated this run
  startedAt:      datetime
  endedAt?:       datetime
  terminalState?: "applied" | "partially_applied" | "failed" | "cancelled" | "paused"
  itemsTotal:     int
  itemsApplied:   int
  itemsFailed:    int
  itemsSkipped:   int
  itemsCancelled: int
  itemsPending:   int
}
```

`PlanApplyEvent.runId` MUST reference this row.

`terminalState` `paused` indicates the run is suspended awaiting user action
(R-Pause-1). The run transitions `paused → applying` on `plan.resume` or
`paused → cancelled` on `plan.cancel`.

## Counters

The plan-level counters (`itemsApplied`, `itemsFailed`, `itemsSkipped`,
`itemsCancelled`, `itemsPending`) are owned by 017 and updated by spec 025's
executor transactionally with each item state transition:

- on `pending → applying`: `itemsPending--`
- on `applying → succeeded`: `itemsApplied++`
- on `applying → failed`: `itemsFailed++`
- on `applying → stale`: run pauses; no counter change until resolved
- on `failed → applying` (retry): `itemsFailed--`
- on `pending → skipped`: `itemsPending--`; `itemsSkipped++`
- on `pending → cancelled` (batch at cancel): `itemsPending` → 0;
  `itemsCancelled += (count of pending items)`

## Invariants

- `itemsApplied + itemsFailed + itemsSkipped + itemsCancelled + itemsPending
  == itemsTotal` at all times (A3).
- For any item, the sequence of `PlanApplyEvent.newState` values forms a
  legal path in the transition graph.
- A plan in a terminal state has no item in `applying`.
- `Plan.state == "cancelled"` ⇒ there exists a `PlanApplyEvent` recording
  the plan-level `applying → cancelled` transition; per-item events for the
  batched `pending → cancelled` transitions are written for every untouched
  item.
- `Plan.state == "paused"` ⇒ there exists a `PlanApplyRun` with
  `terminalState == "paused"` and a `PlanApplyEvent` recording the
  `applying → paused` transition (R-Pause-1).
- `PlanApplyEvent` rows are append-only (no UPDATE, no DELETE).
- A `PlanApplyRun` row MUST be created at apply start before any item
  mutation (R-Run-1). The CAS `plans.state: 'approved' → 'applying'` is
  atomic; if it fails, no run is created (R-CAS-1).

## Relation to spec 017 shapes

Spec 017's `plan.retry` consumes a terminal plan and emits a new `draft`
plan. The new plan's items reference the parent plan's item ids via the
shape 017 owns (`parent_item_id`). Spec 025 does not need to know about
this relationship while executing — it sees a fresh plan with fresh item
ids and runs it like any other.
