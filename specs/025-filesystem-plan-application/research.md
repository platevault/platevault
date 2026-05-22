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

## R7. Concurrency model (R-Concur-1)

**Decision**: v1 is **strictly sequential** within a single plan, matching
the mockup. Per-volume parallelism is deferred. Multiple plans MAY apply
concurrently only if their (source ∪ destination) path sets are disjoint at
subtree-prefix granularity. The executor MUST check pending applies against
active applies' path sets at start; overlapping plans are rejected with
`plan.conflict.overlap`.

**Path-set comparison algorithm**: Compute `Set<canonical_path_prefix>` per
plan (source paths + destination paths + archive paths). Compare via
prefix-overlap test: two sets overlap if any prefix in one is a prefix-of or
has-as-prefix any prefix in the other. The comparison uses canonicalized
absolute paths.

## R8. Approval-token freshness (A2)

**Decision**: The approval token issued by 017 is an HMAC over
`(planId, contentHash, approvedAt, serverSecret)`. Single-use; consumed by
`plan.apply`. **No time-based TTL on the approval token.** Freshness is
enforced by per-item FS revalidation before each mutation (see R-FS-1 below).

The apply executor re-computes the plan content hash before starting and
rejects with `plan.approval.stale` if the plan body changed. This prevents
an edit between approve and apply from sneaking new items into a run.

## R1 (addendum). Cross-volume move error codes (R-Fail-1)

In addition to the R3 taxonomy, cross-volume copy-then-delete failure adds:

| code | recoverable | meaning |
|---|---|---|
| `copy.succeeded.delete.failed` | true | Cross-volume move: copy succeeded but source delete failed. Executor attempts rollback (remove destination copy). |
| `copy.succeeded.delete.failed.rollback.failed` | true | Rollback of destination copy also failed; both source AND destination remain on disk. UI surfaces this hybrid state explicitly. Audit event records the full sequence. |
| `item.stale` | true | Per-item FS revalidation mismatch (R-FS-1). Non-skippable; requires re-approval. |
| `os_trash.unavailable` | true | Platform trash API not supported (R-Trash-1). |
| `os_trash.full` | true | OS trash quota exceeded. |
| `os_trash.permission.denied` | false | OS refused trash operation. |

**Rollback policy for `copy.succeeded.delete.failed`**: executor attempts to
remove the destination copy. If rollback succeeds, item lands in `failed`
with the original delete error. If rollback fails, item lands in `failed`
with code `copy.succeeded.delete.failed.rollback.failed` and both source and
destination remain on disk. The UI surfaces this hybrid state explicitly.
Audit event records the full sequence.

## R3 (addendum). Disk-full pre-flight (A4)

Pre-flight space check at plan generation time blocks plan creation when
destination volume has insufficient space (computed from `totalBytesRequired`
with a configurable safety margin). This is a hard fail before the plan
enters `draftable` state.

Mid-apply `disk.full` (volume fills up after plan creation) becomes a
recoverable per-item failure that pauses the run (matches R-Pause-1 below).
The user frees space and resumes.

## R-FS-1. Per-item FS revalidation snapshot

Before each item mutation the executor MUST check:
- (a) Source path's current `(mtime, sizeBytes)` matches `PlanItem.approvedMtime`
  / `PlanItem.approvedSizeBytes` (populated by `plan.approve`).
- (b) Destination path is empty (no name conflict).

On mismatch: item state → `stale`; run pauses (R-Pause-1). User sees "Plan
is stale" dialog with option to regenerate the plan (full re-approval flow).
Error code `item.stale` is `recoverable: true` and non-skippable.

## R-Pause-1. Pause/resume on mid-apply faults

Run state machine: `applying → paused` on `volume.unavailable`, `disk.full`,
or `item.stale`. `paused → applying` via `plan.resume`. `paused → cancelled`
via `plan.cancel`.

The `plan.resume` contract re-validates the pause condition before resuming.
If the condition is unchanged (e.g. volume still unavailable), the server
returns the appropriate failure code rather than resuming.

Event bus topics: `plan.applying.paused` (on pause), `plan.applying.resumed`
(on resume).

## R-CAS-1. Atomic CAS on apply start

The apply executor MUST perform an atomic compare-and-swap:
`UPDATE plans SET state='applying' WHERE id=? AND state='approved'`.
If the CAS fails (state changed between read and write, e.g. concurrent
apply from another window), apply returns `plan.invalid_state` and does NOT
start the run. This prevents double-apply races.

## Open Points

All previously open points are now resolved:

- `volume.unavailable` pauses the run (R-Pause-1). Resolved.
- `disk.full` pauses the run mid-apply; pre-flight blocks plan creation (A4, R-Pause-1). Resolved.
- Per-volume parallelism deferred; sequential is v1 (R-Concur-1). Resolved.
- Dry-run: no separate mode; review IS the dry run. Resolved.

## R2 (addendum). OS trash platform semantics (R-Trash-1)

When `destructiveDestination == os_trash` on a plan, the executor uses:
- **Windows**: `IFileOperation::DeleteItem` with `FOFX_RECYCLEONDELETE`.
- **macOS**: `NSFileManager.trashItem(at:resultingItemURL:error:)`.
- **Linux**: freedesktop trash spec / `gio trash` (XDG `$XDG_DATA_HOME/Trash`
  with `.trashinfo` file).

Recommended Rust crate: `trash` (cross-platform abstraction).

Error codes: `os_trash.unavailable`, `os_trash.full`,
`os_trash.permission.denied` (added to R3 taxonomy above).
