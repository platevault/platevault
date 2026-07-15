---
id: J07
title: Archive a completed project, then trash or permanently delete it
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [archive, projects, plans, audit]
interfaces: [windows-desktop]
trace:
  - pre-migration docs/product/journeys/J07-archive-delete/journey.md @ 66026463
  - deltas/2026-07-14-jval-docdrift.md (folded — verified in apps/desktop/src/features/projects/ProjectDetail.tsx)
  - deltas/2026-07-14-q15-t123.md (folded — verified in crates/app/core/src/protection.rs)
  - specs/016-source-protection-defaults/spec.md (FR-004, SC-003)
  - specs/030-ui-audit-revision/spec.md (FR-090, FR-130–FR-134)
  - e2e-agentic-test/017-cleanup-archive-review-plans/archive-lifecycle/scenario.md (D7/D14/D15/D24)
  - PR #401, PR #415, PR #826
---

## Goal

An astrophotographer who considers a project's imaging work finished moves
that project's files out of the active library into a reviewable, audited
archive location, and can later remove the archived files — first to the OS
trash, or, with an explicit typed confirmation, permanently. "Done" means:
the project's files are relocated only through an approved, reviewable plan;
the project's lifecycle field reads `archived` only after that plan has
actually been applied; and no permanent deletion ever happens without the
user typing the literal word `DELETE`.

## Preconditions

- P1: A project exists in the `completed` lifecycle state.
- P2: The project has real files on disk under a registered library root
  (source) available to archive.

## Steps

### S1 — Attempt to archive a completed project {#S1}
- **Do:** From the completed project's detail view, choose the action to
  archive it.
- **Expect:** The lifecycle transition is refused server-side because no
  archive plan yet exists for this project; the client responds to that
  refusal by generating the archive plan and opening the plan review in the
  same interaction — no separate manual step and no backend-only command is
  needed.
- **Expect (negative):** The project's lifecycle does not change on this
  click alone; a bare refusal never silently flips state.
- **Trace:** apps/desktop/src/features/projects/ProjectDetail.tsx (`handleGenerateArchivePlan`).

### S2 — Review the generated archive plan {#S2}
- **Do:** Review the plan's item list before approving.
- **Expect:** Each item shows both its source path and its destination path
  (the app-managed archive folder for this plan). Items from a protected
  source are called out separately from normal/unprotected items and are
  flagged as requiring acknowledgement, with a stated reason.
- **Expect:** Acknowledging a protected item writes a durable audit record
  (checkable via the Audit Log) for that acknowledgement.
- **Expect (negative):** Approving/applying the plan stays unavailable until
  every protected item has been individually acknowledged.
- **Trace:** crates/app/core/src/protection.rs (`plan_protection_check`,
  `acknowledge_protected_item`); specs/016-source-protection-defaults/spec.md
  FR-004.

### S3 — Apply the archive plan {#S3}
- **Do:** Approve and apply the reviewed plan.
- **Expect:** Files move into an app-managed, collision-free archive folder
  scoped to this plan (`.astro-plan-archive/<planId>/…`, a documented
  deviation from the originally specced token-pattern destination, D24).
  Only once apply succeeds does the project's lifecycle flip to `archived`,
  and the project's Edit pane becomes read-only with a stated reason.
- **Expect (negative):** If apply has not run, or fails, the lifecycle stays
  unchanged and the Edit pane stays editable.
- **Expect (negative):** Apply never overwrites an existing file at the
  destination.

### S4 — Find the archived project on the Archive page {#S4}
- **Do:** Open Archive; search by name, reason, or original path; sort by
  name, type, reason, size, or archived date.
- **Expect:** The archived project appears as a row with its type, reason,
  size, and archived timestamp, reflecting only real archived projects.
- **Expect (negative):** No placeholder/fixture rows ever appear on this
  page.

### S5 — View archived project detail and its audit history {#S5}
- **Do:** Select the archived row.
- **Expect:** The detail pane shows archived-at, reason, entity type, size,
  and original path, plus a dated, human-readable audit-history table for
  this project (durable `audit_log_entry` history, not the live event bus).
- **Expect (negative):** The audit-history table is not simply a repeat of
  the row's own list columns.

### S6 — Send archived files to the OS trash {#S6}
- **Do:** With the archived project selected, choose "Send to trash".
- **Expect:** The plan's archived files move to the OS Recycle Bin/Trash; a
  durable audit row is recorded; the row reflects the new state.
- **Expect (negative):** Files are not permanently removed by this action —
  they remain recoverable from the OS trash.

### S7 — Permanently delete archived files {#S7}
- **Do:** Choose "Delete permanently"; a confirmation dialog requires typing
  the literal word `DELETE`.
- **Expect:** The confirm control stays disabled until the typed text is an
  exact, case-sensitive match for `DELETE`; confirming deletes the files
  with no OS-trash recovery path.
- **Expect (negative):** A half-typed or wrong-case entry leaves the confirm
  control disabled; Cancel leaves every file untouched.
- **Expect (negative):** When "Block permanent delete" is enabled in
  Cleanup/Protection settings, the deletion is refused server-side
  (`plan.blocked_by_protection`) and no file is removed.
- **Trace:** crates/app/core/src/plans.rs (`permanently_delete_archive`).

### S8 — Reveal archived files {#S8}
- **Do:** Choose the platform-native reveal control ("Show in File
  Explorer" on Windows) for a selected archived entry.
- **Expect:** The control is present and its label follows the OS-native
  convention.
- **Expect (negative):** Today this control is always disabled — it does
  not silently no-op; a tooltip states it, and no files are opened (see
  Known gaps G3).

## Success criteria

- SC1: Choosing Archive on a completed project with no existing plan always
  ends with a plan generated and its review open in the same interaction
  (S1) — no case reaches a dead-end refusal.
- SC2: A project's lifecycle field reads `archived` if and only if an
  `origin=archive` plan for that project has been applied (S3).
- SC3: The permanent-delete confirm control is enabled if and only if the
  typed input is exactly `DELETE` (S7).
- SC4: Every permanent-delete attempt while "Block permanent delete" is
  enabled is refused, with zero files removed (S7).
- SC5: Every protected-item acknowledgement during archive-plan review
  (S2) resolves to a durable `audit_log_entry` row.

## Known gaps

- G1: Restore (un-archive) is not implemented; the control is absent by
  design (decision D15) pending its own reviewable plan generator — moving
  files back is itself a filesystem mutation and needs the same plan-gate
  discipline as archiving.
- G2: No Master/Target archival concept exists (decision D7); the Archive
  page also ships without a Sessions tab (decision D14) — sessions have no
  lifecycle to archive since the derived-inventory redesign. Archive covers
  Projects only.
- G3: Reveal is a stub, permanently disabled: the `ArchiveEntry` contract
  does not yet expose the app-managed archive folder path a reveal action
  would need. (apps/desktop/src/features/archive/ArchivePage.tsx)

## Delta log

(empty — this is the initial FORMAT migration; the pre-migration narrative
lived in git history and in `deltas/`, not in a Δ-log window.)
