# Data Model: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: IMPLEMENTED

## Entities

### PreparedSourceView

The canonical record of a generated project source view.

| Field        | Type                                    | Notes |
| ------------ | --------------------------------------- | ----- |
| `id`         | `PreparedSourceViewId` (UUID)           | Primary key. |
| `project_id` | `ProjectId`                             | Owning project. |
| `kind`       | enum `symlink \| junction \| copy` | View strategy. `hardlink` is reserved/deferred to v1.x (R-026-Strategies, GRILL 2026-05-22). |
| `state`      | enum `current \| stale \| missing \| removed \| failed \| kind_diverged` | Lifecycle. `kind_diverged` indicates a pre-existing record whose `kind` disagrees with item `materialization`; UI surfaces for manual resolution (D-026-H2, GRILL 2026-05-22). |
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
| `materialization` | enum `symlink \| junction \| copy` | Recorded actual kind at creation. `hardlink` reserved/deferred to v1.x (R-026-Strategies, GRILL 2026-05-22). |
| `last_observed_state` | enum `present \| missing \| changed_kind \| diverged \| hash_diverged` | From last sweep. `hash_diverged` applies to copy-kind items where content hash no longer matches the recorded hash (A3, GRILL 2026-05-22). Link-kind items skip content hash. |

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
current      -> stale        (sweep detects divergence: link missing, changed kind,
                               or for copy-kind: hash_diverged)
current      -> removed      (ViewRemovalPlan applied successfully)
stale        -> removed      (ViewRemovalPlan applied successfully)
stale        -> current      (ViewRegenerationPlan applied successfully)
removed      -> current      (ViewRegenerationPlan applied successfully)
any          -> failed       (plan apply reports per-item failures; view stays
                              failed until a follow-up plan resolves it)
any          -> kind_diverged (migration: pre-existing record where PreparedSourceView.kind
                              disagrees with an item's materialization; UI surfaces
                              for manual resolution — D-026-H2, GRILL 2026-05-22)
kind_diverged -> removed     (user resolves via plan after UI confirmation)
kind_diverged -> current     (user resolves divergence and regenerates)
```

## Invariants

- A `ViewRemovalPlan.actions[*].target` MUST be a path recorded in the named
  `PreparedSourceView.items[*].view_relative_path` membership.
- A view in state `removed` retains full `items` membership. The view record is
  never hard-deleted; regeneration remains available indefinitely (A4, GRILL
  2026-05-22).
- A view in state `failed` MUST have at least one item with a failure outcome
  recorded in audit.
- `PreparedSourceView.kind` MUST equal every `PreparedSourceViewItem.materialization`
  at create time. A create request that would violate this invariant is refused
  with `view.mixed_kind` (A2, GRILL 2026-05-22).
- The destructive destination for view removal is always `archive`. No
  `destructiveDestination` field is accepted on the remove request
  (R-026-Dest-Archive, GRILL 2026-05-22).
- View removal and regeneration are only permitted when the owning project
  lifecycle is one of `setup_incomplete | ready | prepared | processing |
  blocked | completed`. Attempts on `archived` projects return
  `lifecycle.read_only` (R-026-Lifecycle, GRILL 2026-05-22).

## Storage Notes

- `PreparedSourceView` records are never hard-deleted.
- `kind_diverged` state is set by a data-migration task for pre-existing records
  that violated the mixed-kind invariant before it was enforced.
- The `crates/project/structure/` crate owns this data model (cross-spec note:
  see spec 008/009 for project lifecycle state machine). View operations align
  with project lifecycle states per R-026-Lifecycle; the unarchive path that
  enables view ops on previously-archived projects flows through spec 009
  R-Unarchive.
