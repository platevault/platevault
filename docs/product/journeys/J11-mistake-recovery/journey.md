---
id: J11
title: Correct an inbox or calibration mistake before it becomes permanent
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [inbox, calibration]
interfaces: [windows-desktop]
trace:
  - pre-migration journey.md @ git 66026463
  - crates/app/inbox/src/reclassify.rs
  - crates/persistence/db/src/repositories/inbox.rs
  - crates/app/core/src/inbox_plan.rs
  - crates/app/core/src/plans.rs
  - crates/calibration/*/src/assign.rs
  - crates/persistence/db/src/repositories/calibration_assignment.rs
---

## Goal
Let the user correct their own mistakes during inbox triage and calibration
matching without touching a single file on disk: assign the wrong frame type
to a needs-review file and fix it before confirming, pick the wrong
destination library and change it before confirming, confirm a plan too
early and back out of it before it applies, or assign the wrong calibration
master to a session and replace it with the right one. "Done" is the
index returning to a state indistinguishable from having never made the
mistake — no orphaned plan, no leftover file, no stuck classification.

## Preconditions
- P1: an inbox item whose files include at least one the scanner could not
  auto-detect a frame type for (a "needs review" file).
- P2: more than one destination root exists for the relevant frame-type
  category, so a root picker is shown.
- P3: an inbox item has been confirmed to a not-yet-applied plan.
- P4: a session has already been assigned a calibration master (bias, dark,
  or flat) that the user now believes is wrong, and at least one other
  compatible master exists to reassign to.

## Steps

### S1 — Assign a frame type to a needs-review file, then change your mind {#S1}
- **Do:** open an inbox item with needs-review files; assign a frame type to
  one file, then, before applying, change the pending selection to a
  different frame type; submit.
- **Expect:** the file's classification reflects only the last value
  submitted; the item's classification type (`single_type` / `mixed` /
  `unclassified`) recomputes from the submitted overrides.
- **Expect (negative):** nothing is written until the override is submitted;
  changing the pending dropdown value before submitting never touches the
  index.
- **Trace:** `apps/desktop/src/features/inbox/InboxDetail.tsx` (`pendingOverrides`, `handleApplyOverrides`); `crates/app/inbox/src/reclassify.rs`.

### S2 — Bulk-assign a frame type across several needs-review files in one action {#S2}
- **Do:** select multiple needs-review files in the same item and submit one
  frame type (and optionally filter/exposure/binning) for the whole
  selection.
- **Expect:** every selected file receives the submitted values in one call;
  the selection and bulk-input fields clear on success; the remaining
  needs-review count drops by the number of files that received a frame
  type.
- **Expect (negative):** files not in the selection are unaffected.
- **Trace:** `apps/desktop/src/features/inbox/InboxDetail.tsx` (`handleBulkApply`).

### S3 — Reclassification is refused while a plan is open on the item {#S3}
- **Do:** with an open (confirmed, unapplied) plan linked to an item, attempt
  to change a file's frame-type assignment on that item.
- **Expect:** the reclassify action is refused with a reason naming the open
  plan; the user must discard the plan (S5) before reclassifying.
- **Trace:** `crates/app/inbox/src/reclassify.rs` (`inbox.has.open.plan` guard).

### S4 — Change the destination library before confirming {#S4}
- **Do:** on an item eligible for more than one destination root of the
  applicable category, pick a root, then pick a different one before
  confirming; alternatively, leave it on "Auto" and let the confirm attempt
  resolve it.
- **Expect:** the confirmed plan's destinations reflect only the last root
  selected at the time of confirm. If "Auto" cannot resolve a single root,
  confirm is refused and the user is prompted to choose among the specific
  candidate roots before the plan is generated — nothing is confirmed to an
  ambiguous or wrong root silently.
- **Expect (negative):** no plan is generated, and no files move, from
  picking a root alone — only confirming does.
- **Trace:** `apps/desktop/src/features/inbox/InboxDetail.tsx` (`onSelectRoot`); `apps/desktop/src/features/inbox/InboxPage.tsx` (`pendingRootPick`, `inbox.destination_root_required`).

### S5 — Discard a confirmed-but-unapplied plan {#S5}
- **Do:** from the inbox plan surface, discard a plan that has been
  confirmed but not yet applied.
- **Expect:** the plan's state becomes discarded; the originating inbox item
  reverts to `classified` (unconfirmed) and is immediately confirmable
  again, without a page refresh; an audit event records the discard.
- **Expect (negative):** discard never touches any file — the plan was never
  applied, so there is nothing on disk to revert. Discard is refused while
  the plan is `applying` or `paused`; a plan already in one of those states
  cannot be silently abandoned through this action.
- **Trace:** `apps/desktop/src/features/inbox/PlanPanel.tsx` (`onCancel`); `crates/app/core/src/inbox_plan.rs` (`cancel_inbox_plan`); `crates/app/core/src/plans.rs` (`discard_plan`).

### S6 — Replace a mis-assigned calibration master {#S6}
- **Do:** from the correct master's detail page, assign it to the session
  that currently carries the wrong master for the same calibration type
  (bias/dark/flat); force the assignment past a hard-rule mismatch if
  needed.
- **Expect:** the session now shows the newly assigned master as its
  calibration source for that type; the previous assignment for that
  (session, calibration type) pair is gone — replaced, not duplicated; the
  new and old masters' "used by" counts and session lists update
  accordingly; an audit event records the new assignment.
- **Expect (negative):** assigning a replacement master never mutates or
  moves any file; only the assignment link changes.
- **Trace:** `crates/calibration/*/src/assign.rs`; `crates/persistence/db/src/repositories/calibration_assignment.rs` (`ON CONFLICT(session_id, calibration_type)`); `apps/desktop/src/features/calibration/MatchCandidatesPanel.tsx`.

## Success criteria
- SC1: after S1/S2, the file's/selection's classification matches only the
  last submitted values — no earlier submission is still in effect.
- SC2: after S4, the plan's destination(s) match the root selected at
  confirm time in 100% of cases, including the forced-choice path when
  auto-resolution is ambiguous.
- SC3: after S5, the inbox item is confirmable again within the same
  session with no leftover plan link, and no file changed on disk (path and
  mtime identical to before S5's precondition).
- SC4: after S6, exactly one active assignment exists for the (session,
  calibration type) pair, and it is the newly assigned master.

## Known gaps
- G1: there is no "reset to detected" action anywhere in the reclassify
  path — `set_overrides`/`set_manual_override` only ever write a new
  override value (`COALESCE(?, manual_override)`); no code path sets
  `manual_override` back to `NULL`. This is moot for the S1/S2 scenario
  (needs-review files carry no scanner-detected value to fall back to), but
  means a file the scanner *did* successfully classify has no UI path to
  correct it at all — reclassify's per-file/bulk override controls are
  wired only for the needs-review table
  (`apps/desktop/src/features/inbox/InboxDetail.tsx`), not for already
  `single_type` items, even though the backend's `reclassify_v2` accepts a
  `frameType` correction for any file (`crates/app/inbox/src/reclassify.rs`).
- G2: there is no calibration-master "un-assign" action — only reassignment
  (replacing one master with another for the same session + calibration
  type) is possible. A user who wants a session to have *no* assigned
  master for a type again has no path to that state.
- G3: the legacy pre-migration doc described a "heterogeneous bulk override"
  warning gate (bulk-assigning across files with *differing already-detected*
  types) that does not exist in the current model — mixed-type folders are
  split into single-type sub-items at ingest (spec 041), and the override
  table only ever holds files with no detected type, so no such conflict can
  arise today.

## Delta log
(none — first migrated version)
