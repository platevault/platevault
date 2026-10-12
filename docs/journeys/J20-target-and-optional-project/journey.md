---
id: J20
title: Open a Target and set up its required Project with rigs and goals
version: 4
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [home, targets, projects, planning, settings, goal-templates, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D07, D10, D12, D18, D-W1, D-W3, D-W9, D-W16, D-W29, D-W30, D-W33, D-W34, D-W36, D-W37, D-W39, D-W47, D-W49, D-W50, D-W62, D-W65, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-b-target-and-optional-project, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S16, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-PLAN2, apps/prototype/src/features/v5/b-projects/new-project.tsx, apps/prototype/src/features/v5/b-projects/start-run.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/target.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/targets.tsx]
---

## Goal

The user opens a Target to see what the library holds for it, then sets up the
Project that every processing run needs: subject, rigs and goals copied from a
template. They read the candidates PlateVault derives on the Project page,
compare planning sites on the Targets page and start the first processing run
inside the Project. Done means:

- The Target page shows captured, usable, Unreviewed and Offline integration per channel, library-wide, and offers Add to Plan, Add to Project and New Project but no way to start a run.
- The Project's candidates are exactly the sessions whose settled Target (Confirmed, or Associated by pointing) is NGC 7000 and whose rig is a Project rig. Nothing is assigned to the Project itself.
- Goal progress reads "in project" and "captured", "captured" never reads below "in project", and every goal is unmet while no run has a saved membership.
- Switching planning site changes only visibility.
- The run, started from the Project's Start run sheet and auto-named from its subject and rig, is renamed `NGC7000-HOO-Siril` on its header and opens at Select inside the Project. A rig or subject that any run uses cannot be removed, and an unused rig can.
- Project edits change no file, quality state or run.

## Preconditions

- P1: J19 completed through S15 (`Cold-1` is offline). All seven light sessions have their Target settled as NGC 7000: 24 and 26 Sep are Confirmed, and 12, 18, 28 and 30 Sep and the other-camera session are Associated by pointing within NGC 7000's footprint (OBJECT never counts). The six RedCat sessions read rig `RedCat`, and the other-camera session reads rig `Esprit`.
- P2: Settings › Observing sites holds two saved sites, Backyard and `Remote site` (J15/S6, J15/S7), at least 15° of longitude and one time zone away from Backyard. No site carries the Default pill (J15 ends that way; J29/S5 sets it).
- P3: No Project and no processing run exist.
- P4: The J19/P5 manifest is available.

## Steps

### S1 — Open NGC 7000 {#S1}

- **Do:** Launch PlateVault. From Home, open Targets, search for `NGC 7000` and click its result row.
- **Expect:** Home is the first surface shown, not the Targets page. NGC 7000 is a library Target, so clicking the result row opens NGC 7000's Target page. The page shows tonight, identity, Fit on every rig and captured time per channel with its sessions. Its header offers **Add to Plan**, **Add to Project** and **New Project…**. **Add to Project** is unavailable because no open Project exists, and the Projects box reads `No Project`. Per channel, library-wide, the Target page shows captured, usable, Unreviewed and Offline integration. Ha reads captured 12h 35m (151 frames), usable 0h 00m, Unreviewed 12h 35m and Offline 0h 00m. OIII reads captured 10h 35m (127 frames), usable 0h 00m, Unreviewed 10h 35m and Offline 2h 00m (24 frames). Availability is shown as a separate state: the 12 Sep OIII contribution on `Cold-1` counts in captured integration with its last-observed values and reads Offline.
- **Expect (negative):** The Target page offers no Start run, because a run starts only inside a Project, and the search result row carries no Add button. The 12 Sep contribution is not offered as an available processing input. Search needs no network connection.
- **Trace:** flow B1 · HARNESS-V5-IA.md S10 Target detail · HARNESS-V5-FEEDBACK-R1.md Round 5 "Click a result to act", Round 6 "Target library facts" · prototype targets.tsx activate() (a library Target opens; Round 6 "Clicking a result" is silent on a library Target outside My targets) · LIB-FR-08, LIB-FR-10 · LIB-AC-05, LIB-AC-09 · D18, D-W39

### S2 — Create the Project from the Target {#S2}

- **Do:** On the Target page, click **New Project…**. Enter the name `NGC 7000 HOO` and a note. Keep the prefilled subject NGC 7000. In the subject search, type `IC 1396`, click its result row, then remove IC 1396 again with its ×. Tick rig `RedCat`, choose the template HOO and click **Create Project**.
- **Expect:** The New Project sheet opens with subject NGC 7000 filled in. Its subject search covers My targets, the catalogues and SIMBAD. Clicking the IC 1396 result adds it to Subjects at once, and removing it leaves NGC 7000 the only subject. Rigs lists every rig with its camera kind: `RedCat` Mono and `Esprit` OSC. Template offers None, HOO, SHO, LRGB, OSC broadband and OSC dual-band plus any user templates, and it is the same list whichever rig is ticked. Choosing HOO copies Ha 10h and OIII 10h into the sheet as editable values. **Create Project** opens the `NGC 7000 HOO` Project page with goals Ha 10h and OIII 10h for NGC 7000.
- **Expect (negative):** No result row carries an Add button. The sheet offers no mosaic or panel entry, because mosaic subjects are added on the Project page. No goal kind for exposure preference, equipment or a mixed-equipment check is offered. Creating the Project starts no run.
- **Trace:** flow B2 · HARNESS-V5-IA.md S4 · HARNESS-V5-FEEDBACK-R1.md Round 5 "Click a result to act" · PRJ-FR-01, PRJ-FR-02, PRJ-FR-03, PRJ-FR-12 · PRJ-AC-01, PRJ-AC-07, PRJ-AC-14 · PLAN-EQ-AC-05 · D-W9, D-W17, D-W29, D-W30, D-W47

### S3 — Read the Project page and its derived candidates {#S3}

- **Do:** Read the Project page: its header, its sections and its candidates.
- **Expect:** The header's stage strip reads Open → Runs → Wrap up → Done, with Open current. The toolbar's Next, the page's one primary action, reads **Review 238 new frames**, the Unreviewed frames of the candidates. The sections appear in this order: Runs, Candidates, Goals, Subjects and Rigs, Planning. Runs reads `No runs yet` and offers **Start run**. Candidates has the filters All, Unreviewed and Not in a run, and lists exactly the six RedCat sessions: 12, 18, 24, 26, 28 and 30 Sep. Each one shows why it is a candidate (subject NGC 7000, rig `RedCat`), its Unreviewed count, and **In run** reading Ready.
- **Expect (negative):** The other-camera session is not a candidate, because its rig is not on the Project. The Project page offers no action that assigns a session to the Project itself.
- **Trace:** Projects surface · HARNESS-V5-IA.md S3 · PRJ-FR-08, PRJ-FR-09, PRJ-FR-18 · PRJ-AC-06, PRJ-AC-09, PRJ-AC-10 · root FR-018, FR-019 · D-W33, D-W34, D-W35, D-W37

### S4 — Read goal progress, edit a goal and add a rig {#S4}

- **Do:** Read the goals. Edit the OIII goal to 12h and save the goals. Open Settings › Goal templates and read HOO. Back on the Project page, add rig `Esprit` in Rigs.
- **Expect:** Before the edit, Ha reads `0h00 in project · 9h15 captured · goal 10h` and OIII reads `0h00 in project · 10h35 captured · goal 10h`. "captured" counts the six candidates, because no run has members. Both are unmet, although OIII captured exceeds its goal. The goal editor offers the kinds integration time, frame count and quality bar, and each goal's channel is a chip from the band set. After the edit OIII reads `goal 12h`, and Settings › Goal templates still shows HOO with OIII 10h. After adding the rig, the other-camera session is a seventh candidate and Ha reads `0h00 in project · 12h35 captured · goal 10h`. Home's Projects box shows the Project with these goals and the stage `No runs yet`.
- **Expect (negative):** Editing a copied goal changes no template and no other Project. No goal channel is typed as free text. "captured" never reads lower than "in project", and no label reads "not in a run".
- **Trace:** flow B2 · HARNESS-V5-IA.md S3 Goals, S16 Goal templates · HARNESS-V5-FEEDBACK-R1.md §Domain and seed Goals · PRJ-FR-02, PRJ-FR-04, PRJ-FR-12, PRJ-FR-21 · PRJ-AC-01, PRJ-AC-03, PRJ-AC-09, PRJ-AC-14 · root FR-019, FR-023 · D-W36, D-W37, D-W66

### S5 — Confirm the Project had no side effects {#S5}

- **Do:** Recompute the manifest of the online fixture folders and open Sessions. Compare Cold-1's manifest entries only after it is remounted, then eject it again for the next step.
- **Expect:** Online paths and hashes equal their matching J19/P5 entries, and Cold-1 matches after remount. No processing run exists. Every frame still reads Unreviewed.
- **Expect (negative):** Creating or editing the Project moved, renamed or wrote no file, created no run, and changed no quality state.
- **Trace:** flow B2 · PRJ-FR-05 · PRJ-AC-02

### S6 — Inspect capture sites {#S6}

- **Do:** On the Project page, open the candidate list and read its **Capture site** column.
- **Expect:** The Candidates table has a **Capture site** column, and each candidate's row shows its own capture site there: 12 Sep reads `Remote site` and the Astro-T7 sessions read Backyard. The Project has no single capture-site field.
- **Expect (negative):** Reading the column changes no session's capture site and no candidate; switching planning site later (S7) leaves the column unchanged.
- **Trace:** flow B3 · HARNESS-V5-FEEDBACK-R1.md Round 6 "Target library facts" ("Candidates gets a capture-site column") · PRJ-FR-06 · PRJ-AC-04

### S7 — Compare planning sites on the Targets page {#S7}

- **Do:** Click **Planner** on the Project page. On the Targets page, choose Backyard, then `Remote site` as the site, and read the list. Choose Backyard again, then clear the Project scope. Return to the Project page and read its Planning box.
- **Expect:** **Planner** opens the Targets page scoped to the Project (`?project=`) with its night set to tonight. It lists NGC 7000 only, with its unmet goals, and its rig selector reads this Project's rigs. Fit shows one value per rig labelled with the rig's name, and the Filters column shows one chip per filter of both rigs, graded good tonight. Each change of site recalculates the windows and the altitude column and names that site and its time zone. Clearing the scope returns the list to My targets. Back on the Project page, Planning shows tonight at Backyard, the picked planning site: the Moon's illumination, the dark window, and NGC 7000's best window with its goal gaps.
- **Expect (negative):** Candidates, their capture sites and the Project's subjects and rigs are identical before and after. Picking a site on the Targets page makes no site the default: Settings › Observing sites still shows no Default pill. Notifications stay disabled and no reminder is scheduled.
- **Trace:** flow B3 · HARNESS-V5-IA.md S3 Planning, S10, S11 · HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2, §Domain and seed Sites · PLAN-FR-01, PLAN-FR-09, PLAN-FR-10 · PLAN-AC-01, PLAN-AC-10, PLAN-TGT-AC-14 · D07, D-W16, D-W62

### S8 — Start a processing run from the Project {#S8}

- **Do:** In Runs, click **Start run**. In the sheet, choose subject NGC 7000 and rig `RedCat`, leave **Profile (optional)** at None and click **Start run**. On the run header, click **Rename**, enter `NGC7000-HOO-Siril` and confirm.
- **Expect:** The sheet asks only for a subject, a rig and an optional profile, with no name field. The run is created inside `NGC 7000 HOO`, named `NGC 7000 RedCat` (subject and rig), and opens at its Select step. The Project's Runs table lists `NGC 7000 RedCat` with its step Select, its status Open and when it was updated, and the stage strip marks Runs current. The picker lists the six RedCat candidates. The five available ones (18, 24, 26, 28 and 30 Sep) start selected, and 12 Sep is flagged Offline. After the rename, the run header and the Runs table read `NGC7000-HOO-Siril`, still at Select with the same five sessions selected. Every goal is still unmet with 0h00 in project, because no membership is saved yet, and Ha still reads 12h35 captured.
- **Expect (negative):** The sheet shows no "What starts" list. The picker lists no Esprit session. No run folder is created on disk and no quality state changes. The rename writes, moves or renames no file, and changes neither the run's step nor its selected sessions; the Runs table still lists exactly one run.
- **Trace:** flow B4 · HARNESS-V5-IA.md S3 Runs, S5 · HARNESS-V5-FEEDBACK-R1.md §B Start run sheet, Round 5 "Runs read as one model", Round 6 "Rename runs and Projects" · VSEL-FR-01, VSEL-FR-02, VSEL-FR-03, VSEL-FR-09 · VSEL-AC-01, VSEL-AC-18 · PRJ-FR-04, PRJ-FR-10, PRJ-FR-20 · D-W3, D-W37, D-W49, D-W50

### S9 — Try to remove the run's rig and subject {#S9}

- **Do:** Return to the Project page. In Rigs, read `RedCat`'s row and try to remove it. In Subjects, try to remove NGC 7000. Then remove rig `Esprit` and add it back.
- **Expect:** Removing `RedCat` is refused with the terse refusal `Can't remove rig · used by 1 run ▸`, whose disclosure names `NGC7000-HOO-Siril`, the one run that uses it. Removing subject NGC 7000 is refused the same way, `Can't remove subject · used by 1 run ▸`, naming the same run. `Esprit`, which no run uses, offers **Remove**, and removing it succeeds: the other-camera session stops being a candidate, is a member of no run, and Ha captured reads 9h15 again. Adding `Esprit` back restores the seventh candidate and Ha captured 12h35.
- **Expect (negative):** The refused removals change neither the Project's subjects and rigs nor the run's subject, rig or picker.
- **Trace:** Projects surface · HARNESS-V5-FEEDBACK-R1.md Round 5 "Remove an unused rig", §Copy rules terse refusals · PRJ-FR-02, PRJ-FR-04 · PRJ-AC-06, PRJ-AC-25 · 065 edge case "Removing a subject or a rig is refused while any run uses it" · D-W37, D-W65, D-W66

## Success criteria

- SC1: At S1, usable reads 0h 00m per channel, Unreviewed equals captured per channel, Offline reads 0h 00m for Ha and 2h 00m (24 frames) for OIII, 12 Sep reads Offline and unavailable, and the Target page offers 0 Start run controls.
- SC2: The Project has exactly 6 candidates and 0 runs at S3, and 7 candidates after S4. Ha reads 0h00 in project and 12h35 captured after S4.
- SC3: Zero file or quality-state changes and zero runs exist through S5.
- SC4: The S7 windows differ between the two sites, while candidates and the Capture site column's values are identical (S6, S7), and no site carries the Default pill after S7.
- SC5: Exactly 1 run exists after S8 and the Runs table lists it once, at Select, created as `NGC 7000 RedCat` and renamed `NGC7000-HOO-Siril` with 0 file changes. Its picker lists 6 sessions with 5 selected and 0 Esprit sessions, and every goal is unmet.
- SC6: The S9 removals of `RedCat` and of subject NGC 7000 are each refused with `used by 1 run` and name `NGC7000-HOO-Siril`. The Project ends S9 with 2 rigs and subject NGC 7000.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, apps/prototype/design/ on ui-harness-v5 @ b5e813a5, and Round 6 (user, 2026-10-10) @ 4f470775, which the prototype does not implement yet), the specs at d45a22ad and the defaults set in decisions D07, D10, D12, D18 and the 2026-10-06 workflow decisions. No implementation has been validated against them.
- G2: Out of scope for this journey: mosaic subjects (the mosaic editor, run groups) are covered by J33, not here.
- G4: Out of scope for this journey: external resolver enrichment of a saved target, its provider provenance and a resolver failure (LIB-AC-12, D18) are not exercised. Blocks readiness until covered by a step or a journey.
- G5: (dissolved 2026-10-12): answered by Round 6 "Target library facts"; S1 now asserts usable, Unreviewed and Offline integration per channel, library-wide, on the Target page, and S6 reads each candidate's capture site in the Candidates **Capture site** column.
- G6: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S8 now asserts that Start run auto-names the run `NGC 7000 RedCat` and that Rename on the run header renames it to `NGC7000-HOO-Siril` without touching a file or the selection.
- G7: Out of scope for this journey: the Goals section's exposure-mismatch and missing-calibration warnings per rig (HARNESS-V5-IA.md S3) are not exercised. Blocks readiness until covered by a step or a journey.

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
