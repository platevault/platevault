---
id: J14
title: Add a Target and sessions to an existing Project
version: 6
status: draft
last_reviewed: 2026-07-14
actors: [primary-user]
surfaces: [targets, planning, projects, sessions, home, view]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D-W94, D-W17, D-W23, D-W30, D-W96, D-W36, D-W95, D-W47, D-W59, D-W60, D-W61, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S12, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-PLAN2, apps/prototype/src/features/v5/e-targets-plan-settings/target.tsx, apps/prototype/src/features/v5/a-home/parts.tsx, 068-calibration-inputs, 069-application-handoff, D-W93, D-W97, D-W98, D-W99, D-W100, D-W101, D-W102, D-W103, D-W104, D-W105, D-W106, FR-033, FR-034, FR-035, LIB-FR-17, LIB-FR-20, LIB-FR-23, PRJ-FR-01, PRJ-FR-02, PRJ-FR-04, PRJ-FR-05, PRJ-FR-07, PRJ-FR-08, PRJ-FR-09, PRJ-FR-31, VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16]
---

## Goal

The user knows what to shoot and process next: NGC 7000. They find it on the
Targets page and check that it fits their `RedCat` rig. A Target page cannot
start processing, so from NGC 7000's Target page they add it to `Cygnus HOO`, the
Project they already keep for the Cygnus region. They then add the five available
RedCat sessions to the Project and apply its first View. Later the user adds the
other-camera session to the same Project from the **Not in any Project** filter.
Done means:
- NGC 7000 is a subject of `Cygnus HOO`; NGC 6888 and its goals are unchanged. The five available RedCat sessions are in the Project and its View is built from their originals.
- The Project groups its sessions by rig and framing, and the user explicitly adds sessions; matching suggestions are not added automatically.
- The Project and its Target stay linked by identity, including after the Project is renamed.
- Adding the other-camera session adds its rig and session to the Project with a visible note, and the Project's groups update after Apply.
- No original capture file or library quality state changes; the View is the only fixture output.

## Preconditions

- P1: J19 completed through S15. All seven light sessions are Ready, fully reviewed, have settled calibration assignments, and have Target NGC 7000: 24 and 26 Sep are Confirmed, and 12, 18, 28 and 30 Sep and the other-camera session are Associated by pointing within NGC 7000's footprint (OBJECT never counts). The six RedCat sessions read rig `RedCat`, the other-camera session reads rig `Esprit`, and `Cold-1` is offline.
- P2: My targets has no ★ favourite. Exactly one Project exists: `Cygnus HOO`, open, created with New Project as in J20/S2 with the single subject NGC 6888, rig `RedCat` and the built-in HOO goal template (Ha 10h and OIII 10h). No session has Target NGC 6888, and the Project holds no sessions.
- P3: Settings > Equipment holds rig `RedCat` (RedCat 51 + ASI2600MM) as J15/S2 to S4 create it, with a 250 mm focal length and the ASI2600MM sensor size and pixel size, so its field of view is known. Its filter list holds Ha and OIII.
- P4: A manifest (relative path, size, SHA-256) of every file under the J19 folders, recorded outside PlateVault before S1, with `Cold-1` remounted for the recording and ejected again afterwards.

## Steps

### S1 — Find NGC 7000 on the Targets page {#S1}

- **Do:** From Home, open **Targets**. Search for `ngc7000`. Open the NGC 7000 result row's menu and choose **Add ★**. In the toolbar rig selector, choose `RedCat`.
- **Expect:** Targets opens on **My targets**, which lists NGC 6888, with the badge `Project Cygnus HOO`, and NGC 7000, with no ★ and no badge, because it has indexed sessions (PLAN-TGT-FR-01, D-W125; owner's answer, 2026-10-19, astro-plan-rzbzu.1). The search lists NGC 7000 with its source, and `ngc7000` matches the same Target as `NGC 7000`. After **Add ★**, NGC 7000 is listed under My targets with ★ set. Choosing the rig adds a Fit column, and NGC 7000's Fit reads fits, with its coverage: its major axis is about 2° against the rig's 3.6° shorter side. The Filters column shows one chip per `RedCat` filter, Ha and OIII, each graded good tonight.
- **Expect (negative):** No result row carries an Add button. Starring a Target creates no Project, adds no subject and assigns no session to anything.
- **Trace:** Targets list · HARNESS-V5-IA.md S10 · HARNESS-V5-FEEDBACK-R1.md Round 5 "Click a result to act", P-PLAN2 · PLAN-TGT-FR-01, PLAN-TGT-FR-03, PLAN-TGT-FR-11, PLAN-TGT-FR-06 · PLAN-TGT-AC-03, PLAN-TGT-AC-11 · D-W17, D-W23, D-W61

### S2 — Open the Target page {#S2}

- **Do:** In the search results, which still list NGC 7000, click NGC 7000's result row.
- **Expect:** NGC 7000 is now in My targets, so the click opens NGC 7000's Target page. Its captured time reads Ha 12h35 and OIII 10h35, with the seven sessions listed by night, channel, frames and rig: six on `RedCat` and one on `Esprit`. Its header offers **Add to Plan**, **Add to Project** and **New Project…**, and its Projects box reads `No Project`.
- **Expect (negative):** The Target page offers no processing action. The click adds nothing: My targets still lists NGC 7000 once, with ★ set.
- **Trace:** LIB-FR-08 · LIB-AC-05 · PRJ-FR-01, PRJ-FR-02 · D-W94, D-W96

### S2a — Add NGC 7000 to Cygnus HOO {#S2a}

- **Do:** Open **Add to Project** and choose `Cygnus HOO`.
- **Expect:** **Add to Project** lists the open Projects that lack NGC 7000: exactly `Cygnus HOO`. Adding NGC 7000 makes it a Project subject; the Target page's Projects box lists `Cygnus HOO`, Open. Its Sessions step suggests the six matching RedCat sessions, including 12 Sep with its last-observed contribution. The NGC 7000 goals read Ha `0h00 in project · 9h15 captured · goal 10h` and OIII `0h00 in project · 10h35 captured · goal 10h`; both are unmet. "captured" counts matching suggestions, not only sessions already added to the Project. **Add to Project** is unavailable because NGC 7000 is already a subject of every open Project.
- **Expect (negative):** Adding the subject adds no rig or session, so `Esprit` stays off the Project and its suggestions. It changes no source file or quality decision, and leaves NGC 6888 and its goals unchanged.
- **Trace:** PRJ-FR-01, PRJ-FR-02, PRJ-FR-04, PRJ-FR-09 · PRJ-AC-03 · D-W94, D-W96

### S2b — Add RedCat sessions and apply the View {#S2b}

- **Do:** Open `Cygnus HOO` from the Target page's Projects box. On Sessions, open **Add sessions…**, select the five available RedCat sessions dated 18, 24, 26, 28 and 30 Sep, and add them. Open View, keep the default **Symlinks** mode, choose **Apply…**, review the changes and folder tree, then apply.
- **Expect:** The Project has subjects NGC 6888 and NGC 7000, rig `RedCat`, and the five chosen sessions in groups by rig and framing. The Sessions step shows the other matching RedCat suggestion as Offline, not added. The Apply sheet lists the five additions and the new View folder tree. After applying, `Cygnus HOO/View/` contains the five sessions in the layout for their groups and nights. NGC 7000's goals read Ha `9h15 in project · 9h15 captured · goal 10h` and OIII `8h35 in project · 10h35 captured · goal 10h`; both are unmet.
- **Expect (negative):** The Project adds no session without the user's action. The offline 12 Sep original is not needed by this Apply; no original is moved, renamed or modified, and no quality state changes. The Project stays Open, and no goal reads "in project" above "captured".
- **Trace:** PRJ-FR-04, PRJ-FR-07, PRJ-FR-08, PRJ-FR-27, PRJ-FR-31 · VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · FR-033, FR-034 · D-W94, D-W95, D-W96, D-W100

### S5 — Read the Project sessions and groups {#S5}

- **Do:** On the Project's Sessions step, read the groups, their sessions and the suggestions.
- **Expect:** The Project's Sessions step lists the five added RedCat sessions in their rig and framing groups. The 12 Sep RedCat session remains an Offline suggestion with its last-observed values. The other-camera session is not suggested while `Esprit` is absent from the Project's rig list.
- **Expect (negative):** Suggestions do not become Project sessions until the user adds them. No action on this page changes the source files or library quality.
- **Trace:** PRJ-FR-07, PRJ-FR-08, PRJ-FR-09, PRJ-FR-27, PRJ-FR-31 · VSEL-FR-03, VSEL-FR-09 · LIB-FR-17, LIB-FR-20, LIB-FR-23 · D-W94, D-W95, D-W96, D-W105

### S6 — Check the link from both sides and rename {#S6}

- **Do:** Open Targets on My targets, then open NGC 7000's Target page and choose `Cygnus HOO` in its Projects box. On the Project header, choose **Edit…**, change the name to `Cygnus HOO bicolour` and save, then open NGC 7000's Target page again. Open **Projects**, open the `Cygnus HOO bicolour` row's menu, choose **Edit…**, change the name back to `Cygnus HOO` and save.
- **Expect:** My targets lists NGC 7000 with ★ and the badge `Project Cygnus HOO`. The Target page lists the Project, and choosing it opens the Project page with NGC 7000 among its subjects. **Edit…** offers the Project's name and notes from the header and row menu. After each rename, the Project header, My targets badge and Target page's Projects box show the new name; its subjects, groups and sessions remain linked to the same Project identity.
- **Expect (negative):** Renaming leaves the subject and its Target attached because the link is by identity. Neither rename changes the Project's notes, goals, groups or sessions. The View does not change before Apply.
- **Trace:** PRJ-FR-01, PRJ-FR-05, PRJ-FR-07 · PLAN-TGT-FR-01 · D-W94, D-W97, D-W100

### S7 — Add the other-camera session from Not in any Project {#S7}

- **Do:** Open Sessions and choose the **Not in any Project** filter. On the other-camera session's row, choose **Add to Project** and pick `Cygnus HOO`; note the visible rig addition. Add the session. Return to the Project's Sessions step.
- **Expect:** Before adding it, **Not in any Project** lists exactly the other-camera session, and its **Add to Project** action notes that it adds rig `Esprit`. After adding, the Project lists both rigs and the Esprit session in a group; Ha reads `12h35 in project · 12h35 captured · goal 10h`. The session no longer appears under **Not in any Project**.
- **Expect (negative):** Adding the session changes no source file or library quality state. The existing RedCat sessions and their group remain in the Project; the View stays unchanged until Apply.
- **Trace:** LIB-FR-17, LIB-FR-20, LIB-FR-23 · PRJ-FR-02, PRJ-FR-05, PRJ-FR-08, PRJ-FR-27, PRJ-FR-31 · VSEL-FR-12 · D-W94, D-W95, D-W96, D-W100, D-W105

### S8 — Confirm there were no side effects {#S8}

- **Do:** Outside PlateVault, remount `Cold-1`, recompute the P4 manifest and eject `Cold-1` again. In Sessions, read the quality of every frame.
- **Expect:** Every path, size and SHA-256 in the original J19 folders equals P4. Every frame retains its library quality state.
- **Expect (negative):** Applying the View and adding the Esprit session moves, renames or writes no original capture file, and changes no library quality state.
- **Trace:** PRJ-FR-05 · PRJ-AC-02 · VSEL-FR-14, VSEL-FR-16 · FR-034

## Success criteria

- SC1: After S2a, `Cygnus HOO` has subjects NGC 6888 and NGC 7000 and no added sessions. After S2b, it holds exactly five available RedCat sessions and has one View built from them; no source files or quality states change.
- SC2: After S2a, NGC 7000's Ha reads 9h15 captured and OIII reads 10h35 captured, both with 0h00 in project and unmet, and NGC 6888's 2 goals are unchanged.
- SC3: S5 lists five RedCat sessions in Project groups, 0 Esprit sessions and the offline 12 Sep session as a suggestion.
- SC4: After each S6 rename, the badge, Target page and Project page show the same Project name; the subject NGC 7000 remains linked to the Project.
- SC5: After S7, the Project has 2 rigs and 6 sessions, including the Esprit session; Ha reads 12h35 in project and 12h35 captured.
- SC6: The S8 manifest of original J19 files equals P4 for 100% of paths, sizes and hashes, and 0 frames change library quality state.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Expected behavior follows specs 063 to 072 at head and workflow decisions D-W93 to D-W116. No implementation has been validated against the F4 Project model.
- G2: Unresolved implementation qualification: S1 assumes NGC 7000's catalogued major axis is about 2°. The bundled catalogue's size value has not been checked, so the exact coverage behind "fits" is unverified. Blocks readiness.
- G4: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S2b now asserts that Start run auto-names the run `NGC 7000 RedCat` and that Rename on the run header renames it to `NGC7000-HOO-Siril` without touching a file or the selection.
- G5: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S6 now asserts Edit details (name, notes) on the Project header and in the Projects row menu, and that both renames keep the Project–Target link and the run's name.
- G6: Out of scope for this journey: editing mosaic panel groups (J33) and removing a subject or rig from the suggestion criteria (J20/S9).
- G7: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W94's rig list that only decides suggestions (S2a, S5, S7), D-W96's matching rule and its "captured" count of every matching suggestion (S2a, S2b, S5, S7), and D-W100's rule that the first Apply builds the View with no separate Start processing (S2b). If the owner changes one, the steps that cite it change.

## Delta log
- **Δ2** 2026-10-06 · S1, S2, S5, S6, S7, +S8 · behavior-change
  Every processing run now lives in a Project. Starting a run from a Target first asks for Create Project or Add to Project, the Project is prefilled from the Target, and the run is created inside it. The Targets list (My targets, search, rig selector, Fit) replaces the planner columns, and Add to Project from Not in any Project adds the session's rig with a note. The legacy wizard defects of v1 no longer apply.
  Evidence: D-W1, D-W8, D-W17, D-W23, D-W33, D-W37, D-W50, D-W59, D-W60 and VSEL-FR-01, VSEL-AC-16, PRJ-FR-01, PRJ-FR-19, LIB-FR-17, PLAN-TGT-FR-01, PLAN-TGT-FR-11 at e4476231; D-W65, D-W66 ("captured" is candidates plus run members) and PRJ-FR-02, PRJ-FR-04, PRJ-FR-21, root FR-023 at d45a22ad; rig names `RedCat` and `Esprit` from J15/S3 and S3a · by: agent (intent-gated, user instruction)
- **Δ3** 2026-10-12 · S1, S2, +S2a, +S2b, S5, S6, S7 · behavior-change
  A Target page no longer starts a run: it offers Add to Plan, Add to Project (previewed first) and New Project. The journey now adds NGC 7000 to the existing Project `Cygnus HOO` (P2) and starts the run there from the Start run sheet; old steps 3 (start a run with no Project) and 4 (create the prefilled Project) are retired.
  The Targets search stars a result from its row menu, with no Add button, and Filters shows a chip per rig filter graded good tonight. Home's top line is gone, so S7 reads the Sessions box. P1 follows J19 v3 (Targets Confirmed or Associated by pointing). G3 is retired; G6 records what stays out of scope.
  Evidence: HARNESS-V5-IA.md §Screens S1, S3, S10 ("Target detail: … Add to Plan, Add to Project (previewed first) or New Project"), S12; HARNESS-V5-FEEDBACK-R1.md §B "Start run sheet", §Round 5 "Home has no issues strip", "Click a result to act", "OBJECT is a label, never evidence", P-PLAN2 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); J19 v3; user instruction 2026-10-12 · by: JourneysV5.U2Projects (intent-gated)
- **Δ4** 2026-10-12 · S2, S2b, S6 · behavior-change
  Start run auto-names the run `NGC 7000 RedCat`, and S2b renames it to `NGC7000-HOO-Siril` with Rename on the run header. S6 renames the Project with Edit details (name, notes) on the Project header and back again from the Projects row menu.
  S2 opens the Target page by clicking its search result, because a result already in My targets opens. G4 and G5 are dissolved.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Rename runs and Projects", "Clicking a result" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6C (intent-gated)
- **Δ5** 2026-10-15 · S2, S2a, S2b, S5, S6, S7, S8 · behavior-change
  The Project holds sessions in groups by rig and framing; users add sessions explicitly, and Apply builds the Project's View from originals. Processing no longer uses a separate run, revisions or run folders.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, FR-033 to FR-035, LIB-FR-17, LIB-FR-20, LIB-FR-23, PRJ-FR-01, PRJ-FR-02, PRJ-FR-04, PRJ-FR-05, PRJ-FR-07 to PRJ-FR-09, PRJ-FR-27, PRJ-FR-31, VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-19 · S1 · behavior-change
  My targets lists every Target with at least one session, so S1 lists NGC 7000 before **Add ★**.
  Evidence: D-W125, PLAN-TGT-FR-01 · owner's answer, 2026-10-19 in astro-plan-rzbzu.1 · by: Main (intent-gated)
