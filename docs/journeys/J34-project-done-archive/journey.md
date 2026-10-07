---
id: J34
title: Mark a Project Done, trash its rejected frames, intermediates and duplicate copies, archive it, and reopen it
version: 1
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, done-archive-sheet, storage, sessions, targets, home, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, 070-results-reuse, 071-storage-custody, 072-observing-plans, D19, D-W26, D-W42, D-W43, D-W46, D-W48, D-W52, D-W57, D-W66, D-W69, D-W70, D-W72, D-W74, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md]
---

## Goal

The user finishes Project `NGC 7000 HOO`. First every open run is completed
or moved to the Project's Trash, then the Project is marked Done. From its
Done / Archive sheet the user empties the Project's Trash, moves the Project's
library-Unusable frames, its processing intermediates and its duplicate copies
to the OS Trash, and archives its sessions. Afterwards the user puts one frame
back and reopens the Project.
Done means:
- Mark Done waited until every run outside the Project's Trash was Complete. Moving a run to the Trash and emptying it moved no file and changed no goal number.
- The trash offers covered only what they may cover. A frame in a Complete run's prepared revision was offered, the adopted master's generated source went only as a verified duplicate of the kept library copy, and every frame kept one copy. No Project-only reject, refused frame, accepted Result or adopted library master reached the Trash, and every refusal was listed with its reason. Nothing was permanently deleted.
- The Trashed frames counted nowhere and showed only under the Sessions "Trashed" filter and, marked "Trashed", in the fixed membership of every Complete run that holds them.
- Archive kept the session another open Project's run uses.
- Reopening returned the Project to open with its runs, goals and members unchanged, and it moved no file. The archived sessions still read Archived at their archive paths, and restoring one opens a reviewed transfer.

## Preconditions

- P1: Fresh replay of J23, J24, J26, J27/S1 to J27/S3, and J27/S12 to J27/S14b. J25, J27/S4 to J27/S11, J27/P3 and J27/P6 are not run, so `NGC7000-HOO-Siril` still holds its 208 prepared hardlinks, and the J27/S14 stage rail has no `26 Sep symlink check`. J27/S14b emptied `28 Sep Ha copy check` from the Project's Trash together with its Results folder. The Project's Trash list is empty, and the runs of Project `NGC 7000 HOO` are then:
  - `NGC7000-HOO-Siril`: Complete.
  - `24 Sep flat check`: open, back at Calibrate after J27/S12, with no preparation revision.
  - `NGC7000 HOO combine`: open, not Complete.
- P2: From J22, `NGC7000-HOO-Siril` leaves out six 30 Sep frames. Five of them are library Unusable, and one is Rejected for this Project only, with library quality Unreviewed.
- P3: After J27/S2, two included 18 Sep frames of `NGC7000-HOO-Siril` were marked Unusable in the library. Their prepared hardlinks remain in `NGC7000-HOO-Siril/`.
- P4: An open Project `NGC 7000 Ha deep` (subject NGC 7000, rig `RedCat`) holds two runs, each with member session 28 Sep:
  - `Ha deep v1` is Complete. Its saved membership and prepared revision explicitly include two library-Unusable 28 Sep frames, F-res and F-ab. Its accepted Ha stack has Tool-recorded input lineage that names F-res and not F-ab.
  - `Ha deep` is open and Prepared. Its prepared revision explicitly includes one library-Unusable 28 Sep frame, F-prep, and leaves F-res and F-ab out.
  - F-res, F-prep and F-ab are library Unusable. Like every 28 Sep frame, each is a member of `NGC7000-HOO-Siril` with a prepared hardlink in `NGC7000-HOO-Siril/`. No other run holds F-ab.
- P5: The open Project `NGC 7000 SHO` from J26/P7 has 18, 28 and 30 Sep as candidates, and none of its runs includes them.
- P6: `Scratch/Captures` is registered and indexed as a Captures location after `Astro-T7/Captures`. It holds a byte copy of one of the five Unusable 30 Sep frames, F-dup. `Scratch` has no OS Trash.
- P7: The J27/P7 helper is available. F-drift, one of the other Unusable 30 Sep frames, is its target in S6. One registered intermediate is its target in S9.
- P8: `NGC7000-HOO-Siril Results/` holds 416 recognized intermediates from J26/P1 (208 calibrated and 208 registered). It also holds the generated source of the master flat that J26/S9 adopted into `Astro-T7/Calibration`. No other run of the Project has a recognized intermediate in its Results folder.
- P9: A disposable writable volume `Archive` has free space for the Project's sessions.
- P10: The isolated account's Trash inventory is recorded as in J27/P4. So are a manifest of the Project's captures, of every file in `NGC7000-HOO-Siril Results/` and of the adopted master, plus directory listings of `Astro-T7`, `Backup` and `Archive`.
- P11: Volume `Backup`, which has an OS Trash, holds `Backup/Captures`, registered and indexed as a Captures location after `Astro-T7/Captures`. It holds byte copies of two 24 Sep frames, D-1 and D-2, and no other file.

## Steps

### S1 — Mark Done with open runs {#S1}

- **Do:** On the Project page of `NGC 7000 HOO`, choose **Mark Done**.
- **Expect:** PlateVault names `24 Sep flat check` and `NGC7000 HOO combine` as runs that are not Complete, and asks the user to complete each one or move it to Trash. The Project stays open.
- **Expect (negative):** No Done / Archive sheet opens, and no file moves.
- **Trace:** PRJ-FR-14 · PRJ-AC-21 · D-W46, D-W72

### S2 — Move the flat check run to Trash {#S2}

- **Do:** In the prompt, choose **Move run to Trash** for `24 Sep flat check`. Read the Project's stage rail, its Trash list and its OIII goal.
- **Expect:** `24 Sep flat check` leaves the Project's stage rail, and the Trash list shows it at Calibrate with **Restore** and **Empty Trash**. The prompt still names `NGC7000 HOO combine`, and the Project stays open. The OIII goal's "in project" and "captured" numbers are unchanged, because the 24 Sep frames still count through `NGC7000-HOO-Siril`.
- **Expect (negative):** Moving the run to Trash opens no review, moves no file, and changes no frame's library quality or any other run.
- **Trace:** PRJ-FR-04, PRJ-FR-14, PRJ-FR-20 · RES-FR-10 · RES-AC-19 · root FR-009, FR-022 · D-W46, D-W66, D-W72

### S3 — Complete the last run and mark the Project Done {#S3}

- **Do:** Choose **Mark processing complete** for `NGC7000 HOO combine`, then choose **Mark Done** again.
- **Expect:**
  - The Project reads Done, and its Done / Archive sheet opens with five offers, each a separate approval: **Archive**, `Move 7 rejected frames to Trash (size)`, `Move 417 processing intermediates to Trash (size)`, `Move 2 duplicate copies to Trash (size)` and **Empty Trash** for the one run in the Project's Trash, `24 Sep flat check`. The 417 are the 416 P8 intermediates and the adopted master's generated source. The 2 are the P11 copies of D-1 and D-2.
  - Home lists the Project among its Projects only when **Show done** is on.
- **Expect (negative):** No file moves until the user approves an offer.
- **Trace:** Done / Archive sheet · PRJ-FR-14, PRJ-FR-15, PRJ-FR-20 · PRJ-AC-15 · STO-FR-13, STO-FR-14, STO-FR-16 · root FR-021, FR-022 · D-W26, D-W46, D-W48, D-W70, D-W72, D-W74

### S3a — Empty the Project's Trash {#S3a}

- **Do:** On the sheet, choose **Empty Trash**, read the review and confirm. Then open the Project's Trash list and read the OIII goal.
- **Expect:** The review lists only the run record of `24 Sep flat check`, because the run has no preparation revision and no Results folder, so it offers no Results folder to tick. After confirming, the Trash list is empty, the sheet drops its **Empty Trash** offer, and nothing offers to restore `24 Sep flat check`. The OIII goal's numbers are unchanged.
- **Expect (negative):** No file moves, and the Trash inventory gains no entry. No frame's library quality or any other run changes, and the other four offers are unchanged.
- **Trace:** Done / Archive sheet · PRJ-FR-14, PRJ-FR-20 · PRJ-AC-15 · RES-FR-10 · RES-AC-22 · STO-FR-17 · root FR-009 · D-W72

### S4 — Read the rejected-frames offer {#S4}

- **Do:** Open the details of `Move 7 rejected frames to Trash (size)`.
- **Expect:**
  - The seven offered frames are the two P3 18 Sep frames, four 30 Sep frames and F-ab. F-ab is offered, because its place in a prepared revision of the Complete run `Ha deep v1` is no refusal reason.
  - The size covers only the four 30 Sep frames. The two 18 Sep frames and F-ab add 0 bytes, because their prepared hardlinks in `NGC7000-HOO-Siril/` still hold their bytes.
  - Three frames are listed as refused, each with its reason:
    - F-prep: in a prepared revision of run `Ha deep` in Project `NGC 7000 Ha deep`, a run that is not Complete.
    - F-res: a recorded input of the accepted Ha stack of `Ha deep v1`.
    - F-dup: one of its copies sits on `Scratch`, which has no OS Trash.
- **Expect (negative):** The Project-only reject from P2 is neither counted nor listed. No library-Usable or Unreviewed frame is offered.
- **Trace:** Done / Archive sheet · PRJ-FR-15 · PRJ-AC-16 · STO-FR-14, STO-FR-15 · STO-AC-18 · root FR-021 · D-W42, D-W43, D-W57

### S5 — Review Archive {#S5}

- **Do:** Choose **Archive**, read the review, and return to the sheet without approving.
- **Expect:**
  - The review lists the Project's member sessions: 18, 24, 26, 28 and 30 Sep.
  - 28 Sep is listed as kept at its path, naming Project `NGC 7000 Ha deep` as its user.
  - 18, 24, 26 and 30 Sep are proposed for transfer to `Archive/NGC7000`. Their destination paths are laid out by the naming templates, with bytes, source identities, affected runs and reference updates.
  - 30 Sep is proposed for transfer even though it is a candidate of the open Project `NGC 7000 SHO`.
- **Expect (negative):** Nothing transfers, and no run's membership or totals change.
- **Trace:** Done / Archive sheet · STO-FR-06, STO-FR-13 · STO-AC-17 · PRJ-FR-14 · root FR-011 · D-W26, D-W46

### S6 — Move the rejected frames to Trash {#S6}

- **Do:** Approve `Move 7 rejected frames to Trash` and read the review. With the P7 helper, overwrite F-drift in place. Then confirm. Afterwards, restore F-drift's saved bytes and mtime with the helper.
- **Expect:**
  - Progress shows per-frame outcomes. The summary names 6 frames moved, and F-drift refused with drift named and left in place.
  - The six moved files are newly in the OS Trash, and the library marks them Trashed.
- **Expect (negative):**
  - Nothing is permanently deleted.
  - No prepared hardlink in `NGC7000-HOO-Siril/` is moved, and no prepared entry of `Ha deep` or `Ha deep v1` is moved.
  - F-prep, F-res, F-dup (both copies) and the Project-only reject remain at their paths.
- **Trace:** Done / Archive sheet · STO-FR-15 · STO-AC-19 · PRJ-FR-15 · PRJ-AC-17 · LIB-FR-18 · root SC-010 · D19, D-W43, D-W57

### S7 — Confirm the Trashed frames are hidden {#S7}

- **Do:** Read the 18, 28 and 30 Sep rows in Sessions and the Captured column of Target NGC 7000. Read the "captured" goal numbers of `NGC 7000 SHO`, start a run there on rig `RedCat` and read its session picker, and open frame review on its 30 Sep candidate session. Open the fixed memberships of `NGC7000-HOO-Siril` and `Ha deep v1`. Then rescan `Astro-T7/Captures`.
- **Expect:**
  - Sessions shows 2 fewer frames for 18 Sep, 1 fewer for 28 Sep and 3 fewer for 30 Sep.
  - Target NGC 7000's Captured falls by Ha 0h 15m and OIII 0h 15m.
  - In `NGC 7000 SHO`, Ha and OIII "captured" each fall by 0h 15m. The picker leaves the six Trashed frames out, and frame review leaves the three Trashed 30 Sep frames out.
  - `NGC7000-HOO-Siril`'s fixed membership still lists the two 18 Sep frames and F-ab, marked "Trashed". `Ha deep v1`'s fixed membership still lists F-ab, marked "Trashed". These two are the only Complete runs that hold a Trashed frame.
  - The rescan reports none of the six frames Missing.
- **Expect (negative):** No Trashed frame is offered by any picker, counted in any goal or total, measured or thumbnailed in frame review, or shown on Home. The open run `Ha deep` lists no Trashed frame.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-09, PRJ-FR-16 · VSEL-AC-25 · PIX-AC-19 · PLAN-TGT-FR-08 · root FR-021 · D-W43, D-W52, D-W66

### S8 — Find the frames under the Trashed filter {#S8}

- **Do:** In Sessions, choose the **Trashed** filter.
- **Expect:** Exactly the six frames are listed, each with its last-observed metadata and the operation that trashed it.
- **Expect (negative):** F-drift, F-prep, F-res, F-dup and the Project-only reject are not listed.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · D-W43

### S9 — Move the processing intermediates to Trash {#S9}

- **Do:** On the sheet, approve `Move 417 processing intermediates to Trash` and read the review. With the P7 helper, overwrite one listed intermediate in place. Then confirm.
- **Expect:**
  - The review lists the 416 recognized intermediates in `NGC7000-HOO-Siril Results/`. As the 417th item it lists the adopted master's generated source, a verified duplicate that names the kept library copy in `Astro-T7/Calibration`.
  - It keeps the accepted Ha and OIII stacks and the adopted library master. The log, the unrecognized file and every unaccepted candidate are not offered.
  - The summary names 416 items moved to the OS Trash under that one approval, 415 intermediates and the generated source, and the overwritten intermediate refused with drift named and left in place.
- **Expect (negative):**
  - No accepted Result, adopted library master, log, unrecognized file, unaccepted candidate or prepared entry reaches the Trash. Each still matches P10.
  - Nothing is permanently deleted.
- **Trace:** Done / Archive sheet · PRJ-FR-15 · PRJ-AC-28 · STO-FR-04, STO-FR-15, STO-FR-16 · STO-AC-21 · CAL-FR-06, CAL-FR-07 · RES-FR-01, RES-FR-04 · root FR-021 · D19, D-W43, D-W70

### S9a — Move the duplicate copies to Trash {#S9a}

- **Do:** On the sheet, approve `Move 2 duplicate copies to Trash` and read the review. Then confirm, and read the 24 and 30 Sep rows in Sessions and the copies listed for D-1, D-2 and F-dup.
- **Expect:**
  - The review lists the `Backup/Captures` copies of D-1 and D-2. Each names its kept copy in `Astro-T7/Captures`, which is a Captures location registered earlier.
  - It lists the `Scratch/Captures` copy of F-dup as refused, because `Scratch` has no OS Trash.
  - After confirming, both `Backup` copies are newly in the OS Trash. D-1 and D-2 each list one copy, in `Astro-T7/Captures`, and F-dup still lists two.
  - Sessions shows the same 24 Sep and 30 Sep frame counts as at S7, and Target NGC 7000's Captured is unchanged.
- **Expect (negative):** No kept copy, prepared hardlink, Trashed frame or F-dup copy moves. The Trashed filter still lists exactly the six frames, and nothing is permanently deleted. The adopted master's generated source, which S9 moved, is not listed.
- **Trace:** Done / Archive sheet · PRJ-FR-15 · PRJ-AC-30 · STO-FR-15, STO-FR-16 · STO-AC-23 · root FR-021 · D19, D-W43, D-W74

### S10 — Put one frame back {#S10}

- **Do:** In the OS Trash, put back one of the three trashed 30 Sep frames. Rescan `Astro-T7/Captures`.
- **Expect:** The frame returns as Unusable and leaves the Trashed filter, which now lists five frames. Target NGC 7000's OIII Captured rises by 0h 05m. The frame's history still shows its Trashed episode.
- **Expect (negative):** PlateVault offers no restore of its own, and the frame does not read Missing or ChangedContent.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · PRJ-AC-17 · STO-FR-15 · D-W43

### S11 — Archive the Project {#S11}

- **Do:** On the sheet, choose **Archive** again, review it, and approve.
- **Expect:**
  - 18, 24, 26 and 30 Sep transfer to `Archive/NGC7000`. Every destination verifies before any source is retired, and the four sessions read Archived. The 30 Sep transfer includes the frame put back in S10.
  - 28 Sep stays at its path.
  - The memberships and totals of `Ha deep` and `Ha deep v1` are unchanged.
- **Expect (negative):** The four Trashed 18 Sep and 30 Sep frames are not transferred, and no run's membership or exclusions change.
- **Trace:** Done / Archive sheet · STO-FR-07, STO-FR-13 · STO-AC-17 · root FR-011 · D-W26, D-W46 · G3

### S12 — Reopen the Project after Archive {#S12}

- **Do:** On the Project page, choose **Reopen**. Then list `Astro-T7` and `Archive` and compare them with the S11 result.
- **Expect:**
  - The Project reads open, and Home lists it again without **Show done**.
  - Its runs keep their states: `NGC7000-HOO-Siril` and `NGC7000 HOO combine` are Complete, and `24 Sep flat check` and `28 Sep Ha copy check`, emptied from the Project's Trash, do not return. The Trash list is empty, and its goals and members are unchanged.
  - 18, 24, 26 and 30 Sep still read Archived at their `Archive/NGC7000` paths, each with a restore offer.
- **Expect (negative):** Reopening moves no file: both listings equal their state after S11. No Trashed frame returns.
- **Trace:** Done / Archive sheet · PRJ-FR-14, PRJ-FR-20 · PRJ-AC-21, PRJ-AC-27 · STO-FR-13 · STO-AC-22 · D-W46, D-W69

### S12a — Read the restore review of an Archived session {#S12a}

- **Do:** On 30 Sep, choose its restore offer, read the review, and close it without approving. Then list `Astro-T7` and `Archive` again.
- **Expect:** The restore opens a transfer review of 30 Sep from `Archive/NGC7000`. It shows destination paths, bytes, source identities, affected runs and reference updates, plus the destination volume identity, free space and writability.
- **Expect (negative):** Nothing transfers without approval. Both listings still equal their state after S11, and 30 Sep still reads Archived at its `Archive/NGC7000` path.
- **Trace:** Done / Archive sheet · STO-FR-06, STO-FR-13 · STO-AC-22 · PRJ-FR-14 · PRJ-AC-27 · D-W69 · G5

## Success criteria

- SC1: Mark Done opens the sheet 0 times while a run outside the Project's Trash is open (S1, S2). It opens exactly once after every such run is Complete, with Empty Trash offered for exactly 1 run (S3). Moving that run to Trash and emptying it moves 0 files and changes the OIII numbers by 0 (S2, S3a).
- SC2: The rejected-frames offer counts exactly 7 frames, including 1 in a Complete run's prepared revision. It lists exactly 3 refusals with reasons and includes 0 Project-only rejects (S4).
- SC3: Exactly 6 frames reach the OS Trash. 0 refused or drifted frames, 0 prepared entries and 0 files are permanently deleted (S6).
- SC4: The Trashed frames appear in 0 pickers, candidate lists, frame reviews, goals or totals. They show only under the Trashed filter (6 frames) and, marked "Trashed", in the fixed memberships of `NGC7000-HOO-Siril` (3 frames) and `Ha deep v1` (1 frame) (S7, S8).
- SC5: Exactly 415 intermediates and 1 generated source, listed as a verified duplicate of the kept library copy, reach the OS Trash. 0 accepted Results and 0 adopted library masters do (S9).
- SC6: Put back plus rescan returns 1 frame as Unusable, and the Trashed filter then lists 5 (S10).
- SC7: Archive keeps 28 Sep and transfers 4 sessions, including 30 Sep, which is only another Project's candidate (S5, S11).
- SC8: Reopen after Archive moves 0 files and changes 0 run states, goals or members. The 4 archived sessions still read Archived, and the restore review moves 0 files (S12, S12a).
- SC9: The duplicate-copies offer counts exactly 2 copies and lists 1 refusal. Exactly 2 copies reach the OS Trash, and every frame keeps at least 1 copy (S3, S9a).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, decision D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G3: Out of scope for this journey: archive transfer failures, interruption and reference repair are J28's. J28 forks from S5. Blocks readiness until J28 covers them.
- G4: Unresolved implementation qualification: P4 needs Tool-recorded input lineage from a processing tool for F-res. No profile has qualified how that evidence is captured. Blocks readiness.
- G5: Out of scope for this journey: approving the restore of an Archived session after Reopen (STO-FR-13) is not exercised, because S12a stops at the review. Blocks readiness until covered by a step or a journey.

## Delta log

- No entries (initial draft, version 1).
