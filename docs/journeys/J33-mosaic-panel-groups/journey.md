---
id: J33
title: Process a mosaic with Project panel groups
version: 8
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, sessions, calibration, view, output, wrap-up, home]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 066-view-selection, 067-frame-review, 068-calibration-inputs, 069-application-handoff, 070-results-reuse, D04, D19, D-W98, D-W5, D-W26, D-W29, D-W95, D-W41, D-W47, D-W78, D-W101, D-W100, D-W94, specs/063-clean-rebuild-contract/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S7, HARNESS-V5-IA.md#S8, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-CAL3, P-PREP3, apps/prototype/src/features/v5/b-projects/mosaic-editor.tsx, 064-library-inventory, 071-storage-custody, D-W93, D-W99, D-W105, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/071-storage-custody/spec.md, D-W107, D-W114]
---

## Goal

The user organizes the seven in-scope Veil sessions in Project `Veil Mosaic HOO` into four groups marked as mosaic panels. Each panel shows its own progress and goals on a panel map. The user applies a View built from the original captures, opens it in WBPP, and places each panel's result under `Output/Panels/` and the assembled mosaic in `Output/`. The user assembles the mosaic in PixInsight. Done means the panel groups contain 40, 30, 30 and 20 lights, the View paths use `PANEL_<name>/` and the appropriate night/filter layout, all six output files are visible as Results without acceptance or lineage, and Wrap up retains `Output/` when the Project closes.

## Preconditions

- P1: The J19 catalog exists with rig `RedCat` (RedCat 51 + ASI2600MM), whose field of view (about 5.4° × 3.6°) is known as J15/S2 to S4 set it up, and no Project named `Veil Mosaic HOO` exists.
- P2: `Astro-T7/Captures` holds eight further Ready sessions of mono 300 s lights on rig `RedCat`, at the J19 gain, offset, temperature and binning. Their Target and rig are confirmed and each session's darks, flats and bias are pinned or explicitly set to No darks, No flats or No bias. The user adds the seven sessions dated 10 to 15 and 17 Aug; 16 Aug is outside every panel and is not added.

  | Session | Channel | Frames | Pointing |
  |---|---|---|---|
  | 10 Aug | Ha | 20 | inside Panel 1 only |
  | 11 Aug | OIII | 20 | inside Panel 1 only |
  | 12 Aug | Ha | 20 | inside Panel 2 only |
  | 13 Aug | Ha | 20 | inside Panel 3 only |
  | 14 Aug | OIII | 20 | inside Panel 4 only |
  | 15 Aug | Ha | 10 | inside both Panel 1 and Panel 2 |
  | 16 Aug | OIII | 10 | inside the Veil Nebula framing, outside every panel |
  | 17 Aug | Ha | 10 | none (Position unknown) |

- P3: The four panel framings are recorded by the captures' pointing and rotation evidence, with a 20% overlap between adjacent framings. This is within the default 5 to 40% overlap at which PlateVault offers groups as mosaic panels (D-W114). The P2 pointings place the 10 and 11 Aug sessions in Panel 1, 12 Aug in Panel 2, 13 Aug in Panel 3, and 14 Aug in Panel 4. Intake split each night by framing, so each session has one framing (D-W107). The 15 Aug session's framing is ambiguous between Panels 1 and 2; the 17 Aug session has no pointing and starts as Framing unknown.
- P4: The Calibration library contains the master darks and flats for the seven sessions. Calibration was matched at ingestion and pinned on each session; any suggested match was confirmed during import review, and the 17 Aug session is explicitly set to No flats. No raw calibration frame is assigned in the Project.
- P5: PixInsight is installed. Its WBPP profile is configured in PlateVault with recorded evidence that it reads input folders and never writes into its input files (D04).
- P6: `Work/Processing` exists on `Astro-T7`, writable, on the same volume as `Astro-T7/Captures`. `Astro-T7` supports symbolic links. The Project's View mode is Symlinks. On the `desktop-ui` (Windows) lane, Windows Developer Mode is on.
- P7: Two named 12 Aug frames, Q1 and Q2, whose read permission the user can remove and restore.
- P8: Test images are kept outside PlateVault: one panel stack for each of Panels 1 to 4, `Panel4_OIII_drizzle.xisf`, `Veil_HOO_mosaic.xisf`, and `stray.xisf`. None carries input lineage. `Panel4_OIII_drizzle.xisf` is named for Panel 4; S12 copies it into Panel 2's output folder to verify that folder location, not its filename, identifies the panel.


## Steps

### S1 — Create the Project {#S1}
- **Do:** Create `Veil Mosaic HOO` with Veil Nebula as its subject, `RedCat` as its rig and the HOO goals.
- **Expect:** The Project opens with the Ha 10h and OIII 10h goals. Creating it changes no files or library quality.
- **Trace:** PRJ-FR-01, PRJ-FR-03, PRJ-FR-05 · D-W94 to D-W96

### S1a — Add the settled sessions {#S1a}
- **Do:** On Sessions, add the seven Ready, calibration-settled sessions listed in P2. Leave 16 Aug out of the Project.
- **Expect:** The Project contains 120 lights. Suggestions are not added automatically, and no unsettled session can be added.
- **Trace:** PRJ-FR-08, PRJ-FR-09 · LIB-FR-20, LIB-FR-23 · D-W96, D-W105

### S1b — Mark the framing groups as mosaic panels {#S1b}
- **Do:** In the Project's Sessions step, mark the four groups formed by the panel framings as mosaic panels.
- **Expect:** Before marking, Sessions shows the groups PlateVault formed by rig and framing: one for each panel framing (10 and 11 Aug, 12 Aug, 13 Aug and 14 Aug), a fifth group for 15 Aug, whose centre is within the framing margins of neither panel, and 17 Aug flagged Framing unknown in a `RedCat` group. After marking the four panel-framing groups, the Project becomes a mosaic. The groups are named `Panel 1` through `Panel 4`, using a NINA or capture name where present and otherwise numbering them. Their folder keyword will be PANEL only.
- **Trace:** PRJ-FR-31, PRJ-FR-27 to PRJ-FR-29 · D-W95

### S1c — Place the ambiguous and unknown framings {#S1c}
- **Do:** Move 15 Aug to Panel 2 and move 17 Aug from Framing unknown to Panel 3. Do not add 16 Aug.
- **Expect:** The seven sessions are grouped as P3 specifies: 10 and 11 Aug in Panel 1, 12 and 15 Aug in Panel 2, 13 and 17 Aug in Panel 3, and 14 Aug in Panel 4. Unknown pointing is not treated as zero distance.
- **Expect (negative):** Moving sessions between groups changes no capture metadata or library quality. Each move takes a whole session, and no control moves single frames of a session to another panel.
- **Trace:** PRJ-FR-08, PRJ-FR-31, PRJ-FR-27, PRJ-AC-47, VSEL-FR-04, VSEL-FR-12 · D-W95, D-W107

### S2 — Check panel goals and progress {#S2}
- **Do:** Read each panel's Ha and OIII goals and progress on the Project page.
- **Expect:** Each panel has its own goals and counts. The four panels contain 40, 30, 30 and 20 lights respectively, for 120 lights total. Counted at 300 s, Ha reads 1h40 in Panel 1, 2h30 in Panels 2 and 3 and 0 in Panel 4, and OIII reads 1h40 in Panels 1 and 4 and 0 in Panels 2 and 3. The subject's progress identifies the weakest panel, and the subject completes only when every panel meets its goals. Panel balance reads ±10 %, the default, and measures each panel against the panels' mean (1h40 for Ha, 50 min for OIII). Ha is out of balance in Panels 2 and 3 (50 % above) and Panel 4 (100 % below), and its line names the furthest panel: `Panel 4 100% below average · limit ±10%`. OIII is out of balance in all four panels (100 % each way), and on the tie its line names the first panel below: `Panel 2 100% below average · limit ±10%`. The warning copy is provisional, from the prototype.
- **Expect (negative):** The balance warning never blocks completion and is not a goal.
- **Trace:** PRJ-FR-03, PRJ-FR-24, PRJ-AC-13 · D-W90, D-W95 · HARNESS-V5-FEEDBACK-R1.md "Goals, grilling round 4" (mosaic coverage, mosaic panel balance)

### S2a — Read the panel map {#S2a}
- **Do:** Open the linked sky-coverage view and read the panel map.
- **Expect:** The map shows the four panel group outlines from their framings. It does not draw a stitched image or invent a fifth panel.
- **Trace:** VSEL-FR-07, PRJ-FR-29 · D-W95

### S3 — Read Project-level progress {#S3}
- **Do:** Read the Project's panel progress and group list.
- **Expect:** Progress is shown per panel and per panel goal. The panels are groups of one Project, and no whole-mosaic processing state exists. The Project page shows the subject's counted Ha to OIII ratio, 6h40 to 3h20 (2:1), next to the 1:1 ratio its HOO goals imply.
- **Expect (negative):** Channel balance is not offered as a goal.
- **Trace:** PRJ-FR-03, PRJ-FR-07, PRJ-FR-27, PRJ-FR-29 · D-W90, D-W94, D-W95 · HARNESS-V5-FEEDBACK-R1.md "Goals, grilling round 4" (channel balance dropped as a goal)

### S5 — Choose the application and View mode {#S5}
- **Do:** On View, select PixInsight and Symlinks.
- **Expect:** Symlinks is the View mode and Copies is the alternative. The application and mode are Project settings; there is no shared panel setup to save.
- **Trace:** PRJ-FR-07, PREP-FR-01, PREP-FR-04 · D-W81, D-W83, D-W100

### S5a — Set a panel goal {#S5a}
- **Do:** Change Panel 4's OIII goal to 12h.
- **Expect:** The Project shows the revised, still-unmet Panel 4 goal immediately. Goals remain editable while the Project is open and do not change files or require Apply.
- **Trace:** PRJ-FR-03, PRJ-AC-40 · D-W90, D-W96

### S6 — Review the grouped sessions {#S6}
- **Do:** Read the four panel groups, their session lists and frame-quality counts on Sessions.
- **Expect:** Each session appears in its Project group, and the panel group labels correspond to the framing evidence. Frame review is reached through Sessions, not through the Project.
- **Trace:** PRJ-FR-07, PRJ-FR-27, VSEL-FR-02, VSEL-FR-08 · D-W95, D-W100

### S7 — Check session-pinned calibration {#S7}
- **Do:** Open the Project's Calibrate step and read the group-and-night diagram.
- **Expect:** The step is a read-only view of the calibration pinned on each session at ingestion. It shows the panel groups and nights; it offers no per-panel matching or exceptions.
- **Trace:** CAL-FR-09, LIB-FR-23, PRJ-FR-07 · D-W101, D-W105

### S8 — Review the first Apply {#S8}
- **Do:** Choose Apply… on View and read the folder tree and space estimate.
- **Expect:** The Project folder contains `View/`, `Processing/WBPP/` and `Output/`. With four groups, the View tree uses `PANEL_Panel-1/` through `PANEL_Panel-4/`, with hyphenated `NIGHT_` folders, light folders named by filter and exposure, such as `Lights/Ha_300s/`, and assigned `Flats/<filter>/`. The Apply sheet lists the inputs and calibration layout and reads `Linked · 0 B`.
- **Expect (negative):** No file changes before approval. Tools do not write into `Output/`, and no panel-specific processing or Results folder is created.
- **Trace:** PREP-FR-06, PREP-FR-07, PREP-FR-16, PRJ-FR-28 · D-W98 to D-W100

### S9 — Refuse an Apply with unavailable originals {#S9}
- **Do:** After the first Apply, rename Panel 4 to `Panel Four`. Open Apply…, remove read permission from Q1 and Q2, and approve the change.
- **Expect:** Apply names the unavailable originals and fails without swapping the View. The existing panel folder and entries remain unchanged; the rename is still pending.
- **Trace:** PREP-FR-06, PREP-FR-09, VSEL-FR-14 · D-W100

### S10 — Apply the reviewed layout and open PixInsight {#S10}
- **Do:** Restore read permission on Q1 and Q2, Apply again and choose Open in PixInsight.
- **Expect:** Apply rebuilds the View from originals, swaps it in, and reflects the renamed panel folder. Opening verifies the View entries and launches PixInsight on `View/`. Closing PixInsight does not close the Project or report processing completion.
- **Trace:** PREP-FR-06, PREP-FR-10, PREP-FR-18 · D-W100

### S11 — Save panel stacks and assemble the mosaic {#S11}
- **Do:** In PixInsight, process the panels and assemble the mosaic. Save the four panel stacks and `Veil_HOO_mosaic.xisf` outside PlateVault for copying to Output.
- **Expect:** The user, not PlateVault, assembles the mosaic. The panel output folders and the finished mosaic are distinct deliverables.
- **Trace:** PRJ-FR-29, RES-FR-08 · D-W95, D-W98

### S12 — Copy the files to Output {#S12}
- **Do:** Use Copy to Output… for the four panel stacks and copy the finished mosaic into the Project's `Output/` folder. Then copy `Panel4_OIII_drizzle.xisf` into Panel 2's folder under `Output/Panels/`, and save `stray.xisf` outside `Output/`.
- **Expect:** The four panel Results appear under `Output/Panels/`, in folders named like their panel groups. `Veil_HOO_mosaic.xisf` appears in `Output/`. Each file is a Result without acceptance or recorded input lineage.
- **Expect (negative):** `Panel4_OIII_drizzle.xisf` in Panel 2's folder is listed as a sixth Result, under Panel 2; its filename does not reassign it. `stray.xisf` outside `Output/` is not listed.
- **Trace:** RES-FR-01, RES-FR-02, RES-FR-08 · D-W93, D-W98

### S13 — Apply library-wide frame rejections {#S13}
- **Do:** In Sessions, reopen the 12 Aug session's review and mark Q1 and Q2 Unusable. Return to the Project and Apply the pending Library removals.
- **Expect:** The open Project shows two pending removals labelled as Library changes, and its View stays unchanged until Apply. Apply rebuilds the View without those frames from the originals; `Output/` remains unchanged.
- **Expect (negative):** The rejection applies library-wide, not only to this Project. No original is moved by marking a frame Unusable or by Apply.
- **Trace:** LIB-FR-20, VSEL-FR-12, VSEL-FR-15, PREP-FR-06 · D-W78, D-W100

### S14 — Read the Project's Output {#S14}
- **Do:** Open Output and read the panel Results and the finished mosaic.
- **Expect:** The four panel stacks, `Panel4_OIII_drizzle.xisf` and the assembled mosaic appear as six Results. Panel assignment follows the containing folder; PlateVault records no input lineage. The Results remain unchanged after Apply.
- **Trace:** RES-FR-01, RES-FR-06, RES-FR-08 · D-W93, D-W98

### S15 — Trash rejected frames through Wrap up {#S15}
- **Do:** Open Wrap up, remove the View in Clean up, then select the two rejected frames in Trash. Skip Archive and choose Close project…
- **Expect:** Only the Project's library-Unusable frames are offered for the OS Trash, through Wrap up. The two selected captures move to the OS Trash after custody re-verification. The Project closes and `Output/` is kept.
- **Expect (negative):** Clean up does not trash originals. No file in `Output/` is removed, and nothing is permanently deleted.
- **Trace:** PRJ-FR-14 to PRJ-FR-16, STO-FR-01, STO-FR-14, STO-FR-15, RES-FR-06 · D-W43, D-W97

## Success criteria

- SC1: The Project holds exactly 7 sessions in four panel groups with 40, 30, 30 and 20 lights; 16 Aug is not a Project session (S1a, S1c).
- SC2: The Project shows four separate panel-goal sets and a panel map; the weakest panel is visible in Project progress (S2, S2a).
- SC3: Apply builds four `PANEL_` group folders from the originals. A refused Apply leaves the current View unchanged, and a successful Apply includes the reviewed rename (S8, S9, S10).
- SC4: Exactly six files appear as Results: five in panel-group folders under `Output/Panels/`, which are the four panel stacks, one per panel folder, and `Panel4_OIII_drizzle.xisf` under Panel 2, and one assembled mosaic in `Output/`. The filename of a file in a panel folder does not change its panel attribution; none needs acceptance or has recorded lineage (S11, S12, S14).
- SC5: Marking Q1 and Q2 Unusable creates exactly two Library-labelled pending removals; neither the marks nor Apply moves originals, and `Output/` remains unchanged (S13).
- SC6: Wrap up moves exactly two rejected captures to the OS Trash, leaves `Output/` in place, and permanently deletes zero files (S15).
- SC7: At S2, panel balance at ±10 % flags 3 of 4 panels for Ha and 4 of 4 for OIII, names Panel 4 for Ha and Panel 2 for OIII, and blocks 0 completions. At S3 the counted ratio reads 2:1 against the goals' 1:1.

## Known gaps

- G1: Not validated: the rebuilt application has not been validated. Product behavior follows the current specs and D-W93 to D-W116; no implementation has been validated against them.
- G2: Unresolved implementation qualification: the WBPP profile's capability probe and folder input remain unqualified (D04). Blocks readiness.
- G3: Unresolved implementation qualification: the default 5 to 40% overlap rule and framing tolerances (D-W114) have not been validated against the panel fixture. The P3 geometry and the session movements in S1c are explicit fixture data, not claims about automatic assignment outside those conditions. Blocks readiness.
- G4: Out of scope for this journey: canceling Apply, a Project mixing cameras, and reviewing what `View (previous)/` holds after the S10 and S13 swaps (J25/S7c covers that review). Blocks readiness until covered by a step or a journey.
- G5: (dissolved 2026-10-12): answered by Round 6 "Result revision"; S11 and S14 now assert that tool evidence (a header input list) decides the revision and that, without it, the revision current when the file appeared applies, marked Inferred.
- G6: (dissolved 2026-10-12): answered by Round 6 "Mosaic: an excluded panel keeps its goals"; S2 and S2a now assert that Panel 5 keeps its goals on the subject, shown as unmet on the Project's Goals and Home's Goals box, with no panel run, and stays includable in the mosaic editor.
- G7: (dissolved 2026-10-15): P4 now sets the 17 Aug session to No flats (D-W105), so no master flat without optical-train evidence is needed, and S7 only reads the calibration pinned on each session (D-W101).
- G8: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: PRJ-FR-31's "Framing unknown" flag for a session without pointing (D-W107, S1b, S1c), D-W99's provisional WBPP layout (S8, S10), and D-W108's exposure part that ends every light folder name (S8). If the owner changes one, the steps that cite it change.
- G9: D-W136 not observed: no step removes a panel group while one of its goals is hidden, so the journey doesn't show that goal being dropped (PRJ-FR-02, PRJ-AC-50; D-W136; owner's answer, 2026-10-20). Blocks readiness until a fixture does.

## Delta log
- **Δ2** 2026-10-12 · S1, +S1a, +S1b, +S1c, S2, S3, S5, +S5a, S7, S8 · behavior-change
  The mosaic is laid out in the one-frame mosaic editor: the panel grid comes from the rig's field of view, panels are added and excluded, sessions are placed by pointing or by the user, and Start group creates the group with only the included panels. The New Project sheet no longer takes a mosaic, and old step 4 (resolve flagged sessions after the group exists) is retired into S1c.
  The group reads as one run model in the Project's Runs table, a trashed panel leaves the counts until restored (S5a), and calibration assigns masters only (P4, S7).
  Evidence: HARNESS-V5-IA.md §Screens S3, S4, S7, S8, §Round 2b foundation (structured calibration storage); HARNESS-V5-FEEDBACK-R1.md §B "Mosaic flow (one frame)", §Round 1b P-CAL3, §Round 5 "Runs read as one model"; D-W75 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); J36 calibration process; user instruction 2026-10-12 · by: JourneysV5.U2Projects (intent-gated)
- **Δ3** 2026-10-12 · S2, +S2a, S5, S8, S10, S11, S13, S14, S15 · behavior-change
  The excluded Panel 5 keeps its unmet goals on the subject (S2, S2a). A Result's revision comes from tool evidence, else the revision current when it appeared, marked Inferred (S11, S14). X replaces Exclude from run (S13).
  Prepare uses Independent copy, cloned on `Astro-T7` with a real footprint of `0 B extra · cloned` (S5, S8, S10, S13), and completing a panel run offers Clean up prepared copies, which frees no space (S15). G5 and G6 are dissolved.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Mosaic: an excluded panel keeps its goals", "Result revision", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); §Input modes (user, 2026-10-10) P-PREP2, "Prepared copies are cleaned up when a run is done" (@ d609ff55); user answers to the PR #1788 journey questions · by: JourneysV5.R6C (intent-gated)
- **Δ4** 2026-10-12 · S5, S8, S10, S13, S15 · behavior-change
  Run view replaces input mode: the panels prepare as symlinks, with the footprint `Linked · 0 B`. Completing Panel 1 removes its run view and its intermediates through the OS Trash from the Complete confirmation; the other panels keep their views by unticking the offer.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3, "Intermediates cleanup stays" (apps/prototype/design/ on ui-harness-v5 @ 12638a7c; research RUN-VIEWS-OPTIONS.md) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ5** 2026-10-15 · S1, S1a, S1b, S1c, S2, S2a, S3, S5, S5a, S6, S7, S8, S9, S10, S11, S12, S13, S14, S15 · behavior-change
  Mosaic panels are Project groups, calibration is pinned on sessions, Apply builds their View, and panel and assembled Results live in `Output/`. Wrap up keeps Output and is the only route for rejected captures to the OS Trash. Δ2 to Δ4 above stay as the run-group journey's history. S1b names the groups before S1c, S12 places the drizzle file, and Output holds six Results; G7 is dissolved and G8 is new.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, PRJ-FR-03, PRJ-FR-31, PRJ-FR-27 to PRJ-FR-29, VSEL-FR-07, PREP-FR-06, PREP-FR-16, RES-FR-01, RES-FR-08, STO-FR-14 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-16 · S1c · behavior-change
  Sessions split at intake by framing, so each panel group holds whole sessions and S1c moves whole sessions only. The overlap and framing defaults are settled.
  Evidence: D-W107 and D-W114 (owner's answers of 2026-10-15/16) in PR #1804, LIB-FR-04, PRJ-FR-08, PRJ-FR-29, PRJ-FR-31, PRJ-AC-47 · by: SpecF4Answers (intent-gated)
- **Δ7** 2026-10-16 · S8 · behavior-change
  Light folders end in their exposure, such as `Lights/Ha_300s/` (provisional), while flat folders keep the filter name.
  Evidence: D-W108 as amended by the owner's second batch of 2026-10-16 in PR #1804, PREP-FR-16, PREP-AC-32 · by: EncodeOwnerAnswers2 (intent-gated)
- **Δ8** 2026-10-17 · S2, S3, +SC7 · behavior-change
  Panel balance (±10 % by default) flags each panel outside the band around the panels' mean and names the furthest one per channel, without blocking completion (S2). The Project page shows the subject's counted channel ratio next to the ratio its goals imply, with no channel-balance goal (S3).
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C7 and "Goals, grilling round 4" · D-W90 · PRJ-FR-03, PRJ-FR-24, PRJ-AC-13 · prototype derive.ts panelBalance, messages domain_balance_below (ui-harness-v5) · by: JourneysR9c (intent-gated)
