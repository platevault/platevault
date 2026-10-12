---
id: J14
title: Add a Target to an existing Project from its Target page and start its run there
version: 3
status: draft
last_reviewed: 2026-07-14
actors: [primary-user]
surfaces: [targets, planning, projects, sessions, home, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D-W1, D-W8, D-W17, D-W23, D-W30, D-W33, D-W36, D-W37, D-W47, D-W49, D-W50, D-W59, D-W60, D-W61, D-W65, D-W66, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S12, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, P-PLAN2, apps/prototype/src/features/v5/e-targets-plan-settings/target.tsx, apps/prototype/src/features/v5/b-projects/start-run.tsx, apps/prototype/src/features/v5/a-home/parts.tsx]
---

## Goal

The user knows what to shoot and process next: NGC 7000. They find it on the
Targets page and check that it fits their `RedCat` rig. A Target page cannot
start a run, so from NGC 7000's Target page they add it to `Cygnus HOO`, the
Project they already keep for the Cygnus region, after reading a preview of
what the addition changes. They then start the run `NGC7000-HOO-Siril` inside
that Project, choosing NGC 7000 among its two subjects. Later the user adds the
other-camera session to the same Project from the **Not in any Project**
filter. Done means:

- NGC 7000 is a subject of `Cygnus HOO` with the Project's goal set copied in, and the existing subject NGC 6888 and its goals are unchanged.
- The run `NGC7000-HOO-Siril` exists only inside `Cygnus HOO` and offers no move or share to another Project.
- The Project and its Target stay linked by identity, and a rename keeps the link.
- Adding the other-camera session adds its rig to the Project with a visible note, but the existing run keeps its own rig.
- No file is written, moved or renamed, and no quality state changes.

## Preconditions

- P1: J19 completed through S15. All seven light sessions have confirmed Target NGC 7000, the six RedCat sessions read rig `RedCat`, the other-camera session reads rig `Esprit`, and `Cold-1` is offline.
- P2: My targets has no ★ favourite. Exactly one Project exists: `Cygnus HOO`, open, created with New Project as in J20/S2 with the single subject NGC 6888, rig `RedCat` and the built-in HOO goal template (Ha 10h and OIII 10h), and no run. No session has Target NGC 6888, and no processing run exists.
- P3: Settings > Equipment holds rig `RedCat` (RedCat 51 + ASI2600MM) as J15/S2 to S4 create it, with a 250 mm focal length and the ASI2600MM sensor size and pixel size, so its field of view is known. Its filter list holds Ha and OIII.
- P4: A manifest (relative path, size, SHA-256) of every file under the J19 folders, recorded outside PlateVault before S1, with `Cold-1` remounted for the recording and ejected again afterwards.

## Steps

### S1 — Find NGC 7000 on the Targets page {#S1}

- **Do:** From Home, open **Targets**. Search for `ngc7000`. Open the NGC 7000 result row's menu and choose **Add ★**. In the toolbar rig selector, choose `RedCat`.
- **Expect:** Targets opens on **My targets**, which lists only NGC 6888, with the badge `Project Cygnus HOO`. The search lists NGC 7000 with its source, and `ngc7000` matches the same Target as `NGC 7000`. After **Add ★**, NGC 7000 is listed under My targets with ★ set. Choosing the rig adds a Fit column, and NGC 7000's Fit reads fits, with its coverage: its major axis is about 2° against the rig's 3.6° shorter side. The Filters column shows one chip per `RedCat` filter, Ha and OIII, each graded good tonight.
- **Expect (negative):** No result row carries an Add button. Starring a Target creates no Project, adds no subject and assigns no session to anything.
- **Trace:** Targets list · HARNESS-V5-IA.md S10 · HARNESS-V5-FEEDBACK-R1.md Round 5 "Click a result to act", P-PLAN2 · PLAN-TGT-FR-01, PLAN-TGT-FR-03, PLAN-TGT-FR-11, PLAN-TGT-FR-06 · PLAN-TGT-AC-03, PLAN-TGT-AC-11 · D-W17, D-W23, D-W61

### S2 — Open the Target page {#S2}

- **Do:** Click NGC 7000's row under My targets.
- **Expect:** The click opens NGC 7000's Target page. Its captured time reads Ha 12h35 and OIII 10h35, with the seven sessions listed by night, channel, frames and rig: six on `RedCat` and one on `Esprit`. Its header offers **Add to Plan**, **Add to Project** and **New Project…**, and its Projects box reads `No Project`.
- **Expect (negative):** The Target page offers no Start run, because a run starts only inside a Project.
- **Trace:** flow B1 · HARNESS-V5-IA.md S10 Target detail · LIB-FR-08 · LIB-AC-05 · D-W1, D-W8

### S2a — Add NGC 7000 to Cygnus HOO, previewed first {#S2a}

- **Do:** Open **Add to Project** and choose `Cygnus HOO`. Read the preview and cancel it. Open it again and confirm with **Add to Cygnus HOO**.
- **Expect:** **Add to Project** lists the open Projects that lack NGC 7000: exactly `Cygnus HOO`. The preview reads `Add NGC 7000 to Cygnus HOO?` and lists `Adds NGC 7000 as a subject` and `Copies the goals: Ha 10h, OIII 10h`. After confirming, the Target page's Projects box lists `Cygnus HOO`, Open, with NGC 7000's goal lines `Ha 0h00 in project · 9h15 captured · goal 10h` and `OIII 0h00 in project · 10h35 captured · goal 10h`. "captured" counts the six RedCat candidates, 12 Sep included, because no run has members yet. Both goals are unmet, although OIII captured exceeds its goal. **Add to Project** is now unavailable, because NGC 7000 is in every open Project.
- **Expect (negative):** Cancelling the preview changes nothing. Confirming adds no rig, so `Esprit` stays off the Project, and the captured values leave out the `Esprit` session. It creates no run, moves no file, and leaves NGC 6888 and its goals unchanged.
- **Trace:** flow B2 · HARNESS-V5-IA.md S10 "Add to Project (previewed first)" · HARNESS-V5-FEEDBACK-R1.md §Copy rules previews · PRJ-FR-01, PRJ-FR-02, PRJ-FR-04, PRJ-FR-21 · PRJ-AC-03 · D-W30, D-W36, D-W37, D-W66

### S2b — Start the run inside the Project {#S2b}

- **Do:** Open `Cygnus HOO` from the Target page's Projects box. In Runs, click **Start run**. In the sheet, choose subject NGC 7000 and rig `RedCat`, leave **Profile (optional)** at None, and click **Start run**. Name the run `NGC7000-HOO-Siril` (G4).
- **Expect:** The Project page lists the subjects NGC 6888 and NGC 7000, its Candidates list the six RedCat NGC 7000 sessions, and Runs reads `No runs yet`. The Start run sheet offers both subjects and the one rig `RedCat`. The run is created inside `Cygnus HOO` and opens at its Select step, and the Runs table lists `NGC7000-HOO-Siril` at Select. NGC 7000's goals still read 0h00 in project and are unmet.
- **Expect (negative):** No run is created for NGC 6888, and no standalone or Target-only run exists. No goal reads "in project" above "captured". The Project stays Open; no goal state marks it Done.
- **Trace:** flow B4 · HARNESS-V5-IA.md S3 Runs · HARNESS-V5-FEEDBACK-R1.md §B Start run sheet · PRJ-FR-10, PRJ-FR-12 · PRJ-AC-01, PRJ-AC-14 · VSEL-FR-01 · VSEL-AC-17 · D-W1, D-W8, D-W47, D-W50

### S5 — Read the run's candidates and ownership {#S5}

- **Do:** In the run's Select step, read the session picker and the run's header.
- **Expect:** The header names Project `Cygnus HOO`, subject NGC 7000 and rig `RedCat`. The picker lists the six RedCat sessions with the reason `Target NGC 7000 on RedCat`. The five available sessions (18, 24, 26, 28 and 30 Sep) start selected, and 12 Sep is flagged Offline.
- **Expect (negative):** The other-camera session is not listed, even after the picker's filters are cleared. The run offers no control to move it to another Project or to share it with one.
- **Trace:** flow C2 · VSEL-FR-01, VSEL-FR-03, VSEL-FR-09 · VSEL-AC-01, VSEL-AC-18 · D-W8, D-W37, D-W49

### S6 — Check the link from both sides and rename {#S6}

- **Do:** Open Targets on My targets, then open NGC 7000's Target page. Rename the Project to `Cygnus HOO bicolour` (G5), then open the Target page again. Rename the Project back to `Cygnus HOO`.
- **Expect:** My targets lists NGC 7000 with ★ and the badge `Project Cygnus HOO`. The Target page lists the Project, and choosing it opens the Project page with NGC 7000 among its subjects. After the rename, the badge and the Target page show the new name, and the Project page still shows subject NGC 7000 and the run `NGC7000-HOO-Siril`.
- **Expect (negative):** Renaming leaves the subject, the run and its Target attached, because the link is by identity.
- **Trace:** Projects surface · HARNESS-V5-IA.md S10 My targets badge · PRJ-FR-01, PRJ-FR-07 · PLAN-TGT-FR-01 · PLAN-TGT-AC-16 · D-W60

### S7 — Add the other-camera session from Not in any Project {#S7}

- **Do:** Open Sessions and choose the **Not in any Project** filter. On the other-camera session's row, open **Add to Project** and pick `Cygnus HOO`. Read the preview, then confirm with **Add session**. Return to Home and to the run's Select step.
- **Expect:** Before confirming, **Not in any Project** lists exactly the other-camera session, and its **Add to Project** menu marks `Cygnus HOO` with `+ rig Esprit`. The preview lists `Adds rig Esprit` and that the session becomes a candidate. After confirming, the Project lists both rigs, and NGC 7000's Ha reads `0h00 in project · 12h35 captured · goal 10h`, because the other-camera session is now a candidate. **Not in any Project** lists no session, and Home's Sessions box reads `None` under Needs a Target and under Not in any Project.
- **Expect (negative):** Adding the session assigns it to no run. The picker of `NGC7000-HOO-Siril` still lists only RedCat sessions, because a run's rig is fixed at creation. No label reads "not in a run".
- **Trace:** Sessions filters · HARNESS-V5-IA.md S12 ("Add to Project (also adds the rig, with a visible note)"), S1 Sessions · LIB-FR-17 · LIB-AC-18 · PRJ-FR-04, PRJ-FR-19, PRJ-FR-21 · PRJ-AC-09 · VSEL-AC-18 · D-W37, D-W50, D-W59, D-W66

### S8 — Confirm there were no side effects {#S8}

- **Do:** Outside PlateVault, remount `Cold-1`, recompute the P4 manifest and eject `Cold-1` again. In Sessions, read the quality of every frame.
- **Expect:** Every path, size and SHA-256 equals P4, and every frame still reads Unreviewed.
- **Expect (negative):** No run folder, prepared link or copy exists on disk. Creating the Project and the run and adding the rig moved, renamed or wrote no file, and changed no quality state.
- **Trace:** PRJ-FR-05 · PRJ-AC-02 · root FR-001

## Success criteria

- SC1: The Target page offers 0 Start run controls (S2). Zero runs exist after S2a, and exactly one run, `NGC7000-HOO-Siril` in `Cygnus HOO`, exists after S2b, with 0 runs for NGC 6888.
- SC2: After S2a, NGC 7000's Ha reads 9h15 captured and OIII reads 10h35 captured, both with 0h00 in project and unmet, and NGC 6888's 2 goals are unchanged.
- SC3: The S5 picker lists 6 sessions with 5 selected and 0 Esprit sessions. The run offers 0 move or share controls.
- SC4: After the S6 rename, the badge, the Target page and the Project page all show the new name, and the subject is still NGC 7000.
- SC5: After S7, the Project lists 2 rigs and Ha reads 12h35 captured, and the run's picker still lists 0 Esprit sessions.
- SC6: The S8 manifest equals P4 for 100% of files, and 0 frames have a quality other than Unreviewed.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, apps/prototype/design/ on ui-harness-v5 @ b5e813a5), on top of specs 063 to 072 at d45a22ad and the workflow decisions of 2026-10-06. No implementation has been validated against them.
- G2: Unresolved implementation qualification: S1 assumes NGC 7000's catalogued major axis is about 2°. The bundled catalogue's size value has not been checked, so the exact coverage behind "fits" is unverified. Blocks readiness.
- G4: Unresolved product question: v5 auto-names a new run '<subject> <rig>' (store/actions/runs.ts startRun; the Start run sheet has only subject, rig and profile) and no Rename control is exposed, although the store has renameRun; this journey's run name needs a Rename control or a fixture rename. Blocks readiness.
- G5: Unresolved product question: S6 renames the Project, but the v5 Project page exposes no control to rename a Project or edit its details (the store has updateProjectDetails; no screen calls it). Blocks readiness.
- G6: Out of scope for this journey: New Project from a Target (J20/S2), the refusal to remove a rig or subject that a run uses (J20/S9) and a mosaic subject (J33).

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S5, S6, S7, +S8 · behavior-change
  Every processing run now lives in a Project. Starting a run from a Target first asks for Create Project or Add to Project, the Project is prefilled from the Target, and the run is created inside it. The Targets list (My targets, search, rig selector, Fit) replaces the planner columns, and Add to Project from Not in any Project adds the session's rig with a note. The legacy wizard defects of v1 no longer apply.
  Evidence: D-W1, D-W8, D-W17, D-W23, D-W33, D-W37, D-W50, D-W59, D-W60 and VSEL-FR-01, VSEL-AC-16, PRJ-FR-01, PRJ-FR-19, LIB-FR-17, PLAN-TGT-FR-01, PLAN-TGT-FR-11 at e4476231; D-W65, D-W66 ("captured" is candidates plus run members) and PRJ-FR-02, PRJ-FR-04, PRJ-FR-21, root FR-023 at d45a22ad; rig names `RedCat` and `Esprit` from J15/S3 and S3a · by: agent (intent-gated, user instruction)
- **Δ3** 2026-10-10 · S1, S2, +S2a, +S2b, S5, S6, S7 · behavior-change
  A Target page no longer starts a run: it offers Add to Plan, Add to Project (previewed first) and New Project. The journey now adds NGC 7000 to the existing Project `Cygnus HOO` (P2) and starts the run there from the Start run sheet; old steps 3 (start a run with no Project) and 4 (create the prefilled Project) are retired.
  The Targets search stars a result from its row menu, with no Add button, and Filters shows a chip per rig filter graded good tonight. Home's top line is gone, so S7 reads the Sessions box. G3 is retired; G6 records what stays out of scope.
  Evidence: HARNESS-V5-IA.md §Screens S1, S3, S10 ("Target detail: … Add to Plan, Add to Project (previewed first) or New Project"), S12; HARNESS-V5-FEEDBACK-R1.md §B "Start run sheet", §Round 5 "Home has no issues strip", "Click a result to act", P-PLAN2 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-10 · by: JourneysV5.U2Projects (intent-gated)
