# Implementation Plan: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: NOT IMPLEMENTED

## Architecture Overview

A `PreparedSourceView` is a reproducible projection of canonical inventory data
(symlinks, junctions, hardlinks, or copies created under a project workspace).
Removal and regeneration are modeled as `FilesystemPlan` variants so that all
constitutional plan-review, apply, and audit guarantees apply uniformly.

### Crate Boundaries

- `crates/project/structure/`: owns the `PreparedSourceView` aggregate and its
  per-item membership list (which inventory items the view references and what
  on-disk link/copy was produced).
- `crates/fs/planner/`: extended with `ViewRemovalPlan` and
  `ViewRegenerationPlan` variants of `FilesystemPlan`. Both carry a
  `plan.origin` discriminator (`prepared_view_removal` or
  `prepared_view_regeneration`) so audit and review surfaces can route them.
- `crates/fs/inventory/`: provides resolution of canonical paths during
  regeneration and detection of broken references for stale-view marking.
- `crates/audit/`: emits per-item events; no schema changes beyond a new
  `origin` value.
- `crates/app/core/`: orchestrates the use cases `RemovePreparedView` and
  `RegeneratePreparedView`.
- `crates/contracts/core/` and `packages/contracts/`: expose
  `preparedview.remove` and `preparedview.regenerate` operations.

### Plan Flow

1. User triggers `preparedview.remove` with a `view_id`.
2. App enumerates the view's items, classifies each as
   `symlink|junction|copy|hardlink`, and produces a `ViewRemovalPlan` whose
   targets are restricted to app-created paths recorded for that view.
3. The plan is reviewed and applied through the existing filesystem plan
   pipeline. Apply emits per-item outcomes.
4. On successful apply, the `PreparedSourceView` record is marked `removed`
   but its membership history is preserved for later regeneration.
5. `preparedview.regenerate` reads the preserved membership, resolves current
   canonical inventory paths, and emits a fresh plan with origin
   `prepared_view_regeneration`. Unresolved references are surfaced as plan
   warnings rather than silent omissions.

### Safety Properties

- Removal plans MUST include only paths recorded as part of the view; no plan
  step may target an inventory path outside the recorded view membership.
- Copy-strategy views are removed via the archive/trash workflow by default to
  preserve reversibility; symlink/junction/hardlink strategies use direct
  unlink because the canonical bytes remain in inventory.
- Stale-view detection is read-only and never mutates without a plan.

## Out of Scope

- Processing-tool execution.
- Bulk cross-project removal.
- Migration of legacy non-view link folders that have no `PreparedSourceView`
  record.
