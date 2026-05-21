# Data Model: Filesystem Plan Application

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document scopes only the entities owned by spec 025. The `Plan` and
`PlanItem` parent shapes are owned by spec 017 (`crates/fs/planner/`); this
spec adds item-level run state, item-level failure structure, and a typed
audit event for each state transition.

## Shared entities (owned by 017)

- `Plan { id, number, state, items, items_total, items_applied, items_failed, items_pending, approval_token?, ... }`
- `PlanItem { id, plan_id, operation, source, destination?, reason, protected, confirm_required, state }`

Spec 025 consumes these shapes unchanged. It does not redefine them.

## Entities owned by spec 025

### `PlanItemState` (enum)

The per-item run state, distinct from the plan state machine.

```text
PlanItemState =
  | pending      # not yet executed in this run; default
  | applying     # executor is acting on this item right now
  | succeeded    # filesystem operation completed
  | failed       # filesystem operation failed; see PlanItemFailure
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

### `PlanApplyRun` (optional v1, recommended)

If multiple apply attempts on the same plan need to be distinguished:

```text
PlanApplyRun {
  id:            string  # ULID
  plan_id:       string
  started_at:    datetime
  ended_at?:     datetime
  terminal_state: "applied" | "partially_applied" | "failed" | "cancelled"
  items_succeeded: int
  items_failed:    int
  items_skipped:   int
  items_cancelled: int
  approval_token: string  # the token used; allows audit of which approval gated this run
}
```

`PlanApplyEvent.run_id` SHOULD reference this row when present.

## Counters

The plan-level counters (`items_applied`, `items_failed`, `items_pending`)
already exist on the `Plan` shape (owned by 017). Spec 025's executor
updates them transactionally with each item state transition:

- on `pending → applying`: `items_pending--`
- on `applying → succeeded`: `items_applied++`
- on `applying → failed`: `items_failed++`
- on `failed → applying` (retry): `items_failed--`
- on `pending → skipped`: `items_pending--`
- on `pending → cancelled` (batch at cancel): `items_pending` set to 0

## Invariants

- `items_succeeded + items_failed + items_skipped + items_cancelled + items_pending = items_total`
  at all times.
- For any item, the sequence of `PlanApplyEvent.new_state` values forms a
  legal path in the transition graph.
- A plan in a terminal state has no item in `applying`.
- `Plan.state == "cancelled"` ⇒ there exists a `PlanApplyEvent` recording
  the plan-level `applying → cancelled` transition; per-item events for the
  batched `pending → cancelled` transitions are written for every untouched
  item.
- `PlanApplyEvent` rows are append-only (no UPDATE, no DELETE).

## Relation to spec 017 shapes

Spec 017's `plan.retry` consumes a terminal plan and emits a new `draft`
plan. The new plan's items reference the parent plan's item ids via the
shape 017 owns (`parent_item_id`). Spec 025 does not need to know about
this relationship while executing — it sees a fresh plan with fresh item
ids and runs it like any other.
