# Research: Filesystem Plan Application

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This file resolves the cross-cutting research questions the spec calls out
before implementation. Each section lists options considered, the chosen
default, and the rationale.

## R1. Cross-platform move semantics

**Question**: How does the executor perform a "move" item when source and
destination may live on different volumes, OSes, or filesystem types?

**Options**

1. Always rename (atomic on same volume; fails across volumes).
2. Always copy-then-delete (slower; safe across volumes; risks
   double-storage during the copy window).
3. Detect same volume, prefer rename; fall back to copy-then-delete.

**Decision**: Option 3.

- Windows: use `MoveFileEx` semantics via Rust std::fs::rename when source
  and destination share a volume root; otherwise copy-then-delete with
  cross-process file-locking awareness (skip if source handle is open).
- macOS/Linux: use `rename(2)` when same filesystem; otherwise
  copy-then-delete with `fsync` on the copy before the delete.
- The executor MUST verify destination does not exist before rename (no
  silent overwrite per the constitution). If a destination collision is
  detected, the item fails with `conflict.destination_exists`.

## R2. Archive versus trash by operating system

**Question**: For destructive items, which OS-level "trash" do we use, and
when do we prefer the user's configured archive root instead?

**Decision**:

- "Archive" items go to the project's configured archive root via the
  rename/copy path in R1. No OS trash interaction.
- "Delete" items go through the platform trash API:
  - Windows: `SHFileOperation` with `FOF_ALLOWUNDO`.
  - macOS: `NSFileManager trashItem:resultingItemURL:error:`.
  - Linux: XDG trash spec under `$XDG_DATA_HOME/Trash` with `.trashinfo`.
- "Permanent delete" items require destructive confirmation (FR-004) and
  bypass trash. The contract surfaces this as an item-level confirmation
  flag, not as a separate operation.

## R3. Failure-mode taxonomy

**Question**: What structured failure codes do `PlanItemFailure.code`
values take, and which are `recoverable`?

**Decision**: the executor produces one of these codes per failed item:

| code                           | recoverable | meaning |
|--------------------------------|-------------|---------|
| `permission.denied`            | true        | OS refused read or write; user can elevate or fix ACLs. |
| `conflict.destination_exists`  | true        | Destination path exists; user can rename or remove. |
| `source.missing`               | false       | Source disappeared between approval and apply. |
| `source.locked`                | true        | Another process holds the source file. |
| `volume.unavailable`           | true        | Removable drive ejected or network share offline. |
| `disk.full`                    | true        | Destination volume out of space. |
| `path.invalid`                 | false       | Path violates OS rules (length, characters). |
| `protected.source`             | false       | Source policy forbids this operation (FR-008). |
| `trash.unavailable`            | true        | Platform trash API unavailable; user can permanent-delete instead. |
| `unknown`                      | false       | Catch-all; preserve raw OS error in `message`. |

`recoverable=true` means per-item retry (or plan-level retry via 017) is
expected to be a useful next action. `recoverable=false` typically requires
a new plan (which routes through 017).

## R4. Partial-progress preservation on cancellation

**Question**: When the user cancels, what is the invariant on disk and in
the audit log?

**Decision**:

- The executor MUST finish the currently-running item (success or failure)
  before observing cancellation. This is enforced by a cancellation token
  checked between items, not within an item.
- All items that already resolved (`succeeded` or `failed`) keep their state
  and audit events.
- Items still `pending` at cancellation transition to `cancelled` with a
  single audit event each, batched but per-item.
- The plan terminal state is `cancelled` (not `partially_applied`) even when
  some items succeeded — `cancelled` carries strictly more information.

## R5. Per-item retry primitives

**Question**: What does "retry a failed item within a running apply" do
mechanically?

**Decision**:

- Retry is only valid while the plan is `applying`. After the plan reaches
  a terminal state the user must use 017's `plan.retry` instead.
- A retry resets the item from `failed` back to `applying` and re-invokes
  the per-item executor closure exactly once. Repeated retries are explicit
  per-click; the executor never auto-retries.
- The previous failure record is preserved in the audit log; the new
  attempt writes its own `PlanApplyEvent` chain (`failed → applying →
  succeeded|failed`).

## R6. Idempotency of re-apply

**Question**: If the user clicks "Apply" again on an already-applying or
partially terminal plan, what happens?

**Decision**:

- If the plan is `applying`, the second call is rejected with
  `plan.invalid_state`.
- If the plan is in a terminal state (`applied`, `partially_applied`,
  `failed`, `cancelled`), the second call is also rejected with
  `plan.invalid_state`. Users must go through 017's `plan.retry` to
  generate a new plan.
- If the plan is `approved` with items still in `pending`, re-apply resumes
  from those `pending` items. `failed` items are preserved (not retried),
  `succeeded` items are skipped.

## R7. Concurrency model

**Decision**: v1 is **strictly sequential** within a single plan, matching
the mockup. Per-volume parallelism is deferred. Multiple plans CAN apply
concurrently only if they touch disjoint source/destination subtrees; the
executor MUST refuse overlapping plans with `plan.conflict.overlap`. This
overlap check uses the planner's path-set comparison.

## R8. Approval-token freshness

**Decision**: The approval token issued by 017 includes the plan-content
hash at approval time. Apply re-computes the hash before running and
rejects with `plan.approval.stale` if the plan content changed. This
prevents an edit between approve and apply from sneaking new items into a
run.

## Open Points

- Whether `volume.unavailable` should pause the run rather than fail items.
  Default: fail each affected item; user can per-item-retry after
  remounting.
- Whether to expose a "dry-run" mode separate from 017's plan review.
  Default: no; review is the dry run.
- Whether `disk.full` should short-circuit the whole run.
  Default: no; continue to allow non-overlapping items to succeed.
