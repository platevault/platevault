# Implementation Plan: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: IMPLEMENTED (core pipeline; see spec.md deferred list)

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

1. User triggers `preparedview.remove` with a `view_id`. The owning project
   MUST be in `setup_incomplete | ready | prepared | processing | blocked |
   completed`; `archived` projects are refused with `lifecycle.read_only`
   (R-026-Lifecycle, GRILL 2026-05-22). Cross-reference: use spec 009
   R-Unarchive (`archived → ready`) to unarchive before operating on views.
2. App validates that `PreparedSourceView.kind` equals every item's
   `materialization`. A diverged record (state `kind_diverged`) is surfaced
   for manual resolution before proceeding (D-026-H2, GRILL 2026-05-22).
3. App enumerates the view's items, classifies each as `symlink|junction|copy`
   (hardlink deferred — R-026-Strategies, GRILL 2026-05-22), and produces a
   `ViewRemovalPlan` whose targets are restricted to app-created paths recorded
   for that view. Destructive destination is always `archive`
   (R-026-Dest-Archive, GRILL 2026-05-22).
4. The plan flows through the **full spec 017/025 pipeline**
   (R-026-Pipeline, GRILL 2026-05-22):
   - `plan.approve` issues an approvalToken (HMAC over plan body).
   - `plan.apply` runs per-item FS revalidation; mismatches pause via
     `plan.resume`; all spec 017/025 error codes (`item.stale`,
     `disk.full`, `volume.unavailable`, `path.invalid`) can surface.
   - The `preparedview.remove` response includes the `plan_id`; callers
     use the standard plan pipeline contracts to track progress.
5. On successful apply, the `PreparedSourceView` record is marked `removed`
   but its membership history is preserved for later regeneration indefinitely
   (A4, GRILL 2026-05-22).
6. `preparedview.regenerate` reads the preserved membership, resolves current
   canonical inventory paths, and emits a fresh plan with origin
   `prepared_view_regeneration`. Unresolved references are surfaced as plan
   warnings. The regenerate response similarly includes a `plan_id`.

**Stale views and cleanup plans (R-026-StaleAutoInclude, GRILL 2026-05-22)**:
Stale views are never auto-mutated. Spec 017 cleanup plans MAY passively
include stale views as candidates in their preview. Users explicitly approve
any action against stale views through the standard plan review surface.

**Spec 017/025 compliance (R-026-Pipeline, E-026-2)**:
All view plan operations are full citizens of the spec 017/025 plan pipeline.
The architecture section of spec 017/025 contracts is the authoritative
reference for approval tokens, FS revalidation, paused state, and retry
semantics. This spec does not re-specify those behaviours.

### Safety Properties

- Removal plans MUST include only paths recorded as part of the view; no plan
  step may target an inventory path outside the recorded view membership.
- All view removal uses archive as the destructive destination (R-026-Dest-Archive,
  GRILL 2026-05-22). No `destructiveDestination` field is accepted on the
  remove request; the server hard-codes `archive`.
- Stale-view detection is read-only and never mutates without a plan.
- Mixed-kind views are refused at create time (A2, GRILL 2026-05-22);
  the `view.mixed_kind` error is returned.
- `hardlink` strategy is deferred to v1.x; any request that specifies
  `kind: hardlink` is refused with `view.unsupported_kind` in v1.

## Out of Scope

- Processing-tool execution.
- Bulk cross-project removal.
- Migration of legacy non-view link folders that have no `PreparedSourceView`
  record.
- `hardlink` view strategy and its removal/regeneration semantics
  (R-026-Strategies, GRILL 2026-05-22 — deferred to v1.x).
- User-selectable destructive destination (hard-coded `archive` in v1,
  R-026-Dest-Archive, GRILL 2026-05-22).
- Envelope sweep for existing contracts (deferred, E-026-1, GRILL 2026-05-22).
