---
id: J06
title: Reclaim disk space from processing outputs and raw sub-frames without losing anything protected
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [cleanup, projects, sessions, plans]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J06-cleanup-scan-review-apply/journey.md @ 66026463
  - deltas/2026-07-14-jval-docdrift.md (folded — PR #413 status verified)
  - spec-017 WP-E (project-level cleanup review flow)
  - spec-048 US3 (session-scoped raw sub-frame cleanup)
  - spec-025 FR-004 (destructive-confirm apply gate)
---

## Goal
An astrophotographer wants to reclaim disk space from processing outputs a
project no longer needs (intermediates superseded by masters/finals) or from
raw light/dark/flat/bias sub-frames a session no longer needs, without ever
having a protected file deleted or moved without an explicit, reviewed
decision. "Done" is: the reclaimed files are gone from their original
location, present at the chosen destination (Archive folder or System trash),
and a re-scan confirms the candidate is no longer offered — with nothing
protected ever touched without an acknowledged, reviewed step.

## Preconditions
- P1: A project exists with processing outputs of mixed kind (intermediate,
  master, final) already recorded, OR a session exists with raw sub-frames
  already recorded in inventory.
- P2: Protection categories/policy are configured (defaults apply if the
  user has not customized them) so scans can classify candidates as
  protected or not.

## Steps

### S1 — Scan a project's outputs for cleanup candidates {#S1}
- **Do:** From a project's Outputs/Cleanup section, run "Scan for cleanup
  candidates."
- **Expect:** A read-only preview lists candidates grouped by kind
  (Intermediates/Masters/Finals) with per-item size and confidence; protected
  items are shown locked with no selection affordance; a total reclaimable
  size is shown for the current candidate set. Scanning a project with no
  candidates shows a clear empty result instead of an empty table.
- **Expect (negative):** No plan is created and no file on disk is moved,
  renamed, or deleted by scanning; running the scan twice in a row on an
  unchanged project returns the same grouping and total.
- **Trace:** `apps/desktop/src/features/projects/OutputsCleanupSections.tsx`,
  `crates/app/core/src/cleanup_generator.rs`

### S2 — Choose a destination and generate the plan {#S2}
- **Do:** Pick a destructive destination — Archive folder (default) or
  System trash — then click "Generate cleanup plan."
- **Expect:** A real, reviewable plan is created 1:1 with the candidates in
  scope; the chosen destination is fixed at this point and shown read-only
  in the review overlay from here on.
- **Expect (negative):** Nothing on disk is touched by generating the plan;
  the destination cannot be changed after generation without discarding and
  restarting.
- **Trace:** `apps/desktop/src/features/projects/cleanupStore.ts`

### S3 — Review the plan {#S3}
- **Do:** Open the review overlay that follows plan generation.
- **Expect:** Every item in the plan is listed 1:1 with the generated plan;
  if any protected item is included, its protection must be explicitly
  acknowledged (per item) before "Approve & apply" becomes clickable; an
  empty plan (nothing selected) cannot be approved and the overlay states why
  it is empty; choosing "Discard" leaves disk untouched and returns cleanly.
- **Expect (negative):** "Approve & apply" stays disabled while any protected
  item's acknowledgement is outstanding.
- **Trace:** `apps/desktop/src/features/plans/PlanReviewOverlay.tsx`,
  `apps/desktop/src/features/plans/PlanProtectionGate.tsx`

### S4 — Approve and apply {#S4}
- **Do:** Click "Approve & apply" on a plan whose destination is Archive and
  that contains no protected item (see Known gaps for the Trash-destination
  and protected-item cases).
- **Expect:** Live per-item progress is shown ("Applying N of M…"); each
  item's outcome (succeeded/failed with reason) is visible afterward; the
  moved files are present at the Archive destination; re-scanning the
  project afterward shows the applied items gone from the candidate list.
- **Expect (negative):** The overlay never reports a plan as fully applied
  while any item's outcome is unknown; a failed item's reason is shown
  rather than a silent skip.
- **Trace:** `crates/app/core/src/plan_apply.rs`,
  `crates/fs/executor/src/run.rs`

### S5 — Scan a session's raw sub-frames for cleanup candidates {#S5}
- **Do:** From a session's detail view, run the raw sub-frame cleanup scan.
- **Expect:** A read-only preview lists individual light/dark/flat/bias
  frames with type, size, and protection state; non-protected frames are
  preselected; protected frames show no selection control; the reclaimable
  total reflects only the currently selected frames.
- **Expect (negative):** No file is moved or altered by scanning.
- **Trace:** `apps/desktop/src/features/sessions/RawFrameCleanupSection.tsx`

### S6 — Select frames and generate a session cleanup plan {#S6}
- **Do:** Adjust the frame selection if needed, choose Archive or System
  trash, and click "Generate cleanup plan."
- **Expect:** A plan is generated for the selected frames and hands off to
  the same review/apply flow as S3/S4; "Generate cleanup plan" is disabled
  while no frame is selected.
- **Expect (negative):** Nothing moves until the resulting plan is approved
  and applied.
- **Trace:** `apps/desktop/src/features/inventory/store.ts` (`useGenerateRawFrameCleanupPlan`)

## Success criteria
- SC1: A project scan against an unchanged candidate set returns the same
  grouping, protection flags, and reclaimable total on repeated runs (S1),
  and disk contents are unchanged.
- SC2: An Archive-destination plan with no protected item, once approved,
  reports every item succeeded, and a subsequent scan (S1 or S5) no longer
  offers those items as candidates (S2–S4).
- SC3: Any plan containing a protected item cannot reach "Approve & apply"
  enabled without an explicit per-item acknowledgement (S3).
- SC4: An empty plan (zero candidates selected) is refused before apply, with
  a stated reason, in both the project and session flows (S3, S6).
- SC5: A session raw-frame scan preselects only non-protected frames and
  offers no selection control on protected frames (S5).

## Known gaps
- G1: Plans whose destination is System trash currently fail every item at
  apply, unconditionally — `destructive_confirmed` (the column the apply-time
  gate reads for `trash`/`delete` actions) has no write path anywhere in the
  codebase, so the check can never pass. Confirmed by reading
  `crates/fs/executor/src/run.rs:384-404` and
  `crates/app/core/src/plan_apply.rs:680-681`. Tracked as issue #741 (open).
  Affects both the project (S2/S4) and session (S6) flows, which share the
  same executor.
- G2: The review overlay's protected-item acknowledgement (S3) is cosmetic —
  acknowledging only publishes an audit-bus event and persists no state that
  the apply-time protection gate consults; approving and applying a plan
  containing any protected item with a mutating action (archive/trash) fails
  every such item unconditionally, regardless of acknowledgement. Confirmed
  by reading `apps/desktop/src/features/plans/PlanProtectionGate.tsx:70-97`,
  `crates/app/core/src/protection.rs:395-420`, and
  `crates/fs/executor/src/run.rs:474-493`. Tracked as issue #807 (open).
  Supersedes the prior belief (see deltas/2026-07-14-q15-t123.md) that
  acknowledgement is durably audited — that claim conflicts with the current
  code and was not folded into this body.
- G3: Applied plans are not confirmed to produce durable `audit_log_entry`
  rows. Issue #766 (open) demonstrates zero audit rows for a successfully
  applied plan through the shared plan-apply/executor pipeline that cleanup
  plans also use; not independently reproduced against a cleanup plan
  specifically, but the mechanism is shared with S4/S6.
- G4 (carried from legacy 2026-07-04 doc, updated): no pre-generate estimate
  of whether a cleanup would even fit at the chosen destination is shown
  before generating a plan (S2). A real per-item free-space check now runs at
  apply time and fails safely with a stated reason
  (`crates/fs/executor/src/ops/volume_check.rs`) rather than the previously
  documented hardcoded-zero estimate — but the user still only learns of
  insufficient destination space after attempting apply, not at generate or
  review time.
- G5 (project-level Outputs flow only, S1–S4): candidate accuracy after a
  project is reopened following an out-of-app file drop may be affected by a
  separate, documented defect (issue #780, open, filed against Journey 5) in
  which the on-attach `processing_artifacts` reconcile is non-recursive and
  can flip present output files to `missing` (or miss new ones). Since S1's
  candidates are grounded in `processing_artifacts`
  (`crates/app/core/src/cleanup_generator.rs`), this could under- or
  over-report candidates after a reopen; not independently reproduced
  against a cleanup scan. Does not apply to the session-scoped raw sub-frame
  flow (S5/S6), which reads frame inventory instead of
  `processing_artifacts`.
- Dropped: the legacy 2026-07-04 note that the cleanup review UI "requires
  PR #413 (open)" is stale — PR #413 merged 2026-07-04
  (`feat: review and safely apply project cleanup plans with live
  progress`); the scan/review/generate UI is fully shipped (folded from
  deltas/2026-07-14-jval-docdrift.md).

## Delta log
