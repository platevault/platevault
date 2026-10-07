---
id: J33
title: Process a mosaic as a run group with one run per panel
version: 1
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [projects, view-review, frame-review, calibration, preparation, results]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 066-view-selection, 067-frame-review, 068-calibration-inputs, 069-application-handoff, 070-results-reuse, D04, D19, D-W4, D-W5, D-W26, D-W29, D-W38, D-W41, D-W47, D-W51, D-W54, D-W55, D-W67, D-W73, specs/063-clean-rebuild-contract/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/067-frame-review/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md]
---

## Goal

The user processes the four-panel Veil mosaic in Project `Veil Mosaic HOO`.
Starting a processing run on the mosaic subject creates run group
`Veil Mosaic`, with one panel run per panel. PlateVault assigns each session to
a panel by its pointing and flags the rest for the user. The user sets up the
group once, reviews every panel's frames in one list, matches calibration per
panel, and prepares all panels into one folder that WBPP can load. The user
then picks up each panel's Results from that panel's own Results folder and an
assembled mosaic from the group's Results folder. Done means the four panel
runs hold 40, 30, 30 and 20 lights. They are prepared under
`Work/Processing/Veil Mosaic HOO/Veil Mosaic/Panel 1/` to `Panel 4/`, and each
panel run's Results come only from its own `Veil Mosaic/Panel N Results/`
folder. A re-prepared Panel 2 revision lands in a new `Veil Mosaic (rev 2)/`
folder with its own `Panel N/` folders, while the first folder stays
unchanged. Panel 2's Results of both revisions come from the one
`Veil Mosaic/Panel 2 Results/` folder, and each names the revision it came
from. The assembled image saved to `Veil Mosaic Results/` is the group Result
candidate and is accepted with lineage Unknown. No panel run's status,
membership or revision changes because of another panel or the group Result.

## Preconditions

- P1: The J19 catalog exists with rig `RedCat` (RedCat 51 + ASI2600MM), and no Project named `Veil Mosaic HOO` exists.
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

- P3: Panel definitions for the Veil mosaic: four centres (RA/Dec) and one rotation, kept outside PlateVault, that produce the P2 pointing column.
- P4: Calibration fixture in `Astro-T7/Calibration`, indexed. Darks match the P2 lights exactly. Flat set A (Ha and OIII) has RedCat optical-train evidence and matches the nights of 10, 11, 12, 14 and 15 Aug. Flat set B (Ha) has RedCat optical-train evidence and matches 13 Aug. The 17 Aug Ha flats have no optical-train evidence.
- P5: PixInsight is installed. Its WBPP profile is configured in PlateVault with recorded evidence that it reads input folders and never writes into its input files (D04).
- P6: `Work/Processing` exists on `Astro-T7`, writable, with free space for the four panels' links.
- P7: Two named 12 Aug frames, Q1 and Q2, whose read permission the user can remove and restore.
- P8: Test images kept outside PlateVault: one per panel for the `Panel N Results/` folders, `Panel4_OIII_drizzle.xisf`, whose file name names Panel 4, `Veil_HOO_mosaic.xisf`, and `stray.xisf`.

## Steps

### S1 — Create the mosaic Project {#S1}

- **Do:** Click **New Project**. Enter `Veil Mosaic HOO`. Add subject Veil Nebula, mark it **Mosaic**, name it `Veil Mosaic`, and enter the four P3 panels by centre and rotation. Add rig `RedCat` and apply the built-in HOO goal template. Save.
- **Expect:** The Project lists subject `Veil Mosaic` with Panels 1 to 4 and rig `RedCat`. Each panel has its own goals, Ha 10h and OIII 10h, each showing "in project" and "captured". All read `0h 00m in project`. Captured reads Ha 1h 40m and OIII 1h 40m for Panel 1, Ha 1h 40m for Panels 2 and 3, and OIII 1h 40m for Panel 4. The Project page lists the eight sessions as candidates, and 15, 16 and 17 Aug count toward no panel.
- **Expect (negative):** Creating the Project changes no file, creates no run and changes no quality state.
- **Trace:** PRJ-FR-01, PRJ-FR-03, PRJ-FR-05 · PRJ-AC-13, PRJ-AC-14 · D-W29, D-W38, D-W47

### S2 — Start a run on the mosaic subject {#S2}

- **Do:** On the Project page click **Start a processing run**. Choose subject `Veil Mosaic` and rig `RedCat`. Read the panels the creation step lists and confirm them.
- **Expect:** The only choice offered for the mosaic subject is a run group. The creation step lists Panels 1 to 4 with their centres and rotation. After the user confirms them, PlateVault creates run group `Veil Mosaic` with four panel runs, Panel 1 to Panel 4, each tied to one panel and at its Select step. 10 and 11 Aug join Panel 1, 12 Aug joins Panel 2, 13 Aug joins Panel 3 and 14 Aug joins Panel 4. Each reason names the session's pointing inside that panel. 15 Aug is flagged as in Panels 1 and 2, 16 Aug as outside every panel, and 17 Aug as Position unknown. Each flagged session waits for the user to assign a panel or leave it out.
- **Expect (negative):** No single whole-mosaic run is offered. No flagged session joins a panel run, and no session joins a panel without pointing evidence. No folder is created on disk.
- **Trace:** Mosaic run group · VSEL-FR-01, VSEL-FR-03, VSEL-FR-04, VSEL-FR-18 · VSEL-AC-21 · PRJ-FR-10 · D-W38, D-W73

### S3 — Read panel coverage {#S3}

- **Do:** Toggle **Sky coverage**. Set the Panel filter to Panel 1, then to Flagged, then clear it. Read the group summary.
- **Expect:** Sky coverage draws four panel outlines from their centres and rotation, each with its assigned sessions. Panel 1 lists 10 and 11 Aug. Flagged lists exactly 15, 16 and 17 Aug. The summary shows each panel run and the group: Panel 1 40 lights / 3h 20m, Panels 2, 3 and 4 20 lights / 1h 40m each, and the group 100 lights / 8h 20m.
- **Expect (negative):** 17 Aug shows no distance of 0. PlateVault draws no stitched image.
- **Trace:** Mosaic run group · VSEL-FR-05, VSEL-FR-07, VSEL-FR-08 · D-W38

### S4 — Resolve the flagged sessions {#S4}

- **Do:** Assign 15 Aug to Panel 2 and 17 Aug to Panel 3. Leave 16 Aug out.
- **Expect:** Panel 2 holds 12 and 15 Aug (30 lights / 2h 30m) and Panel 3 holds 13 and 17 Aug (30 lights / 2h 30m). The reason for 15 Aug and 17 Aug reads as the user's assignment. 16 Aug is in no panel run. The group reads 120 lights / 10h 00m.
- **Expect (negative):** Assigning a panel changes no header, Target or pointing. 16 Aug joins no panel run.
- **Trace:** Mosaic run group · VSEL-FR-18 · VSEL-AC-21 · PV-VSEL-SC-04 · D-W38

### S5 — Set the shared setup and save {#S5}

- **Do:** In the group, choose profile WBPP, input mode Linked and calibration policy automatic. Click **Save run** for the group. Open Panel 4 alone and move it to its Review step. Read the group's status list and the Project's panel goals.
- **Expect:** All four panel runs show profile WBPP, input mode Linked and calibration policy automatic. Each panel run reads saved membership revision 1. The group lists Panel 4 at Review and Panels 1, 2 and 3 at Select. Panel 2 and Panel 3 read Ha `2h 30m in project`, Panel 1 reads Ha and OIII `1h 40m in project`, and Panel 4 reads OIII `1h 40m in project`.
- **Expect (negative):** Moving Panel 4 changes no other panel run's step. Saving changes no quality state and creates no folder.
- **Trace:** Mosaic run group · VSEL-FR-16, VSEL-FR-18, VSEL-FR-19 · VSEL-AC-22 · PRJ-FR-04 · D-W38, D-W41

### S6 — Review all panels in one list {#S6}

- **Do:** Click **Review all**. Wait for measurement to complete. Set the Panel filter to Panel 2. Make Q1 current and press **X**, then press **←** and **U**.
- **Expect:** Frame review lists all 120 frames with a Panel column. The Panel 2 filter lists exactly the 30 Panel 2 frames. **X** makes Q1 read Rejected with scope Library, Panel 2's draft holds 29 lights and lists Q1 with the reason "Rejected", and the next frame becomes current. After **U**, Q1 reads Unreviewed and Panel 2's draft holds 30 lights again. Every panel run reads Review.
- **Expect (negative):** Marking Q1 changes no other frame's quality and no other panel run's draft. Every frame stays in its own panel run's membership. The saved membership revisions are unchanged.
- **Trace:** Run-group review across panels · VSEL-FR-15, VSEL-FR-19, PIX-FR-13, PIX-FR-14, PIX-FR-17 · PIX-AC-18, VSEL-AC-22 · D-W41, D-W54

### S7 — Match calibration per panel {#S7}

- **Do:** Open the group's **Calibrate** step. Read each panel's readiness line. In Panel 3 open **Review matches**, and for the 17 Aug Ha flat requirement record a scoped exception with the reason `train unknown, flats taken same night`.
- **Expect:** The group lists one readiness line per panel run. Panels 1, 2 and 4 read Calibration ready with Flat set A assigned Automatic. Panel 3 assigns Flat set B to 13 Aug as Automatic and reads 1 needs review, naming Panel 3 and the 17 Aug Ha flat requirement. After the exception, Panel 3's 17 Aug row reads Excepted with its reason, and Panel 3 reads ready.
- **Expect (negative):** The unresolved requirement and the exception change no assignment in Panels 1, 2 and 4, and the exception does not apply in another panel run. No match with an unknown criterion is assigned automatically.
- **Trace:** Run-group calibration per panel · CAL-FR-02, CAL-FR-05, CAL-FR-09, CAL-FR-11 · CAL-AC-13 · D-W5, D-W41, D-W55

### S8 — Review Prepare all {#S8}

- **Do:** Click **Prepare all**. Choose `Work/Processing` as the parent folder. Read the review.
- **Expect:** The review lists `Work/Processing/Veil Mosaic HOO/Veil Mosaic/Panel 1/` to `Panel 4/`. It lists each panel run's Results folder, `Veil Mosaic/Panel 1 Results/` to `Panel 4 Results/`, and the group Results folder `Work/Processing/Veil Mosaic HOO/Veil Mosaic Results/`. Each panel shows its entry count, covering 40, 30, 30 and 20 lights, and its own calibration choices. Panel 3 is named with its exception. Profile WBPP, input mode Linked and calibration policy automatic appear once, with one total footprint and the free space.
- **Expect (negative):** Nothing is created under `Work/Processing` before approval. The group Results folder is not inside `Veil Mosaic/`, and no `Panel N Results/` folder is inside a prepared `Panel N/` folder.
- **Trace:** Run group: Prepare all and the panel folder layout · PREP-FR-06, PREP-FR-07, PREP-FR-12 · PREP-AC-16 · D-W38, D-W41, D-W51, D-W73

### S9 — Prepare all with a blocked panel {#S9}

- **Do:** With the review open, remove read permission from Q1 and Q2. Approve **Prepare all**.
- **Expect:** Panels 1, 3 and 4 read Prepared. Panel 2 reads Partial and lists Q1 and Q2 as blocked items with the reason. The group reads Partial and lists each panel's outcome. **Open** is offered on Panels 1, 3 and 4.
- **Expect (negative):** **Open** on the group folder is not offered. Panel 2's blocked items do not change Panels 1, 3 and 4. Q1, Q2 and every other source are untouched.
- **Trace:** Run group: Prepare all and the panel folder layout · PREP-FR-09, PREP-FR-12, PREP-FR-13 · PREP-AC-17 · D-W38

### S10 — Retry the blocked panel {#S10}

- **Do:** Restore read permission on Q1 and Q2. Click **Retry** on Panel 2. Then click **Open** on the group folder and quit PixInsight.
- **Expect:** Panel 2 reads Prepared, and the group reads Prepared. **Open** on the group folder appears, re-verifies every panel's entries, and launches PixInsight on `Work/Processing/Veil Mosaic HOO/Veil Mosaic/`. The launch is recorded separately from processing.
- **Expect (negative):** Retry does not re-create Panels 1, 3 and 4. Quitting PixInsight marks no panel run Complete.
- **Trace:** Run group: Prepare all and the panel folder layout · PREP-FR-10, PREP-FR-12, PREP-FR-13 · D-W38, D-W51

### S11 — Discover panel Results and the group candidate {#S11}

- **Do:** Outside PlateVault, copy one P8 panel image into each of `Veil Mosaic/Panel 1 Results/` to `Panel 4 Results/`. Copy `Panel4_OIII_drizzle.xisf` into `Veil Mosaic/Panel 2 Results/`, `Veil_HOO_mosaic.xisf` into `Veil Mosaic Results/`, and `stray.xisf` into `Veil Mosaic/Panel 1/`. Open the group's **Results** step.
- **Expect:**
  - Each panel run lists exactly the candidates in its own `Panel N Results/` folder. Panel 2 lists `Panel4_OIII_drizzle.xisf` too, because it was written to Panel 2's folder.
  - The group lists `Veil_HOO_mosaic.xisf` from `Veil Mosaic Results/` as a group Result candidate of kind Assembled mosaic.
  - Each discovered Result names the group preparation it came from, `Veil Mosaic`. **Attach Result** is visible beside the discovered list.
- **Expect (negative):** `stray.xisf` is not discovered. Panel 4 does not list `Panel4_OIII_drizzle.xisf`, whatever its file name says, and no candidate is listed as unplaced. Nothing is accepted automatically.
- **Trace:** Run group Results: per-panel Results folders and the optional group Result · RES-FR-01, RES-FR-02, RES-FR-08 · RES-AC-11 · D-W4, D-W51, D-W67, D-W73

### S12 — Accept a panel Result and the group Result {#S12}

- **Do:** Inspect and accept Panel 1's result. Inspect and accept `Veil_HOO_mosaic.xisf` as the group Result.
- **Expect:** Panel 1's result appears on Panel 1. The group Result appears on run group `Veil Mosaic`, on Project `Veil Mosaic HOO` and on subject `Veil Mosaic`, with lineage Unknown and the SHA-256 recorded at acceptance.
- **Expect (negative):** Accepting the group Result changes no panel run's status, membership or revision. The lineage does not claim the panel Results as inputs.
- **Trace:** Run group Results: per-panel Results folders and the optional group Result · RES-FR-04, RES-FR-08 · RES-AC-11 · D19, D-W38, D-W73

### S13 — Re-prepare one panel into a new group folder {#S13}

- **Do:** Record a listing (path, inode, size) of `Veil Mosaic/` outside PlateVault. In Panel 2, choose **Exclude from run** for Q2 and click **Save run**. Click **Prepare** on Panel 2, read the review, and approve.
- **Expect:** Panel 2 reads saved membership revision 2 with 29 lights. The review proposes the new group folder `Work/Processing/Veil Mosaic HOO/Veil Mosaic (rev 2)/`, with a `Panel N/` folder inside it for every panel run, `Panel 1/` to `Panel 4/`. It names `Veil Mosaic/Panel 2 Results/` as Panel 2's unchanged Results folder, which serves both revisions. After approval, `Veil Mosaic (rev 2)/Panel 2/` holds 29 lights and every panel reads Prepared.
- **Expect (negative):** `Veil Mosaic/` and its `Panel N/` folders equal the recorded listing, and no existing folder is reused or cleared. The previous group folder stays until the user approves its cleanup. No second Results folder is proposed.
- **Trace:** Run group: Prepare all and the panel folder layout · PREP-FR-06, PREP-FR-07, PREP-FR-11, PREP-FR-13 · PREP-AC-18 · D-W51, D-W67, D-W73

### S14 — Discover a Result from the new revision {#S14}

- **Do:** Outside PlateVault, copy a second P8 panel image into `Veil Mosaic/Panel 2 Results/`. Open the group's **Results** step again.
- **Expect:** Panel 2 lists the new candidate, naming `Veil Mosaic (rev 2)` as the preparation it came from. The S11 candidates, in the same `Panel 2 Results/` folder, still name `Veil Mosaic`. The group Result accepted at S12 is unchanged.
- **Expect (negative):** No candidate is discovered inside `Veil Mosaic (rev 2)/`, and no other panel lists the new candidate.
- **Trace:** Run group Results: per-panel Results folders and the optional group Result · RES-FR-01, RES-FR-08 · RES-AC-16 · D-W67, D-W73 · G5

### S15 — Complete each panel run {#S15}

- **Do:** Mark each of the four panel runs processing complete.
- **Expect:** Each panel run reads Complete with its own Results, and each offers Clean up as a separate action. The group lists all four as Complete.
- **Expect (negative):** Completing removes no file. No panel run waits on the group Result or on another panel.
- **Trace:** RES-FR-06, RES-FR-08 · RES-AC-12 · D-W26, D-W38

## Success criteria

- SC1: At S2 exactly 5 sessions join a panel by pointing and exactly 3 are flagged, with 0 sessions joining a panel without pointing or a user choice; 0 whole-mosaic runs are offered.
- SC2: After S4 the panel runs hold 40, 30, 30 and 20 lights and the group 120 lights / 10h 00m, with 16 Aug in 0 panel runs.
- SC3: At S6 marking Q1 changes exactly 1 frame's quality and 1 panel draft; the Panel 2 filter lists exactly 30 frames.
- SC4: At S7 the Panel 3 exception changes 0 assignments in Panels 1, 2 and 4.
- SC5: At S9 the group reads Partial with exactly Panel 2 Partial and 2 blocked items, and the group-folder Open is absent; after S10 the group reads Prepared.
- SC6: At S11 `stray.xisf` is discovered 0 times, `Panel4_OIII_drizzle.xisf` is listed under Panel 2 only, 0 candidates are unplaced, and exactly 1 group Result candidate is listed; S12 changes 0 panel statuses, memberships or revisions.
- SC7: After S13 `Veil Mosaic/` equals its recorded listing and `Veil Mosaic (rev 2)/` holds 4 panel folders.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, decisions D04 and D19, and workflow decisions D-W29, D-W38, D-W41, D-W51, D-W55, D-W67 and D-W73. No implementation has been validated against them.
- G2: Unresolved implementation qualification: the WBPP profile's capability probe (D04) and the folder input it uses are not qualified, and the flow names no control for naming a mosaic subject or entering panel centres and rotation (S1). Blocks readiness.
- G3: Unresolved implementation qualification: the panel-assignment geometry rule (pointing inside a panel's centre-and-rotation footprint, D-W38) has no fixed tolerance. The P3 panel definitions must place each P2 session by an unambiguous margin once the rule is chosen. Blocks readiness.
- G4: Out of scope for this journey: Cancel or Pause of Prepare all, a group whose every panel fails, cleanup of the previous `Veil Mosaic/` folder, and a run group with no group Result (RES-AC-12 in its stated form) are not exercised. Blocks readiness until covered by a step or a journey.
- G5: Unresolved product question: RES-FR-01 and RES-AC-16 require each discovered Result to record the prepared revision it came from, but do not say how PlateVault decides it. S14 assumes that a file which appears after the rev 2 preparation names rev 2. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
