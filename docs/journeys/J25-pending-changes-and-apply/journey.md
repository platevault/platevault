---
id: J25
title: Add sessions and apply Project View changes
version: 8
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [projects, sessions, indexing, locations, preparation, applications, duplicates, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 069-application-handoff, 070-results-reuse, 071-storage-custody, D02, D08, D09, D16, D19, D-W96, D-W100, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-g-refresh-an-existing-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S12, HARNESS-V5-FEEDBACK-R1.md#round-5, P-STO2, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-PREP3, 068-calibration-inputs, D-W93, D-W94, D-W95, D-W98, D-W99, D-W101, D-W105, D-W106, specs/068-calibration-inputs/spec.md, D-W109, D-W110]
---

## Goal

After two Ready sessions arrive, the user sees them as Project suggestions, adds the Ha session but not the OIII session, and sees its ten frames as a pending change. The user reviews a calibration reassignment and group split in the Apply sheet, then applies a fresh View built from originals. Until Apply succeeds, the existing View remains unchanged. Duplicate physical copies count once; a changed duplicate needs review and is not moved.

Done means: the Project shows the addition, group and calibration changes as pending; the Apply sheet names every change, shows the new folder tree, reports an offline original if one is unavailable, and gives tick boxes for files PlateVault did not place. Apply builds from originals, installs the complete View, and leaves changed copies and unticked files in `View (previous)/` rather than deleting them.

## Preconditions

- P1: J24 completed: Project `NGC 7000 HOO` has 208 light frames in `Work/Processing/NGC 7000 HOO/View/`, in Copies mode, with its 28 Sep session in group `RedCat · 2`. A listing of the View entries is recorded outside PlateVault.
- P2: Two new RedCat sessions with confirmed Target NGC 7000, reviewed frames and settled, pinned calibration are available to index: one Ha session and one OIII session, each with 10 lights of 300 s, captured after 30 Sep.
- P3: Every frame in the new Ha session also has a byte-identical copy in registered location `Spare`; one named `Spare` copy has a same-size variant with different bytes kept outside PlateVault.
- P4: The Project holds the 18 Sep session, whose original is on the `Astro-T7` location and can be made offline and restored.
- P5: One named copy in the current View can be changed in place and restored from a backup. The View also contains a DSS `.Info.txt` file and a user note that PlateVault did not place.
- P6: `Astro-T7` can be mounted and unmounted. On Windows, a fixture can hold a current View file in use and release it on demand.

## Steps

### S1 — Index and add the new Ha session {#S1}

- **Do:** Index both P2 sessions and `Spare/Captures`, then open Project `NGC 7000 HOO` and add only the Ha session through **Add sessions…**.
- **Expect:** Sessions lists both Ready, settled sessions as suggestions with their Target and rig reasons. The Project's Ha and OIII captured values each rise by 0h 50m. Every Ha frame lists copies in `Astro-T7` and `Spare`; one automatic warning lists `10 duplicate copies · <bytes>`. The Ha session is added once, and the OIII session remains a suggestion.
- **Expect (negative):** Neither suggestion is added automatically. The duplicate scan changes no source or file location; the Project counts each logical capture once.
- **Trace:** PRJ-FR-08, PRJ-FR-09 · VSEL-FR-03, VSEL-FR-08, VSEL-FR-15 · LIB-FR-08 · D-W96, D-W105

### S2 — Make a held original unavailable {#S2}

- **Do:** Unmount `Astro-T7` and inspect the 18 Sep session in Project Sessions.
- **Expect:** The held session remains in the Project and is marked Unavailable with its last-observed counts. Its current View is unchanged.
- **Expect (negative):** The session is not silently removed, and last-observed counts are not reported as verified.
- **Trace:** VSEL-FR-09, VSEL-FR-12 · D-W94, D-W100

### S2a — Re-confirm a held session's Target {#S2a}

- **Do:** In Sessions, confirm IC 5070 as the Target for 26 Sep, then inspect the Project's Sessions step.
- **Expect:** The Project still holds 26 Sep in its group and shows the newly confirmed Target and its evidence. The OBJECT header remains only a label and assigns no Target.
- **Expect (negative):** A Target change does not remove the held session or alter source bytes.
- **Trace:** VSEL-FR-12 · VSEL-AC-24 · D-W94, D-W96

### S2b — Reassign pinned calibration {#S2b}

- **Do:** Use **Reassign…** on one held session to choose another compatible flat set.
- **Expect:** The session shows the new pinned assignment. The open Project lists a pending calibration change labelled as a session reassignment.
- **Expect (negative):** Reassignment does not change the current View before Apply or change a Closed or Archived Project.
- **Trace:** LIB-FR-25 · CAL-FR-05, CAL-FR-09 · VSEL-FR-12 · D-W101, D-W106

### S3 — Split a group and move the new session {#S3}

- **Do:** In Project Sessions, split the RedCat group and move the added Ha session into the new group. Keep the suggested group name `RedCat · 2`.
- **Expect:** The Project lists the new group and the Ha session's new group. The group creation and move appear as pending changes.
- **Expect (negative):** The current View's folder tree and contents do not change before Apply.
- **Trace:** PRJ-FR-31 · VSEL-FR-12 · D-W95, D-W100

### S4 — Inspect pending Project changes {#S4}

- **Do:** Open Sessions and the View step and inspect the pending-change rows. Try to discard the calibration reassignment row.
- **Expect:** Rows name the added Ha session, the group move and the calibration reassignment and identify the source of each change. The added session and the group move offer Discard. The calibration reassignment offers no Discard: its row says it came from the session's calibration, links to that session, and offers Remove session from Project. The View step shows the pending-change count and **Apply…**.
- **Expect (negative):** The View remains byte-for-byte as listed in P1 until Apply. The unselected OIII suggestion stays out of the Project. Trying to discard the reassignment changes neither the session's pinned flats nor the pending changes.
- **Trace:** VSEL-FR-12, VSEL-FR-16 · VSEL-AC-33 · D-W100, D-W109

### S5 — Review the Apply sheet {#S5}

- **Do:** Re-confirm NGC 7000 for 26 Sep, then open **Apply…** and inspect the changes and folder tree.
- **Expect:** The sheet lists the 10 Ha frames added, the group move with its from and to names, the calibration reassignment and its source, and the changed group layout with "re-add View in your tool". Its tree shows `GROUP_` levels only because the Project has several groups, hyphenated `NIGHT_` dates, light folders named by filter and exposure, such as `Lights/Ha_300s/`, and assigned `Flats/<filter>/`. It lists copies that differ from what PlateVault placed, the space needed for two Views in Copies mode, and files PlateVault did not place, each with a tick box.
- **Expect (negative):** Nothing moves or changes before Apply succeeds. The new View is planned from the originals and reuses no entry of the current View.
- **Trace:** VSEL-FR-14, VSEL-FR-15, VSEL-FR-20 · PREP-FR-08, PREP-FR-16 · D-W99, D-W100

### S5a — Choose files PlateVault did not place {#S5a}

- **Do:** In the Apply sheet, tick the named DSS `.Info.txt` file and leave the user note unticked.
- **Expect:** Each file has its own visible tick box. The selection is recorded in the sheet: the ticked file will move into the new View after the swap, and the unticked note will stay in `View (previous)/`.
- **Expect (negative):** PlateVault does not delete either file or move one before the swap.
- **Trace:** VSEL-FR-20 · STO-FR-10 · D-W100

### S6 — Block Apply for an offline original {#S6}

- **Do:** Close the sheet, unmount `Astro-T7`, and reopen **Apply…**.
- **Expect:** The sheet names the offline original required by the new View and disables Apply. Remounting `Astro-T7` and reopening the sheet shows the source available again.
- **Expect (negative):** The current View and `View (previous)/` do not change while an original is offline. Apply does not omit the original.
- **Trace:** VSEL-FR-14 · PREP-FR-06 · D-W100

### S7 — Wait for an in-use View file {#S7}

- **Do:** On Windows, hold a current View entry open using P6, confirm Apply after all originals are online, and wait for the build to finish.
- **Expect:** After building the complete `View (building)/`, Apply reads "Waiting for a tool to release a file in View". Choose **Cancel** while it waits.
- **Expect (negative):** The installed View stays in place after cancel. No source changes, and no old entry is sent to Trash.
- **Trace:** PREP-FR-09, PREP-FR-18 · D-W100

### S7a — Apply after releasing the file {#S7a}

- **Do:** Release the file handle, reopen **Apply…**, confirm Apply and wait for the swap.
- **Expect:** Apply builds a complete fresh View from the originals and swaps it in. The changed copy remains in `View (previous)/`; the new View contains fresh bytes from the original. The ticked `.Info.txt` moves into the new View after the swap, and the unticked note remains in `View (previous)/`. PlateVault never deletes either user/tool file. The Project has the added Ha frames once, the new group tree and reassigned calibration.
- **Expect (negative):** No entry from the old View is reused, and originals and unselected files remain unchanged.
- **Trace:** VSEL-FR-14, VSEL-FR-20 · PREP-FR-06, PREP-FR-09, PREP-FR-16, PREP-FR-19 · STO-FR-10 · D-W100

### S7b — Change one duplicate capture copy {#S7b}

- **Do:** Overwrite the named `Spare` copy from P3 with its variant, restore its mtime and index `Spare` again.
- **Expect:** That logical capture reads as conflicting copies on `Astro-T7` and `Spare`, needing review. The duplicate warning reads `9 duplicate copies · <bytes>`, and Project integration does not change.
- **Expect (negative):** PlateVault changes neither physical copy, does not substitute the changed copy, and moves no file to Trash.
- **Trace:** LIB-FR-08 · LIB-AC-15 · D-W96

### S7c — Review `View (previous)/` before the next Apply {#S7c}

- **Do:** On the Sessions step, exclude one frame of the 18 Sep session. Open **Apply…** and read it. For the leftovers in `View (previous)/`, choose keep for the user note and Trash for the changed copy, then confirm Apply.
- **Expect:**
  - Before anything else, the sheet lists the two files `View (previous)/` still holds from S7a: the changed copy and the unticked user note. Each offers keep, move and Trash, and Apply stays disabled until both are reviewed. It also lists the `.Info.txt` in the View with its tick box (VSEL-FR-20).
  - After the review, the changed copy is in the OS Trash and Apply is enabled. Apply swaps in a View without the excluded frame.
  - No `View (previous 2)/` or other numbered folder exists. The kept note still exists, and where it sits after this swap isn't asserted (G7).
- **Expect (negative):** No leftover is deleted or moved before the user chooses for it, and Apply does not start while one is unreviewed. The kept note isn't deleted, and its bytes are unchanged.
- **Trace:** VSEL-FR-14, VSEL-FR-20 · VSEL-AC-34 · STO-FR-10 · D-W110

### S7d — Open the next Apply without the kept note asked again {#S7d}

- **Do:** On the Sessions step, restore the frame excluded at S7c. Open **Apply…**, read it, then close it without applying.
- **Expect:** The sheet lists the restored frame as a change. Its list of `View (previous)/` files to review doesn't name the user note kept at S7c, and the note shows no keep, move or Trash choice.
- **Expect (negative):** Opening and closing the sheet changes nothing in the View or `View (previous)/`, and the note's bytes are unchanged.
- **Trace:** VSEL-FR-14 · VSEL-AC-34 · STO-FR-10 · D-W110

## Success criteria

- SC1: Adding the Ha session changes Project membership once by 10 frames, leaves the OIII session out, and changes the View 0 times before Apply (S1, S4).
- SC2: A held session stays in the Project when it is unavailable or its Target changes; a calibration reassignment is visible as a labelled pending change (S2, S2a, S2b).
- SC3: The Apply sheet names the added frames, group move, calibration reassignment and layout change, shows the View tree, and provides an individual tick box for each file PlateVault did not place (S3, S5, S5a).
- SC4: When an original is offline, Apply is disabled, names it and changes the current View 0 times (S6).
- SC5: On Windows, Apply waits with the specified message after building, cancel preserves the old View, and releasing the file allows a later complete swap (S7, S7a).
- SC6: The new View has the added Ha frames exactly once and freshly built from originals; the ticked unplaced file moves only after swap, while the changed copy and unticked note remain in `View (previous)/` and are never deleted (S7a).
- SC7: The new duplicate copy conflict raises the count from exactly 10 byte-identical duplicate copies to 9, with 0 files moved and no integration change (S1, S7b).
- SC8: Discard is offered for the Project's own changes and refused for the calibration reassignment, which changes 0 pins (S4).
- SC9: With 2 leftovers in `View (previous)/`, Apply stays disabled until both are reviewed; afterwards 1 file is in the OS Trash, the kept note exists with its bytes unchanged, and 0 numbered `View (previous)` folders exist (S7c).
- SC10: The note kept at S7c is offered for review 0 times by the next Apply sheet (S7d).

## Known gaps

- G1: Not validated: the rebuilt application has not been validated against the Project-level Apply flow specified by 066, 069 and 071 as amended by D-W93 to D-W116.
- G2: (dissolved 2026-10-15): D-W100 removes preparation revisions and the run's shared Results folder, so no revision 3 is prepared. Each Apply builds a complete View from the originals, and S7a and S7c cover the replaced View's entries (STO-FR-10).
- G3: Out of scope for this journey: path repair after an archive transfer is distinct from refresh and is exercised in J28/S8.
- G4: Out of scope for this journey: adding a session while an external application reads the View (VSEL-AC-12) is not exercised, and no frame is an explicit inclusion, so the D09 pinning of manual inclusions is not observed. Blocks readiness until covered by a step or a journey.
- G5: Covered elsewhere: the Duplicates review and its clean-up (Keep this copy, Move the others to the OS Trash) opened from the S1 warning are exercised by J39 (S2 to S6); this journey only reads the warning.
- G6: Rests on the F4 items not settled by the owner's answer: D-W96's matching rule and its "captured" count (S1), D-W95's "re-add View in your tool" note (S5), and D-W108's exposure part that ends every light folder name (S5). If the owner changes one, the steps that cite it change.
- G7: (dissolved 2026-10-19): the owner's answer, 2026-10-19 (astro-plan-rzbzu.1), settles D-W110: on the next Apply, kept files move to a separate kept folder; a `-2` suffix is added on name clashes. S7c and S7d state the resulting placement while preserving the kept file's bytes and avoiding a repeated review.

## Delta log
- **Δ2** 2026-10-06 · S1, S3, S4, S5, +S2a, +S2b, +S5a · behavior-change
  The run offers "Add N new sessions" for new candidates. A Complete run asks for Reopen first, and Reopen returns it to the stage it was in. A member whose Target is re-confirmed stays and is flagged "no longer matches subject" with an offer to remove it. Saving adds a membership revision that feeds "in project".
  Evidence: specs/066-view-selection VSEL-FR-12, VSEL-FR-17, VSEL-AC-06, VSEL-AC-20, VSEL-AC-24. specs/070-results-reuse RES-FR-07, RES-AC-08. Workflow decisions D-W34, D-W45, D-W66. 065 PRJ-FR-04, PRJ-FR-21, 071 STO-FR-10 and 069 PREP-FR-07. Rig name `RedCat` from J15 · by: journey-scribe (intent-gated)
- **Δ3** 2026-10-12 · S1, S2a, S2b, S3, S4, S5, S5a, S7 · behavior-change
  The refresh lives in Select: "2 new candidates" with Add 2 or per-row Add to run, and "No longer matches" with Remove, in place of a separate refresh diff with accept/decline. A Complete run's Select is read-only until Reopen in the header, which returns the run to Prepare.
  Indexing a byte-identical copy raises an automatic "10 duplicate copies" warning in the status bar, and nothing is moved.
  Evidence: HARNESS-V5-IA.md §Screens S5 (header Complete / Reopen; Select "refresh flags") and S12 (Confirm rig); HARNESS-V5-FEEDBACK-R1.md §Round 5 "Duplicates are scanned automatically", "Duplicates review has clean-up", P-STO2 and P-SB3; prototype src/features/v5/c-runs/select-step.tsx, run.tsx, model.ts and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S2a, S2b · behavior-change
  P1 now reads the run as 208 cloned frame entries (Independent copy) instead of hard links. Completing the run in S2b offers Clean up of its prepared copies with the footprint "0 B extra · cloned", which frees no space, and the user leaves the offer. Confirming IC 5070 against NGC 7000 pointing in S2a shows a mismatch warning in the session's Target box.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Confirming a Target the pointing disagrees with" (@ 4f470775); §Input modes (user, 2026-10-10) P-PREP2 "Independent copy", "Footprint is real", "Prepared copies are cleaned up when a run is done" (@ d609ff55) (apps/prototype/design/ on ui-harness-v5); user answers to the PR #1788 journey questions · by: JourneysV5 (lead, intent-gated)
- **Δ5** 2026-10-12 · S2b · behavior-change
  P1 reads the run's 208 entries as symlinks (Symlinks run view). Completing the run in S2b offers "Remove run view · links only", ticked, in the Complete confirmation; the user unticks it, so nothing is removed.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S2a, S2b, S3, S4, S5, S5a, S6, S7, +S7a, +S7b · behavior-change
  New sessions are suggestions on the Project, and additions, group moves and calibration reassignments stay pending until Apply. The Apply sheet names exact changes, shows the rebuilt folder tree and preserves files PlateVault did not place or copies that differ from its recorded contents. Δ2 to Δ5 above stay as the refresh journey's history; G2 is dissolved, G3 to G5 keep their meaning, and G6 is new.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, VSEL-FR-12 to VSEL-FR-21, PREP-FR-06, PREP-FR-08, PREP-FR-16 to PREP-FR-19, STO-FR-10 · by: SpecF4Writer2 (intent-gated)
- **Δ7** 2026-10-16 · S4, +S7c · behavior-change
  A Project discards only its own pending edits; a calibration reassignment is fixed on the session or by removing it. The next Apply waits until the user reviews each file `View (previous)/` still holds: keep, move or Trash.
  Evidence: D-W109 and D-W110 (owner's answers of 2026-10-15/16) in PR #1804, VSEL-FR-12, VSEL-FR-14, VSEL-AC-33, VSEL-AC-34, STO-FR-10 · by: SpecF4Answers (intent-gated)
- **Δ8** 2026-10-16 · S5, +S7d, +SC10 · behavior-change
  A file the user keeps in `View (previous)/` isn't asked about again: new S7d opens the next Apply sheet and finds no review choice for the note kept at S7c. Light folders end in their exposure (provisional). G6 drops the kept-file rule, and G7 records the open swap rule.
  Evidence: D-W110 and D-W108 as amended by the owner's second batch of 2026-10-16 in PR #1804, VSEL-FR-14, VSEL-AC-34, STO-FR-10, PREP-FR-16 · by: EncodeOwnerAnswers2 (intent-gated)
