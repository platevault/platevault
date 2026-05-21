# Data Model: Cleanup And Archive Review Plans

**Feature**: 017-cleanup-archive-review-plans  
**Date**: 2026-05-20

## Entities

### Plan

A reviewable proposed set of filesystem operations.

| Field           | Type                                      | Notes |
|-----------------|-------------------------------------------|-------|
| `id`            | string (uuid)                             | stable identifier |
| `number`        | integer                                   | display-friendly monotonically increasing number |
| `title`         | string                                    | e.g. "Split /raw/2026-04" |
| `origin`        | enum: `inbox` \| `restructure` \| `cleanup` \| `archive` \| `project` | source generator |
| `originPath`    | string (optional)                         | filesystem context when applicable |
| `state`         | `PlanState`                               | see lifecycle below |
| `createdAt`     | timestamp (ISO 8601)                      | creation time |
| `items`         | `PlanItem[]`                              | proposed operations (may be paged in detail load) |
| `itemsTotal`    | integer                                   | item count |
| `itemsApplied`  | integer                                   | succeeded so far |
| `itemsFailed`   | integer                                   | failed so far |
| `itemsPending`  | integer                                   | still pending |
| `type`          | enum: `split` \| `restructure` \| `cleanup` \| `archive` \| `source_map` | execution shape |
| `parentPlanId`  | string (uuid, optional)                   | set on retry plans; references the terminal parent |

Invariants:

- `itemsTotal == itemsApplied + itemsFailed + itemsPending` MUST hold at every
  observation point.
- `parentPlanId` MUST reference a plan in a terminal state at the time the
  retry plan was created.
- A plan with `itemsTotal == 0` MUST NOT be approvable.

### PlanItem

One proposed filesystem operation.

| Field           | Type                                      | Notes |
|-----------------|-------------------------------------------|-------|
| `id`            | string                                    | stable per-item id |
| `index`         | integer                                   | per-plan ordinal (1-based) |
| `name`          | string                                    | display name (filename or summary) |
| `action`        | enum: `move` \| `archive` \| `delete` \| `link` \| `write` | proposed action |
| `from`          | string                                    | source absolute path |
| `to`            | string                                    | destination absolute path (may be empty for `delete`) |
| `reason`        | string                                    | human-readable rationale |
| `protection`    | enum: `normal` \| `protected`             | from spec 016 |
| `linked`        | string (optional)                         | linked Inventory session, project, or calibration set |
| `state`         | enum: `pending` \| `applying` \| `succeeded` \| `failed` \| `skipped` | per-item progression |
| `failureReason` | string (optional)                         | populated by apply executor on failure |
| `provenance`    | `{ label, value }[]` (optional)           | how the item was inferred |

### PlanState

The eight-state lifecycle vocabulary, drawn from spec 002 §2.2 and reproduced
here for completeness.

```
draft            → { ready_for_review, discarded }
ready_for_review → { approved, draft, discarded }
approved         → { applying, draft }            # reopen invalidates
applying         → { applied, partially_applied, failed, cancelled }
applied          → ∅ (terminal)
partially_applied→ ∅ (terminal — retry plan is a NEW plan)
failed           → ∅ (terminal — retry plan is a NEW plan)
cancelled        → ∅ (terminal)
```

Lifecycle table:

| State              | Writer       | Terminal? | Allowed transitions                                  | Notes |
|--------------------|--------------|-----------|------------------------------------------------------|-------|
| `draft`            | review (017) | no        | → `ready_for_review`, → discarded                    | initial state from any generator |
| `ready_for_review` | review (017) | no        | → `approved`, → `draft`, → discarded                 | items materialised and shown in detail |
| `approved`         | review (017) | no        | → `applying`, → `draft`                              | reopen as draft invalidates approval |
| `applying`         | apply  (025) | no        | → `applied`, → `partially_applied`, → `failed`, → `cancelled` | only executor writes |
| `applied`          | apply  (025) | yes       | ∅                                                    | every item succeeded |
| `partially_applied`| apply  (025) | yes       | ∅                                                    | retry creates a new plan |
| `failed`           | apply  (025) | yes       | ∅                                                    | retry creates a new plan |
| `cancelled`        | apply  (025) | yes       | ∅                                                    | forward progress halted by user; no rollback |

Key constraint (carried from spec 002 §2.2): **a retry plan is a new plan**
with its own audit trail, referencing the failed plan by id via
`parentPlanId`. This was confirmed in the mockup by the "Generate retry plan
for failures" CTA, which calls `createPlan(retry, parent_id)` rather than
mutating the failed plan in place.

## Relationships

- `Plan` 1—n `PlanItem` (composition).
- `Plan` 0..1—1 `Plan` (`parentPlanId` references parent for retry chains).
- `Plan` n—1 audit-event stream (`crates/audit/`).
- `PlanItem.linked` is a soft reference to an Inventory session, project, or
  calibration set; review surface does not enforce referential integrity but
  warns if the referent is missing.

## Storage Notes

- Plans and items live in SQLite tables owned by `crates/persistence/db/`.
- Item counters (`itemsApplied`, `itemsFailed`, `itemsPending`) are persisted
  on the plan row to avoid recomputing on list render; the apply executor is
  responsible for keeping them coherent.
- Paths are stored as `(root_id, relative_path)` pairs internally; the review
  contracts return resolved absolute paths for display.
