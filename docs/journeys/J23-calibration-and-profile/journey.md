---
id: J23
title: Review Project calibration and configure its View
version: 7
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [calibration, projects, view-review, applications]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 068-calibration-inputs, 069-application-handoff, D04, D13, D15, D19, D-W3, D-W5, D-W95, D-W94, D-W101, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-e-choose-calibration-and-application-preparation, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-5-user-2026-10-10, P-CAL3, apps/prototype/src/domain/calibration.ts, apps/prototype/messages/en-GB.json, J36, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-PREP3, 064-library-inventory, 065-project-goals, 066-view-selection, D-W93, D-W96, D-W97, D-W98, D-W99, D-W100, D-W102, D-W103, D-W104, D-W105, D-W106, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md]
---

## Goal

The user checks the pinned calibration for the sessions in Project `NGC 7000 HOO`, confirms a suggested flat on its session, and chooses an application profile and input mode in the Project's View. Done means:
- The Project's Calibrate step shows the calibration pinned on each group and night, without an assignment control or Proceed gate.
- Every session held by the Project has settled calibration: each kind is pinned or explicitly set to No.
- Confirming the suggested flat records its unknown optical-train evidence without changing the master or another session's assignment.
- Reassigning calibration on a session appears as a pending change on the open Project and does not change the existing View before Apply.
- Siril and an input mode are selected in View, and the Apply sheet reports the corrected values recorded at ingestion, which Apply applies with no per-value choice.
- Calibration masters and original source files remain unchanged.

## Preconditions

- P1: J22's frame review is complete. Project `NGC 7000 HOO` holds 208 RedCat lights / 17h 20m in five sessions dated 18, 24, 26, 28 and 30 Sep, has settled calibration for every held session, and has an applied View. Its application is not yet selected in View.
- P2: The raw sets of J36/P2 were indexed in `Astro-T7/Calibration`; J36 turns them into masters through their calibration processes. The flat age window is set to 30 nights. The Calibration library holds the imported masters in its structured storage:
  - `MasterDark_2026-09-20.xisf` and `MasterBias_2026-09-20.xisf`: camera, dimensions, binning, gain and offset match the J19/P2 RedCat lights, and the dark matches their 300 s exposure.
  - `MasterFlat_2026-09-18.xisf`: Ha, with RedCat optical-train evidence.
  - `MasterFlat_2026-09-30.xisf`: OIII, with RedCat optical-train evidence. For 24 Sep it passes the configured flat checks and is the best fully compatible flat; it was captured six nights after the lights.
  - `MasterDark_ASI294MM_300s.xisf`: a dark from the second camera, captured 148 days before 15 Oct 2026, for checking the old-master badge.
  - `MasterFlat_2026-09-26.xisf`: OIII, imported in J36/S9 with no optical-train evidence.

  The 50 raw bias frames that J36/S8 kept stay indexed in `Astro-T7/Calibration/Raw/Bias/2026-09-20/`.
- P3: The library also holds the two other masters J36/S9 and J36/S9a imported: a master dark from a second camera (ZWO ASI294MM Pro) and an OIII master flat from a second optical train (Esprit 100). Neither is part of rig RedCat. The bias master also holds the 15 Jun version that J36/S9a added, which is never the closest version for these sessions.
- P4: Siril is installed at a known path and not yet configured in PlateVault.
- P5: The J19/P5 manifest is available.

## Steps

### S1 — Read Project calibration {#S1}

- **Do:** Open Project `NGC 7000 HOO` and select **Calibrate**.
- **Expect:** Calibrate shows a read-only diagram of the calibration pinned on the Project's groups and nights. It includes the five sessions' dark, flat and bias assignments with the relevant version and date, or the explicit No choice.
- **Expect (negative):** Calibrate has no assignment control, Matches table or Proceed gate. Opening it does not rematch or change a session.
- **Trace:** CAL-FR-02, CAL-FR-09, LIB-FR-23 · D-W101, D-W105

### S2 — Inspect the calibration diagram {#S2}

- **Do:** Expand the RedCat group's nights and inspect the calibration entries for 18, 24, 26, 28 and 30 Sep.
- **Expect:** Each night shows the pinned calibration its lights receive. Different pinned versions appear on the nights that use them, and a night mixing versions with the same settings is marked as such.
- **Expect (negative):** The diagram offers no action to assign or replace calibration and does not report unresolved calibration for a session already held by the Project.
- **Trace:** CAL-FR-09, CAL-FR-22, CAL-FR-23 · PREP-FR-16 · D-W101, D-W104

### S3 — Read why a session has its calibration {#S3}

- **Do:** Open the details for the 24 Sep OIII session and read **Why this match** for its dark and pinned flat.
- **Expect:** Each pinned or suggested assignment shows compatible, incompatible and unknown criteria, along with the capture dates for the light and calibration. The session records the rig version it was captured with.
- **Expect (negative):** An unknown optical-train value is shown as unknown; it is not inferred from a filename or another session.
- **Trace:** CAL-FR-03, CAL-FR-21 · LIB-FR-26 · D-W102, D-W103, D-W104

### S4a — Review the calibration inputs {#S4a}

- **Do:** In the session details, inspect the calibration kinds and the files pinned for the 18 Sep Ha session.
- **Expect:** Session details distinguish pinned raw calibration from a pinned master version. When both raw flats and a matching master flat are present, the Project's View uses the master flat unless the session is switched to its raw flats. The 50 raw bias frames remain raw files and create no master record.
- **Expect (negative):** The Project's Calibrate diagram does not offer a row menu for selecting a master or a raw set.
- **Trace:** CAL-FR-04, CAL-FR-08, CAL-FR-09 · LIB-FR-23 · D-W101, D-W102

### S5 — Review a suggested flat {#S5}

- **Do:** In the 24 Sep session details, read the suggested `MasterFlat_2026-09-26.xisf` and its **Why this match** evidence.
- **Expect:** The 26 Sep flat is a suggestion because its optical-train evidence is unknown. The pinned 30 Sep flat remains unchanged while the suggestion is only being inspected.
- **Expect (negative):** The unknown train is not described as compatible, and inspecting the suggestion changes neither the master evidence nor the pinned assignment.
- **Trace:** CAL-FR-03, CAL-FR-05, CAL-FR-19, CAL-FR-20 · CAL-AC-03 · D-W102

### S6 — Confirm the suggested flat on its session {#S6}

- **Do:** On the 24 Sep session, choose **Reassign…** for flats and confirm `MasterFlat_2026-09-26.xisf` despite its unknown optical-train evidence.
- **Expect:** The 24 Sep session now has the 26 Sep flat pinned, with the unknown criterion recorded on the confirmation. The Calibration library still shows the flat's optical train as unknown, and other sessions keep their own assignments.
- **Expect (negative):** PlateVault asks for no exception reason, does not make the master universally compatible, and does not change the flat pinned on another session.
- **Trace:** CAL-FR-05, LIB-FR-23, LIB-FR-25 · CAL-AC-03 · D-W102, D-W106

### S7 — Review the pending Project change {#S7}

- **Do:** Return to Project `NGC 7000 HOO` and inspect Calibrate and the pending changes after the session reassignment.
- **Expect:** The Project labels the calibration reassignment as a pending change from the session. Calibrate still has no assignment control. The existing View stays unchanged until Apply.
- **Expect (negative):** A session reassignment does not silently rewrite the View or change a Closed or Archived Project.
- **Trace:** CAL-FR-09 · LIB-FR-25 · VSEL-FR-12 · D-W100, D-W106

### S7a — Inspect dated master versions and age {#S7a}

- **Do:** Open the Calibration library and inspect the RedCat dark master and `MasterDark_ASI294MM_300s.xisf`.
- **Expect:** The RedCat dark's dated versions are shown without a Latest label. The ASI294MM dark shows `Old · 148 d`; flats have no age badge.
- **Expect (negative):** Adding a version does not move a session to it, create an Update notice or bulk-update pinned assignments.
- **Trace:** CAL-FR-14, CAL-FR-15 · D-W103

### S7b — Try to hide a master pinned on this Project {#S7b}

- **Do:** Choose **Hide** on `MasterFlat_2026-09-26.xisf` after it is pinned on the 24 Sep session.
- **Expect:** Hide is refused and names Project `NGC 7000 HOO`, which uses the master through its session.
- **Expect (negative):** The master and its versions remain in the Calibration library, the session keeps its pinned assignment, and no file moves.
- **Trace:** CAL-FR-16 · LIB-FR-23 · D-W106

### S7c — Hide and restore an unused master {#S7c}

- **Do:** Choose **Hide** on the unused ASI294MM dark, open **Show hidden**, and choose **Restore**.
- **Expect:** The unused master leaves the active Calibration list and is absent from matching and offers while hidden. Show hidden lists it with Restore; after restoration it returns to the active list.
- **Expect (negative):** Hide and Restore do not move, rename or delete the master file.
- **Trace:** CAL-FR-16 · D-W76, D-W106

### S8 — Choose Siril in the Project's View {#S8}

- **Do:** Open Project `NGC 7000 HOO`'s **View** step and choose **Siril** under Application. If its executable is not found, locate it in Settings › Applications and return to View.
- **Expect:** View lists the configured application and its supported input, layout and configuration evidence. Unsupported configuration is named, and no capability is claimed as verified without evidence.
- **Expect (negative):** Profile selection does not launch Siril or start processing.
- **Trace:** PREP-FR-01, PREP-FR-02 · D-W83, D-W100

### S9 — Choose an input mode in View {#S9}

- **Do:** Configure a generic application in Settings › Applications, select it in View, and inspect **Symlinks** and **Copies**.
- **Expect:** View offers only Symlinks and Copies. When the profile's input-write behavior is unknown or write-prone, the Symlinks risk is named and Symlinks is refused; Copies is offered.
- **Expect (negative):** PlateVault does not silently change the mode or offer a third mode.
- **Trace:** PREP-FR-01, PREP-FR-02, PREP-FR-04, PREP-AC-11 · D-W81, D-W83, D-W100

### S10 — Read the corrected values in Apply {#S10}

- **Do:** With the S9 generic application selected in View and the View in Copies mode, open the Apply sheet and read its Corrected values section.
- **Expect:** The section reads "2 corrected values", the two that held sessions recorded at ingestion in J19/S10. It lists each with its session, its field, the value in the header and the corrected value. 24 Sep's Target reads "–" in the header and NGC 7000 corrected, and 28 Sep's Equipment reads "–" in the header and `RedCat` corrected. Because the generic application reads no corrected values through its configuration, the section names the route as isolated patched copies in the Copies View. The sheet also shows the pending calibration change and the new View as a folder tree.
- **Expect (negative):** The sheet offers no per-value choice: no accepting the source value and no excluding an input. Apply creates or changes no catalog correction; it only delivers the ones already recorded.
- **Trace:** PREP-FR-03, PREP-FR-08, PREP-FR-16, PREP-AC-06 · VSEL-FR-14 · LIB-FR-12, LIB-FR-20 · D-W100, D-W122 · HARNESS-V5-FEEDBACK-R1.md Round 9 C15

### S11 — Apply the corrected values {#S11}

- **Do:** Apply the reviewed View changes.
- **Expect:** Apply builds the View from the originals, writes the two corrected values into isolated patched copies of the 24 Sep and 28 Sep frames in the Copies View, and swaps the View in.
- **Expect (negative):** No original or link target is patched, and no correction is reported as delivered while the application still reads the original value.
- **Trace:** PREP-FR-03, PREP-FR-06, PREP-FR-09, PREP-AC-06 · D-W100, D-W122 · HARNESS-V5-FEEDBACK-R1.md Round 9 C15

## Success criteria

- SC1: All 15 session-kind assignments in the five-session fixture are pinned or explicit No choices, and Calibrate displays them without an assignment control or Proceed gate (S1, S2).
- SC2: The 26 Sep flat's unknown optical-train criterion is visible before confirmation and recorded when pinned to 24 Sep; its library evidence and other sessions' assignments remain unchanged (S5, S6).
- SC3: The reassignment appears as a pending Project change, and the existing View does not change before Apply (S7).
- SC4: Dated versions are shown with no Latest label or Update notice, and the 148-day-old dark has `Old · 148 d` while flats have no badge (S7a).
- SC5: Hiding a master pinned on the Project is refused with the Project named; hiding and restoring an unused master changes no file bytes (S7b, S7c).
- SC6: Siril and the input mode are chosen in View; an unknown or write-prone profile cannot use Symlinks without a refusal and explicit mode choice (S8, S9).
- SC7: The Apply sheet reads "2 corrected values" with the route isolated patched copies and offers 0 per-value choices; Apply patches 0 originals (S10, S11).

## Known gaps

- G1: Not validated: the rebuilt application has not been validated against this journey. This journey follows the current contracts in specs 064, 066, 068 and 069 and D-W93 to D-W116.
- G2: Unresolved implementation qualification: Siril profile capability probes (D04) must exist before S8 can show verified evidence. The PixInsight/WBPP and SETI Astro Suite Pro profiles are not exercised in this journey. Blocks readiness.
- G3: Out of scope for this journey: calibration across mosaic panel groups is covered by J33. The Project diagram and pinned-session rules are specified by CAL-FR-09 and CAL-FR-23.
- G4: (dissolved 2026-10-12): answered by Round 6 "Calibration Off"; S7a now asserts that with **Auto-assign** off the 3 compatible masters read Suggested, none is assigned, and only an accepted one becomes a handoff input.
- G5: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S7 now asserts that the run starts auto-named `NGC 7000 RedCat` and is renamed `24 Sep flat check` on the run header.
- G6: (dissolved 2026-10-15): D-W101 matches calibration at ingestion and makes the Project's Calibrate step a read-only check, so no Calibrate row offers `Stack from <session>`. Raw sets wait as calibration processes in the Calibration library, which J36 stacks.
- G7: (dissolved 2026-10-15): PREP-AC-11 (D-W81, D-W83) answers it: for a profile whose input-write behavior is unknown or write-prone, Symlinks is refused with the input-write risk named, and Copies is offered without a silent mode change. S9 asserts that refusal for a generic application.
- G8: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W106's refusal of Hide on a master an open Project uses through its sessions (S7b, SC5), and D-W102's ranking, which makes the 30 Sep master the best fully compatible flat for 24 Sep (P2, S3). If the owner changes one, the steps that cite it change.
- G9: (dissolved 2026-10-17): D-W122 records Round 9 C15, and 069 PREP-FR-03 and PREP-AC-06 follow it. Corrections are recorded at session intake, and the Apply sheet shows "N corrected values" with no per-value choice. Each value reaches the application through the profile's configuration, else as an isolated patched copy. S10 and S11 rest on that contract.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S5, S6, S7, +S7a, S9 · behavior-change
  Calibration is automatic: compatible matches are assigned on reaching Calibrate, a readiness line reports them, and Review matches holds the table. The standalone View is now run `24 Sep flat check` in the Project. Matching is limited to the run's rig.
  Evidence: specs/068-calibration-inputs CAL-FR-02, CAL-FR-09, CAL-FR-10, CAL-AC-01, CAL-AC-11, CAL-AC-14; D-W5, D-W37, D-W55 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S3, +S4a, S5, S6, S7, S7a, +S7b, S8, S9 · behavior-change
  Runs are assigned masters only: the fixture is J36's masters, raw flats are no longer handed to the application (retired old step 4), and Matches offers masters only. Readiness reads per kind (Dark, Flat, Bias); the user defers a flat, then uses the unknown-train master as an exception from the row menu.
  A master's Used by lists the runs that use it. Profiles are picked in Prepare (**Other app**, `Linked run`), and executables are set in Settings › Applications.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3, §Round 5 Calibration; HARNESS-V5-IA.md §Screens S5, S14, S16, §Round 2b foundation (P-CAL3: masters only); prototype src/features/v5/c-runs/calibrate-step.tsx, prepare-step.tsx, messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U4Calibration (intent-gated)
- **Δ4** 2026-10-12 · S7, S7a, +S7c, S9, S10 · behavior-change
  A new run starts auto-named `NGC 7000 RedCat` and is renamed on the run header. With **Auto-assign** off, compatible masters read Suggested and wait for acceptance. Dismissing a master that runs use is refused with the runs named.
  Prepare's input modes are **Automatic**, **Independent copy**, **Link to originals** and **Give PixInsight the file list** (WBPP only); `Linked run`, `Direct source` and `Clone` are gone.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Calibration Off", "Rename runs and Projects", "Dismiss is refused while a run uses the master" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); §Input modes (user, 2026-10-10) P-PREP2 (@ d609ff55); user answers to the PR #1788 journey questions · by: JourneysV5.R6D (intent-gated)
- **Δ5** 2026-10-12 · S9, S10 · behavior-change
  Prepare's Run view offers **Symlinks** (the Settings default) and **Copies**; the Automatic, file-list and linked-originals modes are gone. A patched correction reaches the application through Copies.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c; research RUN-VIEWS-OPTIONS.md) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S3, S4a, S5, S6, S7, S7a, S7b, S7c, S8, S9, S10, S11 · behavior-change
  Calibration is pinned on sessions at ingestion; Project Calibrate is a read-only diagram, and profile and input-mode choices are in View. Dated versions have no Latest or Update notice, and darks and bias use the Old badge. S9 refuses Symlinks for a profile with unknown input-write behavior, which dissolves G7; G6 is dissolved because Calibrate has no rows to offer Stack, and G8 is new.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, LIB-FR-23 to LIB-FR-26, CAL-FR-02 to CAL-FR-09, CAL-FR-13 to CAL-FR-23, PREP-FR-01, PREP-FR-03, PREP-FR-04, PREP-FR-06, PREP-FR-08, PREP-FR-09, PREP-AC-11 · by: SpecF4Writer2 (intent-gated)
- **Δ7** 2026-10-17 · S10, S11 · behavior-change
  Corrections are recorded at session ingestion, so Apply lists the corrected values with their count ("2 corrected values" from J19/S10) and applies all of them, here as isolated patched copies for the S9 generic application. The per-value choice (accept the source value, exclude the input) is gone. G9 records the conflict with 069 PREP-FR-03.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C15 · prototype view-step.tsx Corrected values section (ui-harness-v5) · by: JourneysR9c (intent-gated)
