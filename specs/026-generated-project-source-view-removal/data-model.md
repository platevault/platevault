# Data Model: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: NOT IMPLEMENTED

## Entities

### PreparedSourceView

The canonical record of a generated project source view.

| Field        | Type                                    | Notes |
| ------------ | --------------------------------------- | ----- |
| `id`         | `PreparedSourceViewId` (UUID)           | Primary key. |
| `project_id` | `ProjectId`                             | Owning project. |
| `kind`       | enum `symlink \| junction \| copy \| hardlink` | View strategy. |
| `state`      | enum `current \| stale \| missing \| removed \| failed` | Lifecycle. |
| `items`      | `Vec<PreparedSourceViewItem>`           | Per-item membership. |
| `created_at` | timestamp                               | First materialization time. |
| `removed_at` | optional timestamp                      | Set when a `ViewRemovalPlan` apply succeeds. |

A view is never hard-deleted from the database after removal; its membership is
preserved to make regeneration reproducible.

### PreparedSourceViewItem

| Field             | Type                | Notes |
| ----------------- | ------------------- | ----- |
| `inventory_item_id` | `InventoryItemId` | Canonical source the projection references. |
| `view_relative_path` | string           | Path under the project workspace where the link/copy lives. |
| `materialization` | enum `symlink \| junction \| copy \| hardlink` | Recorded actual kind at creation. |
| `last_observed_state` | enum `present \| missing \| changed_kind \| diverged` | From last sweep. |

### ViewRemovalPlan (FilesystemPlan variant)

A `FilesystemPlan` whose `origin` discriminator is `prepared_view_removal`.

| Field        | Type                          | Notes |
| ------------ | ----------------------------- | ----- |
| `plan_id`    | `PlanId`                      | Standard plan id. |
| `origin`     | const `prepared_view_removal` | Routes audit and review surfaces. |
| `view_id`    | `PreparedSourceViewId`        | Target view. |
| `actions`    | `Vec<PlanAction>`             | Per-item unlink or archive action. Actions are constrained to the recorded view membership; no action may target an inventory path. |

### ViewRegenerationPlan (FilesystemPlan variant)

A `FilesystemPlan` whose `origin` discriminator is
`prepared_view_regeneration`.

| Field      | Type                                | Notes |
| ---------- | ----------------------------------- | ----- |
| `plan_id`  | `PlanId`                            | Standard plan id. |
| `origin`   | const `prepared_view_regeneration`  | Routes audit and review surfaces. |
| `view_id`  | `PreparedSourceViewId`              | View to re-materialize. |
| `actions`  | `Vec<PlanAction>`                   | Per-item create-link or copy actions resolved against current inventory paths. |
| `warnings` | `Vec<RegenerationWarning>`          | Surfaces unresolved or remapped references. |

## State Transitions

```
current  -> stale     (sweep detects divergence)
current  -> removed   (ViewRemovalPlan applied successfully)
stale    -> removed   (ViewRemovalPlan applied successfully)
stale    -> current   (ViewRegenerationPlan applied successfully)
removed  -> current   (ViewRegenerationPlan applied successfully)
any      -> failed    (plan apply reports per-item failures; view stays
                       failed until a follow-up plan resolves it)
```

## Invariants

- A `ViewRemovalPlan.actions[*].target` MUST be a path recorded in the named
  `PreparedSourceView.items[*].view_relative_path` membership.
- A view in state `removed` retains full `items` membership.
- A view in state `failed` MUST have at least one item with a failure outcome
  recorded in audit.
