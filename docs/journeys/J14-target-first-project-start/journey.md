---
id: J14
title: Start a processing run from a Target and create its Project on the way
version: 2
status: draft
last_reviewed: 2026-07-14
actors: [primary-user]
surfaces: [targets, planning, projects, sessions, home, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D-W1, D-W8, D-W17, D-W23, D-W30, D-W33, D-W36, D-W37, D-W47, D-W49, D-W50, D-W59, D-W60, D-W61, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md]
---

## Goal

The user knows what to shoot and process next: NGC 7000. They find it on the
Targets list, check that it fits their RedCat rig, and choose **Start a
processing run** on its Target page before any Project exists. PlateVault first
asks for a Project, creates `NGC 7000 HOO` prefilled with the Target, and only
then creates the run inside it. Later the user adds the other-camera session
to the same Project from the **Not in any Project** filter. Done means:

- The run `NGC7000-HOO-Siril` exists only inside `NGC 7000 HOO` and offers no move or share to another Project.
- The Project and its Target stay linked by identity, and a rename keeps the link.
- Adding the other-camera session adds its rig to the Project with a visible note, but the existing run keeps its own rig.
- No file is written, moved or renamed, and no quality state changes.

## Preconditions

- P1: J19 completed through S15. All seven light sessions have confirmed Target NGC 7000, the six RedCat sessions read rig RedCat 51 / ASI2600MM, the other-camera session reads rig Esprit 100 / ASI533MC, and `Cold-1` is offline.
- P2: No Project and no processing run exist. My targets has no ★ favourite.
- P3: Settings > Equipment holds rig RedCat 51 / ASI2600MM with a 250 mm focal length and the ASI2600MM sensor size and pixel size, so its field of view is known. Its filter list holds Ha and OIII.
- P4: A manifest (relative path, size, SHA-256) of every file under the J19 folders, recorded outside PlateVault before S1, with `Cold-1` remounted for the recording and ejected again afterwards.

## Steps

### S1 — Find NGC 7000 on the Targets list {#S1}

- **Do:** From Home, open **Targets**. Search for `ngc7000`. Choose **Add to targets** on the NGC 7000 result. In the toolbar rig selector, choose RedCat 51 / ASI2600MM.
- **Expect:** Targets opens on **My targets**, which is empty before the search. The search lists NGC 7000 from the bundled catalogues with its source, and `ngc7000` matches the same Target as `NGC 7000`. After **Add to targets**, NGC 7000 is listed under My targets with ★ set. Choosing the rig adds a Fit column, and NGC 7000's Fit reads "fits": its major axis is about 2° against the rig's 3.6° shorter side. The Filters strip shows only the bands the rig's filters pass, Ha and OIII.
- **Expect (negative):** Adding a Target to My targets creates no Project and assigns no session to anything.
- **Trace:** Targets list · PLAN-TGT-FR-01, PLAN-TGT-FR-03, PLAN-TGT-FR-11, PLAN-TGT-FR-06 · PLAN-TGT-AC-03, PLAN-TGT-AC-11 · D-W17, D-W23, D-W61

### S2 — Open the Target page {#S2}

- **Do:** Open NGC 7000's Target page from its row.
- **Expect:** The Target page shows captured, library-wide usable and Unreviewed integration by channel. Ha reads captured 12h 35m (151 frames, both rigs) and OIII reads captured 10h 35m (127 frames). The 12 Sep OIII contribution (2h 00m) reads Offline. Usable reads 0h 00m for both channels, and Unreviewed equals captured. **Start a processing run** and **New Project** are offered, and the page lists no Project.
- **Trace:** flow B1 · LIB-FR-08 · LIB-AC-05 · VSEL-FR-01

### S3 — Start a run with no Project {#S3}

- **Do:** Click **Start a processing run**.
- **Expect:** Before any run exists, PlateVault asks for **Create Project** or **Add to Project**. **Add to Project** lists no Project, because none exists.
- **Expect (negative):** No run is created at this point, and no standalone or Target-only run is offered.
- **Trace:** flow B4 · VSEL-FR-01 · VSEL-AC-16 · root FR-003, FR-013 · D-W1, D-W8

### S4 — Create the prefilled Project {#S4}

- **Do:** Choose **Create Project**. Enter the name `NGC 7000 HOO`. Add rig RedCat 51 / ASI2600MM and apply the built-in HOO goal template. Save.
- **Expect:** The New Project form opens with subject NGC 7000 already filled in. Applying HOO copies the goals Ha 10h and OIII 10h into the Project. After saving, Ha reads `0h00 in project · 9h15 captured · goal 10h`, and OIII reads `0h00 in project · 10h35 captured · goal 10h`. Both goals are unmet, although OIII captured exceeds its goal. PlateVault then creates the run: subject NGC 7000 and rig RedCat 51 / ASI2600MM are the only choices. The user names the run `NGC7000-HOO-Siril`, and it opens at its Select step inside the Project.
- **Expect (negative):** The captured values leave out the Esprit 100 / ASI533MC session, because that rig is not on the Project. The Project stays open; no goal state marks it Done.
- **Trace:** flow B2, B4 · PRJ-FR-01, PRJ-FR-02, PRJ-FR-04, PRJ-FR-10, PRJ-FR-12 · PRJ-AC-01, PRJ-AC-03, PRJ-AC-14 · VSEL-AC-16 · D-W30, D-W36, D-W47

### S5 — Read the run's candidates and ownership {#S5}

- **Do:** In the run's Select step, read the session picker and the run's header.
- **Expect:** The header names Project `NGC 7000 HOO`, subject NGC 7000 and rig RedCat 51 / ASI2600MM. The picker lists the six RedCat sessions with the reason `Target NGC 7000 on RedCat 51 / ASI2600MM`. The five available sessions (18, 24, 26, 28 and 30 Sep) start selected, and 12 Sep is flagged Offline.
- **Expect (negative):** The other-camera session is not listed, even after the picker's filters are cleared. The run offers no control to move it to another Project or to share it with one.
- **Trace:** flow C2 · VSEL-FR-01, VSEL-FR-03, VSEL-FR-09 · VSEL-AC-01, VSEL-AC-16, VSEL-AC-18 · D-W8, D-W37, D-W49

### S6 — Check the link from both sides and rename {#S6}

- **Do:** Open Targets on My targets, then open NGC 7000's Target page. Rename the Project to `NGC 7000 HOO bicolour`, then open the Target page again. Rename the Project back to `NGC 7000 HOO`.
- **Expect:** My targets lists NGC 7000 with a Project badge naming `NGC 7000 HOO`. The Target page lists the Project, and choosing it opens the Project page with NGC 7000 as its subject. After the rename, the badge and the Target page show the new name, and the Project page still shows subject NGC 7000 and the run `NGC7000-HOO-Siril`.
- **Expect (negative):** Renaming leaves the subject, the run and its Target attached, because the link is by identity.
- **Trace:** Projects surface · PRJ-FR-01, PRJ-FR-07 · PLAN-TGT-FR-01 · PLAN-TGT-AC-16 · D-W60

### S7 — Add the other-camera session from Not in any Project {#S7}

- **Do:** Open Sessions and choose the **Not in any Project** filter. On the other-camera session's row, choose **Add to Project** and pick `NGC 7000 HOO`. Read the confirmation, then save. Return to Home and to the run's Select step.
- **Expect:** Before saving, **Not in any Project** lists exactly the other-camera session. Its row offers **Create Project** and **Add to Project**. The confirmation has a visible note that rig Esprit 100 / ASI533MC will be added to the Project. After saving, the Project lists both rigs, and Ha reads `0h00 in project · 12h35 captured · goal 10h`. **Not in any Project** lists no session, and Home's top line reads `0 sessions need a Target · 0 not in any Project`.
- **Expect (negative):** Adding the session assigns it to no run. The picker of `NGC7000-HOO-Siril` still lists only RedCat sessions, because a run's rig is fixed at creation.
- **Trace:** Sessions filters · LIB-FR-17 · LIB-AC-18 · PRJ-FR-19 · PRJ-AC-09 · VSEL-AC-18 · D-W37, D-W50, D-W59

### S8 — Confirm there were no side effects {#S8}

- **Do:** Outside PlateVault, remount `Cold-1`, recompute the P4 manifest and eject `Cold-1` again. In Sessions, read the quality of every frame.
- **Expect:** Every path, size and SHA-256 equals P4, and every frame still reads Unreviewed.
- **Expect (negative):** No run folder, prepared link or copy exists on disk. Creating the Project and the run and adding the rig moved, renamed or wrote no file, and changed no quality state.
- **Trace:** PRJ-FR-05 · PRJ-AC-02 · root FR-001

## Success criteria

- SC1: Zero runs exist after S3, and exactly one run, `NGC7000-HOO-Siril` in `NGC 7000 HOO`, exists after S4.
- SC2: At S4, Ha reads 9h15 captured and OIII reads 10h35 captured, both with 0h00 in project and unmet.
- SC3: The S5 picker lists 6 sessions with 5 selected and 0 Esprit sessions. The run offers 0 move or share controls.
- SC4: After the S6 rename, the badge, the Target page and the Project page all show the new name, and the subject is still NGC 7000.
- SC5: After S7, the Project lists 2 rigs and Ha reads 12h35 captured, and the run's picker still lists 0 Esprit sessions.
- SC6: The S8 manifest equals P4 for 100% of files, and 0 frames have a quality other than Unreviewed.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows specs 063 to 072 at e4476231 and the workflow decisions of 2026-10-06. No implementation has been validated against them.
- G2: Unresolved implementation qualification: S1 assumes NGC 7000's catalogued major axis is about 2°. The bundled catalogue's size value has not been checked, so the exact coverage behind "fits" is unverified. Blocks readiness.
- G3: Out of scope for this journey: **Add to Project** from a Target into an existing Project and a mosaic subject. J20 covers the refusal to remove a rig that a run uses, and J33 covers mosaics.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S6, S7, +S8 · behavior-change
  Every processing run now lives in a Project. Starting a run from a Target first asks for Create Project or Add to Project, the Project is prefilled from the Target, and the run is created inside it. The Targets list (My targets, search, rig selector, Fit) replaces the planner columns, and Add to Project from Not in any Project adds the session's rig with a note. The legacy wizard defects of v1 no longer apply.
  Evidence: D-W1, D-W8, D-W17, D-W23, D-W33, D-W37, D-W50, D-W59, D-W60 and VSEL-FR-01, VSEL-AC-16, PRJ-FR-01, PRJ-FR-19, LIB-FR-17, PLAN-TGT-FR-01, PLAN-TGT-FR-11 at e4476231 · by: agent (intent-gated, user instruction)
