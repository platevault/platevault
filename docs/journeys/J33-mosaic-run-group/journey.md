---
id: J33
title: Process a mosaic as a run group with one run per panel
version: 3
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, mosaic-editor, project-trash, view-review, frame-review, calibration, preparation, results, home]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 066-view-selection, 067-frame-review, 068-calibration-inputs, 069-application-handoff, 070-results-reuse, D04, D19, D-W4, D-W5, D-W26, D-W29, D-W38, D-W41, D-W47, D-W51, D-W54, D-W55, D-W67, D-W72, D-W73, D-W75, specs/063-clean-rebuild-contract/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S7, HARNESS-V5-IA.md#S8, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-CAL3, P-PREP2, apps/prototype/src/features/v5/b-projects/mosaic-editor.tsx, apps/prototype/src/features/v5/c-runs/group.tsx]
---

## Goal

The user processes the four-panel Veil mosaic in Project `Veil Mosaic HOO`.
In the mosaic editor, one frame, the user lays out the panel grid on the field
from the rig's field of view, adds a panel and excludes it, and sees each
session placed on a panel by its pointing, with the rest flagged for the user
to place or leave out. Confirming creates run group `Veil Mosaic` with one
panel run per included panel, and the group reads as one run model: an
overall status plus each panel's own status. The user sets up the group once,
reviews every panel's frames in one list, matches calibration masters per
panel, and prepares all panels into one folder that WBPP can load. The user
then picks up each panel's Results from that panel's own Results folder and an
assembled mosaic from the group's Results folder. Done means the four panel
runs hold 40, 30, 30 and 20 lights, and the excluded panel has no run but
keeps its goals on the subject, shown as unmet. They are
prepared under `Work/Processing/Veil Mosaic HOO/Veil Mosaic/Panel 1/` to
`Panel 4/`, and each panel run's Results come only from its own
`Veil Mosaic Results/Panel N/` folder. Every Results folder sits outside the
group folder `Veil Mosaic/` that PixInsight loads. A re-prepared Panel 2
revision lands in a new `Veil Mosaic (rev 2)/` folder with its own `Panel N/`
folders, while the first folder stays unchanged. Panel 2's Results of both
revisions come from the one `Veil Mosaic Results/Panel 2/` folder, and each
names the revision it came from: by tool evidence where the file carries it,
otherwise the revision current when it appeared, marked Inferred. The
prepared entries are independent copies whose footprint is shown, and
completing a panel run offers to clean them up. The assembled image saved to
`Veil Mosaic Results/Assembled/` is the group Result candidate and is accepted
with lineage Unknown. A panel moved to the Project Trash is listed as Trashed
and its frames leave the counts until it is restored exactly as it was. No
panel run's status, membership or revision changes because of another panel or
the group Result.

## Preconditions

- P1: The J19 catalog exists with rig `RedCat` (RedCat 51 + ASI2600MM), whose field of view (about 5.4° × 3.6°) is known as J15/S2 to S4 set it up, and no Project named `Veil Mosaic HOO` exists.
- P2: `Astro-T7/Captures` holds eight further sessions of mono 300 s lights on rig `RedCat`, at the J19 gain, offset, temperature and binning. They are indexed, with confirmed Target Veil Nebula and confirmed rig `RedCat`. The 17 Aug Target was confirmed by hand because it has no pointing.

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

- P3: Panel geometry for the Veil mosaic: the mosaic editor's 2 × 2 layout, drawn from `RedCat`'s field of view around the Veil Nebula's catalogued centre, gives four panel centres and one rotation. Recorded outside PlateVault, they produce the P2 pointing column, and no P2 session points inside a panel added beside the 2 × 2 grid (S1b).
- P4: Calibration masters only (P-CAL3), in the Calibration library and filed in structured calibration storage on `Astro-T7`, each stacked through a calibration process as in J36 or filed with Import masters: master darks that match the P2 lights exactly; master flats A, Ha and OIII per night, filed under `Flats/RedCat/<filter>/<night>/` and matching the nights of 10, 11, 12, 14 and 15 Aug; master flat B, Ha, filed under `Flats/RedCat/Ha/13 Aug/` and matching 13 Aug; and a 17 Aug Ha master flat whose header carries no optical-train evidence (G7). No raw calibration frame is assigned to any run.
- P5: PixInsight is installed. Its WBPP profile is configured in PlateVault with recorded evidence that it reads input folders and never writes into its input files (D04).
- P6: `Work/Processing` exists on `Astro-T7`, writable. `Astro-T7` is formatted exFAT, which cannot clone, so every prepared entry is a copy; the volume has free space for two sets of copies of the 120 lights (S8, S13).
- P7: Two named 12 Aug frames, Q1 and Q2, whose read permission the user can remove and restore.
- P8: Test images kept outside PlateVault, none of which carries tool evidence of its inputs unless stated: one per panel for the `Veil Mosaic Results/Panel N/` folders, `Panel4_OIII_drizzle.xisf`, whose file name names Panel 4, `Veil_HOO_mosaic.xisf`, `stray.xisf`, `Panel2_rev2_stack.xisf`, and `Panel2_rev1_late.xisf`, whose header records its input list: the 30 Panel 2 lights of saved membership revision 1, Q2 included.

## Steps

### S1 — Create the Project {#S1}

- **Do:** Click **New Project…**. Enter `Veil Mosaic HOO`. In the subject search, type `Veil` and click the Veil Nebula result. Tick rig `RedCat`, choose the template HOO and click **Create Project**.
- **Expect:** The Project page opens with subject Veil Nebula, rig `RedCat` and goals Ha 10h and OIII 10h. Ha reads `0h00 in project · 6h40 captured · goal 10h` and OIII reads `0h00 in project · 4h10 captured · goal 10h`. Candidates lists the eight P2 sessions, and Runs reads `No runs yet`.
- **Expect (negative):** The New Project sheet offers no mosaic or panel entry. Creating the Project changes no file, creates no run and changes no quality state.
- **Trace:** HARNESS-V5-IA.md S4 ("Mosaic subjects are added on the Project page") · PRJ-FR-01, PRJ-FR-03, PRJ-FR-05 · PRJ-AC-13, PRJ-AC-14 · D-W29, D-W47

### S1a — Lay out the panels in the mosaic editor {#S1a}

- **Do:** In Subjects, click **New mosaic**. In the editor's search, click the Veil Nebula result. Name the mosaic `Veil Mosaic`, keep rig `RedCat`, and choose the 2 × 2 layout. Read the field and the Sessions list.
- **Expect:** The mosaic editor opens on the Project page (`?mosaic=new`) as one frame, with the field on the left and Sessions on the right. The 2 × 2 layout draws Panels 1 to 4 on the field from `RedCat`'s field of view around the Veil Nebula, and the header reads `4/4 panels`. Sessions are placed by pointing: 10 and 11 Aug on Panel 1, 12 Aug on Panel 2, 13 Aug on Panel 3 and 14 Aug on Panel 4, each reason naming the pointing inside that panel. 15 Aug is flagged Ambiguous, naming Panels 1 and 2, 16 Aug is flagged Off panel, and 17 Aug No pointing. Sessions reads `5 placed` and `3 flagged`, and the header shows `3 flags`.
- **Expect (negative):** Nothing is saved while the editor is open: Subjects still lists Veil Nebula as a plain Target, and no run exists. 17 Aug shows no distance of 0, no flagged session is placed on a panel, and PlateVault draws no stitched image.
- **Trace:** Mosaic editor · HARNESS-V5-IA.md S3 (`?mosaic=new|<subjectId>`) · HARNESS-V5-FEEDBACK-R1.md §B "Mosaic flow (one frame)" · VSEL-FR-05, VSEL-FR-07, VSEL-FR-18 · D-W38, D-W73

### S1b — Add a panel and exclude it {#S1b}

- **Do:** Click **Add panels**, add one panel beside the grid, and click **Done adding**. Then click Panel 5 on the field to exclude it.
- **Expect:** Panel 5 is drawn beside the grid and listed under Panels, and the header reads `5/5 panels`. After the click, Panel 5 is drawn as excluded and the header reads `4/5 panels`. No session is placed on Panel 5, and the S1a placements are unchanged.
- **Expect (negative):** Adding or excluding a panel saves nothing and moves no session to another panel.
- **Trace:** Mosaic editor · HARNESS-V5-FEEDBACK-R1.md §B "Mosaic flow (one frame)" ("add or remove panels, and include or exclude each"), Round 6 "Mosaic: an excluded panel keeps its goals" · D-W38, D-W73

### S1c — Place the flagged sessions {#S1c}

- **Do:** Drag 15 Aug onto Panel 2. From 17 Aug's menu, choose **Place on** › Panel 3. From 16 Aug's menu, choose **Leave out**.
- **Expect:** 15 Aug reads placed on Panel 2 and 17 Aug placed on Panel 3, each with the reason `Placed by you`. 16 Aug reads `Left out`. Sessions reads `7 placed` and `1 out`, and the header shows no flag.
- **Expect (negative):** Placing a session changes no header, Target or pointing.
- **Trace:** Mosaic editor · HARNESS-V5-FEEDBACK-R1.md §B "Mosaic flow (one frame)" ("drag or assign to a panel; flags for ambiguous or off-panel sessions") · VSEL-FR-18 · VSEL-AC-21 · PV-VSEL-SC-04 · D-W38

### S2 — Start the group {#S2}

- **Do:** Click **Start group**.
- **Expect:** PlateVault creates run group `Veil Mosaic` with four panel runs, Panel 1 to Panel 4, each tied to one panel, and opens the group at its Select step. 10 and 11 Aug are in Panel 1, 12 and 15 Aug in Panel 2, 13 and 17 Aug in Panel 3, and 14 Aug in Panel 4. The reasons for 15 and 17 Aug name the user's placement, and every other reason names the session's pointing inside that panel. The subject reads `Veil Mosaic`, with goals Ha 10h and OIII 10h for each of Panels 1 to 4, each reading `0h00 in project`. Captured reads Ha 1h40 and OIII 1h40 for Panel 1, Ha 1h40 for Panels 2 and 3, and OIII 1h40 for Panel 4. The subject keeps the excluded Panel 5 with its own goals, Ha 10h and OIII 10h, each reading `0h00 in project` and shown as unmet.
- **Expect (negative):** The excluded Panel 5 gets no panel run, and its goals are neither dropped nor met. 16 Aug is in no panel run. No session joined a panel without pointing evidence or the user's placement. No folder is created on disk and no quality state changes.
- **Trace:** Mosaic run group · HARNESS-V5-FEEDBACK-R1.md §B "Confirm creates the run group with only the included panels", Round 6 "Mosaic: an excluded panel keeps its goals" · VSEL-FR-01, VSEL-FR-03, VSEL-FR-04, VSEL-FR-18 · VSEL-AC-21 · PRJ-FR-10 · D-W38, D-W73

### S2a — Read the excluded panel's goals and its place in the mosaic {#S2a}

- **Do:** On the Project page, read the Goals section. Open Home and read the Goals box. Return to the Project, open `Veil Mosaic` in the mosaic editor from Subjects, click Panel 5 to include it, read the header, click Panel 5 again to exclude it, and close the editor.
- **Expect:** The Project's Goals lists Ha 10h and OIII 10h for each of Panels 1 to 5, all unmet; Panel 5's read `0h00 in project`. Home's Goals box lists `Veil Mosaic · Panel 5` with Ha 10h00 and OIII 10h00, beside Panels 1 to 4. The mosaic editor (`?mosaic=<subjectId>`) draws Panel 5 as excluded; clicking it marks it included and the header reads `5/5 panels`, and clicking it again returns `4/5 panels`.
- **Expect (negative):** Closing the editor saves nothing: the group still holds 4 panel runs, no run exists for Panel 5, and Panel 5's goals stay on the subject, unmet.
- **Trace:** Mosaic editor, Goals · HARNESS-V5-IA.md S1 Goals, S3 (`?mosaic=new|<subjectId>`) · HARNESS-V5-FEEDBACK-R1.md Round 6 "Mosaic: an excluded panel keeps its goals" ("so a later group can include it (its goals show as unmet)") · PRJ-FR-04, PRJ-FR-17 · D-W36, D-W38

### S3 — Read the group as one run model {#S3}

- **Do:** Read the group page and the Project's Runs table. Then, on the Project page, click **Start run**, choose subject `Veil Mosaic`, read the sheet's button, and cancel.
- **Expect:** The group shows its overall status, the worst across its panels, with `4 of 4 panels at Select`, and each panel row shows exactly the step and status a single run shows: Select, Open. The summary shows Panel 1 40 lights / 3h 20m, Panels 2 and 3 30 lights / 2h 30m each, Panel 4 20 lights / 1h 40m, and the group 120 lights / 10h 00m. The Project's Runs table, which lists single runs and groups together, lists `Veil Mosaic` as one row with its name, step Select, status Open and when it was updated. For subject `Veil Mosaic`, the Start run sheet's button reads **Place panels**, which leads to the mosaic editor.
- **Expect (negative):** No single whole-mosaic run is offered, and cancelling creates no run or group.
- **Trace:** Mosaic run group · HARNESS-V5-FEEDBACK-R1.md Round 5 "Runs read as one model" · HARNESS-V5-IA.md S3 Runs, S7 · VSEL-FR-05, VSEL-FR-07, VSEL-FR-08 · D-W38

### S5 — Set the shared setup and save {#S5}

- **Do:** In the group, choose profile WBPP, read the input mode choices, keep **Independent copy** and calibration policy automatic. Click **Save run** for the group. Open Panel 4 alone and move it to its Review step. Read the group's status and the Project's panel goals.
- **Expect:** The input mode offers **Independent copy** (the default, selected), **Link to originals** with a warning, and **Give PixInsight the file list**, which is offered because the profile is WBPP. All four panel runs show profile WBPP, input mode Independent copy and calibration policy automatic. Each panel run reads saved membership revision 1. Panel 4 reads Review, as a single run at Review does, and Panels 1, 2 and 3 read Select; the group's overall status reads `3 of 4 panels at Select`. Panel 2 and Panel 3 read Ha `2h30 in project`, Panel 1 reads Ha and OIII `1h40 in project`, and Panel 4 reads OIII `1h40 in project`.
- **Expect (negative):** Moving Panel 4 changes no other panel run's step. Saving changes no quality state and creates no folder.
- **Trace:** Mosaic run group · HARNESS-V5-IA.md S7 shared setup · HARNESS-V5-FEEDBACK-R1.md Round 5 "Runs read as one model", §Input modes P-PREP2 · VSEL-FR-16, VSEL-FR-18, VSEL-FR-19 · VSEL-AC-22 · PRJ-FR-04 · D-W38, D-W41

### S5a — Move a panel to the Trash and restore it {#S5a}

- **Do:** Open Panel 4's panel run and click **Move to Trash…**. Read the preview and confirm. Read the group and the Project's goals. Open the Project's Trash and restore Panel 4's run.
- **Expect:** The preview lists Panel 4's run going to the Project Trash and `Its members stop counting toward goals`. After confirming, the group lists Panel 4 as Trashed and reads `3 panels` with `1 in Trash`, and its counts leave out Panel 4's frames: the group reads 100 lights / 8h 20m. Panel 4's OIII goal reads `0h00 in project`. The Project's Trash lists Panel 4's run with the step it was at, Review. After **Restore**, Panel 4 is back exactly as it was: at Review, at saved membership revision 1, with profile WBPP and OIII `1h40 in project`. The group reads 120 lights / 10h 00m and `4 panels` again.
- **Expect (negative):** Moving to the Trash and restoring moves, deletes or writes no file and changes no frame's quality. Neither changes another panel run's step, membership or setup.
- **Trace:** Run group Trash · HARNESS-V5-IA.md S7 ("A trashed panel is listed as Trashed and its frames leave the counts"), S8 Project Trash · D-W72, D-W75

### S6 — Review all panels in one list {#S6}

- **Do:** Click **Review all**. Wait for measurement to complete. Set the Panel filter to Panel 2. Make Q1 current and press **X**, then press **←** and **U**.
- **Expect:** Frame review lists all 120 frames with a Panel column. The Panel 2 filter lists exactly the 30 Panel 2 frames. **X** makes Q1 read Rejected with scope Library, Panel 2's draft holds 29 lights and lists Q1 with the reason "Rejected", and the next frame becomes current. After **U**, Q1 reads Unreviewed and Panel 2's draft holds 30 lights again. Every panel run reads Review.
- **Expect (negative):** Marking Q1 changes no other frame's quality and no other panel run's draft. Every frame stays in its own panel run's membership. The saved membership revisions are unchanged.
- **Trace:** Run-group review across panels · VSEL-FR-15, VSEL-FR-19, PIX-FR-13, PIX-FR-14, PIX-FR-17 · PIX-AC-18, VSEL-AC-22 · D-W41, D-W54

### S7 — Match calibration per panel {#S7}

- **Do:** Open the group's **Calibrate** step. Read each panel's readiness line. In Panel 3 open **Review matches**, and for the 17 Aug Ha flat requirement record a scoped exception with the reason `train unknown, flats taken same night`.
- **Expect:** The group lists one readiness line per panel run. Panels 1, 2 and 4 read Calibration ready, with master flats A assigned Automatic. Panel 3 assigns master flat B to 13 Aug as Automatic and reads 1 needs review, naming Panel 3 and the 17 Aug Ha flat requirement. After the exception, Panel 3's 17 Aug row reads Excepted with its reason, and Panel 3 reads ready.
- **Expect (negative):** The unresolved requirement and the exception change no assignment in Panels 1, 2 and 4, and the exception does not apply in another panel run. No match with an unknown criterion is assigned automatically, and no raw calibration frame is offered for assignment.
- **Trace:** Run-group calibration per panel · HARNESS-V5-IA.md S7 calibration readiness per panel · HARNESS-V5-FEEDBACK-R1.md Round 1b P-CAL3 ("runs are assigned masters only") · CAL-FR-02, CAL-FR-05, CAL-FR-09, CAL-FR-11 · CAL-AC-13 · D-W5, D-W41, D-W55

### S8 — Review Prepare all {#S8}

- **Do:** Click **Prepare all**. Choose `Work/Processing` as the parent folder. Read the review.
- **Expect:** The review lists `Work/Processing/Veil Mosaic HOO/Veil Mosaic/Panel 1/` to `Panel 4/`. It lists each panel run's Results folder, `Work/Processing/Veil Mosaic HOO/Veil Mosaic Results/Panel 1/` to `Panel 4/`, and the group Results folder `Veil Mosaic Results/Assembled/`. Each panel shows its entry count, covering 40, 30, 30 and 20 lights, and its own calibration choices. Panel 3 is named with its exception. Profile WBPP, input mode Independent copy and calibration policy automatic appear once, with one total footprint and the free space. The footprint is the actual extra space: the 120 lights' and their assigned masters' total size, read as copied, because `Astro-T7` cannot clone (P6).
- **Expect (negative):** Nothing is created under `Work/Processing` before approval. No Results folder is inside the group folder `Veil Mosaic/` or a prepared `Panel N/` folder. No `Panel 5/` folder is proposed for the excluded Panel 5.
- **Trace:** Run group: Prepare all and the panel folder layout · HARNESS-V5-IA.md S7 · HARNESS-V5-FEEDBACK-R1.md §Input modes P-PREP2 ("Footprint is real") · PREP-FR-06, PREP-FR-07, PREP-FR-12 · PREP-AC-16 · D-W38, D-W41, D-W51, D-W73

### S9 — Prepare all with a blocked panel {#S9}

- **Do:** With the review open, remove read permission from Q1 and Q2. Approve **Prepare all**.
- **Expect:** Panels 1, 3 and 4 read Prepared. Panel 2 reads Partial and lists Q1 and Q2 as blocked items with the reason. The group reads Partial and lists each panel's outcome. **Open** is offered on Panels 1, 3 and 4.
- **Expect (negative):** **Open** on the group folder is not offered. Panel 2's blocked items do not change Panels 1, 3 and 4. Q1, Q2 and every other source are untouched.
- **Trace:** Run group: Prepare all and the panel folder layout · PREP-FR-09, PREP-FR-12, PREP-FR-13 · PREP-AC-17 · D-W38

### S10 — Retry the blocked panel {#S10}

- **Do:** Restore read permission on Q1 and Q2. Click **Retry** on Panel 2. Then click **Open** on the group folder and quit PixInsight.
- **Expect:** Panel 2 reads Prepared, and the group reads Prepared. Every prepared item records that it was copied, and every verified entry in `Veil Mosaic/` is read-only. **Open** on the group folder appears, re-verifies every panel's entries, and launches PixInsight on `Work/Processing/Veil Mosaic HOO/Veil Mosaic/`, which holds only the four `Panel N/` folders. The launch is recorded separately from processing.
- **Expect (negative):** Retry does not re-create Panels 1, 3 and 4. Quitting PixInsight marks no panel run Complete. The folder PixInsight loads holds no Results folder, so a later pass never reads a panel's own output as input.
- **Trace:** Run group: Prepare all and the panel folder layout · PREP-FR-10, PREP-FR-12, PREP-FR-13 · D-W38, D-W51

### S11 — Discover panel Results and the group candidate {#S11}

- **Do:** Outside PlateVault, copy one P8 panel image into each of `Veil Mosaic Results/Panel 1/` to `Panel 4/`. Copy `Panel4_OIII_drizzle.xisf` into `Veil Mosaic Results/Panel 2/`, `Veil_HOO_mosaic.xisf` into `Veil Mosaic Results/Assembled/`, and `stray.xisf` into `Veil Mosaic/Panel 1/`. Open the group's **Results** step.
- **Expect:**
  - Each panel run lists exactly the candidates in its own `Veil Mosaic Results/Panel N/` folder. Panel 2 lists `Panel4_OIII_drizzle.xisf` too, because it was written to Panel 2's folder.
  - The group lists `Veil_HOO_mosaic.xisf` from `Veil Mosaic Results/Assembled/` as a group Result candidate of kind Assembled mosaic.
  - Each discovered Result names the group preparation it came from, `Veil Mosaic`, and is marked Inferred: none carries tool evidence (P8), and `Veil Mosaic` was the revision current when each file appeared. **Attach Result** is visible beside the discovered list.
- **Expect (negative):** `stray.xisf` is not discovered. Panel 4 does not list `Panel4_OIII_drizzle.xisf`, whatever its file name says, and no candidate is listed as unplaced. Nothing is accepted automatically.
- **Trace:** Run group Results: per-panel Results folders and the optional group Result · RES-FR-01, RES-FR-02, RES-FR-08 · RES-AC-11 · D-W4, D-W51, D-W67, D-W73

### S12 — Accept a panel Result and the group Result {#S12}

- **Do:** Inspect and accept Panel 1's result. Inspect and accept `Veil_HOO_mosaic.xisf` as the group Result.
- **Expect:** Panel 1's result appears on Panel 1. The group Result appears on run group `Veil Mosaic`, on Project `Veil Mosaic HOO` and on subject `Veil Mosaic`, with lineage Unknown and the SHA-256 recorded at acceptance.
- **Expect (negative):** Accepting the group Result changes no panel run's status, membership or revision. The lineage does not claim the panel Results as inputs.
- **Trace:** Run group Results: per-panel Results folders and the optional group Result · RES-FR-04, RES-FR-08 · RES-AC-11 · D19, D-W38, D-W73

### S13 — Re-prepare one panel into a new group folder {#S13}

- **Do:** Record a listing (path, inode, size) of `Veil Mosaic/` outside PlateVault. In the group's Review, set the Panel filter to Panel 2, make Q2 current and press **X**, then click **Save run**. Click **Prepare** on Panel 2, read the review, and approve.
- **Expect:** Q2 reads `Rejected · Library` and leaves Panel 2's draft, and Panel 2 reads saved membership revision 2 with 29 lights. The review proposes the new group folder `Work/Processing/Veil Mosaic HOO/Veil Mosaic (rev 2)/`, with a `Panel N/` folder inside it for every panel run, `Panel 1/` to `Panel 4/`, and its footprint read as copied. It names `Veil Mosaic Results/Panel 2/` as Panel 2's unchanged Results folder, which serves both revisions. After approval, `Veil Mosaic (rev 2)/Panel 2/` holds 29 lights and every panel reads Prepared.
- **Expect (negative):** `Veil Mosaic/` and its `Panel N/` folders equal the recorded listing, and no existing folder is reused or cleared. The previous group folder stays until the user approves its cleanup. No second Results folder is proposed, and none is inside `Veil Mosaic (rev 2)/`. Pressing X moves no file: Q2 stays in `Astro-T7/Captures`, and no panel run other than Panel 2 changes its draft.
- **Trace:** Run group: Prepare all and the panel folder layout · HARNESS-V5-FEEDBACK-R1.md Round 6 "Reject is library-wide by default" · PREP-FR-06, PREP-FR-07, PREP-FR-11, PREP-FR-13 · PREP-AC-18 · D-W51, D-W67, D-W73

### S14 — Discover a Result from the new revision {#S14}

- **Do:** Outside PlateVault, copy `Panel2_rev2_stack.xisf` and then `Panel2_rev1_late.xisf` (P8) into `Veil Mosaic Results/Panel 2/`. Open the group's **Results** step again.
- **Expect:** Panel 2 lists both new candidates. `Panel2_rev2_stack.xisf`, which carries no tool evidence, names `Veil Mosaic (rev 2)`, the revision current when it appeared, and is marked Inferred. `Panel2_rev1_late.xisf` names `Veil Mosaic`, revision 1, decided by its tool evidence: its header's input list is Panel 2's revision 1 membership. The S11 candidates, in the same `Veil Mosaic Results/Panel 2/` folder, still name `Veil Mosaic`, marked Inferred. The group Result accepted at S12 is unchanged.
- **Expect (negative):** Appearing after the rev 2 preparation does not make `Panel2_rev1_late.xisf` name rev 2, and it is not marked Inferred. No candidate is discovered inside `Veil Mosaic (rev 2)/`, no other panel lists the new candidates, and nothing is accepted automatically.
- **Trace:** Run group Results: per-panel Results folders and the optional group Result · HARNESS-V5-FEEDBACK-R1.md Round 6 "Result revision" · RES-FR-01, RES-FR-08 · RES-AC-16 · D-W67, D-W73

### S15 — Complete each panel run {#S15}

- **Do:** Mark each of the four panel runs processing complete. Read each run's **Clean up prepared copies** offer, and close it without approving.
- **Expect:** Each panel run reads Complete with its own Results, and completing it offers **Clean up prepared copies**, on by default, showing that run's footprint as copied bytes. The group lists all four as Complete.
- **Expect (negative):** Completing and closing the offer remove no file: every prepared copy stays in place, and nothing goes to the OS Trash without an approved review. No panel run waits on the group Result or on another panel.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Input modes "Prepared copies are cleaned up when a run is done" · RES-FR-06, RES-FR-08 · RES-AC-12 · D-W26, D-W38

## Success criteria

- SC1: At S1a exactly 5 sessions are placed by pointing and exactly 3 are flagged. At S2, 0 sessions joined a panel without pointing or the user's placement, and at S3, 0 whole-mosaic runs are offered.
- SC2: After S2 the group holds exactly 4 panel runs, and 0 for the excluded Panel 5, which keeps 2 unmet goals (S2, S2a). They hold 40, 30, 30 and 20 lights and the group 120 lights / 10h 00m, with 16 Aug in 0 panel runs.
- SC3: At S6 marking Q1 changes exactly 1 frame's quality and 1 panel draft; the Panel 2 filter lists exactly 30 frames.
- SC4: At S7 the Panel 3 exception changes 0 assignments in Panels 1, 2 and 4.
- SC5: At S9 the group reads Partial with exactly Panel 2 Partial and 2 blocked items, and the group-folder Open is absent; after S10 the group reads Prepared.
- SC6: At S11 `stray.xisf` is discovered 0 times, `Panel4_OIII_drizzle.xisf` is listed under Panel 2 only, 0 candidates are unplaced, and exactly 1 group Result candidate is listed, from `Veil Mosaic Results/Assembled/`. All 6 discovered files sit outside `Veil Mosaic/`, and all 6 are marked Inferred. S12 changes 0 panel statuses, memberships or revisions.
- SC7: After S13 `Veil Mosaic/` equals its recorded listing and `Veil Mosaic (rev 2)/` holds 4 panel folders.
- SC8: At S5a, with Panel 4 in the Trash, the group reads 100 lights and lists Panel 4 as Trashed. After Restore, Panel 4 reads Review at saved membership revision 1 and the group reads 120 lights.
- SC9: At S14 Panel 2 lists exactly 2 new candidates: `Panel2_rev2_stack.xisf` names rev 2 and is marked Inferred, and `Panel2_rev1_late.xisf` names revision 1 by tool evidence; 0 other panels list them. At S15, 4 Clean up prepared copies offers appear and 0 files move.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, apps/prototype/design/ on ui-harness-v5 @ b5e813a5), the specs, decisions D04 and D19, and workflow decisions D-W29, D-W38, D-W41, D-W51, D-W55, D-W67, D-W72, D-W73 and D-W75. No implementation has been validated against them.
- G2: Unresolved implementation qualification: the WBPP profile's capability probe (D04) and the folder input it uses are not qualified. Blocks readiness.
- G3: Unresolved implementation qualification: the panel-assignment geometry rule (pointing inside a panel's footprint drawn from the rig's field of view, D-W38) has no fixed tolerance, and the overlap between the editor's panels is not specified. The P3 layout must place each P2 session by an unambiguous margin once the rule is chosen. Blocks readiness.
- G4: Out of scope for this journey: Cancel or Pause of Prepare all, a group whose every panel fails, cleanup of the previous `Veil Mosaic/` folder (which must leave `Veil Mosaic Results/` in place), a run group with no group Result (RES-AC-12 in its stated form), and removing a panel in the mosaic editor, which is refused while a run uses it, are not exercised. Blocks readiness until covered by a step or a journey.
- G5: (dissolved 2026-10-12): answered by Round 6 "Result revision"; S11 and S14 now assert that tool evidence (a header input list) decides the revision and that, without it, the revision current when the file appeared applies, marked Inferred.
- G6: (dissolved 2026-10-12): answered by Round 6 "Mosaic: an excluded panel keeps its goals"; S2 and S2a now assert that Panel 5 keeps its goals on the subject, shown as unmet on the Project's Goals and Home's Goals box, with no panel run, and stays includable in the mosaic editor.
- G7: Unresolved implementation qualification: P-CAL3 files master flats by optical train, filter and night (`Flats/<train>/<filter>/<night>/`, HARNESS-V5-IA.md Round 2b), but the S7 edge case needs a 17 Aug Ha master flat with no optical-train evidence. Where such a master is filed and how the Calibration library lists it is not specified, so P4 cannot yet be established. Blocks readiness.

## Delta log

- **Δ2** 2026-10-12 · S1, +S1a, +S1b, +S1c, S2, S3, S5, +S5a, S7, S8 · behavior-change
  The mosaic is laid out in the one-frame mosaic editor: the panel grid comes from the rig's field of view, panels are added and excluded, sessions are placed by pointing or by the user, and Start group creates the group with only the included panels. The New Project sheet no longer takes a mosaic, and old step 4 (resolve flagged sessions after the group exists) is retired into S1c.
  The group reads as one run model in the Project's Runs table, a trashed panel leaves the counts until restored (S5a), and calibration assigns masters only (P4, S7).
  Evidence: HARNESS-V5-IA.md §Screens S3, S4, S7, S8, §Round 2b foundation (structured calibration storage); HARNESS-V5-FEEDBACK-R1.md §B "Mosaic flow (one frame)", §Round 1b P-CAL3, §Round 5 "Runs read as one model"; D-W75 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); J36 calibration process; user instruction 2026-10-12 · by: JourneysV5.U2Projects (intent-gated)
- **Δ3** 2026-10-12 · S2, +S2a, S5, S8, S10, S11, S13, S14, S15 · behavior-change
  The excluded Panel 5 keeps its unmet goals on the subject (S2, S2a). A Result's revision comes from tool evidence, else the revision current when it appeared, marked Inferred (S11, S14). X replaces Exclude from run (S13).
  Prepare uses Independent copy with a real footprint read as copied (S5, S8, S10), and completing a panel run offers Clean up prepared copies (S15). G5 and G6 are dissolved.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Mosaic: an excluded panel keeps its goals", "Result revision", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); §Input modes (user, 2026-10-10) P-PREP2, "Prepared copies are cleaned up when a run is done" (@ d609ff55); user answers to the PR #1788 journey questions · by: JourneysV5.R6C (intent-gated)
