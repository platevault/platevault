---
id: J26
title: Discover Project Output and adopt a calibration master
version: 6
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, calibration, projects, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 070-results-reuse, 068-calibration-inputs, 069-application-handoff, 071-storage-custody, D04, D05, D09, D13, D19, D-W98, D-W5, D-W94, D-W101, D-W93, D-W100, D-W97, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/070-results-reuse/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-h-results-and-generated-masters, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed-foundation, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, P-CAL2, P-CAL3, apps/prototype/src/features/v5/e-targets-plan-settings/calibration.tsx, apps/prototype/messages/en-GB.json, J36, HARNESS-V5-FEEDBACK-R1.md#round-6, D-W103, D-W113]
---

## Goal

The user opens the Project's Output step to find its Results, saves finished images there, or copies a tool file from `Processing/` with **Copy to Output…**. The user adopts a generated master offered once from `Processing/` through Output and the Calibration library. Done means:
- Files in `Output/` appear as Results without acceptance or recorded lineage, and a Result is never a Project input.
- Copy to Output… places a verified copy in `Output/` and leaves the source in `Processing/` unchanged.
- A tool rerun may overwrite files in `Processing/` without changing Results already in `Output/`.
- A generated master is offered once from `Processing/`; explicit adoption registers it only after its source and verified copy match the reviewed digest.
- A hidden master can be restored from Show hidden, and a changed adopted master is marked drifted and is not offered as an input until its bytes return.

## Preconditions

- P1: Project `NGC 7000 HOO` is open and has an applied View. Its `Processing/Siril/` folder contains Ha and OIII stacks, a log and the generated master flat `masterFlat_BIN-1_FILTER-Ha.fit`; `Output/` contains final image files. The master was generated on 2026-10-01.
- P2: A helper process keeps writing one further file inside the Project's `Output/` during S1, then lets it settle.
- P3: `Processing/Siril/` contains a finished TIFF that can be selected through Copy to Output… .
- P4: A baseline manifest records the files and SHA-256 digests in `Output/` and `Processing/Siril/`.
- P5: A helper outside PlateVault saves a file's bytes and nanosecond mtime, then overwrites it in place with a same-size variant whose bytes differ and restores the saved mtime. The helper later restores the saved bytes and mtime.
- P6: A fault control pauses master adoption after the destination copy is read back and verified and before the master is registered (G4).
- P7: The proposed master destination in Calibration storage can be occupied by an unrelated file whose digest is recorded before adoption is attempted.
- P8: `Output/final/` contains two image files that the Output table lists with paths relative to `Output/`.

## Steps

### S1 — Find Results in Output {#S1}

- **Do:** Open Project `NGC 7000 HOO` and select its Output step.
- **Expect:** The table lists the files in `Work/Processing/NGC 7000 HOO/Output/` with File, Kind, Channel and State, and availability where known. The file still being written reads "Still being written".
- **Expect (negative):** The table does not list files from `Processing/` as Results, and no row offers Accept.
- **Trace:** RES-FR-01, RES-AC-01, RES-AC-23 · D-W98

### S1a — Read paths inside Output {#S1a}

- **Do:** In Project `NGC 7000 HOO`, open Output and inspect the two files in `Output/final/`.
- **Expect:** Both files appear with their paths relative to `Output/`, including `final/`; Kind, Channel and State are shown for each row.
- **Expect (negative):** PlateVault does not create, rename or move folders inside `Output/`, and the files have no preparation revision or input lineage.
- **Trace:** RES-FR-01, RES-AC-27 · D-W93, D-W98

### S2 — Copy a tool file to Output {#S2}

- **Do:** On Output, choose **Copy to Output…** and select the TIFF in `Processing/Siril/` through the native file dialog.
- **Expect:** A verified copy appears in `Output/` as a Result. The source in `Processing/Siril/` remains byte-identical to its recorded digest.
- **Expect (negative):** No file is copied or listed before the copy succeeds, and an existing destination is not overwritten.
- **Trace:** RES-FR-02, RES-AC-02, RES-AC-25 · STO-FR-07 · D-W98

### S3 — Rerun a tool without changing Output {#S3}

- **Do:** Record the copy in `Output/`, rerun Siril so it overwrites the source file in `Processing/Siril/`, and reopen Output.
- **Expect:** The copy in `Output/` retains its recorded SHA-256 and remains listed as a Result; the file in `Processing/Siril/` reflects the tool's new bytes.
- **Expect (negative):** The tool does not write into `Output/`, and no Result asks to be accepted again.
- **Trace:** RES-FR-02, RES-AC-28 · D-W93, D-W98

### S3a — Confirm Results need no acceptance {#S3a}

- **Do:** Open the rows for the two stacks and the copied TIFF in Output.
- **Expect:** Each file in `Output/` is a Result and has its Kind and Channel fields; no inspection or acceptance action is required to make it a Result.
- **Expect (negative):** No file has an acceptance digest, recorded lineage, or an acceptance state.
- **Trace:** RES-FR-01 · D-W93, D-W98

### S4 — Keep Output separate from the View {#S4}

- **Do:** Open Project `NGC 7000 HOO`'s View and inspect its input folder tree after Apply.
- **Expect:** The View contains the inputs PlateVault places for the Project; the Project's Results remain in the sibling `Output/` folder.
- **Expect (negative):** `Output/` files are not placed into the View and cannot be selected as Project inputs.
- **Trace:** VSEL-FR-01 · PREP-FR-16 · D-W93, D-W98

### S4a — Keep another Project's Output separate {#S4a}

- **Do:** Open the Output step of another Project, then open the Sessions step of `NGC 7000 HOO`.
- **Expect:** Results remain listed only in their owning Project's Output table; the Sessions step lists sessions and Project suggestions.
- **Expect (negative):** The other Project's Results do not appear as sessions or as selectable inputs, and PlateVault records no lineage between Projects' Results.
- **Trace:** VSEL-FR-01 · D-W93

### S5 — Change a Result's displayed kind {#S5}

- **Do:** In Output, change one file's Kind and Channel with the row dropdowns.
- **Expect:** The row keeps the selected Kind and Channel, and remains listed as a Result.
- **Expect (negative):** Changing those fields does not open an acceptance flow or create a lineage record.
- **Trace:** RES-FR-01, RES-AC-24 · D-W93, D-W98

### S6 — Check that Output is not an input {#S6}

- **Do:** Open the Project's Apply sheet and inspect the proposed View tree.
- **Expect:** The tree previews the folders and files PlateVault will place from the Project's sessions and their pinned calibration.
- **Expect (negative):** No file in `Output/` appears in the View tree or is available as a Project input.
- **Trace:** VSEL-FR-01, VSEL-FR-12, VSEL-FR-20 · D-W93, D-W100

### S7 — List a file while it is being written {#S7}

- **Do:** While the P2 helper writes the file inside `Output/`, open the Output step and read its row.
- **Expect:** The file is listed with the State "Still being written" until it settles.
- **Expect (negative):** A growing file is not omitted from the table, and its state does not imply acceptance or lineage.
- **Trace:** RES-FR-01, RES-AC-01, RES-AC-23 · D-W98

### S7a — Read the settled file {#S7a}

- **Do:** Let the P2 helper finish writing, then reopen Output.
- **Expect:** The file remains listed as a Result and its State no longer reads "Still being written".
- **Expect (negative):** Settling the file does not require acceptance or add lineage.
- **Trace:** RES-FR-01, RES-AC-01, RES-AC-23 · D-W98

### S8 — Hide and restore the generated master offer {#S8}

- **Do:** In the Project's Output step, open the once-only offer for `masterFlat_BIN-1_FILTER-Ha.fit` found in `Processing/Siril/`. Choose **Hide**, then open the Calibration library's Show hidden list and choose **Restore** for that candidate.
- **Expect:** Output offers the generated master once with **Add to calibration library** and **Hide**. Hiding records the decline and the offer does not return; the candidate remains listed in Calibration. Show hidden lists it with Restore, and Restore returns it to the Calibration list.
- **Expect (negative):** Hiding and restoring the offer do not move or change the generated file, which remains in `Processing/Siril/` with its recorded digest.
- **Trace:** CAL-FR-06, CAL-FR-16, RES-FR-11, RES-AC-15 · D-W98

### S8a — Refuse an occupied master destination {#S8a}

- **Do:** Choose **Add to calibration library** for the generated master and read its adoption review. Place an unrelated file at the proposed destination and record its SHA-256, then confirm adoption.
- **Expect:** The existing destination is named and adoption is refused; the unrelated file keeps its recorded digest.
- **Expect (negative):** The occupied file is never overwritten, no master is registered, and no other destination is silently selected.
- **Trace:** CAL-FR-07 · CAL-AC-08 · STO-FR-12 · D05, D-W98

### S8b — Refuse a master changed after review {#S8b}

- **Do:** Review **Add to calibration library** for the master and record the displayed SHA-256. With the P5 helper, change the source bytes in place without changing its size or mtime, then confirm.
- **Expect:** Adoption is blocked because the current source digest differs from the reviewed digest, and a new review is required.
- **Expect (negative):** No destination copy is written and no master is registered; the generated source is not changed by PlateVault.
- **Trace:** CAL-FR-07, CAL-AC-09 · D05, D19, D-W98

### S8c — Recheck the source before registration {#S8c}

- **Do:** Restore the source bytes with the P5 helper and, outside PlateVault, delete the unrelated S8a file from the proposed destination. Review and confirm adoption with the P6 pause armed. When the destination copy is verified and awaiting registration, change the source bytes again and release the pause.
- **Expect:** The final source recheck detects drift, blocks registration and names the unregistered verified copy at the proposed destination.
- **Expect (negative):** A master with a changed source is not registered, and PlateVault does not alter the source.
- **Trace:** CAL-FR-07, CAL-AC-09 · D05, D19 · G4, G9

### S9 — Adopt the generated master {#S9}

- **Do:** Restore the P5 source bytes. Outside PlateVault, move the unregistered verified copy that S8c named out of the proposed destination, so the destination is empty. Review the SHA-256 and destination, and confirm **Add to calibration library**.
- **Expect:** PlateVault rechecks the source against the reviewed digest, copies it, reads back and verifies the copy, and checks the source again before registering the master and its provenance. The generated file remains in `Processing/Siril/`.
- **Expect (negative):** The master is not registered if any digest check fails, and adoption pins the master on no session and changes no session's pinned calibration.
- **Trace:** CAL-FR-06, CAL-FR-07, CAL-FR-08 · CAL-AC-05, CAL-AC-07 · D05, D19, D-W98, D-W101 · G9

### S9a — Detect drift in the adopted master {#S9a}

- **Do:** With the P5 helper, change the adopted master's bytes in place while preserving its size and mtime. Open the Calibration library and the Project's Calibrate step.
- **Expect:** The master reads drifted against its adoption digest and needs review.
- **Expect (negative):** The changed master is not treated as a valid pinned or suggested calibration input, and no session's calibration changes. No session pins this master; J24/S8b covers a pinned file that changes (D-W113).
- **Trace:** CAL-FR-08 · CAL-AC-10 · D19, D-W101

### S9b — Restore the adopted master bytes {#S9b}

- **Do:** Restore the adopted master's saved bytes and mtime with the P5 helper, then reopen the Calibration library and Calibrate.
- **Expect:** The master digest again matches its adoption digest and it no longer reads drifted.
- **Expect (negative):** No new adoption is recorded and no assignment changes.
- **Trace:** CAL-FR-08 · CAL-AC-10 · D19

### S9c — Hide and restore an unused master {#S9c}

- **Do:** In Calibration, confirm that the adopted master is unused, choose **Hide**, then open Show hidden and choose **Restore**.
- **Expect:** Hide removes the master from the active Calibration list and matching; Show hidden lists it with Restore, and Restore returns it to the active list.
- **Expect (negative):** Hide and Restore do not move, rename or change the master file, its path or its SHA-256.
- **Trace:** CAL-FR-16 · D-W76, D-W82

## Success criteria

- SC1: Every file in `Output/` is listed as a Result; a growing file reads "Still being written" and no row offers acceptance (S1, S1a, S3a, S7, S7a).
- SC2: Copy to Output… creates a verified copy, leaves the source unchanged, and a later tool overwrite changes 0 bytes in `Output/` (S2, S3).
- SC3: `Output/` remains separate from View and is never a Project input; neither its files nor another Project's Results appear as selectable session inputs (S4, S4a, S6).
- SC4: Changing Kind or Channel leaves the file listed as a Result and does not record lineage (S5).
- SC5: The generated master is offered once from `Processing/`; Hide removes the offer and Show hidden with Restore returns the candidate to Calibration (S8).
- SC6: An occupied master destination changes 0 bytes; a source that drifts after review or before registration registers 0 masters (S8a, S8b, S8c).
- SC7: Adoption registers the master only after the reviewed source digest, verified destination digest and final source recheck agree (S9).
- SC8: A changed adopted master reads drifted and is not offered as a valid input, and no session's calibration changes; restoring the bytes restores the digest without a new adoption (S9a, S9b).
- SC9: Hide and Restore change 0 bytes and 0 paths for the master file (S9c).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Expected behavior follows specs 063 to 072 and workflow decisions D-W93 to D-W116 in PR #1804; no implementation has been validated against them.
- G2: (dissolved 2026-10-15): D-W93 drops Results as inputs, so no step depends on Siril's product-input capability; S4 and S6 assert that `Output/` is never a Project input.
- G3: (dissolved 2026-10-15): D-W93 drops Results as inputs and D-W94 removes runs, so there is no product to pick into a run, no mixed raw and product input and no run group Result; S4a asserts that another Project's Results are not selectable.
- G4: Unresolved implementation qualification: no fault control yet pauses adoption between destination verification and registration (P6), and S8c depends on it. Blocks readiness.
- G5: (dissolved 2026-10-12): answered by Round 6 "No silent re-rank"; S9 now asserts that the prepared run keeps `MasterFlat_2026-09-18.xisf` and both revisions unchanged while Calibrate shows "Better match available", and S9a to S9c assert that the notice follows the adopted master's availability.
- G6: (dissolved 2026-10-12): answered by Round 6 "Result revision"; S1 and S1a now assert that tool evidence decides each stack's revision, also against the revision current when it appeared, and that the log, without it, is marked Inferred.
- G7: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S4 now asserts that the run starts as `NGC 7000 RedCat` and is renamed `NGC7000 HOO combine` on the run header, and S7 and S7a read the picker of the existing `28 Sep Ha copy check` instead of starting throwaway runs.
- G8: (dissolved 2026-10-12): answered by Round 6 "Adopting a master"; S8a to S9 now assert that **Add to library** opens a confirmation naming the destination path and SHA-256 and re-verifies the bytes on confirm, so S8b writes no copy. G9 records what stays open.
- G9: Unresolved product question: S8c leaves a verified copy, named unregistered, at the one fixed destination `Astro-T7/Calibration/Flats/RedCat/Ha/2026-10-01/MasterFlat_2026-10-01.fit`, and S9 adopts to that same path. CAL-AC-09 keeps that copy unregistered and CAL-AC-08 refuses an occupied path, but neither the design nor Round 6 says whether a later adoption is refused with `Name taken`, registers the existing copy once its bytes re-verify, or replaces PlateVault's own unregistered copy. S9 moves that copy out of the destination before it adopts, so it doesn't depend on the answer, and no step adopts over the copy. Blocks readiness.
- G10: Rests on a provisional F4 item, pending the owner's confirmation in PR #1804: D-W98's once-only offer of a generated master found in `Processing/`, on the Output step (S8 to S9, SC5). If the owner changes it, those steps change.

## Delta log

- **Δ2** 2026-10-06 · S1, +S1a, S2, S4, +S4a, S6, S7, S8, S8a, S9, S9a, S9b · behavior-change
  Results are discovered in the sibling `<Run> Results/` folder, one folder for every revision, and each candidate records its revision. Attach Result is a visible action on the Results step. Reuse is through a new run's Results input filter, across Projects and rigs. Intermediates are never trashed from the Results step. The new master is offered once in the Results step, with Dismiss.
  Evidence: specs/070-results-reuse RES-FR-01, RES-FR-02, RES-FR-05, RES-AC-01, RES-AC-13, RES-AC-14, RES-AC-15. specs/068-calibration-inputs CAL-FR-06, CAL-AC-12. D-W4, D-W55, D-W56, D-W67 at e4476231. D-W67, D-W70. 070 RES-FR-01, RES-FR-05, RES-AC-16, 069 PREP-FR-07 and 071 STO-FR-16 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S2, S3, S3a, S4, S4a, S7, S7a, S8, S8a, S8b, S8c, S9, S9a, S9b · behavior-change
  Attach is **Attach…**, Accept works per product, and reuse goes through a run's **Add products…** picker, where another rig reads `Another rig`. Siril's master flat no longer comes from raw flats PlateVault handed it.
  Dismiss is reversible: the offer goes to the Calibration library's Dismissed filter, where Restore offers it again. Add to library files the master at a fixed path in structured calibration storage, so no destination or file name is chosen.
  Evidence: HARNESS-V5-IA.md §Screens S5, S14, §Round 2b foundation (C: masters only, `masterStoragePath`); HARNESS-V5-FEEDBACK-R1.md §Domain and seed P-CAL2, §Round 1b P-CAL3; prototype src/features/v5/c-runs/results-step.tsx, select-step.tsx, actions.ts (`answerMasterOffer`), messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U4Calibration (intent-gated)
- **Δ4** 2026-10-12 · S1, S1a, S4, S7, S7a, S8a, S8b, S8c, S9, S9a, S9b, +S9c · behavior-change
  A Result's revision comes from tool evidence, else it is marked Inferred. The combine run starts auto-named and is renamed on the run header, and drift is read in an existing run's picker.
  **Add to library** opens a confirmation with the destination and SHA-256 and re-verifies the bytes on confirm. A better adopted master reassigns nothing: Calibrate shows "Better match available". A master no run uses can be dismissed and is not matched until restored.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Result revision", "Rename runs and Projects", "Adopting a master", "No silent re-rank", "Dismiss is refused while a run uses the master" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6D (intent-gated)
- **Δ5** 2026-10-15 · S1, S1a, S2, S3, S3a, S4, S4a, S5, S6, S7, S7a, S8, S8a, S8b, S8c, S9, S9a, S9b, S9c · behavior-change
  Results are files in the Project's `Output/`; there is no acceptance, lineage or use of a Result as a Project input. Copy to Output… brings tool files over from `Processing/`, and the once-only generated-master offer moves to Output. Master adoption, drift and hiding follow the Calibration library contract. G2 and G3 are dissolved with Results as inputs; G4 and G9 stay open, and S8c and S9 clear the proposed destination by hand instead of depending on G9. G10 is new.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 070 RES-FR-01 to RES-FR-11, 068 CAL-FR-06 to CAL-FR-09, 071 STO-FR-16 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-16 · S9a · behavior-change
  No session pins the adopted master, so S9a reads only its drift in the Calibration library and Calibrate. J24/S8b covers a pinned file that changes, which keeps its pin and makes Apply refuse with a link to reassign (D-W113).
  Evidence: D-W113 (owner's answers of 2026-10-15/16) in PR #1804, CAL-FR-08, CAL-AC-10, J24/S8b · by: SpecF4Answers (intent-gated)
