---
id: J44
title: Move Unusable frames to the OS Trash from the library clean-up, outside a Project's Wrap up, and put one back
version: 1
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [cleanup, sessions, targets, projects, view-review, frame-review, status-bar, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#input-modes-user-2026-10-10-research-designinput-modes-researchmd, P-SB3, P-PREP2, D19, D-W42, D-W43, D-W52, D-W54, D-W57, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/071-storage-custody/spec.md, apps/prototype/messages/en-GB.json, J22, J32, J34, J39]
---

## Goal

The user clears frames marked Unusable without waiting for a Project's Wrap
up. X marks a frame Unusable library-wide, and every Unusable frame becomes a
purge candidate. In the library clean-up of Unusable frames, the user reads
which frames PlateVault may move and which it refuses, with each reason, moves
the rest to the OS Trash, and later puts one back. Done means:

- The clean-up offered exactly the library-Unusable frames it may move, in a Project or in none, while Project `NGC 7000 HOO` was still open with runs that are not Complete. A frame in a Complete run's prepared revision was offered. A frame in a prepared revision of a run that is not Complete, a recorded input of a Result, a frame with a copy on a location without OS Trash and a frame on an Offline location were refused, each with its reason. No Project-only reject and no Usable or Unreviewed frame was offered.
- Every copy of each moved frame went to the OS Trash after a re-check at move time. A frame whose bytes changed after the review was refused and left in place, no prepared entry moved, and nothing was permanently deleted.
- The Trashed frames counted nowhere and showed only under the Sessions "Trashed" filter and, marked "Trashed", in the fixed memberships of the Complete runs that hold them.
- Put back in the OS Trash plus a rescan returned a frame as Unusable, and the clean-up offered it again.

## Preconditions

- P1: The J34 starting world: J34/P1 to J34/P11 hold, and no step of J34 has run. Project `NGC 7000 HOO` is open. `NGC7000-HOO-Siril` and `26 Sep symlink check` read Complete, and `24 Sep flat check` and `NGC7000 HOO combine` are not Complete, so its Wrap up is blocked (J34/S1). These frames are library Unusable:
  - the two 18 Sep frames of J34/P3, members of the Complete run `NGC7000-HOO-Siril`, with prepared clones in its prepared revision;
  - the five library-Unusable rejected 30 Sep frames of J34/P2, among them F-drift (J34/P7) and F-dup, which also has a byte copy on `Scratch` (J34/P6);
  - F-res, F-prep and F-ab of J34/P4.

  Neither Project-only reject of J34/P2 is library Unusable: the 30 Sep frame reads Unreviewed, and the 28 Sep frame reads Usable.
- P2: The `4 Oct M 33` session of J32/P3 lies under `Astro-T7/Captures/M33/2026-10-04/` and is indexed: 16 Ha 300 s `RedCat` lights with Target M 33 and rig `RedCat` Confirmed, a candidate of no Project and a member of no run. M 33 is ★ in My targets, as in J32/P4. Two of its lights, MX-1 and MX-2, are marked Unusable in the library, and the other 14 read Usable.
- P3: Besides the J34/P11 files, `Backup/Captures/M33/2026-10-04/` holds a byte copy of MX-1, indexed with `Backup/Captures`. `Backup` has an OS Trash.
- P4: While `Cold-1` was online, one 12 Sep frame, C-x, was marked Unusable in the library. `Cold-1` is offline again, as in J19/P3, so `Cold-1 captures` reads Offline.
- P5: The J27/P7 helper is available, and F-drift is its target in S2.
- P6: The isolated account's Trash inventory is recorded as in J27/P4. So are a manifest (path, size, SHA-256) of every file under `Astro-T7/Captures`, `Scratch/Captures` and `Backup/Captures`, and directory listings of the prepared folders of `NGC7000-HOO-Siril`, `26 Sep symlink check`, `Ha deep` and `Ha deep v1`.

## Steps

### S1 — Open the library clean-up while the Project is open {#S1}

- **Do:** Open the library clean-up of Unusable frames. Read its offer, its count and size, and open the disclosure of its refusals.
- **Expect:**
  - The offer lists 9 frames, each with its session: the two 18 Sep frames, the four 30 Sep frames other than F-dup, F-ab, and MX-1 and MX-2 of `4 Oct M 33`, a session in no Project. F-ab is offered, because its place in a prepared revision of the Complete run `Ha deep v1` is no refusal reason.
  - The size covers the four 30 Sep frames, MX-2 and both copies of MX-1. The two 18 Sep frames and F-ab add 0 bytes, because their prepared clones in `NGC7000-HOO-Siril/` still share their bytes.
  - A terse refusal counts 4 frames, and its disclosure lists each with its reason:
    - F-prep: in a prepared revision of run `Ha deep` in Project `NGC 7000 Ha deep`, a run that is not Complete.
    - F-res: a recorded input of the accepted Ha stack of `Ha deep v1`.
    - F-dup: one of its copies sits on `Scratch`, which has no OS Trash, so neither copy moves.
    - C-x: its location `Cold-1 captures` is Offline.
- **Expect (negative):** Neither Project-only reject is offered or counted, and no library-Usable or Unreviewed frame is offered, including the 14 Usable M 33 lights. Opening the clean-up moves no file. `NGC 7000 HOO` stays open, and its four runs keep their states.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 ("Reject is library-wide by default": Unusable frames become purge candidates, and a library clean-up offers to move them to the OS Trash), §Copy rules (terse refusals), §Input modes (P-PREP2: footprint is real) · PRJ-FR-15 (refusal reasons) · STO-FR-15 · STO-AC-18 · D-W42, D-W43, D-W54, D-W57 · G2, G4

### S2 — Move the offered frames to the OS Trash {#S2}

- **Do:** Start the move and read the review. With the P5 helper, overwrite F-drift in place. Then confirm the move to the OS Trash, and read the status bar while it runs and the operation's Activity entry. Afterwards, restore F-drift's saved bytes and mtime with the helper.
- **Expect:**
  - The review lists the 9 frames with every copy of each, each copy with its identity and SHA-256. MX-1 lists two copies, under `Astro-T7/Captures/M33/2026-10-04/` and `Backup/Captures/M33/2026-10-04/`. Trash support reads available for `Astro-T7` and `Backup`.
  - The move runs as one trash operation. The status bar's running work names it with a mini progress bar, Activity lists it once, and progress shows per-frame outcomes.
  - The summary names 8 frames moved to the OS Trash and 1 kept with its reason, F-drift with drift named, and reads that nothing was deleted permanently.
  - The 9 moved files, both copies of MX-1 among them, are newly in the OS Trash, and the library marks the 8 frames Trashed.
- **Expect (negative):**
  - Nothing is permanently deleted, and no file outside a registered Captures location moves.
  - No prepared entry of `NGC7000-HOO-Siril`, `26 Sep symlink check`, `Ha deep` or `Ha deep v1` moves: their listings equal P6.
  - F-drift, F-prep, F-res, both copies of F-dup and both Project-only rejects remain at their paths, and after the restore they match P6.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6, §Round 5 (P-SB3) · STO-FR-15 · STO-AC-19 · PRJ-FR-15 · PRJ-AC-17 · LIB-FR-18 · root SC-010 · D19, D-W43, D-W57 · prototype `op_trash_summary` ("{trashed} moved to the OS Trash ({bytes}); {refused} kept with a reason. Nothing was deleted permanently.", messages/en-GB.json @ 4f470775)

### S3 — Confirm the Trashed frames are hidden {#S3}

- **Do:** Read the 18, 28 and 30 Sep and `4 Oct M 33` rows in Sessions, and the Captured column of NGC 7000 and M 33 in Targets. Read the "captured" goal numbers of `NGC 7000 SHO`. Open the fixed memberships of `NGC7000-HOO-Siril` and `Ha deep v1`, and frame review on `4 Oct M 33`. Then rescan `Astro-T7/Captures` and `Backup/Captures`.
- **Expect:**
  - Sessions shows 2 fewer frames for 18 Sep, 1 fewer for 28 Sep and 3 fewer for 30 Sep, and 14 frames for `4 Oct M 33`.
  - NGC 7000's Captured falls by Ha 0h 15m and OIII 0h 15m, and M 33's reads Ha 1h 10m, 0h 10m less than before S2.
  - In `NGC 7000 SHO`, Ha and OIII "captured" each fall by 0h 15m.
  - `NGC7000-HOO-Siril`'s fixed membership still lists the two 18 Sep frames and F-ab, marked "Trashed", and `Ha deep v1`'s lists F-ab, marked "Trashed".
  - Frame review of `4 Oct M 33` lists 14 frames, without MX-1 and MX-2.
  - The rescans report none of the 8 frames Missing.
- **Expect (negative):** No Trashed frame is offered by any run picker, counted in any goal or total, measured or thumbnailed in frame review, or shown on Home. The open run `Ha deep` lists no Trashed frame.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-09, PRJ-FR-16 · PIX-AC-19 · PLAN-TGT-FR-08 · D-W43, D-W52, D-W66 · HARNESS-V5-IA.md S10, S12

### S4 — Find the frames under the Trashed filter {#S4}

- **Do:** In Sessions, choose the **Trashed** filter.
- **Expect:** Exactly the 8 frames are listed, each with its last-observed metadata and the S2 operation that trashed it.
- **Expect (negative):** F-drift, F-prep, F-res, F-dup, C-x and both Project-only rejects are not listed.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · D-W43 · prototype `sessions_trashed_help` (messages/en-GB.json @ 4f470775)

### S5 — Put one frame back and meet it in the clean-up again {#S5}

- **Do:** In the OS Trash, put back MX-2. Rescan `Astro-T7/Captures`. Read `4 Oct M 33` in Sessions, M 33's Captured in Targets, and the Trashed filter. Then open the library clean-up of Unusable frames again, read its offer and refusals, and close it without moving anything.
- **Expect:**
  - MX-2 returns as Unusable and leaves the Trashed filter, which now lists 7 frames. `4 Oct M 33` reads 15 frames, and M 33's Captured rises by 0h 05m. MX-2's history still shows its Trashed episode.
  - The clean-up offers exactly 2 frames, MX-2 and F-drift, and still refuses F-prep, F-res, F-dup and C-x, each with its reason.
- **Expect (negative):** PlateVault offers no restore of its own, and MX-2 reads neither Missing nor ChangedContent. Closing the clean-up moves no file.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · PRJ-AC-17 · STO-FR-15 · D-W43 · HARNESS-V5-FEEDBACK-R1.md §Round 6

## Success criteria

- SC1: With `NGC 7000 HOO` open and 2 of its runs not Complete, the clean-up offers exactly 9 frames, including 1 in a Complete run's prepared revision and 2 of a session in no Project, and lists exactly 4 refusals, each with its reason. It offers 0 of the 2 Project-only rejects and 0 Usable or Unreviewed frames (S1).
- SC2: Exactly 8 frames, 9 files, reach the OS Trash. F-drift is refused 1 time with drift named. 0 prepared entries move, and 0 files are permanently deleted (S2).
- SC3: Every copy moves or none does: MX-1 moves 2 of its 2 copies, and F-dup moves 0 of its 2 (S1, S2).
- SC4: The Trashed frames appear in 0 pickers, frame reviews, goals or totals. They show only under the Trashed filter (8 frames) and, marked "Trashed", in the fixed memberships of `NGC7000-HOO-Siril` (3 frames) and `Ha deep v1` (1 frame). The rescans report 0 of them Missing (S3, S4).
- SC5: Put back plus rescan returns 1 frame as Unusable. The Trashed filter then lists 7 frames, and the clean-up offers exactly 2 (S5).

## Known gaps

- G1: Not validated: the rebuilt application does not exist, and the v5 prototype at ui-harness-v5 4f470775 does not yet implement Round 6. Product behavior follows HARNESS-V5-FEEDBACK-R1.md §Round 6 "Reject is library-wide by default" (@ 4f470775) and §Input modes P-PREP2 (@ d609ff55), the trash and custody rules of D-W43, D-W52, D-W54 and D-W57, and the 064, 065 and 071 specs cited above. No implementation has been validated against them.
- G2: Contract drift: STO-FR-03, STO-FR-14, STO-AC-20, PRJ-FR-15 and LIB-FR-18 still name the Project's Done / Archive sheet, now Wrap up, as the only way a library frame reaches the Trash. Round 6 adds the library clean-up of Unusable frames, which this journey follows. Those requirements need an amendment.
- G3: Out of scope for this journey: an unreadable copy, a stale review, a location whose OS removal deletes immediately (STO-FR-15) and a ChangedContent frame (LIB-FR-09) are not exercised in the library clean-up. Blocks readiness until covered by a step or a journey.
- G4: Unresolved implementation qualification: F-res needs Tool-recorded input lineage from a processing tool (J34/G4), and S1's F-res refusal depends on it. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
