---
id: J34
title: Mark a Project Done, trash its rejected frames and intermediates, archive it, and reopen it
version: 1
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, done-archive-sheet, storage, sessions, targets, home, run-workspace]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 067-frame-review, 071-storage-custody, 072-observing-plans, D19, D-W26, D-W42, D-W43, D-W46, D-W48, D-W52, D-W57, D-W64, D-W66, D-W69, D-W70, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/071-storage-custody/spec.md]
---

## Goal

The user finishes Project `NGC 7000 HOO`. First every open run is completed
or abandoned, then the Project is marked Done. From its Done / Archive sheet
the user moves the Project's library-Unusable frames and its processing
intermediates to the OS Trash and archives its sessions. Afterwards the
user puts one frame back and reopens the Project. Done means:
- Mark Done waited until no run was open.
- The trash offers covered only what they may cover: no Project-only reject, no refused frame, no accepted Result and no adopted master reached the Trash, and every refusal was listed with its reason. Nothing was permanently deleted.
- The Trashed frames counted nowhere and showed only under the Sessions "Trashed" filter and, marked "Trashed", in the Complete run's membership.
- Archive kept the session another open Project's run uses.
- Reopening returned the Project to open with its runs, goals and members unchanged, and it moved no file.

## Preconditions

- P1: Fresh replay of J23, J24, J26, J27/S1 to J27/S3, and J27/S12 to J27/S14. J25, J27/S4 to J27/S11, J27/P3 and J27/P6 are not run, so `NGC7000-HOO-Siril` still holds its 208 prepared hardlinks. The runs of Project `NGC 7000 HOO` are then:
  - `NGC7000-HOO-Siril`: Complete.
  - `28 Sep Ha copy check`: Complete.
  - `24 Sep flat check`: open.
  - `NGC7000 HOO combine`: not Complete.
- P2: From J22, `NGC7000-HOO-Siril` leaves out six 30 Sep frames. Five of them are library Unusable, and one is Rejected for this Project only, with library quality Unreviewed.
- P3: After J27/S2, two included 18 Sep frames of `NGC7000-HOO-Siril` were marked Unusable in the library. Their prepared hardlinks remain in `NGC7000-HOO-Siril/`.
- P4: An open Project `NGC 7000 Ha deep` (subject NGC 7000, rig RedCat) holds two runs:
  - `Ha deep v1` is Complete with member session 28 Sep. Its accepted Ha stack has Tool-recorded input lineage that names one 28 Sep frame, F-res.
  - `Ha deep` is open and Prepared, with member session 28 Sep. Its prepared revision explicitly includes one 28 Sep frame, F-prep.
  - F-res and F-prep are library Unusable.
- P5: The open Project `NGC 7000 SHO` from J26/P7 has 30 Sep as a candidate, and none of its runs includes 30 Sep.
- P6: `Scratch/Captures` is registered and indexed as a Captures location. It holds a byte copy of one of the five Unusable 30 Sep frames, F-dup. `Scratch` has no OS Trash.
- P7: The J27/P7 helper is available. F-drift, one of the other Unusable 30 Sep frames, is its target in S6. One registered intermediate is its target in S9.
- P8: `NGC7000-HOO-Siril Results/` holds 416 recognized intermediates from J26/P1 (208 calibrated and 208 registered).
- P9: A disposable writable volume `Archive` has free space for the Project's sessions.
- P10: The isolated account's Trash inventory is recorded as in J27/P4. So are a manifest of the Project's captures, of every file in `NGC7000-HOO-Siril Results/`, and of the adopted master, plus directory listings of `Astro-T7` and `Archive`.

## Steps

### S1 — Mark Done with open runs {#S1}

- **Do:** On the Project page of `NGC 7000 HOO`, choose **Mark Done**.
- **Expect:** PlateVault names `24 Sep flat check` and `NGC7000 HOO combine` as not Complete, and asks the user to complete or abandon each one. The Project stays open.
- **Expect (negative):** No Done / Archive sheet opens, and no file moves.
- **Trace:** PRJ-FR-14 · PRJ-AC-21 · D-W46

### S2 — Abandon the flat check run {#S2}

- **Do:** In the prompt, choose **Abandon** for `24 Sep flat check`.
- **Expect:** `24 Sep flat check` reads Abandoned and read-only. The prompt still names `NGC7000 HOO combine`, and the Project stays open.
- **Expect (negative):** Abandoning removes no file.
- **Trace:** PRJ-FR-14 · D-W46, D-W64

### S3 — Complete the last run and mark the Project Done {#S3}

- **Do:** Choose **Mark processing complete** for `NGC7000 HOO combine`, then choose **Mark Done** again.
- **Expect:**
  - The Project reads Done, and its Done / Archive sheet opens with three separate offers: **Archive**, `Move 6 rejected frames to Trash (size)` and `Move 416 processing intermediates to Trash (size)`.
  - Home lists the Project among its Projects only when **Show done** is on.
- **Expect (negative):** No file moves until the user approves an offer.
- **Trace:** Done / Archive sheet · PRJ-FR-14, PRJ-FR-15, PRJ-FR-20 · PRJ-AC-15 · STO-FR-13, STO-FR-14 · root FR-022 · D-W26, D-W46, D-W48, D-W70

### S4 — Read the rejected-frames offer {#S4}

- **Do:** Open the details of `Move 6 rejected frames to Trash (size)`.
- **Expect:**
  - The six offered frames are the two P3 18 Sep frames and four 30 Sep frames.
  - The size covers only the four 30 Sep frames. The two 18 Sep frames add 0 bytes, because their prepared hardlinks still hold their bytes.
  - Three frames are listed as refused, each with its reason:
    - F-prep: used in a prepared revision of run `Ha deep` in Project `NGC 7000 Ha deep`, which is not Complete.
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

- **Do:** Approve `Move 6 rejected frames to Trash` and read the review. With the P7 helper, overwrite F-drift in place. Then confirm. Afterwards, restore F-drift's saved bytes and mtime with the helper.
- **Expect:**
  - Progress shows per-frame outcomes. The summary names 5 frames moved, and F-drift refused with drift named and left in place.
  - The five moved files are newly in the OS Trash, and the library marks them Trashed.
- **Expect (negative):**
  - Nothing is permanently deleted.
  - No prepared hardlink in `NGC7000-HOO-Siril/` is moved.
  - F-prep, F-res, F-dup (both copies) and the Project-only reject remain at their paths.
- **Trace:** Done / Archive sheet · STO-FR-15 · STO-AC-19 · PRJ-FR-15 · PRJ-AC-17 · LIB-FR-18 · root SC-010 · D19, D-W43, D-W57

### S7 — Confirm the Trashed frames are hidden {#S7}

- **Do:** Read the 18 Sep and 30 Sep rows in Sessions and the Captured column of Target NGC 7000. Read the "captured" goal numbers of `NGC 7000 SHO`, start a run there and read its session picker, and open frame review on its 30 Sep candidate session. Open `NGC7000-HOO-Siril`'s fixed membership. Then rescan `Astro-T7/Captures`.
- **Expect:**
  - Sessions shows 2 fewer frames for 18 Sep and 3 fewer for 30 Sep.
  - Target NGC 7000's Captured falls by Ha 0h 10m and OIII 0h 15m.
  - In `NGC 7000 SHO`, OIII "captured" falls by 0h 15m, and the picker and frame review leave the three 30 Sep frames out.
  - `NGC7000-HOO-Siril`'s fixed membership still lists the two 18 Sep frames, marked "Trashed".
  - The rescan reports none of the five frames Missing.
- **Expect (negative):** No Trashed frame is offered by any picker, counted in any goal or total, measured or thumbnailed in frame review, or shown on Home.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-09, PRJ-FR-16 · VSEL-AC-25 · PIX-AC-19 · PLAN-TGT-FR-08 · D-W43, D-W52, D-W66

### S8 — Find the frames under the Trashed filter {#S8}

- **Do:** In Sessions, choose the **Trashed** filter.
- **Expect:** Exactly the five frames are listed, each with its last-observed metadata and the operation that trashed it.
- **Expect (negative):** F-drift, F-prep, F-res, F-dup and the Project-only reject are not listed.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · D-W43

### S9 — Move the processing intermediates to Trash {#S9}

- **Do:** On the sheet, approve `Move 416 processing intermediates to Trash` and read the review. With the P7 helper, overwrite one listed intermediate in place. Then confirm.
- **Expect:**
  - The review lists the 416 recognized intermediates in `NGC7000-HOO-Siril Results/`.
  - It lists as kept the accepted Ha and OIII stacks and the adopted master's retained generated source. The log and the unrecognized file are not offered.
  - The summary names 415 intermediates moved to the OS Trash, and the overwritten one refused with drift named and left in place.
- **Expect (negative):**
  - No accepted Result, adopted master, generated master source, log or unrecognized file reaches the Trash. Each still matches P10.
  - Nothing is permanently deleted.
- **Trace:** Done / Archive sheet · STO-FR-15 · CAL-FR-06, CAL-FR-07 · RES-FR-04 · D19, D-W43, D-W70

### S10 — Put one frame back {#S10}

- **Do:** In the OS Trash, put back one of the three trashed 30 Sep frames. Rescan `Astro-T7/Captures`.
- **Expect:** The frame returns as Unusable and leaves the Trashed filter, which now lists four frames. Target NGC 7000's OIII Captured rises by 0h 05m. The frame's history still shows its Trashed episode.
- **Expect (negative):** PlateVault offers no restore of its own, and the frame does not read Missing or ChangedContent.
- **Trace:** LIB-FR-18 · LIB-AC-19 · PRJ-FR-16 · PRJ-AC-17 · STO-FR-15 · D-W43

### S11 — Archive the Project {#S11}

- **Do:** On the sheet, choose **Archive** again, review it, and approve.
- **Expect:**
  - 18, 24, 26 and 30 Sep transfer to `Archive/NGC7000`. Every destination verifies before any source is retired, and the four sessions read Archived. The 30 Sep transfer includes the frame put back in S10.
  - 28 Sep stays at its path.
  - The memberships and totals of `Ha deep` and `Ha deep v1` are unchanged.
- **Expect (negative):** The four Trashed frames are not transferred, and no run's membership or exclusions change.
- **Trace:** Done / Archive sheet · STO-FR-07, STO-FR-13 · STO-AC-17 · root FR-011 · D-W26, D-W46 · G3

### S12 — Reopen the Project after Archive {#S12}

- **Do:** On the Project page, choose **Reopen**. Then list `Astro-T7` and `Archive` and compare them with the S11 result.
- **Expect:**
  - The Project reads open, and Home lists it again without **Show done**.
  - Its runs keep their states: `NGC7000-HOO-Siril`, `28 Sep Ha copy check` and `NGC7000 HOO combine` Complete, and `24 Sep flat check` Abandoned. Its goals and members are unchanged.
  - 18, 24, 26 and 30 Sep still read Archived, with a restore offer.
- **Expect (negative):** Reopening moves no file: both listings equal their state after S11. No Trashed frame returns.
- **Trace:** PRJ-FR-14, PRJ-FR-20 · PRJ-AC-21 · D-W46, D-W69

## Success criteria

- SC1: Mark Done opens the sheet 0 times while a run is open (S1, S2). It opens exactly once after every run is Complete or Abandoned (S3).
- SC2: The rejected-frames offer counts exactly 6 frames, lists exactly 3 refusals with reasons, and includes 0 Project-only rejects (S4).
- SC3: Exactly 5 frames reach the OS Trash. 0 refused or drifted frames, 0 prepared entries and 0 files are permanently deleted (S6).
- SC4: The Trashed frames appear in 0 pickers, candidate lists, frame reviews, goals or totals. They show only under the Trashed filter (5 frames) and, marked "Trashed", in `NGC7000-HOO-Siril`'s membership (2 frames) (S7, S8).
- SC5: Exactly 415 intermediates reach the OS Trash, and 0 accepted Results, adopted masters or master sources do (S9).
- SC6: Put back plus rescan returns 1 frame as Unusable, and the Trashed filter then lists 4 (S10).
- SC7: Archive keeps 28 Sep and transfers 4 sessions, including 30 Sep, which is only another Project's candidate (S5, S11).
- SC8: Reopen after Archive moves 0 files and changes 0 run states, goals or members (S12).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, decision D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Unresolved product question: D-W64, D-W69 and D-W70 have no spec requirement yet. The specs do not say:
  - whether an Abandoned run with a prepared revision triggers the "not Complete" trash refusal;
  - which files count as "processing intermediates" beyond the recognized intermediates in a run's Results folder;
  - what the restore offer for Archived sessions does after Reopen.
  S2, S9 and S12 follow the decisions alone. Blocks readiness.
- G3: Out of scope for this journey: archive transfer failures, interruption and reference repair are J28's. J28 forks from S5. Blocks readiness until J28 covers them.
- G4: Unresolved implementation qualification: P4 needs Tool-recorded input lineage from a processing tool for F-res. No profile has qualified how that evidence is captured. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
