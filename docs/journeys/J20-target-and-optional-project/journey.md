---
id: J20
title: Open a Target and set up its Project with rigs and goals
version: 5
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [home, targets, projects, planning, settings, goal-templates, view]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D07, D10, D12, D18, D-W94, D-W3, D-W9, D-W16, D-W29, D-W30, D-W96, D-W36, D-W95, D-W89, D-W47, D-W62, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-b-target-and-optional-project, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S16, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-PLAN2, apps/prototype/src/features/v5/b-projects/new-project.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/target.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/targets.tsx, 068-calibration-inputs, 069-application-handoff, D-W93, D-W97, D-W98, D-W99, D-W100, D-W101, D-W102, D-W103, D-W104, D-W105, D-W106, FR-033, FR-034, FR-035, LIB-FR-17, LIB-FR-20, LIB-FR-23, CAL-FR-09, PRJ-FR-01, PRJ-FR-02, PRJ-FR-03, PRJ-FR-04, PRJ-FR-05, PRJ-FR-07, PRJ-FR-08, PRJ-FR-09, PRJ-FR-12, PRJ-FR-14, PRJ-FR-27, PRJ-FR-31, PRJ-FR-32, VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16]
---

## Goal

The user opens a Target to see what the library holds for it, then sets up a
Project with a subject, rigs and goals copied from a template. They read its
suggestions and groups on the Project page and compare planning sites on Targets.
Adding sessions and the first Apply follow in J21. Done means:

- The Target page shows captured integration per channel, library-wide, and offers Add to Plan, Add to Project and New Project but no processing action.
- The Project suggests Ready sessions whose confirmed Target is NGC 7000 and whose rig is on the Project's rig list. Suggestions are not added automatically, and a session that still needs review, such as 30 Sep, is not suggested.
- Goal progress reads "in project" and "captured", "captured" never reads below "in project", and goals remain unmet while no sessions have been added.
- Switching planning site changes only visibility.
- Removing a subject or rig changes only suggestions. The journey ends with no session in the Project and no View; J21 adds sessions and builds the View.
- Project edits change no source file or library quality state before Apply.

## Preconditions

- P1: J19 completed through S15 (`Cold-1` is offline). After it, the user finished the intake review of the 12, 18, 24, 26 and 28 Sep sessions and the other-camera session, so those six are Ready. Each has settled calibration: J19/S10a confirmed 26 Sep's flats, and every other kind on these sessions is pinned or set to No darks, No flats or No bias. The 30 Sep session's 48 frames are still Unreviewed and it reads Needs review; J22 reviews it. All seven light sessions have Target NGC 7000: 24 and 26 Sep are Confirmed, and 12, 18, 28 and 30 Sep and the other-camera session are Associated by pointing within NGC 7000's footprint (OBJECT never counts). The six RedCat sessions read rig `RedCat`, and the other-camera session reads rig `Esprit`.
- P2: Settings › Observing sites holds two saved sites, Backyard and `Remote site` (J15/S6, J15/S7), at least 15° of longitude and one time zone away from Backyard. No site carries the Default pill (J15 ends that way; J29/S5 sets it).
- P3: No Project exists.
- P4: The J19/P5 manifest is available.

## Steps

### S1 — Open NGC 7000 {#S1}

- **Do:** Launch PlateVault. From Home, open Targets, search for `NGC 7000` and click its result row.
- **Expect:** Home is the first surface shown, not the Targets page. NGC 7000 is a library Target, so clicking the result row opens its Target page. The page shows tonight, identity, Fit on every rig and captured time per channel with its sessions. Its header offers **Add to Plan**, **Add to Project** and **New Project…**. **Add to Project** is unavailable because no open Project exists, and the Projects box reads `No Project`. Ha captured integration is 12h 35m (151 frames); OIII is 10h 35m (127 frames). The 12 Sep OIII contribution on `Cold-1` counts in captured integration using its last-observed values and reads Offline.
- **Expect (negative):** The Target page offers no processing action, and the search result row carries no Add button. The 12 Sep contribution is not offered as an available input. Search needs no network connection.
- **Trace:** LIB-FR-08, LIB-FR-10 · LIB-AC-05, LIB-AC-09 · D-W94, D-W96

### S2 — Create the Project from the Target {#S2}

- **Do:** On the Target page, click **New Project…**. Enter the name `NGC 7000 HOO` and a note. Keep the prefilled subject NGC 7000. In the subject search, type `IC 1396`, click its result row, then remove IC 1396 again with its ×. Tick rig `RedCat`, choose the template HOO and click **Create Project**.
- **Expect:** The New Project sheet opens with subject NGC 7000 filled in. Its subject search covers My targets, the catalogues and SIMBAD. Clicking the IC 1396 result adds it to Subjects at once, and removing it leaves NGC 7000 the only subject. Rigs lists every rig with its camera kind: `RedCat` Mono and `Esprit` OSC. Template offers None, HOO, SHO, LRGB, OSC broadband and OSC dual-band plus any user templates, and it is the same list whichever rig is ticked. Choosing HOO copies Ha 10h and OIII 10h into the sheet as editable values. **Create Project** opens the `NGC 7000 HOO` Project page with goals Ha 10h and OIII 10h for NGC 7000.
- **Expect (negative):** No result row carries an Add button. The sheet offers no mosaic mode because a mosaic is a Project with panel groups. No goal kind for exposure preference, equipment or a mixed-equipment check is offered. Creating the Project adds no sessions and changes no source files.
- **Trace:** PRJ-FR-01, PRJ-FR-02, PRJ-FR-03, PRJ-FR-12 · PRJ-AC-01, PRJ-AC-07, PRJ-AC-14 · PLAN-EQ-AC-05 · D-W94, D-W96

### S3 — Read the Project page and its suggestions {#S3}

- **Do:** Read the Project page: its header, its sections and its suggestions.
- **Expect:** The Project page shows the steps Sessions, Calibrate, View, Output and Wrap up. Sessions shows no held sessions and suggests the five Ready RedCat sessions dated 12, 18, 24, 26 and 28 Sep, each with the reason it matches (Target NGC 7000 on rig `RedCat`). Calibrate is a read-only check; View offers the application, input mode and Apply. The Ha goal reads `0h00 in project · 9h15 captured · goal 10h` and OIII reads `0h00 in project · 6h35 captured · goal 10h`; both are unmet because no sessions have been added.
- **Expect (negative):** Suggestions are not added automatically. The 30 Sep session is not suggested because it still needs review, and its 48 frames count in neither number. The other-camera session is not suggested because its rig is not on the Project. The Project's Calibrate step offers no calibration assignment controls.
- **Trace:** PRJ-FR-04, PRJ-FR-07, PRJ-FR-08, PRJ-FR-09, PRJ-FR-31 · PRJ-AC-06, PRJ-AC-09 · CAL-FR-09 · LIB-FR-20, LIB-FR-23 · D-W94, D-W95, D-W96, D-W101, D-W105

### S4 — Read goal progress, edit a goal and add a rig {#S4}

- **Do:** Read the goals. Edit the OIII goal to 12h and save the goals. Open Settings › Goal templates and read HOO. Back on the Project page, add rig `Esprit` in Rigs.
- **Expect:** Before the edit, Ha reads `0h00 in project · 9h15 captured · goal 10h` and OIII reads `0h00 in project · 6h35 captured · goal 10h`. "captured" counts the five matching RedCat suggestions; no sessions are in project, and both goals are unmet. The goal editor offers integration time, frame count and quality bar, and each goal's channel is a chip from the band set. After the edit OIII reads `goal 12h`, and Settings › Goal templates still shows HOO with OIII 10h. Adding `Esprit` makes the other-camera session a sixth suggestion, and Ha reads `0h00 in project · 12h35 captured · goal 10h`: still unmet, although its captured time exceeds the goal. Home's Open work lists the Project with its next step.
- **Expect (negative):** Editing a copied goal changes no template and no other Project. No goal channel is typed as free text. "captured" never reads lower than "in project". Adding a rig does not add its suggested sessions.
- **Trace:** PRJ-FR-02, PRJ-FR-03, PRJ-FR-04, PRJ-FR-12 · PRJ-AC-01, PRJ-AC-03, PRJ-AC-09, PRJ-AC-14 · D-W94, D-W96

### S5 — Confirm the Project had no side effects {#S5}

- **Do:** Recompute the manifest of the online fixture folders and open Sessions. Compare Cold-1's manifest entries only after it is remounted, then eject it again for the next step.
- **Expect:** Online paths and hashes equal their matching J19/P5 entries, and Cold-1 matches after remount. No View exists yet. Every frame retains its reviewed library quality state.
- **Expect (negative):** Creating or editing the Project moves, renames or writes no source file and changes no library quality state. No View is built before Apply.
- **Trace:** PRJ-FR-05 · PRJ-AC-02 · VSEL-FR-16

### S6 — Inspect capture sites {#S6}

- **Do:** On the Sessions step, read the capture-site detail for the 12 Sep session and the Astro-T7 sessions.
- **Expect:** Each session retains its own capture site: 12 Sep reads `Remote site` and the Astro-T7 sessions read Backyard. The Project has no single capture-site field.
- **Expect (negative):** Reading a session's capture site changes neither that site nor the session. Switching planning site later (S7) leaves the capture sites unchanged.
- **Trace:** PRJ-FR-06 · PRJ-AC-04

### S7 — Compare planning sites on the Targets page {#S7}

- **Do:** Click **Planner** on the Project page. On the Targets page, choose Backyard, then `Remote site` as the site, and read the list. Choose Backyard again, then clear the Project scope. Return to the Project page and read its Planning box.
- **Expect:** **Planner** opens the Targets page scoped to the Project (`?project=`) with its night set to tonight. It lists NGC 7000 only, with its unmet goals, and its rig selector reads this Project's rigs. Fit shows one value per rig labelled with the rig's name, and the Filters column shows one chip per filter of both rigs, graded good tonight. Each change of site recalculates the windows and the altitude column and names that site and its time zone. Clearing the scope returns the list to My targets. Back on the Project page, Planning shows tonight at Backyard, the picked planning site: the Moon's illumination, the dark window, and NGC 7000's best window with its goal gaps.
- **Expect (negative):** Suggestions, their capture sites and the Project's subjects and rigs are identical before and after. Picking a site on the Targets page makes no site the default: Settings › Observing sites still shows no Default pill. Notifications stay disabled and no reminder is scheduled.
- **Trace:** flow B3 · HARNESS-V5-IA.md S3 Planning, S10, S11 · HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2, §Domain and seed Sites · PLAN-FR-01, PLAN-FR-09, PLAN-FR-10 · PLAN-AC-01, PLAN-AC-10, PLAN-TGT-AC-14 · D07, D-W16, D-W62

### S8 — Read the Project's next step on Home {#S8}

- **Do:** Open Home and read Open work. Choose the `NGC 7000 HOO` row's next step, then return to the Project page.
- **Expect:** Open work lists `NGC 7000 HOO` with the next step **1 session needs review**, because the 30 Sep session matches its subject and rig but still needs review. Choosing it opens Sessions filtered to Needs review, which lists 30 Sep. Back on the Project page, Sessions still shows no held sessions and the six suggestions of S4.
- **Expect (negative):** Reading Home or following the next step adds no session to the Project, builds no View and changes no frame's quality. Home shows no header buttons.
- **Trace:** PRJ-FR-17, PRJ-FR-18, PRJ-FR-32 · LIB-FR-17, LIB-FR-20 · D-W78, D-W89, D-W96

### S9 — Remove and restore suggestion criteria {#S9}

- **Do:** On the Project page, remove rig `RedCat` and subject NGC 7000 from the suggestion criteria, then add both back. Remove rig `Esprit` and add it back.
- **Expect:** Removing `RedCat` and subject NGC 7000 changes which sessions the Project suggests, and adding them back restores the five RedCat suggestions. Removing `Esprit` removes the other-camera session from suggestions; adding it back restores that suggestion. The Project still holds no session.
- **Expect (negative):** Removing a subject or rig adds or removes no session and builds no View. Which goals NGC 7000 has after it is removed and added back is G9.
- **Trace:** PRJ-FR-02, PRJ-FR-04, PRJ-FR-08, PRJ-FR-31 · PRJ-AC-06 · D-W94, D-W95, D-W96 · G9

## Success criteria

- SC1: At S1, Ha captured reads 12h 35m and OIII captured reads 10h 35m; 12 Sep reads Offline and unavailable, and the Target page offers 0 processing controls.
- SC2: The Project has 0 held sessions and 5 RedCat suggestions at S3, and 6 suggestions after S4; the 30 Sep session is never suggested. Ha remains 0h00 in project and reads 12h35 captured after S4.
- SC3: Zero source-file or quality-state changes and no View exist through S5.
- SC4: The S7 windows differ between the two sites, while Project suggestions and session capture-site values are identical, and no site carries the Default pill after S7.
- SC5: At S8, Home's Open work reads exactly 1 session needing review for `NGC 7000 HOO` and leads to 30 Sep; the Project still holds 0 sessions and no View.
- SC6: S9 removes and restores RedCat, Esprit and NGC 7000 as suggestion criteria; afterwards the suggestions are the six of S4, and the Project holds 0 sessions and no View.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Expected behavior follows specs 063 to 072 at head and workflow decisions D-W93 to D-W116. No implementation has been validated against the F4 Project model.
- G2: Out of scope for this journey: creating and editing mosaic panel groups is covered by J33, not here.
- G4: Out of scope for this journey: external resolver enrichment of a saved target, its provider provenance and a resolver failure (LIB-AC-12, D18) are not exercised. Blocks readiness until covered by a step or a journey.
- G5: (dissolved 2026-10-12): answered by Round 6 "Target library facts"; S1 now asserts usable, Unreviewed and Offline integration per channel, library-wide, on the Target page, and S6 reads each candidate's capture site in the Candidates **Capture site** column.
- G6: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S8 now asserts that Start run auto-names the run `NGC 7000 RedCat` and that Rename on the run header renames it to `NGC7000-HOO-Siril` without touching a file or the selection.
- G7: Out of scope for this journey: the exposure-mismatch warning per subject and channel (PRJ-FR-11, HARNESS-V5-IA.md S3) is not exercised. Its missing-calibration half is gone, because only a session with settled calibration can join a Project (D-W105). Blocks readiness until covered by a step or a journey.
- G8: Out of scope for this journey: detailed calibration matching thresholds, master-version selection and reassignment are covered by the calibration journeys. S3 reads the Project's calibration diagram but does not change a pinned assignment.
- G9: Unresolved product question: PRJ-FR-02 says removing a subject changes only the suggestions, and goals are set per subject (PRJ-FR-03). No source says what happens to a subject's goals when it is removed and added back (S9): kept, copied again from the template, or empty. S9 asserts only the suggestions. Blocks readiness.
- G10: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W94's rig list that only decides suggestions (S2, S4, S9), and D-W96's matching rule and its "captured" count of every matching suggestion (S3, S4, S9). If the owner changes one, the steps that cite it change.

## Delta log
- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S6, S7, S8, +S9 · behavior-change
  A Project is now required for every processing run and holds subjects, rigs and goals from templates. Candidates are derived from confirmed Target and rig, so S3 reads them instead of linking sessions. Goals read "in project" and "captured" (candidates plus run members), and the exposure preference is dropped. Home opens first, Open in Planner uses the Project's rigs, S8 starts the run `NGC7000-HOO-Siril`, and S9 checks that a rig or subject that any run uses cannot be removed.
  Evidence: D-W1, D-W3, D-W9, D-W16, D-W29, D-W30, D-W33, D-W34, D-W36, D-W37, D-W39, D-W50. 065 PRJ-FR-01 to PRJ-FR-12, PRJ-FR-20. 066 VSEL-FR-01. 072 PLAN-FR-10 at e4476231. D-W65 and D-W66 as narrowed by D-W72. 065 PRJ-FR-02, PRJ-FR-04, PRJ-FR-20, PRJ-FR-21, PRJ-AC-25. Root FR-023. Rig names `RedCat`, `Esprit` and site `Remote site` from J15 · by: agent (intent-gated, user instruction)
- **Δ3** 2026-10-12 · S1, S2, S3, S4, S7, S8, S9 · behavior-change
  The Target page offers Add to Plan, Add to Project and New Project, never a run; search results act on click. The New Project sheet copies a template's values in for editing and leaves mosaics to the Project page, whose sections, stage strip and toolbar Next follow v5. Planner opens the merged Targets page scoped to the Project, where the site is picked; the Project's Planning box follows the picked planning site. G3 is retired because Settings › Observing sites exists, and P1 follows J19 v3 (Targets Confirmed or Associated by pointing).
  The run starts from the Start run sheet (subject, rig, optional profile) and appears in the Runs table. Refusals read `Can't remove rig · used by 1 run ▸`, and an unused rig offers Remove.
  Evidence: HARNESS-V5-IA.md §Screens S3, S4, S10, S16; HARNESS-V5-FEEDBACK-R1.md §B "Start run sheet", §Copy rules, §Domain and seed Goals and Sites, §Round 5 "Runs read as one model", "Remove an unused rig", P-PLAN2, "Click a result to act", "OBJECT is a label, never evidence" (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); J19 v3; user instruction 2026-10-12 · by: JourneysV5.U2Projects (intent-gated)
- **Δ4** 2026-10-12 · S1, S6, S8 · behavior-change
  The Target page shows usable, Unreviewed and Offline integration per channel, library-wide (S1), and the Candidates table gains a Capture site column (S6).
  Start run auto-names the run `NGC 7000 RedCat`, and S8 renames it to `NGC7000-HOO-Siril` with Rename on the run header. G5 and G6 are dissolved.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Target library facts", "Rename runs and Projects" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6C (intent-gated)
- **Δ5** 2026-10-15 · S1, S2, S3, S4, S5, S6, S7, S8, S9 · behavior-change
  The Project holds user-added sessions in groups by rig and framing, with suggestions kept separate. The Project page exposes Sessions, Calibrate, View, Output and Wrap up; Apply builds and updates its View from originals. Adding sessions and the first Apply move to J21, so S8 now reads the Project's next step on Home (1 session needs review) instead of adding sessions. 30 Sep still needs review, so the Project suggests five RedCat sessions and OIII reads 6h35 captured. G7 keeps the exposure-mismatch warning open, and G8 to G10 are new.
  Evidence: D-W78, D-W89, D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, FR-033 to FR-035, CAL-FR-09, LIB-FR-17, LIB-FR-20, LIB-FR-23, PRJ-FR-01 to PRJ-FR-09, PRJ-FR-11, PRJ-FR-12, PRJ-FR-14, PRJ-FR-17, PRJ-FR-18, PRJ-FR-27, PRJ-FR-31, PRJ-FR-32, VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · by: SpecF4Writer2 (intent-gated)
