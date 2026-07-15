---
id: J07
title: Archive a completed project, then trash or permanently delete it
version: 2
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [archive, projects, plans, audit]
interfaces: [desktop-ui]
trace:
  - pre-migration docs/product/journeys/J07-archive-delete/journey.md @ 66026463
  - deltas/2026-07-14-jval-docdrift.md (folded — verified in apps/desktop/src/features/projects/ProjectDetail.tsx)
  - deltas/2026-07-14-q15-t123.md (folded — verified in crates/app/core/src/protection.rs)
  - deltas/2026-07-14-q16-t132.md (folded — verified in apps/desktop/src/features/archive/ArchiveTable.tsx, ArchiveDetail.tsx)
  - specs/016-source-protection-defaults/spec.md (FR-004, SC-003)
  - specs/030-ui-audit-revision/spec.md (FR-090, FR-130–FR-134, FR-135–FR-140)
  - e2e-agentic-test/017-cleanup-archive-review-plans/archive-lifecycle/scenario.md (D7/D14/D15/D24)
  - docs/development/journey-run-2026-07-14.md (Journey 7 section — live-app validation, build 7e522c16)
  - PR #401, PR #415, PR #826, PR #849
  - issue #732 (send-to-trash / permanently-delete are audit-only stubs, open)
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
- **Expect (negative):** A missing reason or size is never rendered as a
  fabricated value (e.g. a bare `0`) — it renders through the shared
  `renderValue()` as a distinct unresolved state; absence is only ever used
  as the lowest sort key, never as the displayed value.
- **Trace:** apps/desktop/src/features/archive/ArchiveTable.tsx (`renderValue`,
  `compareEntries`); PR #849; specs/030-ui-audit-revision/spec.md
  FR-135–FR-138.

### S5 — View archived project detail and its audit history {#S5}
- **Do:** Select the archived row.
- **Expect:** The detail pane header shows the project name (title), its
  entity type (pill), and its original path (subtitle, or a stated
  fallback when there is no path), plus a dated, human-readable
  audit-history table (timestamp + detail text) for this project (durable
  `audit_log_entry` history, not the live event bus). Archived-at, reason,
  and size are intentionally not repeated in the detail pane — they live
  only on the Archive row (S4); a former duplicate "Details" table
  repeating those fields was removed.
- **Expect (negative):** The audit-history table is not simply a repeat of
  the row's own list columns.
- **Trace:** apps/desktop/src/features/archive/ArchiveDetail.tsx; PR #849
  (dropped the duplicate Details table per decision T133, "detail-as-delta
  audit"); specs/030-ui-audit-revision/spec.md FR-139–FR-140. Corrects the
  prior migrated claim that archived-at/reason/size/entity-type/path all
  appear in the detail pane — that table was removed by #849 (merged
  2026-07-14T20:01Z).

### S6 — Send archived files to the OS trash {#S6}
- **Do:** With the archived project selected, choose "Send to trash".
- **Expect:** A durable audit row is recorded and the row's control state
  updates as if the send succeeded.
- **Expect (negative):** As currently shipped, this action performs **no
  filesystem work at all** — the archived files stay exactly where they
  are on disk (the app-managed archive path), not the OS Recycle Bin/Trash.
  `send_archive_to_trash`'s own doc comment states filesystem execution is
  "deferred to spec 025" and only records the audit event; there is no
  `trash`/delete call anywhere in that function. This is a false-success
  surface: the UI and audit log report a completed action that did not
  happen (open issue #732, spec-017 FR-017). Do not rely on this action to
  reclaim disk space or to actually relocate files today.
- **Trace:** crates/app/core/src/plans.rs (`send_archive_to_trash`, doc
  comment + body, lines ~654-660); issue #732 (open); confirmed live by the
  2026-07-14 validation run (docs/development/journey-run-2026-07-14.md,
  Journey 7 — dupes hit list; note the S6/S7 apply chain itself was blocked
  there by a 0-item plan, #780, so this stub was found by code inspection
  and the run-052fix sweep, not by a live click-through in that run).

### S7 — Permanently delete archived files {#S7}
- **Do:** Choose "Delete permanently"; a confirmation dialog requires typing
  the literal word `DELETE`.
- **Expect:** The confirm control stays disabled until the typed text is an
  exact, case-sensitive match for `DELETE` (`ArchivePage.tsx` gates the
  button on `confirmInput !== 'DELETE'`; the backend independently rejects
  a mismatched `confirm_text` with `confirm.text.mismatch`); confirming
  records a durable audit row claiming the items were deleted.
- **Expect (negative):** A half-typed or wrong-case entry leaves the confirm
  control disabled; Cancel leaves every file untouched.
- **Expect (negative):** When "Block permanent delete" is enabled in
  Cleanup/Protection settings, the deletion is refused server-side
  (`plan.blocked_by_protection`) and no file is removed.
- **Expect (negative):** As currently shipped, even a successful confirm
  performs **no filesystem deletion** — same stub condition as S6:
  `permanently_delete_archive` emits the `ArchivePermanentlyDeleted` audit
  event and returns success, but never calls a delete/remove API; the
  archived files remain on disk with no attempted removal, contradicting
  the "no OS-trash recovery path" framing the confirm dialog implies (open
  issue #732, spec-017 FR-017).
- **Trace:** crates/app/core/src/plans.rs (`permanently_delete_archive`,
  lines ~706-778); apps/desktop/src/features/archive/ArchivePage.tsx
  (`DELETE_CONFIRM_TEXT`, delete modal); issue #732 (open).

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

- G1: (dissolved 2026-07-15) — tracked as issue #885; Restore is a reviewable restore-plan generator, archive confirmed a real file move.
- G2: (dissolved 2026-07-15) — tracked as issue #886; masters archivable tracked as #886; targets stay non-archivable (DB-only); session files archivable via session-scoped cleanup flow (J06 S5-S6).
- G3: (dissolved 2026-07-15) — tracked as issue #874; reveal is a permanently disabled stub.

## Delta log

- **Δ2** 2026-07-14 · S4, S5 · behavior-change
  Archive adopts the shared value renderer: missing size/reason never
  render as a fabricated value (S4). The detail pane drops its duplicate
  "Details" table (archived-at/reason/size/type/path all already shown on
  the row or in the header) in favor of a minimal header plus the audit
  history, per the detail-panel-adds-new-information rule (S5).
  Evidence: PR #849 (merged 2026-07-14T20:01Z),
  specs/030-ui-audit-revision/spec.md FR-135–FR-140 (Wave-0 Q16, decision
  T133) · by: journey-scribe (intent-gated)
