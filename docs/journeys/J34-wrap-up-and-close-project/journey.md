---
id: J34
title: Wrap up and close a Project after trashing rejected frames and Processing files
version: 7
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, wrap-up, archive, sessions, targets, home, view-review, locations, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, 068-calibration-inputs, 070-results-reuse, 071-storage-custody, 072-observing-plans, D19, D-W26, D-W79, D-W43, D-W97, D-W52, D-W78, D-W57, D-W96, D-W74, D-W77, D-W80, D-W81, P-WRAP1, P-ARC1, P-TRASH2, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S2, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S8, HARNESS-V5-IA.md#S9, HARNESS-V5-IA.md#S16, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#b-projects, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#input-modes-user-2026-10-10-research-designinput-modes-researchmd, HARNESS-V5-FEEDBACK-R1.md#round-8-user-2026-10-12, D-W93, D-W94, D-W98, D-W100, PRJ-FR-14, PRJ-FR-15, PRJ-FR-16, PRJ-FR-25, PRJ-FR-30, PRJ-FR-32, STO-FR-01, STO-FR-06, STO-FR-07, STO-FR-08, STO-FR-13, STO-FR-14, STO-FR-15, STO-FR-16, VSEL-FR-12, LIB-FR-18, D-W112]
---

## Goal

The user wraps up Project `NGC 7000 HOO` after its View changes have been applied, and closes it. Done means:
- Wrap up opens only when no Project change is pending and offers Clean up → Trash → Archive in order.
- The user skips Clean up, so the Project's Symlinks View stays in place.
- Trash moves the rejected frames, the `Processing/` files and the duplicate copies to the OS Trash.
- **Close project…**, Archive's Proceed, transfers 18, 24, 26 and 30 Sep to `Archive/NGC7000`. 28 Sep stays on `Astro-T7` because another open Project holds it.
- Sources retire only after the destination and affected references verify, and the View's symlinks follow the archived sessions.
- `Output/` is kept, and the Project reads Archived after the transfer succeeds.
- The Archived Project is locked for good: no Reopen, no restore of archived sessions, and no library or calibration change reaches it. **Duplicate…** is the way to continue it.

## Preconditions

- P1: Project `NGC 7000 HOO` is open and holds the sessions 18, 24, 26, 28 and 30 Sep. It has no pending changes and no PlateVault operation is running on it. Its View was built by its last Apply in Symlinks mode and holds a symlink to each frame its sessions include, among them 35 symlinks to the 35 frames of 26 Sep. No `View (previous)/` remains. `Output/` holds two Results.
- P2: Library quality is the only quality scope. Five 30 Sep frames have library quality Unusable, among them F-drift and F-dup, and one 30 Sep frame is Unreviewed. The fixture records each Unusable frame's channel and exposure.
- P3: Two 18 Sep frames were marked Unusable in the library while the View held them. The Project applied the resulting Library removals (VSEL-FR-12, VSEL-FR-15), so its View holds no entry for any of its library-Unusable frames.
- P4: The 28 Sep frames F-res, F-prep and F-ab have library quality Unusable. Open Project `NGC 7000 Ha deep` holds 28 Sep. Its View still holds a symlink to F-prep, because its Library removal of F-prep is pending and not yet Applied; it holds no entry for F-res or F-ab. No Result lineage is recorded or used to decide whether a frame may be trashed.
- P5: Open Project `NGC 7000 SHO` has 18, 28 and 30 Sep only as suggestions and holds none of them.
- P6: `Scratch/Captures` is registered and indexed as a Captures location after `Astro-T7/Captures`. It holds a byte copy of F-dup. `Scratch` has no OS Trash.
- P7: A helper outside PlateVault saves a named file's bytes and nanosecond mtime. It overwrites the file in place with a same-size variant whose bytes differ and restores the saved mtime, and it can later restore the saved bytes and mtime. Its targets are F-drift in S6 and one `Processing/WBPP/` file in S9.
- P8: `Processing/WBPP/` holds 416 tool files and the generated source of the master flat adopted into `Astro-T7/Calibration`.
- P9: A disposable writable volume `Archive` has free space for the Project's sessions. Settings › Locations lists two archive locations on it, registered before S1: `Archive/NGC7000`, marked Default, and `Archive/Long-term`.
- P10: The isolated account's OS Trash inventory is recorded. So are manifests of the Project's captures, `Processing/`, `Output/` and the adopted master, plus directory listings of `Astro-T7`, `Backup`, `Archive` and the Views of `NGC 7000 HOO` and `NGC 7000 Ha deep`.
- P11: Volume `Backup`, which has an OS Trash, holds `Backup/Captures`, registered and indexed as a Captures location after `Astro-T7/Captures`. It holds byte copies of two 24 Sep frames, D-1 and D-2, and no other file.

## Steps

### S1 — Open Wrap up with no pending changes {#S1}

- **Do:** On the Project page of `NGC 7000 HOO`, read its steps and pending count, then open Wrap up.
- **Expect:** The page shows the steps Sessions, Calibrate, View, Output and Wrap up, and 0 changes pending. Wrap up opens at Clean up because no change is pending and no operation runs on the Project. It lists Clean up → Trash → Archive in order, and Trash and Archive stay read-only until the steps before them are Finished or Skipped. Archive's Proceed is **Close project…**.
- **Expect (negative):** No file moves, and no Wrap up step records Finished or Skipped. The page has no stage rail, no run list and no Project Trash list.
- **Trace:** HARNESS-V5-IA.md S3, S9 · P-WRAP1 · PRJ-FR-07, PRJ-FR-14, PRJ-FR-32 · PRJ-AC-21 · D-W80, D-W97

### S2 — Inspect the Wrap up Trash step {#S2}

- **Do:** Read the Trash step's three groups: rejected frames, `Processing/` files and duplicate copies.
- **Expect:** Each group shows its offer with an item count and a size, and lists every item it refuses with the reason. Trash is the only step that offers moving capture frames, `Processing/` files or duplicate copies to the OS Trash.
- **Expect (negative):** Reading the Trash step moves no file and changes no frame's library quality, and no Project's sessions or goals.
- **Trace:** HARNESS-V5-IA.md S3, S8 · PRJ-FR-14, PRJ-FR-15 · PRJ-AC-15 · STO-FR-14, STO-FR-16 · root FR-009, FR-022 · D-W43, D-W80

### S3 — Review Wrap up offers and order {#S3}

- **Do:** Read the Wrap up step table, each step's counts and sizes, and the Project's row in Home's Open work.
- **Expect:**
  - Wrap up lists three steps in order, each with its state and its size: 1 Clean up, current; 2 Trash; 3 Archive.
  - Clean up offers removing the Project's View. Because the View is in Symlinks mode, that row starts unticked, and it lists the links PlateVault placed with their count. It lists no `View (previous)/` entry.
  - Trash reads "Move 8 rejected frames to Trash (size)", "Move 417 processing files to Trash (size)" and "Move 2 duplicate copies to Trash (size)". The 417 are the 416 P8 tool files and the adopted master's generated source. The 2 are the P11 copies of D-1 and D-2.
  - Archive reads 4 sessions to move, and its Destination preselects `Archive/NGC7000`, marked Default.
  - Home's Open work lists the Project with its next step and 0 changes pending. Its next step never reads Wrap up.
- **Expect (negative):** No file moves until the user proceeds and confirms a step. No Project Trash, Empty Trash or Empty Trash group exists.
- **Trace:** HARNESS-V5-IA.md S1, S2, S3, S9 · P-WRAP1, P-ARC1 · PRJ-FR-14, PRJ-FR-15, PRJ-FR-18, PRJ-FR-32 · PRJ-AC-15, PRJ-AC-28, PRJ-AC-30 · STO-FR-01, STO-FR-13, STO-FR-14, STO-FR-16 · STO-AC-01 · root FR-021, FR-022 · D-W26, D-W46, D-W70, D-W74, D-W80, D-W97

### S3a — Confirm there is no Project Trash {#S3a}

- **Do:** Return to the Project page and look through its steps, menu and Wrap up for a Project Trash page or an Empty Trash action.
- **Expect:** No Project Trash page, Trash list or Empty Trash action is offered. Wrap up's Trash step remains the only offer for rejected frames, `Processing/` files and duplicate copies.
- **Expect (negative):** No file moves, and the OS Trash inventory gains no entry. No frame's library quality changes, and every Wrap up step keeps its state, size and counts.
- **Trace:** HARNESS-V5-IA.md S8 · PRJ-FR-15, PRJ-FR-32 · STO-FR-14, STO-FR-17 · root FR-009 · D-W94, D-W97

### S3b — Skip Clean up, reopen it and skip again {#S3b}

- **Do:** In Wrap up, choose **Proceed** on Clean up with nothing selected. Reopen Clean up from the step strip and choose **Proceed** with nothing selected again. Inspect the Project's View.
- **Expect:**
  - Proceeding with nothing selected records Clean up as Skipped and makes Trash current. Reopened, Clean up shows the View row still unticked, and proceeding again records Skipped.
  - The Project's View is unchanged: it still holds every symlink of P1.
- **Expect (negative):** Neither Proceed moves or deletes a file or starts a Clean up operation.
- **Trace:** HARNESS-V5-IA.md S9 · P-WRAP1 · PRJ-FR-14 · STO-FR-01 · STO-AC-01 · D-W77, D-W80, D-W97 · G7

### S4 — Read the rejected-frames offer {#S4}

- **Do:** In the Trash step, expand the rejected-frames row and read its files and the items it lists as not selectable.
- **Expect:**
  - The row lists the eight offered frames: the two P3 18 Sep frames, the four 30 Sep frames other than F-dup, and F-res and F-ab. F-res is offered because PlateVault records no Result lineage, and an `Output/` file is no custody reason. F-ab is offered because no other Project's View links it.
  - The size covers the bytes of all eight frames.
  - Two frames are listed as not selectable, each with its reason:
    - F-prep: "Linked by NGC 7000 Ha deep ▸", which leads to that Project's pending change.
    - F-dup: its `Scratch` copy sits on a location with no OS Trash, so the whole frame is refused.
- **Expect (negative):** The Unreviewed 30 Sep frame and every library-Usable frame are neither counted nor listed. Expanding the row moves no file and changes no View, and the row still reads 8 frames.
- **Trace:** HARNESS-V5-IA.md S9 · HARNESS-V5-FEEDBACK-R1.md Copy rules, §Round 6 ("Reject is library-wide by default"), §Round 8 P-TRASH2 · PRJ-FR-14, PRJ-FR-15 · PRJ-AC-16 · STO-FR-14, STO-FR-15 · STO-AC-18 · root FR-021 · D-W42, D-W43, D-W57, D-W79, D-W93 · J44/S1

### S5 — Read the Archive step {#S5}

- **Do:** Read the Archive step while Trash is still current: its Destination, its counts and the disclosure of its kept session. Expand the 30 Sep row.
- **Expect:**
  - Destination lists the two P9 archive locations, with `Archive/NGC7000` preselected and marked Default.
  - The step lists the Project's sessions 18, 24, 26, 28 and 30 Sep. 18, 24, 26 and 30 Sep are selected. 28 Sep is not selectable, and its status names open Project `NGC 7000 Ha deep`, which holds it.
  - The expanded 30 Sep row lists each file with its from path under `Astro-T7/Captures` and its to path under `Archive/NGC7000`, laid out by the naming templates. The step also shows bytes, source identities, affected Projects and the View references to repoint: each View symlink to a selected session's frame is proposed to follow that frame to its `Archive/NGC7000` path.
  - 30 Sep is selected even though open Project `NGC 7000 SHO` suggests it.
- **Expect (negative):** **Close project…** is not available while Trash is neither Finished nor Skipped. Nothing transfers, and no Project's sessions or totals change.
- **Trace:** HARNESS-V5-IA.md S9, S16 · P-ARC1 · PRJ-FR-14 · STO-FR-06, STO-FR-13 · STO-AC-17 · root FR-011 · D-W26, D-W46, D-W77, D-W80 · HARNESS-V5-FEEDBACK-R1.md §Input modes ("a symlinked entry is repointed when its session moves")

### S6 — Move the rejected frames to Trash {#S6}

- **Do:** In the Trash step, leave only the rejected-frames row selected and choose **Proceed**. Before confirming, overwrite F-drift in place with the P7 helper. Confirm the move. Afterwards, restore F-drift's saved bytes and mtime with the helper.
- **Expect:**
  - Progress shows per-frame outcomes. The summary names 7 frames moved, and F-drift refused with drift named and left in place.
  - The seven moved files are newly in the OS Trash, and the library marks them Trashed.
- **Expect (negative):**
  - Nothing is permanently deleted.
  - No View entry of `NGC 7000 HOO` or `NGC 7000 Ha deep` is moved or changed, and `NGC 7000 Ha deep`'s View still links F-prep.
  - F-prep, F-dup (both copies) and the Unreviewed 30 Sep frame remain at their paths.
- **Trace:** HARNESS-V5-IA.md S9 · PRJ-FR-15 · PRJ-AC-17 · STO-FR-14, STO-FR-15 · STO-AC-19 · LIB-FR-18 · root SC-010 · D19, D-W43, D-W57

### S7 — Confirm the Trashed frames are hidden {#S7}

- **Do:** Read the 18, 28 and 30 Sep rows in Sessions and the Captured column of Target NGC 7000. Read the "captured" goal numbers of `NGC 7000 SHO` and its suggestions, the session list of `NGC 7000 HOO`, and the Review step of the 30 Sep session. Rescan `Astro-T7/Captures`.
- **Expect:**
  - Sessions shows 2 fewer frames for 18 Sep, 2 fewer for 28 Sep and 3 fewer for 30 Sep.
  - Target NGC 7000's Captured falls, per channel, by exactly the exposure P2 records for the seven moved frames, and so do the "captured" numbers of `NGC 7000 SHO`'s goals.
  - The sessions of `NGC 7000 HOO` and the suggestions of `NGC 7000 SHO` leave the seven Trashed frames out. The 30 Sep Review step lists none of the three Trashed 30 Sep frames.
  - The rescan reports none of the seven frames Missing.
- **Expect (negative):** No Trashed frame is offered in a suggestion, counted in any goal or total, measured or thumbnailed in a Review step, or shown on Home. `NGC 7000 Ha deep` lists no Trashed frame.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-09, PRJ-FR-16 · PRJ-AC-17 · PIX-AC-19 · PLAN-TGT-FR-08 · root FR-021 · D-W43, D-W52, D-W66

### S8 — Find the frames under the Trashed filter {#S8}

- **Do:** In Sessions, choose the **Trashed** filter.
- **Expect:** Exactly the seven frames are listed, each with its last-observed metadata and the operation that trashed it.
- **Expect (negative):** F-drift, F-prep, F-dup and the Unreviewed 30 Sep frame are not listed.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · D-W43

### S9 — Move the Project's Processing files to Trash {#S9}

- **Do:** Reopen the Trash step from the step strip. Select only the `Processing/` row, expand it and read its files. With the P7 helper, overwrite one listed `Processing/WBPP/` file in place. Then choose **Proceed** and confirm.
- **Expect:**
  - The row lists the 416 files in `Processing/WBPP/` and the adopted master's generated source, listed as a verified duplicate that names the kept library copy in `Astro-T7/Calibration`.
  - It keeps the two Results in `Output/` and the adopted library master. No file outside `Processing/` is offered.
  - The summary names 416 items moved to the OS Trash under that one confirmation: 415 tool files and the generated source. The overwritten file is refused with drift named and left in place.
- **Expect (negative):**
  - No Result in `Output/`, adopted library master or file outside the reviewed `Processing/` offer reaches the Trash. Each still matches P10.
  - Nothing is permanently deleted.
- **Trace:** HARNESS-V5-IA.md S9 · PRJ-FR-14, PRJ-FR-15 · PRJ-AC-28, PRJ-AC-31 · STO-FR-15, STO-FR-16 · STO-AC-21 · CAL-FR-06, CAL-FR-07 · RES-FR-01, RES-FR-06 · root FR-021 · D19, D-W43, D-W70, D-W98

### S9a — Move the duplicate copies to Trash {#S9a}

- **Do:** Reopen the Trash step, select only the duplicate-copies row, expand it and read its copies. Choose **Proceed** and confirm. Then read the Trash step, the 24 and 30 Sep rows in Sessions and the copies listed for D-1, D-2 and F-dup.
- **Expect:**
  - The row lists the `Backup/Captures` copies of D-1 and D-2. Each names its kept copy in `Astro-T7/Captures`, the Captures location registered first.
  - It lists the `Scratch/Captures` copy of F-dup as not selectable, because `Scratch` has no OS Trash.
  - After confirming, both `Backup` copies are newly in the OS Trash. D-1 and D-2 each list one copy, in `Astro-T7/Captures`, and F-dup still lists two.
  - Sessions shows the same 24 Sep and 30 Sep frame counts as at S7, and Target NGC 7000's Captured is unchanged.
  - Trash reads Finished, and Archive is current.
- **Expect (negative):** No kept copy, View entry, Trashed frame or F-dup copy moves. The Trashed filter still lists exactly the seven frames, and nothing is permanently deleted. The adopted master's generated source, which S9 moved, is not listed.
- **Trace:** HARNESS-V5-IA.md S9 · PRJ-FR-14, PRJ-FR-15 · PRJ-AC-30 · STO-FR-15, STO-FR-16 · STO-AC-23 · root FR-021 · D19, D-W43, D-W74

### S10 — Put one frame back {#S10}

- **Do:** In the OS Trash, put back one of the three trashed 30 Sep frames. Rescan `Astro-T7/Captures`.
- **Expect:** The frame returns as Unusable and leaves the Trashed filter, which now lists six frames. Target NGC 7000's Captured rises, in that frame's channel, by exactly the exposure P2 records for it. The frame's history still shows its Trashed episode.
- **Expect (negative):** PlateVault offers no restore of its own, and the frame does not read Missing or ChangedContent.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · PRJ-AC-17 · STO-FR-15 · D-W43

### S11 — Close the Project through Archive {#S11}

- **Do:** In the Archive step, review the selected sessions, their from and to paths and the reference changes. Choose **Close project…**, read its confirmation and confirm.
- **Expect:**
  - The confirmation lists the four archive moves and the outcomes of Clean up (Skipped) and Trash (Finished).
  - 18, 24, 26 and 30 Sep transfer to `Archive/NGC7000`. Every destination verifies before any source is retired, and the four sessions read Archived. The 30 Sep transfer includes the frame put back in S10.
  - Each View symlink to a transferred frame now points at that frame's `Archive/NGC7000` path, among them all 35 symlinks to the 26 Sep frames. The View's 28 Sep symlinks still point under `Astro-T7/Captures`.
  - 28 Sep stays at its path, and the sessions and totals of `NGC 7000 Ha deep` are unchanged.
  - The Project reads Closing while the transfer runs and Archived after every selected item succeeds. Its Wrap up is then read-only.
- **Expect (negative):** Trashed frames are not transferred, and the Project's sessions do not change. No View symlink changes kind, and no reference-mode choice is offered. Close offers no Reopen.
- **Trace:** HARNESS-V5-IA.md S9 · P-WRAP1, P-ARC1 · PRJ-FR-14 · PRJ-AC-31 · STO-FR-06, STO-FR-07, STO-FR-13 · STO-AC-17 · root FR-011 · D-W26, D-W46, D-W80, D-W97 · HARNESS-V5-FEEDBACK-R1.md §Input modes ("a symlinked entry is repointed when its session moves") · G3

### S11a — Inspect the Archived Project record {#S11a}

- **Do:** After Close succeeds, inspect the Project header, menu, Wrap up tab, View, `Output/`, Home and the Projects list.
- **Expect:**
  - The header reads Archived, `Output/` keeps its two Results, and the menu offers only Duplicate….
  - The Wrap up tab is a read-only record of each step's outcome: Clean up Skipped, Trash Finished and Archive Finished. It offers no **Proceed**, and no step can be reopened.
  - Home's Open work does not list the Project, and the Projects list shows it Archived.
- **Expect (negative):** Close moves no file in `Output/` and does not change the Project's sessions or goals. No Reopen is offered.
- **Trace:** HARNESS-V5-IA.md S1, S2, S3, S9 · P-WRAP1 · PRJ-FR-14, PRJ-FR-25 · PRJ-AC-21, PRJ-AC-22, PRJ-AC-34 · RES-FR-06 · D-W80, D-W97

### S12 — Confirm the Archived Project is locked {#S12}

- **Do:** On the Archived Project page, inspect its menu, Edit… control, Wrap up, goals, sessions and View. In Sessions, change the library quality of one 24 Sep frame, and on the 24 Sep session's calibration choose No darks. Return to the Project.
- **Expect:**
  - Edit… is disabled with "Project closed · Duplicate ▸", and the menu offers no Reopen or restore action.
  - The Project still reads Archived, and its Wrap up record is read-only. Its View and `Output/` remain available for inspection, and **Open in {app}** still opens the kept View.
  - Its sessions and goals show the figures frozen at Close, and its calibration for 24 Sep is the one recorded at Close.
  - Its sessions list the six frames still Trashed, marked "Trashed".
  - The Project page lists 18, 24, 26 and 30 Sep as Archived at their `Archive/NGC7000` paths, with no Restore action.
  - **Expect (negative):** The quality change and the No darks choice add no pending change to the Archived Project and change none of its figures. No Reopen or restore action is available.
- **Trace:** HARNESS-V5-IA.md S3, S9 · PRJ-FR-16, PRJ-FR-25 · PRJ-AC-27, PRJ-AC-34 · LIB-AC-30 · CAL-FR-05 · VSEL-FR-12 · STO-FR-13 · D-W69, D-W97, D-W106

### S12a — Duplicate the Archived Project to continue {#S12a}

- **Do:** On the Archived Project, choose **Duplicate…**, keep its sessions, groups and overrides, goals, notes and settings ticked, and confirm. Open the new Project's View step.
- **Expect:** The duplicate is a new open Project that holds 18, 24, 26, 28 and 30 Sep in the same groups, with the same overrides, goals, notes and settings. Its archived sessions are at their `Archive/NGC7000` paths. Its 24 Sep session uses the session's current calibration, No darks as chosen in S12, while the Archived Project still shows the darks recorded at Close. It has no View until its first Apply, which needs `Archive` online.
- **Expect (negative):** No file is copied, and the duplicate shows no "Duplicated from" note or link to the original. The duplicate takes nothing from the original's Close snapshot. The original remains Archived and locked, and editing the duplicate never changes it.
- **Trace:** HARNESS-V5-IA.md S3, S9 · PRJ-FR-25, PRJ-FR-30 · PRJ-AC-27, PRJ-AC-43 · STO-AC-07 · D-W93, D-W96, D-W97, D-W112 · G5

## Success criteria

- SC1: Wrap up opens with no pending Project changes and lists Clean up → Trash → Archive in order; Archive's Proceed is Close project… (S1, S3, S11). No Project Trash page, Empty Trash action or Empty Trash group exists (S2, S3a).
- SC2: The rejected-frames offer counts exactly 8 frames and lists exactly 2 refusals with reasons, F-prep's naming `NGC 7000 Ha deep`. It includes 0 Unreviewed or Usable frames (S4).
- SC3: Exactly 7 frames reach the OS Trash. 0 refused or drifted frames and 0 View entries move, and 0 files are permanently deleted (S6).
- SC4: The Trashed frames appear in 0 suggestions, Review steps, goals or totals of an open Project. They show only under the Trashed filter (7 frames) (S7, S8) and, marked "Trashed", in the Archived Project that held them (S12).
- SC5: Exactly 415 tool files and 1 generated source, listed as a verified duplicate of the kept library copy, reach the OS Trash. 0 Results in `Output/` and 0 adopted library masters do (S9).
- SC6: Put back plus rescan returns 1 frame as Unusable, and the Trashed filter then lists 6 (S10).
- SC7: Archive goes to `Archive/NGC7000`, the Default archive location, keeps 28 Sep and transfers 4 sessions, including 30 Sep, which is only another Project's suggestion (S5, S11).
- SC8: Close transfers the selected sessions only after destination and reference verification, keeps `Output/`, and leaves the Project Archived and locked. Duplicate… creates an independent open Project without copying files, and its 24 Sep session uses the current No darks choice, not the Close snapshot (S11, S11a, S12, S12a).
- SC9: The duplicate-copies offer counts exactly 2 copies and lists 1 refusal. Exactly 2 copies reach the OS Trash, and every frame keeps at least 1 copy (S3, S9a).
- SC10: Skipping Clean up twice moves 0 files, and the Project's View keeps every symlink (S3b).
- SC11: The Project reads Closing during Archive's transfer and Archived after it succeeds. The Archived Project offers 0 Reopen or Restore actions, takes 0 pending changes from the library or calibration, and offers Duplicate… (S11, S11a, S12, S12a).
- SC12: After Archive, every View symlink to a transferred frame, including 35 of 35 to the 26 Sep frames, points at its `Archive/NGC7000` path. 0 View entries change kind, and 0 reference-mode choices are offered (S11).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design: HARNESS-V5-IA.md S1, S2, S3, S8, S9 and S16, and HARNESS-V5-FEEDBACK-R1.md P-WRAP1, P-ARC1, Screens B and Round 5 (ui-harness-v5 @ b5e813a5), Round 6 (@ 4f470775) and Round 8 P-TRASH2. It also follows the specs, decision D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G3: Out of scope for this journey: archive transfer failures, interruption and a symlink that cannot be repointed are J28's. J28 forks from S5. Blocks readiness until J28 covers them.
- G4: (dissolved 2026-10-15): D-W93 puts Result lineage and provenance out of scope, so no input-to-Result relationship is recorded and F-res needs no tool-recorded lineage.
- G5: (dissolved 2026-10-15): D-W97 removes Reopen, so there is no restore of an archived session after Close; sessions stay at their archive paths (PRJ-FR-25, STO-FR-13).
- G6: (dissolved 2026-10-15): PRJ-FR-18 gives a Project's next step no Wrap up rule, so S3 asserts that Next never reads Wrap up.
- G7: Out of scope for this journey: approving Clean up's View removal is not exercised, because S3b skips it so that the View's symlinks remain for Archive to repoint. J27 covers View removal.
- G8: (dissolved 2026-10-12): answered by Round 8 P-TRASH2. S4 refuses F-prep while the View of open Project `NGC 7000 Ha deep` links it. The Project's own View holds no link to its library-Unusable frames once their Library removals are applied (P3), so S6 moves no View entry.
- G9: Rests on provisional F4 copy, pending the owner's confirmation in PR #1804: "Project closed · Duplicate ▸" (PRJ-FR-25, S11a), "Move N processing files to Trash (size)" (PRJ-FR-15, S4 to S6) and the Clean up offer with Copies ticked and Symlinks unticked (D-W97, S3b). If the owner changes them, those steps change.

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
  P-TRASH2: F-prep is refused as `Can't trash 1 · linked by Ha deep ▸`, because the view of that unfinished run links it. The Rejects review reads "Also removes 4 links in kept run views", and the move takes those links of `NGC7000-HOO-Siril` and `Ha deep v1` to the OS Trash with their frames.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 8 (user, 2026-10-12) P-TRASH2 (apps/prototype/design/ on ui-harness-v5) · by: R8JourneysDocs (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S3, S3a, S3b, S4, S5, S6, S7, S8, S9, S9a, S10, S11, S11a, S12, S12a · behavior-change
  Wrap up opens only with no pending changes and proceeds Clean up → Trash → Archive, each step confirmed with Proceed; Close project… is Archive's Proceed. The Project's single Symlinks View replaces the run views, so the Trash offer refuses only frames another open Project's View links, and Archive repoints that View.
  Closed and Archived Projects are locked for good with no Reopen or session restore, and library or calibration changes never reach them; Duplicate… continues them.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 065 PRJ-FR-14 to PRJ-FR-16, PRJ-FR-18, PRJ-FR-25, PRJ-FR-30, PRJ-FR-32; 066 VSEL-FR-12; 071 STO-FR-01, STO-FR-06 to STO-FR-08, STO-FR-13 to STO-FR-16 · by: SpecF4Writer2, SpecF4Writer3 (intent-gated)
- **Δ7** 2026-10-16 · S12a · behavior-change
  Duplicate uses each session's current calibration pins, not the original's Close snapshot, so the duplicate's 24 Sep reads the No darks choice made after Close.
  Evidence: D-W112 (owner's answers of 2026-10-15/16) in PR #1804, PRJ-FR-30, PRJ-AC-43, FR-036 · by: SpecF4Answers (intent-gated)
