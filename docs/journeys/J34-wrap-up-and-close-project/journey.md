---
id: J34
title: Wrap up and close a Project after trashing rejected frames and Processing files
version: 6
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, wrap-up, archive, sessions, targets, home, view-review, locations, activity, status-bar, issues]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, 070-results-reuse, 071-storage-custody, 072-observing-plans, D19, D-W26, D-W35, D-W42, D-W43, D-W46, D-W48, D-W52, D-W54, D-W57, D-W66, D-W69, D-W70, D-W72, D-W74, P-WRAP1, P-ARC1, P-PREP3, P-TRASH2, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S2, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S8, HARNESS-V5-IA.md#S9, HARNESS-V5-IA.md#S16, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#b-projects, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#input-modes-user-2026-10-10-research-designinput-modes-researchmd, HARNESS-V5-FEEDBACK-R1.md#round-7-user-2026-10-12-run-views-research-designrun-views-optionsmd, HARNESS-V5-FEEDBACK-R1.md#round-8-user-2026-10-12, D-W93, D-W94, D-W97, D-W100, PRJ-FR-14, PRJ-FR-15, PRJ-FR-16, PRJ-FR-25, PRJ-FR-30, STO-FR-01, STO-FR-06, STO-FR-07, STO-FR-08, STO-FR-13]
---

## Goal

The user wraps up Project `NGC 7000 HOO` after its View changes have been applied. Wrap up opens only when no Project change is pending and offers Clean up → Trash → Archive in order. The user skips Clean up, reviews the rejected-frame, `Processing/` file and duplicate-copy offers, then chooses **Close project…** as Archive's Proceed. The review transfers 18, 24, 26 and 30 Sep to `Archive/NGC7000`; 28 Sep stays on `Astro-T7` because another Project that is not Closed holds it. Sources retire only after the destination and affected references verify. The symlinked View entries follow the archived sessions. `Output/` is kept, and the Project reads Archived after the transfer succeeds. Closed and Archived Projects stay locked for good: there is no Reopen, no restore of archived sessions and no library or calibration change to them. **Duplicate…** is the way to continue one.

## Preconditions

- P1: The existing NGC 7000 capture sessions, frame-quality fixture and disposable Trash inventory from the earlier journey fixtures are established. The open Project's View contains the established symlink entries for the selected NGC 7000 frames, and `Processing/` contains the fixture files used below. The Project has no pending changes, `Output/` holds the two established Results, and another open Project holds session 28 Sep and has a symlinked View entry for F-prep. Project `NGC 7000 SHO` is also open and has 18, 28 and 30 Sep only as suggestions.
- P2: The frame-quality fixture has six rejected 30 Sep frames, five with library quality Unusable and one with quality Unreviewed; 28 Sep has no Project-scoped rejection. Library quality is the only quality scope.
- P3: After J27/S2, two included 18 Sep frames of `NGC7000-HOO-Siril` were marked Unusable in the library. Their symlink entries remain in `NGC7000-HOO-Siril/`.
- P4: Open Project `NGC 7000 Ha deep` holds session 28 Sep. Its View contains the symlink to F-prep. F-res and F-ab are Unusable library frames. No Result lineage is recorded or used to decide whether a frame may be trashed.
- P5: The open Project `NGC 7000 SHO` from J26/P7 has 18, 28 and 30 Sep as candidates, and none of its runs includes them.
- P6: `Scratch/Captures` is registered and indexed as a Captures location after `Astro-T7/Captures`. It holds a byte copy of one of the five Unusable 30 Sep frames, F-dup. `Scratch` has no OS Trash.
- P7: The J27/P7 helper is available. F-drift, one of the other Unusable 30 Sep frames, is its target in S6. One registered intermediate is its target in S9.
- P8: `Processing/WBPP/` holds 416 tool files and the generated source of the master flat adopted into `Astro-T7/Calibration`. `Output/` holds two Results, which are not offered for Trash.
- P9: A disposable writable volume `Archive` has free space for the Project's sessions. Settings › Locations lists two archive locations on it, registered before S1: `Archive/NGC7000`, marked Default, and `Archive/Long-term`.
- P10: The isolated account's OS Trash inventory is recorded. So are manifests of the Project's captures, `Processing/`, `Output/` and the adopted master, plus directory listings of `Astro-T7`, `Backup` and `Archive`.
- P11: Volume `Backup`, which has an OS Trash, holds `Backup/Captures`, registered and indexed as a Captures location after `Astro-T7/Captures`. It holds byte copies of two 24 Sep frames, D-1 and D-2, and no other file.

## Steps

### S1 — Open Wrap up with no pending changes {#S1}

- **Do:** On the Project page of `NGC 7000 HOO`, read the stage strip, then switch the page to Wrap up.
- **Expect:** Wrap up opens at Clean up because no Project change is pending. It lists Clean up → Trash → Archive in order; later steps are read-only until earlier steps are Finished or Skipped. Archive's Proceed is **Close project…**. No Project Trash or run-level Trash action is present.
- **Expect (negative):** No file moves, and no Wrap up step records Done or Skipped.
- **Trace:** HARNESS-V5-IA.md S3, S9 · HARNESS-V5-FEEDBACK-R1.md Copy rules · P-WRAP1 · PRJ-FR-14 · PRJ-AC-21 · D-W46, D-W72

### S2 — Inspect the Wrap up Trash step {#S2}

- **Do:** Open the Trash step and inspect its three groups: rejected frames, `Processing/` files and duplicate copies.
- **Expect:** The three groups list their selectable offers, item counts and sizes. Refused frames name their reason. No run Trash or Project Trash page is available.
- **Expect (negative):** Opening the Trash step moves no file and changes no frame's library quality, Project sessions or goals.
- **Trace:** HARNESS-V5-IA.md S3, S5, S8 · PRJ-FR-04, PRJ-FR-14, PRJ-FR-20 · RES-FR-10 · RES-AC-19 · root FR-009, FR-022 · D-W46, D-W66, D-W72

### S3 — Review Wrap up offers and order {#S3}

- **Do:** Read the Project's Wrap up step table, its session counts and sizes, and its row on Home.
- **Expect:**
  - The stage strip has Wrap up current, and the Project still reads open. Wrap up lists four steps in order, each with its state and, except Done, its size: 1 Clean up, marked Next; 2 Trash; 3 Archive.
  - Clean up lists the Project View, with the Copies option selected and Symlinks not selected by default, plus any entries still held in `View (previous)/`. It offers **Proceed** and lists the exact entries and sizes.
  - Trash lists three rows, each with its item count, its size and its own **Trash…** approval: Rejects with 7 items, Intermediates with 417 and Duplicates with 2. The 417 are the 416 P8 intermediates and the adopted master's generated source. The 2 are the P11 copies of D-1 and D-2.
  - Archive reads 4 sessions to move, and its Destination preselects `Archive/NGC7000`, marked Default.
  - Done offers **Mark Done**.
  - Home and the Projects list show the Project's stage as Wrap up. Its Next does not read Wrap up while frame review's Unreviewed filter lists any of the Project's candidate frames: it reads `Review N new frames`, with N the number of frames that filter lists, because D-W35 puts that rule before Wrap up.
- **Expect (negative):** No file moves until the user approves a step. No run Trash, Project Trash page, Empty Trash or Empty Trash group exists.
- **Trace:** HARNESS-V5-IA.md S1, S2, S3, S9 · P-WRAP1, P-ARC1 · PRJ-FR-14, PRJ-FR-15, PRJ-FR-20 · PRJ-AC-15 · STO-FR-13, STO-FR-14, STO-FR-16 · root FR-021, FR-022 · D-W26, D-W35, D-W46, D-W48, D-W70, D-W72, D-W74 · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("Linked · 0 B"; Wrap up offers intermediates cleanup) · G6

### S3a — Confirm there is no Project Trash {#S3a}

- **Do:** Return to the Project page and inspect its navigation and Wrap up Trash step for Project Trash or Empty Trash actions.
- **Expect:** No Project Trash page, run Trash list or Empty Trash action is offered. Wrap up's Trash step remains the only offer for rejected frames, `Processing/` files and duplicate copies.
- **Expect (negative):** No file moves, and the Trash inventory gains no entry. No frame's library quality or any other run changes, and every Wrap up step keeps its state, size and counts.
- **Trace:** HARNESS-V5-IA.md S8 · PRJ-FR-14, PRJ-FR-20 · PRJ-AC-15 · RES-FR-10 · RES-AC-22 · STO-FR-17 · root FR-009 · D-W72

### S3b — Skip View Clean up, undo, and skip again {#S3b}

- **Do:** In Wrap up, choose **Proceed** with nothing selected on Clean up, reopen the step, then choose **Undo** and **Proceed** again. Inspect the Project's View.
- **Expect:**
  - Proceeding with no selection records Clean up as Skipped and makes Trash current. Reopening the step allows Undo; proceeding again records Skipped.
  - The Project's View remains unchanged; skipping and undoing Clean up remove no View entry.
- **Expect (negative):** Skip and Undo move no file and start no Clean up operation.
- **Trace:** HARNESS-V5-IA.md S9 · P-WRAP1 · PREP-FR-14 · STO-FR-01 · D-W26 · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 · G7

### S4 — Read the rejected-frames offer {#S4}

- **Do:** In the Trash step, read the Rejects row and open its refusal's disclosure. Then choose **Trash…** on Rejects, read the review, and cancel.
- **Expect:**
  - The review lists the seven offered frames: the two P3 18 Sep frames, four 30 Sep frames and F-ab. F-ab is offered, because its place in a prepared revision of the Complete run `Ha deep v1` is no refusal reason.
  - The size covers all seven frames, because a symlink entry holds none of a frame's bytes. The review's changes list reads `Also removes 4 links in kept run views`: the symlinks to the two P3 18 Sep frames and F-ab in `NGC7000-HOO-Siril/`, and to F-ab in `Ha deep v1/`.
  - The row's terse refusal reads `Can't trash 3`, and its disclosure lists each refused frame with its reason:
    - F-prep: `Can't trash 1 · linked by NGC 7000 Ha deep ▸`, leading to its Open Project View entry.
    - F-res: no tool-output lineage is recorded or used to decide whether it may be trashed.
    - F-dup: one of its copies sits on `Scratch`, which has no OS Trash.
- **Expect (negative):** Neither Project-only reject of P2 is counted or listed. No library-Usable or Unreviewed frame is offered. Cancelling moves no file or link, and the Rejects row still reads 7 items.
- **Trace:** HARNESS-V5-IA.md S9 · HARNESS-V5-FEEDBACK-R1.md Copy rules, §Round 6 ("Reject is library-wide by default"), §Round 7 P-PREP3 ("Linked · 0 B"), §Round 8 P-TRASH2 ("Can't trash · linked by {run} ▸", "Also removes N links in kept run views") · PRJ-FR-15 · PRJ-AC-16 · STO-FR-14, STO-FR-15 · STO-AC-18 · root FR-021 · D-W42, D-W43, D-W54, D-W57 · J44/S6

### S5 — Read the Archive step {#S5}

- **Do:** In the Archive step, read its Destination and its counts, and open the disclosure of its kept session. Then choose **Archive…**, read the review, and cancel without approving.
- **Expect:**
  - Destination lists the two P9 archive locations, with `Archive/NGC7000` preselected and marked Default.
  - The step reads 4 sessions to move and `1 session kept · used by another Project`, whose disclosure names 28 Sep and Project `NGC 7000 Ha deep`.
  - The review lists the Project's sessions: 18, 24, 26, 28 and 30 Sep. 28 Sep is not selectable because open Project `NGC 7000 Ha deep` holds it.
  - 18, 24, 26 and 30 Sep are proposed for transfer to `Archive/NGC7000`. Their destination paths are laid out by the naming templates, with bytes, source identities, affected Projects and View reference updates. Each symlinked Project View entry for a selected session is proposed to follow its frame to its `Archive/NGC7000` path.
  - 30 Sep is proposed for transfer even though it is a candidate of the open Project `NGC 7000 SHO`.
- **Expect (negative):** Nothing transfers, Trash and Archive still read To do, and Project sessions and totals do not change.
- **Trace:** HARNESS-V5-IA.md S9, S16 · P-ARC1 · STO-FR-06, STO-FR-13 · STO-AC-17 · PRJ-FR-14 · root FR-011 · D-W26, D-W46 · HARNESS-V5-FEEDBACK-R1.md §Input modes ("a symlinked entry is repointed when its session moves")

### S6 — Move the rejected frames to Trash {#S6}

- **Do:** On the Rejects row, choose **Trash…** and read the review. With the P7 helper, overwrite F-drift in place. Then confirm **Move to Trash**. Afterwards, restore F-drift's saved bytes and mtime with the helper.
- **Expect:**
  - Progress shows per-frame outcomes. The summary names 6 frames moved, and F-drift refused with drift named and left in place.
  - The six moved files are newly in the OS Trash, and the library marks them Trashed. The 4 links that S4's review counted went with them: `NGC7000-HOO-Siril/` has lost its links to the two 18 Sep frames and F-ab, and `Ha deep v1/` its link to F-ab.
- **Expect (negative):**
  - Nothing is permanently deleted.
  - No other prepared entry of `NGC7000-HOO-Siril`, `26 Sep symlink check`, `Ha deep` or `Ha deep v1` is moved.
  - F-prep, F-res, F-dup (both copies) and both Project-only rejects remain at their paths, and `Ha deep`'s view still links F-prep.
- **Trace:** HARNESS-V5-IA.md S9 · HARNESS-V5-FEEDBACK-R1.md §Round 8 P-TRASH2 ("the move takes those links with the frame") · STO-FR-15 · STO-AC-19 · PRJ-FR-15 · PRJ-AC-17 · LIB-FR-18 · root SC-010 · D19, D-W43, D-W57

### S7 — Confirm the Trashed frames are hidden {#S7}

- **Do:** Read the 18, 28 and 30 Sep rows in Sessions and the Captured column of Target NGC 7000. Read the "captured" goal numbers of `NGC 7000 SHO` and its suggested sessions, inspect the Project's session list, and rescan `Astro-T7/Captures`.
- **Expect:**
  - Sessions shows 2 fewer frames for 18 Sep, 1 fewer for 28 Sep and 3 fewer for 30 Sep.
  - Target NGC 7000's Captured falls by Ha 0h 15m and OIII 0h 15m.
  - In `NGC 7000 SHO`, Ha and OIII "captured" each fall by 0h 15m. The picker leaves the six Trashed frames out, and frame review leaves the three Trashed 30 Sep frames out.
  - The Project that held the Trashed frames when they were trashed still shows them marked "Trashed"; no other Project shows them.
  - The rescan reports none of the six frames Missing.
- **Expect (negative):** No Trashed frame is offered by any picker, counted in any goal or total, measured or thumbnailed in frame review, or shown on Home. The Open Project `NGC 7000 Ha deep` lists no Trashed frame outside the exception for a Project that held it when it was trashed.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-09, PRJ-FR-16 · VSEL-AC-25 · PIX-AC-19 · PLAN-TGT-FR-08 · root FR-021 · D-W43, D-W52, D-W66

### S8 — Find the frames under the Trashed filter {#S8}

- **Do:** In Sessions, choose the **Trashed** filter.
- **Expect:** Exactly the six frames are listed, each with its last-observed metadata and the operation that trashed it.
- **Expect (negative):** F-drift, F-prep, F-res, F-dup and both Project-only rejects are not listed.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · D-W43

### S9 — Move Project Processing files to Trash {#S9}

- **Do:** On the `Processing/` row, choose **Trash…** and read the review. With the P7 helper, overwrite one listed file in place. Then choose **Proceed** and confirm.
- **Expect:**
  - The review lists the 416 files in `Processing/WBPP/` and the adopted master's generated source as a verified duplicate naming the kept library copy in `Astro-T7/Calibration`.
  - It keeps all Results in `Output/` and the adopted library master. Logs and files outside `Processing/` are not offered.
  - The summary names 416 items moved to the OS Trash under that one approval, 415 intermediates and the generated source, and the overwritten intermediate refused with drift named and left in place.
- **Expect (negative):**
  - No Result in `Output/`, adopted library master, log or file outside the reviewed `Processing/` offer reaches the Trash. Each still matches P10.
  - Nothing is permanently deleted.
- **Trace:** HARNESS-V5-IA.md S9 · PRJ-FR-15 · PRJ-AC-28 · STO-FR-04, STO-FR-15, STO-FR-16 · STO-AC-21 · CAL-FR-06, CAL-FR-07 · RES-FR-01, RES-FR-04 · root FR-021 · D19, D-W43, D-W70

### S9a — Move the duplicate copies to Trash {#S9a}

- **Do:** On the Duplicates row, choose **Trash…** and read the review. Then confirm **Move to Trash**, and read the Trash step, the 24 and 30 Sep rows in Sessions and the copies listed for D-1, D-2 and F-dup.
- **Expect:**
  - The review lists the `Backup/Captures` copies of D-1 and D-2. Each names its kept copy in `Astro-T7/Captures`, which is a Captures location registered earlier.
  - It lists the `Scratch/Captures` copy of F-dup as refused, because `Scratch` has no OS Trash.
  - After confirming, both `Backup` copies are newly in the OS Trash. D-1 and D-2 each list one copy, in `Astro-T7/Captures`, and F-dup still lists two.
  - Sessions shows the same 24 Sep and 30 Sep frame counts as at S7, and Target NGC 7000's Captured is unchanged.
  - With all three rows moved, the Trash step reads Done, and Archive is marked Next.
- **Expect (negative):** No kept copy, prepared entry, Trashed frame or F-dup copy moves. The Trashed filter still lists exactly the six frames, and nothing is permanently deleted. The adopted master's generated source, which S9 moved, is not listed.
- **Trace:** HARNESS-V5-IA.md S9 · PRJ-FR-15 · PRJ-AC-30 · STO-FR-15, STO-FR-16 · STO-AC-23 · root FR-021 · D19, D-W43, D-W74

### S10 — Put one frame back {#S10}

- **Do:** In the OS Trash, put back one of the three trashed 30 Sep frames. Rescan `Astro-T7/Captures`.
- **Expect:** The frame returns as Unusable and leaves the Trashed filter, which now lists five frames. Target NGC 7000's OIII Captured rises by 0h 05m. The frame's history still shows its Trashed episode.
- **Expect (negative):** PlateVault offers no restore of its own, and the frame does not read Missing or ChangedContent.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · PRJ-AC-17 · STO-FR-15 · D-W43

### S11 — Close the Project through Archive {#S11}

- **Do:** In the Archive step, review the selected sessions, source and destination paths, and reference changes. Choose **Close project…** as Proceed and confirm.
- **Expect:**
  - 18, 24, 26 and 30 Sep transfer to `Archive/NGC7000`. Every destination verifies before any source is retired, and the four sessions read Archived. The 30 Sep transfer includes the frame put back in S10.
  - Each of the 35 symlinks in `26 Sep symlink check/` now points at its 26 Sep frame's `Archive/NGC7000` path, and the run still reads Complete.
  - Each symlink in `NGC7000-HOO-Siril/` to a transferred frame now points at that frame's `Archive/NGC7000` path, and its 28 Sep symlinks still point under `Astro-T7/Captures`.
  - 28 Sep stays at its path.
  - The memberships and totals of `Ha deep` and `Ha deep v1` are unchanged.
  - The Project reads Closing while the transfer runs and Archived after every selected item succeeds. The Wrap up record is then read-only.
- **Expect (negative):** Trashed frames are not transferred, and Project session membership does not change. No View symlink changes kind or reference mode. Archive's Proceed closes the Project; it does not offer Reopen.
- **Trace:** HARNESS-V5-IA.md S9 · P-WRAP1, P-ARC1 · STO-FR-06, STO-FR-07, STO-FR-13 · STO-AC-17 · root FR-011 · D-W26, D-W46 · HARNESS-V5-FEEDBACK-R1.md §Input modes ("a symlinked entry is repointed when its session moves"), §Round 7 P-PREP3 · G3

### S11a — Inspect the Archived Project record {#S11a}

- **Do:** After Close succeeds, inspect the Project header, menu, Wrap up record, View, `Output/`, Home and Projects list.
- **Expect:**
  - The Project reads Archived, keeps `Output/`, and its menu offers Duplicate… but no Reopen.
  - Wrap up offers no approval, **Skip** or **Undo**.
  - Home's Open work no longer lists the Project; its Archived state remains visible on the Project record.
- **Expect (negative):** Close keeps `Output/` and does not change Project session membership or goals.
- **Trace:** HARNESS-V5-IA.md S1, S2, S3, S9 · P-WRAP1 · PRJ-FR-14 · PRJ-AC-21 · D-W26, D-W46, D-W48

### S12 — Confirm the Closed Project is locked {#S12}

- **Do:** On the Archived Project page, inspect its menu, Edit… control, Wrap up, goals and View. Try to change a library quality mark and a session's calibration from their owning pages, then return to the Project.
- **Expect:**
  - The Archived Project offers no Reopen or restore action. Edit… is disabled with "Project closed · Duplicate ▸".
  - The Project remains Archived and its Wrap up record is read-only. Its View and `Output/` remain available for inspection; Library and calibration changes do not create pending changes.
  - Its session membership and goals remain frozen at Close; its `Output/` Results remain in place.
  - The Project page lists 18, 24, 26 and 30 Sep as Archived at their `Archive/NGC7000` paths, with no Restore action.
- **Expect (negative):** No Reopen or restore action is available, and no library or calibration change updates the Archived Project.
- **Trace:** HARNESS-V5-IA.md S3, S9 · PRJ-FR-14, PRJ-FR-20 · PRJ-AC-21, PRJ-AC-27 · STO-FR-13 · STO-AC-22 · D-W46, D-W69

### S12a — Duplicate the Archived Project to continue {#S12a}

- **Do:** On the Archived Project, choose **Duplicate…** and keep its sessions, groups and overrides, goals, notes and settings selected.
- **Expect:** The duplicate is a new Open Project with the selected sessions and settings, no copied files, no View until its first Apply, and no "Duplicated from" note or link to the original.
- **Expect (negative):** No file is copied, and the original remains Archived and locked. The duplicate can continue independently.
- **Trace:** HARNESS-V5-IA.md S3, S9 · STO-FR-06, STO-FR-13 · STO-AC-22 · PRJ-FR-14 · PRJ-AC-27 · D-W69 · G5

## Success criteria

- SC1: Wrap up opens with no pending Project changes and lists Clean up → Trash → Archive in order; Archive's Proceed is Close project… (S1, S3, S11). There is no run Trash, Empty Trash page or Empty Trash group (S2, S3a).
- SC2: The rejected-frames offer counts exactly 7 frames, including 1 in a Complete run's prepared revision, and its review counts exactly 4 links in kept run views. It lists exactly 3 refusals with reasons, F-prep's naming `Ha deep`, and includes 0 of the 2 Project-only rejects (S4).
- SC3: Exactly 6 frames and the 4 links to them in kept run views reach the OS Trash. 0 refused or drifted frames and 0 other prepared entries move, and 0 files are permanently deleted (S6).
- SC4: The Trashed frames appear in 0 pickers, candidate lists, frame reviews, goals or totals. They show only under the Trashed filter (6 frames) and, marked "Trashed", in the fixed memberships of `NGC7000-HOO-Siril` (3 frames) and `Ha deep v1` (1 frame) (S7, S8).
- SC5: Exactly 415 intermediates and 1 generated source, listed as a verified duplicate of the kept library copy, reach the OS Trash. 0 accepted Results and 0 adopted library masters do (S9).
- SC6: Put back plus rescan returns 1 frame as Unusable, and the Trashed filter then lists 5 (S10).
- SC7: Archive goes to `Archive/NGC7000`, the Default archive location, keeps 28 Sep and transfers 4 sessions, including 30 Sep, which is only another Project's candidate (S5, S11).
- SC8: Close transfers selected sessions only after destination and reference verification, retains `Output/`, and leaves the Project Archived and locked. Duplicate… creates an independent Open Project without copying files (S11, S11a, S12, S12a).
- SC9: The duplicate-copies offer counts exactly 2 copies and lists 1 refusal. Exactly 2 copies reach the OS Trash, and every frame keeps at least 1 copy (S3, S9a).
- SC10: Skip and Undo on Clean up move 0 files, and the Project View's selected symlink entries remain unchanged (S3b).
- SC11: The Project reads Closing during Archive's transfer and Archived after it succeeds; Closed and Archived Projects offer no Reopen and no Restore, and Duplicate… is available (S11, S11a, S12, S12a).
- SC12: After Archive, 35 of 35 symlinks of `26 Sep symlink check` and every symlink of `NGC7000-HOO-Siril` to a transferred frame point at `Archive/NGC7000` paths, 0 prepared entries change kind, and 0 reference-mode choices are offered (S11).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design: HARNESS-V5-IA.md S1, S2, S3, S8, S9 and S16, and HARNESS-V5-FEEDBACK-R1.md P-WRAP1, P-ARC1, Screens B and Round 5 (ui-harness-v5 @ b5e813a5), Round 6 (@ 4f470775), Round 7 P-PREP3 (@ 12638a7c) and Round 8 P-TRASH2. It also follows the specs, decision D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G3: Out of scope for this journey: archive transfer failures, interruption and a symlink that cannot be repointed are J28's. J28 forks from S5. Blocks readiness until J28 covers them.
- G4: Dissolved by D-W93: Result lineage and provenance are out of scope and no input-to-Result relationship is recorded.
- G5: There is no restore of an archived session after Close; sessions stay at their archive paths (PRJ-FR-25, STO-FR-13).
- G6: Out of scope for this journey: Next reading Wrap up (D-W35, HARNESS-V5-IA.md S1) is not observed, because the Project's candidates keep library-Unreviewed frames (P2), so Review N new frames comes first. Blocks readiness until covered by a step or a journey.
- G7: Clean up of the Project View is exercised in S3b; no per-run Clean up flow exists.
- G8: (dissolved 2026-10-12): answered by Round 8 P-TRASH2. S4 refuses F-prep while the view of the unfinished run `Ha deep` links it (J44/S6 prepares that run again and then moves it), and its review counts the 4 links of the kept views of `NGC7000-HOO-Siril` and `Ha deep v1`, which S6 moves with their frames. S11 has no link to a Trashed frame left to repoint.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, S3, S3a, +S3b, S4, S5, S6, S9, S9a, S11, +S11a, S12, S12a · behavior-change
  The Done / Archive sheet is replaced by the Project's Wrap up stage, available once every run is Complete: Clean up runs, Trash (three approvals), Archive to the chosen archive location, then Done, each with its size and skippable with Undo (new S3b).
  Archive now precedes Mark Done, so the Project stays open until the new S11a marks it Done. The Project Trash is emptied from its own page, not from Wrap up, and a Reopened Project lists its Archived sessions on the Project page with Restore.
  Evidence: HARNESS-V5-IA.md §Screens S1, S2, S3, S5, S8, S9, S16; HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Domain and seed (P-WRAP1, P-ARC1), §Screens B, §Round 5 (runs read as one model) (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U5WrapUp (intent-gated)
- **Δ3** 2026-10-12 · S3, S3b, S4, S5, S6, S8, S9a, S11, S12 · behavior-change
  Round 6: the six 30 Sep frames are rejected, not excluded, and J24's 28 Sep frame is a second Project-only reject; neither Project-only reject is offered. The Ha deep runs keep frames marked Unusable after their revisions.
  P-PREP2: `NGC7000-HOO-Siril` holds clones (`0 B extra · cloned`, frees no space), and the world keeps the Link to originals run `26 Sep symlink check` (J27/P6). Archive repoints its 35 symlinks with no reference-mode choice.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); §Input modes (user, 2026-10-10) P-PREP2 (@ d609ff55); user answers to the PR #1788 journey questions · by: JourneysV5.R6E (intent-gated)
- **Δ4** 2026-10-12 · S3, S3b, S4, S5, S11 · behavior-change
  P-PREP3: `NGC7000-HOO-Siril` and `26 Sep symlink check` hold symlinks (`Linked · 0 B`), so a Rejects row's size covers every offered frame, and Archive repoints the symlinks of both runs to the archived frames. Completing `NGC7000 HOO combine` unticks **Remove run view** so that Clean up runs still lists it.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c; research RUN-VIEWS-OPTIONS.md) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ5** 2026-10-12 · S4, S6, S11 · behavior-change
  P-TRASH2: an Unusable frame linked by another unfinished Project's View is refused; the review names links removed with moved frames.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 8 (user, 2026-10-12) P-TRASH2 · by: R8JourneysDocs (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S3, S3a, S3b, S4, S5, S6, S7, S9, S9a, S10, S11, S11a, S12, S12a · behavior-change
  Wrap up now opens only with no pending changes and proceeds Clean up → Trash → Archive; Close project… is Archive's Proceed. Closed and Archived Projects are locked for good with no Reopen or session restore; Duplicate… continues them.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 065 PRJ-FR-14 to PRJ-FR-16, PRJ-FR-25, PRJ-FR-30; 071 STO-FR-01 to STO-FR-08, STO-FR-13 · by: SpecF4Writer2 (intent-gated)
