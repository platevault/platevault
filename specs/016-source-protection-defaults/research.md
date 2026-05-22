# Research: Source Protection Defaults

**Branch**: `016-source-protection-defaults` | **Date**: 2026-05-20

## R1. Protection Level Semantics

**Decision**: Three discrete levels — `protected`, `normal`, `unprotected`.

| Level         | Plan Generation                                              | Permanent Delete                          | UI Treatment              |
| ------------- | ------------------------------------------------------------ | ----------------------------------------- | ------------------------- |
| `protected`   | Destructive items flagged, require explicit acknowledgement. | Rewritten to archive when block toggle on. | Warning banner per item.  |
| `normal`      | Destructive items emitted; review still mandatory.           | Allowed if user confirms in review.       | Standard plan review row. |
| `unprotected` | Destructive items emitted with `advanced_mode` flag.         | Allowed without extra acknowledgement.    | Advanced-mode badge.      |

**Rationale**: a binary protected/unprotected model collapses two distinct
risk classes — externally owned roots that should never be mutated without
heavy review, and capture inboxes where moves are normal day-to-day work.

**Rejected alternatives**:

- Numeric 0–5 scale: harder to map to plan-generation rules; no clear product
  semantics for intermediate values.
- Booleans per operation (delete, move, archive): fragments the policy and
  duplicates rules across sources.

## R2. Granularity: Source vs Category vs Frame Type

**Decision**: Protection is configured at the **source** level. A separate
**protected categories** list (default `lights, masters, finals`) constrains
which items inside any source are treated as protected regardless of the
source-level setting.

**Rationale**: most user mental models are folder-based ("don't mutate my
masters drive"). Category protection covers the cross-cutting case where a
user wants to protect master frames or final stacks wherever they live.

**Rejected alternatives**:

- Per-frame protection: too granular for v1; users would have to mark
  thousands of files individually.
- Per-target protection: a target spans many sources; better expressed via
  lifecycle state (spec 002) rather than this protection model.

## R3. Archive vs Trash vs Permanent Delete Semantics

**Decision (updated 2026-05-22, R-OSTrash-Allowed)**: OS trash is treated as
a **reversible** action and is NOT considered permanent delete. The
`block_permanent_delete` flag therefore applies ONLY to the `permanent_delete`
action. The `os_trash` destructive destination (spec 017 `destructiveDestination`)
is always allowed regardless of `block_permanent_delete`, because the user can
recover items from the OS recycle bin/trash.

Interaction table:

| Action                                   | `block_permanent_delete = true` | `block_permanent_delete = false` |
| ---------------------------------------- | ------------------------------- | -------------------------------- |
| `archive` (move to archive root)         | Allowed                         | Allowed                          |
| `os_trash` (OS recycle bin/trash)        | **Allowed** — reversible        | Allowed                          |
| `permanent_delete`                       | **Blocked** — rewritten to archive | Allowed (with plan review)   |

When the planner would emit a `permanent_delete` against a `protected` source
with `block_permanent_delete = true`, it rewrites the action to `archive`
(move to `<library_root>/.astro-plan-archive/<planId>/`, spec 025 pattern).
The rewrite is recorded on the plan item as `rewritten_action`.

**Rationale**: archive is recoverable from inside the app; OS trash is
recoverable from outside the app; permanent delete is not recoverable.
Constitution principle II prefers archive over trash over delete. Blocking
`os_trash` would be overly restrictive and would surprise users who have
selected that destructive destination in the plan review.

**Rejected alternatives**:

- Block `os_trash` with `block_permanent_delete`: too restrictive; OS trash
  is clearly reversible.
- Always use OS trash: loses audit linkage and breaks on network drives where
  trash is not supported.
- Refuse the plan entirely: poor UX; user has to rebuild the plan manually.

## R4. Recovery From Accidental Destructive Plans

**Decision**: Every destructive plan item records the resolved protection
state, the original action, and any rewrite (e.g., delete → archive). The
audit event stream stores acknowledgements with timestamp and user identity.
Recovery surfaces:

1. **Plan-level**: the review screen lists protected items with a reason and a
   per-item acknowledgement control; nothing executes until all are
   acknowledged or the plan is rebuilt.
2. **Post-execution**: archive root retains moved files; audit event log
   exposes the affected source, item ids, and the rewrite mapping so users
   can restore from archive deliberately.

**Rationale**: Constitution principle II requires reviewable + auditable
mutation; this combination keeps both the pre-flight gate and the post-flight
trail intact.

## R5. Default Protected Categories

**Decision**: Default categories are `lights, masters, finals`.

- `lights`: original capture frames are irreplaceable.
- `masters`: calibration master frames represent significant compute cost to
  re-derive.
- `finals`: integrated/processed final outputs are the user's artistic work.

`darks`, `flats`, `biases`, and intermediates are not default-protected
because they are typically reproducible.

## Open Questions (deferred)

- Whether to allow regex / glob patterns in the protected categories input.
- **"Freeze project" toggle** — explicitly deferred to v1.x (confirmed
  2026-05-22). A toggle that promotes all sources in a project to `protected`
  is useful but out of scope for v1. Document in spec.md Out of Scope.
