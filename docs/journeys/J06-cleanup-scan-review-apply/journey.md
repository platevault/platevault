---
id: J06
title: Reclaim disk space from processing outputs and raw sub-frames without losing anything protected
version: 2
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [cleanup, projects, sessions, plans]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 66026463
  - deltas/2026-07-14-jval-docdrift.md (folded — PR #413 status verified)
  - deltas/2026-07-14-q15-t123.md (superseded by current code — see G2)
  - spec-017 WP-E (project-level cleanup review flow)
  - spec-048 US3 (session-scoped raw sub-frame cleanup)
  - spec-025 FR-004 (destructive-confirm apply gate)
  - docs/development/journey-run-2026-07-14.md (Journey 6 section — live-app
    validation, build 7e522c16; project-level flow only, S5/S6 not exercised)
  - docs/development/windows-journeys/journey-06-cleanup-scan-apply.md
  - PR #413 (merged 2026-07-04 — scan/review/generate cleanup UI)
  - issue #741, issue #807, issue #766, issue #780, issue #806 (all open)
  - PR #894 (fixes #563)
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
  acknowledged (per item) before "Approve & apply" becomes clickable;
  "Approve & apply" is also disabled whenever the plan holds zero items;
  choosing "Discard" leaves disk untouched and returns cleanly.
- **Expect (negative):** "Approve & apply" stays disabled while any protected
  item's acknowledgement is outstanding, or while the plan holds zero items —
  in both cases the overlay shows no explanatory text, only the disabled
  control (no "this plan is empty" or similar message). A zero-item plan
  cannot actually be produced by either flow in the first place: the project
  flow's Generate control does not render unless S1's scan found candidates,
  and the session flow's Generate (S6) is disabled while no frame is
  selected — so this overlay state is unreachable via the documented S1–S4 /
  S5–S6 path; the server-side rejection is defense-in-depth only.
- **Trace:** `apps/desktop/src/features/plans/PlanReviewOverlay.tsx:293`
  (Approve & apply `disabled={... || plan.itemsTotal === 0}`, no message
  rendered for that case), `crates/app/core/src/plans.rs:341-349` (server
  rejects approving a zero-item plan with `PlanItemsEmpty`, not reachable via
  the shipped UI), `apps/desktop/src/features/plans/PlanProtectionGate.tsx`

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
  total reflects only the currently selected frames. A per-root protection
  override set on a source (Settings → Data Sources) now actually governs
  this classification for the frames it owns: a root marked "Unprotected"
  correctly preselects its session-attributed frames as non-protected,
  rather than the override being silently ignored in favor of the global
  default.
- **Expect (negative):** No file is moved or altered by scanning.
- **Trace:** `apps/desktop/src/features/sessions/RawFrameCleanupSection.tsx`;
  `crates/app/core/src/cleanup_generator.rs` `frame_protection_source` (PR
  #894 fixes #563 — a per-root override previously never reached
  session-attributed frames because resolution was keyed under the session
  id, which has no shipped override surface, and silently fell back to the
  global default; it is now keyed under the root when no per-session
  override row exists).

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
- SC4: A plan can never reach an enabled "Approve & apply" with zero items:
  the project flow's Generate control cannot exist without at least one
  candidate (S1 gates it) and the session flow's Generate is disabled while
  no frame is selected (S6); approving a zero-item plan is separately
  rejected server-side as defense-in-depth. No step surfaces an explanatory
  reason to the user for this (S1–S3, S5–S6).
- SC5: A session raw-frame scan preselects only non-protected frames and
  offers no selection control on protected frames (S5).

## Known gaps
- G1: (dissolved 2026-07-15) — tracked as issue #741; trash destination fails every apply item.
- G2: (dissolved 2026-07-15) — tracked as issue #807; protected-item acknowledgement is cosmetic.
- G3: (dissolved 2026-07-15) — tracked as issue #766; applied plans lack durable audit rows.
- G4: (dissolved 2026-07-15) — tracked as issue #876; no free-space estimate at review.
- G5: (dissolved 2026-07-15) — tracked as issue #780; reopen reconcile can misreport cleanup candidates.
- Dropped: the legacy 2026-07-04 note that the cleanup review UI "requires
  PR #413 (open)" is stale — PR #413 merged 2026-07-04
  (`feat: review and safely apply project cleanup plans with live
  progress`); the scan/review/generate UI is fully shipped (folded from
  deltas/2026-07-14-jval-docdrift.md).

## Delta log

- **Δ2** 2026-07-15 · S5 · behavior-change
  A per-root protection override now actually governs cleanup
  classification for the session-attributed raw frames it owns; previously
  the override was cosmetic there (resolution was keyed under the session
  id, found no override row, and silently inherited the global default).
  Evidence: PR #894 (fixes #563) · by: journey-scribe (intent-gated)
