---
id: J44
title: Trash library-Unusable frames through a Project's Wrap up
version: 4
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [projects, wrap-up, sessions, targets, frame-review, status-bar, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-7-user-2026-10-12-run-views-research-designrun-views-optionsmd, HARNESS-V5-FEEDBACK-R1.md#round-8-user-2026-10-12, P-SB3, P-PREP3, P-TRASH2, D19, D-W42, D-W43, D-W52, D-W54, D-W57, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/071-storage-custody/spec.md, apps/prototype/messages/en-GB.json, J22, J24, J32, J34, J39, 063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 071-storage-custody, D-W93, D-W94, D-W97, D-W100, specs/066-view-selection/spec.md]
---

## Goal

The user moves library-Unusable frames belonging to Project `NGC 7000 HOO` to the OS Trash through that Project's Wrap up. The Trash step offers only Unusable frames in the Project's sessions and lists custody refusals. Done means the View is removed through Clean up, nine frames (ten physical files) reach the OS Trash after identity and digest re-verification, the one frame changed after review is kept, and the Project's `Output/` is untouched. The offer excludes a frame held in another open Project's View and frames whose copies are not all eligible for OS Trash. Restoring a trashed frame in the OS and rescanning returns it as Unusable; after the other Project Applies its pending Library removal, the previously blocked frame becomes eligible in Wrap up Trash.

## Preconditions

- P1: Project `NGC 7000 HOO` is open, has no pending changes, and its sessions include the listed Unusable frames: two from 18 Sep; five from 30 Sep, including F-drift and F-dup; F-res, F-prep and F-ab from 28 Sep; and MX-1 and MX-2 from `4 Oct M 33`. The `4 Oct M 33` session is part of this Project. F-prep is also in the View of the separate open Project `NGC 7000 Ha deep`; that Project has a pending Library removal and has not yet Applied it. The HOO Project has a Symlinks View and a populated `Output/` folder.
- P2: `Astro-T7/Captures/M33/2026-10-04/` holds the indexed `4 Oct M 33` session: 16 Ha 300 s `RedCat` lights with confirmed Target M 33, confirmed rig and settled calibration. The session belongs to `NGC 7000 HOO`, which also names M 33 as a subject. MX-1 and MX-2 are Unusable; the other 14 frames are Usable.
- P3: Besides the J34/P11 files, `Backup/Captures/M33/2026-10-04/` holds a byte copy of MX-1, indexed with `Backup/Captures`. `Backup` has an OS Trash.
- P4: While `Cold-1` was online, one 12 Sep frame, C-x, was marked Unusable in the library. `Cold-1` is offline again, as in J19/P3, so `Cold-1 captures` reads Offline.
- P5: The J27/P7 helper is available, and F-drift is its target in S2.
- P6: The isolated account's OS Trash inventory is recorded. So are a manifest (path, size, SHA-256) of every file under `Astro-T7/Captures`, `Scratch/Captures` and `Backup/Captures`, and directory listings of the Views of `NGC 7000 HOO` and `NGC 7000 Ha deep`.

## Steps

### S1 — Open Project Wrap up and review Trash eligibility {#S1}
- **Do:** In `NGC 7000 HOO`, open Wrap up. In Clean up, select removal of the Project's Symlinks View, review the file list, and proceed. Open Trash and read its rejected-frame offer and refusals.
- **Expect:** Trash offers exactly 10 of this Project's library-Unusable frames: the two 18 Sep frames, four 30 Sep frames other than F-dup, F-ab and F-res, and MX-1 and MX-2. It lists three refusals: F-prep because open Project `NGC 7000 Ha deep` still has it in its View; F-dup because one copy is on `Scratch`, which has no OS Trash; and C-x because `Cold-1 captures` is Offline. F-res is eligible: PlateVault records no Result lineage, and an Output file is not a custody reason.
- **Expect (negative):** No Usable or Unreviewed frame is offered. The offer includes only Unusable frames in this Project's sessions, not every Unusable frame in the library. No capture moves before confirmation, and no link or copy from another Project's View is moved.
- **Trace:** PRJ-FR-14, PRJ-FR-15 · STO-FR-14, STO-FR-15 · D-W93, D-W97

### S2 — Confirm the reviewed Trash move {#S2}
- **Do:** With Trash's review open, use the P5 helper to change F-drift in place. Confirm the selected rejected-frame move. Read progress, Activity and the summary, then restore F-drift's recorded bytes and mtime with the helper.
- **Expect:** The review lists each selected frame's physical copies, identities and SHA-256. MX-1 lists both copies. Re-verification refuses F-drift because its bytes changed after review; the other nine frames move, comprising ten physical files because both MX-1 copies move. The summary names nine moved frames, one drift refusal and no permanent deletion. No View links are moved with these captures.
- **Expect (negative):** Nothing outside registered Captures locations moves. Both copies of F-dup, F-prep and C-x remain at their original paths. No other file changes.
- **Trace:** STO-FR-14, STO-FR-15 · STO-AC-18, STO-AC-19 · PRJ-FR-15 · D19, D-W43

### S3 — Confirm the Trashed records are excluded {#S3}
- **Do:** Read Sessions, Targets, the affected Project's totals and frame review for `4 Oct M 33`; rescan `Astro-T7/Captures` and `Backup/Captures`.
- **Expect:** Sessions shows two fewer 18 Sep frames, two fewer 28 Sep frames, three fewer 30 Sep frames and 14 frames in `4 Oct M 33`. The nine moved frames count nowhere in totals, goals or review and are absent from Project suggestions. Rescans report none of them Missing.
- **Expect (negative):** No session view or Project View includes a Trashed frame. A Result file does not retain input lineage or prevent a capture from being trashed.
- **Trace:** LIB-FR-18, LIB-AC-19 · PRJ-FR-16 · D-W93, D-W97

### S4 — Find the records in the Trashed filter {#S4}
- **Do:** In Sessions, choose the **Trashed** filter.
- **Expect:** Exactly nine frames are listed with their last-observed metadata and the operation that moved them. F-drift, F-prep, F-dup and C-x are absent.
- **Trace:** LIB-FR-18, LIB-AC-19 · D-W43

### S5 — Restore one capture and reopen the Trash step {#S5}
- **Do:** Put back MX-2 in the OS Trash and rescan `Astro-T7/Captures`. Read `4 Oct M 33`, M 33's Captured total and Sessions' Trashed filter. Reopen the Project's Trash step.
- **Expect:** MX-2 returns as Unusable, leaves the Trashed filter and raises `4 Oct M 33` to 15 frames and M 33's Captured by 0h 05m. The filter lists eight frames. Trash offers MX-2 and F-drift, and still refuses F-prep, F-dup and C-x.
- **Expect (negative):** PlateVault offers no restore of its own. Closing the reviewed Trash step moves no file.
- **Trace:** LIB-FR-18, LIB-AC-19 · PRJ-FR-14 to PRJ-FR-16 · D-W43, D-W97

### S6 — Apply the other Project's Library removal, then trash F-prep {#S6}
- **Do:** Follow F-prep's refusal to `NGC 7000 Ha deep`. In Sessions, read its pending Library removal and choose Apply on View. Return to `NGC 7000 HOO`'s open Wrap up Trash step, review the refreshed offer and confirm it.
- **Expect:** Apply rebuilds `NGC 7000 Ha deep`'s View without F-prep. Trash in `NGC 7000 HOO` now offers exactly MX-2, F-drift and F-prep, and refuses only F-dup and C-x. The three eligible captures move to the OS Trash after re-verification, and Sessions' Trashed filter lists 11 frames.
- **Expect (negative):** Apply moves no original capture. The Trash operation removes no files from another Project's View and permanently deletes nothing.
- **Trace:** VSEL-FR-12, VSEL-FR-15 · PRJ-FR-14, PRJ-FR-15 · STO-FR-14, STO-FR-15 · D-W97, D-W100

## Success criteria

- SC1: Trash offers exactly 10 frames and lists exactly three initial custody refusals: F-prep, F-dup and C-x (S1).
- SC2: Exactly nine frames and ten physical capture files reach the OS Trash at S2; F-drift is refused at execution, and zero files are permanently deleted.
- SC3: Both MX-1 copies move; neither F-dup copy moves. A frame with any refused physical copy is wholly refused.
- SC4: After S2, nine frames appear in Sessions' Trashed filter, count nowhere else and are not Missing after rescan (S3, S4).
- SC5: Restoring MX-2 and rescanning returns it as Unusable; the filter then lists eight and Wrap up Trash offers exactly MX-2 and F-drift (S5).
- SC6: After the other Project Applies its pending Library removal, Trash offers exactly three frames, refuses two, and the Trashed filter lists 11 (S6).

## Known gaps

- G1: The rebuilt application has not been validated. The behavior in this journey follows the current 064, 065 and 071 specs and the F4 decisions; no implementation has been validated against them.
- G2: An unreadable copy, stale Trash review, OS removal that deletes immediately and ChangedContent frame are not exercised here.

## Delta log
- **Δ4** 2026-10-15 · S1, S2, S3, S4, S5, S6 · behavior-change
  Library-Unusable frames are trashed only through an owning Project's Wrap up. The offer is limited to that Project's sessions and current custody rules; no Result lineage or Project-only rejection governs eligibility.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, PRJ-FR-14 to PRJ-FR-16, LIB-FR-18, VSEL-FR-12, VSEL-FR-15, STO-FR-14, STO-FR-15 · by: SpecF4Writer2 (intent-gated)
